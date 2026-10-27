// Shaping company bank accounts and the payment details an invoice copies from them. Pure functions,
// shared by the settings panel, the invoice form and the server functions so all three agree on what
// a valid account is and which one an invoice starts from. Nothing here touches the database.
import { isValidBic, isValidIban, normalizeBic, normalizeIban } from "@/lib/iban";

export const ACCOUNT_HOLDER_MAX = 120;
export const BANK_NAME_MAX = 120;

// Reads what a person typed and returns the values as they will be stored, or the one thing that is
// wrong with them. The server runs exactly this before writing, so nothing unvalidated is ever saved.
export function readBankAccountInput(input) {
  const accountHolder = String(input?.account_holder || "").trim();
  const iban = normalizeIban(input?.iban);
  const bankName = String(input?.bank_name || "").trim();
  const bic = normalizeBic(input?.bic);

  if (!accountHolder) return { error: "HOLDER_REQUIRED" };
  if (accountHolder.length > ACCOUNT_HOLDER_MAX) return { error: "HOLDER_TOO_LONG" };
  if (!isValidIban(iban)) return { error: "BAD_IBAN" };
  if (!isValidBic(bic)) return { error: "BAD_BIC" };
  if (bankName.length > BANK_NAME_MAX) return { error: "BANK_NAME_TOO_LONG" };

  return { value: { account_holder: accountHolder, iban, bank_name: bankName, bic } };
}

// The account an invoice starts from: the company's default, or the first one when nothing is marked
// default yet. Returns null when the company has no accounts at all — an invoice is never given
// bank details that do not exist.
export function pickDefaultAccount(accounts) {
  const list = Array.isArray(accounts) ? accounts : [];
  return list.find((account) => account.is_default === true) || list[0] || null;
}

// Whether what an invoice is about to freeze actually tells the customer where to pay. Only a real
// IBAN counts: a snapshot carrying something that is not one leaves the customer unable to pay, so it
// is treated exactly like having no bank details at all.
export function hasPaymentIban(snapshot) {
  return isValidIban(snapshot?.iban || "");
}

// Default first, then by holder and IBAN, so the list reads the same way everywhere.
export function sortAccounts(accounts) {
  return [...(Array.isArray(accounts) ? accounts : [])].sort((a, b) => {
    if (Boolean(b.is_default) !== Boolean(a.is_default)) return b.is_default ? 1 : -1;
    const byHolder = String(a.account_holder || "").localeCompare(String(b.account_holder || ""));
    return byHolder !== 0 ? byHolder : String(a.iban || "").localeCompare(String(b.iban || ""));
  });
}

// Only the fields the app works with ever leave the server. Which account is the default comes from
// the company's single pointer, passed in, not from a flag stored on the account.
export function publicAccount(account, defaultId = "") {
  return {
    id: account.id,
    account_holder: account.account_holder || "",
    iban: account.iban || "",
    bank_name: account.bank_name || "",
    bic: account.bic || "",
    is_default: Boolean(defaultId) && account.id === defaultId,
  };
}

// What an invoice copies from the account the user selected. The invoice keeps these values itself,
// so a later change to the company's bank settings cannot reach an invoice that already exists.
export function paymentIdentityFromAccount(account) {
  return {
    bank_account_id: account?.id || "",
    account_holder: account?.account_holder || "",
    iban: account?.iban || "",
    bank_name: account?.bank_name || "",
    bic: account?.bic || "",
  };
}

// The payment details an invoice holds after a write: the bank identity copied from the selected
// account, and the text entered on the invoice itself.
export function invoicePaymentValues({ account, existing, input }) {
  const identity = account
    ? paymentIdentityFromAccount(account)
    : {
        bank_account_id: existing?.bank_account_id || "",
        account_holder: existing?.payment_snapshot?.account_holder || "",
        iban: existing?.payment_snapshot?.iban || "",
        bank_name: existing?.payment_snapshot?.bank_name || "",
        bic: existing?.payment_snapshot?.bic || "",
      };

  const text = (field, fallback) =>
    input?.[field] !== undefined ? String(input[field] || "").trim() : fallback;

  return {
    ...identity,
    payment_reference: text("payment_reference", existing?.payment_reference || ""),
    payment_description: text("payment_description", existing?.payment_description || ""),
    payment_terms: text("payment_terms", existing?.payment_terms || ""),
    service_date: text("service_date", existing?.service_date || ""),
    service_period_start: text("service_period_start", existing?.service_period_start || ""),
    service_period_end: text("service_period_end", existing?.service_period_end || ""),
  };
}