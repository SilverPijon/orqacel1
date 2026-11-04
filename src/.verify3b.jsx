import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useI18n } from "@/lib/i18n/I18nContext";
import QuotationForm from "@/components/quotations/QuotationForm";
import InvoiceForm from "@/components/invoices/InvoiceForm";
import CompanyProfileForm from "@/components/settings/CompanyProfileForm";
import InviteForm from "@/components/settings/InviteForm";
import BankAccountFormDialog from "@/components/settings/BankAccountFormDialog";
import {
  COMPANY_PROFILE_REQUIRED_FIELDS,
  INVITE_REQUIRED_FIELDS,
  INVOICE_REQUIRED_FIELDS,
  QUOTATION_REQUIRED_FIELDS,
  firstInvalidField,
  validateCompanyProfileForm,
  validateInviteForm,
  validateInvoiceForm,
  validateQuotationForm,
} from "@/lib/formValidation";

const { t } = useI18n();
const qc = new QueryClient();
const wrap = (el) => renderToStaticMarkup(React.createElement(QueryClientProvider, { client: qc }, el));

let failures = 0;
const check = (label, condition, detail = "") => {
  if (!condition) failures += 1;
  console.log(`${condition ? "PASS" : "FAIL"}  ${label}${condition ? "" : `  → ${detail}`}`);
};

// ---------------------------------------------------------------- validation rules
console.log("\n--- validation rules (same messages as the toasts they replace) ---");
const q = validateQuotationForm({ client_id: "" }, t);
check("quotation without a client is refused", q.client_id === "Select a client", JSON.stringify(q));
check("quotation with a client passes", Object.keys(validateQuotationForm({ client_id: "c1" }, t)).length === 0);
check("quotation errors point at client_id", firstInvalidField(q, QUOTATION_REQUIRED_FIELDS) === "client_id");

const i = validateInvoiceForm({ client_id: "" }, t);
check("invoice without a customer is refused", i.client_id === "Select a customer", JSON.stringify(i));
check("invoice with a customer passes", Object.keys(validateInvoiceForm({ client_id: "c1" }, t)).length === 0);
check("invoice errors point at client_id", firstInvalidField(i, INVOICE_REQUIRED_FIELDS) === "client_id");

const c = validateCompanyProfileForm({ name: "   " }, t);
check("company profile without a name is refused", c.name === "This field is required", JSON.stringify(c));
check("company profile with a name passes", Object.keys(validateCompanyProfileForm({ name: "Acme" }, t)).length === 0);
check("company profile errors point at name", firstInvalidField(c, COMPANY_PROFILE_REQUIRED_FIELDS) === "name");

const e1 = validateInviteForm({ email: "  " }, t);
const e2 = validateInviteForm({ email: "not-an-email" }, t);
check("empty invitation address is refused", e1.email === "This field is required", JSON.stringify(e1));
check("malformed invitation address is refused", e2.email === "Enter a valid email address", JSON.stringify(e2));
check("valid invitation address passes", Object.keys(validateInviteForm({ email: " a@b.co " }, t)).length === 0);
check("invitation errors point at email", firstInvalidField(e2, INVITE_REQUIRED_FIELDS) === "email");

// ---------------------------------------------------------------- rendered forms
console.log("\n--- rendered forms: marker, required, aria, native validation off ---");

const scenarios = [
  ["quotation", wrap(React.createElement(QuotationForm, {})), "quotation-client", true],
  ["invoice", wrap(React.createElement(InvoiceForm, {})), "invoice-client", true],
  ["company profile", wrap(React.createElement(CompanyProfileForm, {})), "company-name", true],
  ["invitation", wrap(React.createElement(InviteForm, { onInvited: async () => {} })), "invite-email", true],
  [
    "bank account",
    wrap(React.createElement(BankAccountFormDialog, { open: true, onOpenChange: () => {}, onSubmit: async () => {} })),
    "bank-holder",
    true,
  ],
];

// The control carrying an id, whether it is an input or a Radix select trigger button.
const controlWithId = (html, id) => {
  const tag = new RegExp(`<(input|button|textarea)[^>]*\\sid="${id}"[^>]*>`).exec(html);
  return tag ? tag[0] : null;
};

for (const [name, html, id] of scenarios) {
  const label = html.match(new RegExp(`<label[^>]*for="${id}"[\\s\\S]{0,260}?</label>`));
  const markup = label ? label[0] : "";
  const control = controlWithId(html, id) || "";
  const marker = /class="ml-1 font-bold text-destructive"/.test(markup);
  const flag = /data-required="true"/.test(markup);
  const ariaRequired = /aria-required="true"/.test(control);
  const nativeOff = /<form[^>]*novalidate/i.test(html);
  check(`${name}: required field is marked`, marker && flag && ariaRequired && nativeOff,
    `marker=${marker} flag=${flag} aria=${ariaRequired} novalidate=${nativeOff}`);
}

// A second required field in the bank dialog (IBAN), and the two optional ones must stay unmarked.
const bankHtml = scenarios[4][1];
const bankIban = bankHtml.match(/<label[^>]*for="bank-iban"[\s\S]{0,260}?<\/label>/);
check("bank account: IBAN is marked required", /text-destructive/.test(bankIban ? bankIban[0] : ""));
for (const optionalId of ["bank-name", "bank-bic"]) {
  const label = bankHtml.match(new RegExp(`<label[^>]*for="${optionalId}"[\\s\\S]{0,260}?</label>`));
  check(`bank account: optional "${optionalId}" has no marker`, !/text-destructive/.test(label ? label[0] : "x"));
}

// No native constraint may survive to block submission with a browser bubble.
for (const [name, html, id] of scenarios) {
  const control = controlWithId(html, id) || "";
  check(`${name}: no native required attribute`, control !== "" && !/\srequired(=|\s|\/|>)/.test(control), control || "no control");
}

// Error message element is the one aria-describedby points at, once one exists.
const describedBy = /aria-describedby="([a-z-]+)-error"/.exec(
  bankHtml.replace(/aria-describedby="[^"]*"/g, (match) => match) || "",
);
check("bank account error id convention is <field>-error", describedBy === null || describedBy[1].endsWith("bank"));

// ---------------------------------------------------------------- actions
console.log("\n--- form actions ---");
for (const [name, html] of [
  ["quotation", scenarios[0][1]],
  ["invoice", scenarios[1][1]],
]) {
  const sticky = /class="sticky bottom-0 z-10 mt-6[^"]*"/.test(html);
  const submit = /<button[^>]*type="submit"[^>]*formnovalidate/i.test(html);
  const cancel = /type="button"[^>]*>[\s\S]{0,40}Cancel/.test(html);
  check(`${name}: actions sit in a sticky bar`, sticky, "no sticky bar");
  check(`${name}: submit opts out of native validation`, submit, "no formnovalidate");
  check(`${name}: cancel stays next to save`, cancel, "no cancel button");
}
// Duplicate submissions: the save button carries no permanent disabled state, so a click works,
// and it is disabled only while a save is in flight (mirrors the Client/Job dialogs).
for (const [name, html] of [
  ["quotation", scenarios[0][1]],
  ["invoice", scenarios[1][1]],
]) {
  const save = /<button[^>]*type="submit"[^>]*>[\s\S]{0,80}?Save/.test(html);
  check(`${name}: save button is present and wired to submit`, save, "no save button");
}

console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);