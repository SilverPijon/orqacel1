import React, { useEffect, useRef } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useSession } from "@/lib/SessionContext";
import { listBankAccounts } from "@/lib/bank-accounts-fns";
import { pickDefaultAccount } from "@/lib/bankAccounts";
import { formatIban } from "@/lib/iban";
import { referenceProblem, referenceStandardIdForCountry } from "@/lib/paymentReference";
import { useI18n } from "@/lib/i18n/I18nContext";

// A detail the invoice takes from the chosen bank account: shown here, never typed here, so a
// company's bank details keep one source of truth in settings.
function BankValue({ children }) {
  return (
    <div className="mt-1.5 flex h-9 items-center rounded-md border border-input bg-muted/40 px-3 text-sm font-medium">
      {children}
    </div>
  );
}

// The payment details of an invoice: which account it is paid into, the reference the customer
// quotes, and what the payment covers. Nothing is invented: without a saved account the section
// says so and points at settings rather than filling in bank details of its own.
// Offered in the account list only while the draft still names an account that has been deleted. It
// is never selectable; it exists so the list tells the truth instead of showing an empty choice.
const MISSING = "unavailable";

export default function InvoicePaymentFields({ value, onChange, preselectDefault = false, frozen = null }) {
  const { t } = useI18n();
  const { activeCompany } = useSession();
  const fetchAccounts = useServerFn(listBankAccounts);

  const accountsQuery = useQuery({
    queryKey: ["bank-accounts", activeCompany?.id],
    queryFn: () => fetchAccounts(),
    enabled: Boolean(activeCompany?.id),
  });
  const accounts = accountsQuery.data || [];
  const selected = accounts.find((account) => account.id === value.bank_account_id) || null;
  // The account this draft names is not among the company's accounts any more: it was deleted after
  // being chosen. What the invoice already shows stays as it is until someone decides otherwise.
  const missing = Boolean(value.bank_account_id) && !selected && !accountsQuery.isLoading;
  const details = selected || (missing ? frozen : null);

  // A brand new invoice starts from the account the company marked as its default, once. An existing
  // draft never has its account changed here: the app does not substitute the default for one that
  // has gone, and does not put a selection back after someone cleared it.
  const defaultApplied = useRef(false);
  useEffect(() => {
    if (!preselectDefault || defaultApplied.current) return;
    if (value.bank_account_id || !accounts.length) return;
    defaultApplied.current = true;
    const preferred = pickDefaultAccount(accounts);
    if (preferred) onChange("bank_account_id", preferred.id);
  }, [preselectDefault, accounts, value.bank_account_id, onChange]);

  const country = activeCompany?.country || "";
  const reference = value.payment_reference || "";
  const generatedReference = Boolean(referenceStandardIdForCountry(country));
  // The same check the server runs before saving, so a reference that cannot be stored is flagged
  // while it is being typed. A country without a domestic scheme is judged on shape only.
  const referenceLooksWrong = Boolean(referenceProblem({ reference, country }));

  return (
    <section className="rounded-2xl border border-border bg-card p-5 sm:p-6">
      <header className="mb-5">
        <h2 className="font-heading text-base font-semibold">{t("payments.title")}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{t("payments.desc")}</p>
      </header>

      {accountsQuery.isLoading ? (
        <div className="flex h-9 items-center">
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        </div>
      ) : accounts.length || missing ? (
        <div className="grid gap-4 sm:grid-cols-2">
          {missing ? (
            <div className="rounded-xl border border-destructive/40 bg-destructive/5 p-4 sm:col-span-2">
              <p className="text-sm font-medium">{t("payments.account_missing_title")}</p>
              <p className="mt-1 text-sm text-muted-foreground">{t("payments.account_missing_desc")}</p>
            </div>
          ) : null}
          <div className="sm:col-span-2">
            <Label>{t("payments.bank_account")}</Label>
            <Select
              value={selected ? selected.id : missing ? MISSING : "none"}
              onValueChange={(next) => onChange("bank_account_id", next === "none" ? "" : next)}
            >
              <SelectTrigger className="mt-1.5">
                <SelectValue placeholder={t("payments.bank_account")} />
              </SelectTrigger>
              <SelectContent className="max-h-72">
                {missing ? (
                  <SelectItem value={MISSING} disabled>
                    {t("payments.bank_account_missing")}
                  </SelectItem>
                ) : null}
                <SelectItem value="none">{t("payments.bank_account_none")}</SelectItem>
                {accounts.map((account) => (
                  <SelectItem key={account.id} value={account.id}>
                    {[account.account_holder, formatIban(account.iban), account.is_default ? t("bank.default_badge") : null]
                      .filter(Boolean)
                      .join(" · ")}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label>{t("bank.account_holder")}</Label>
            <BankValue>{details?.account_holder || "—"}</BankValue>
          </div>
          <div>
            <Label>{t("bank.iban")}</Label>
            <BankValue>
              <span className="font-mono text-xs">{details?.iban ? formatIban(details.iban) : "—"}</span>
            </BankValue>
          </div>

          {details?.bank_name ? (
            <div>
              <Label>{t("bank.bank_name")}</Label>
              <BankValue>{details.bank_name}</BankValue>
            </div>
          ) : null}
          {details?.bic ? (
            <div>
              <Label>{t("bank.bic")}</Label>
              <BankValue>
                <span className="font-mono text-xs">{details.bic}</span>
              </BankValue>
            </div>
          ) : null}

          <div>
            <Label htmlFor="invoice-reference">{t("payments.reference")}</Label>
            <Input
              id="invoice-reference"
              className="mt-1.5 font-mono"
              inputMode={generatedReference ? "numeric" : "text"}
              value={reference}
              onChange={(event) => onChange("payment_reference", event.target.value)}
            />
            {generatedReference ? (
              <p className="mt-1 text-xs text-muted-foreground">{t("payments.reference_hint")}</p>
            ) : null}
            {referenceLooksWrong ? (
              <p className="mt-1 text-xs text-destructive">{t("payments.reference_check")}</p>
            ) : null}
          </div>
          <div>
            <Label htmlFor="invoice-payment-terms">{t("payments.terms")}</Label>
            <Input
              id="invoice-payment-terms"
              className="mt-1.5"
              value={value.payment_terms || ""}
              onChange={(event) => onChange("payment_terms", event.target.value)}
            />
          </div>

          <div className="sm:col-span-2">
            <Label htmlFor="invoice-payment-description">{t("payments.description")}</Label>
            <Input
              id="invoice-payment-description"
              className="mt-1.5"
              value={value.payment_description || ""}
              onChange={(event) => onChange("payment_description", event.target.value)}
            />
          </div>

          <div>
            <Label htmlFor="invoice-service-date">{t("payments.service_date")}</Label>
            <Input
              id="invoice-service-date"
              type="date"
              className="mt-1.5"
              value={value.service_date || ""}
              onChange={(event) => onChange("service_date", event.target.value)}
            />
          </div>
          <div>
            <Label>{t("payments.service_period")}</Label>
            <div className="mt-1.5 flex items-center gap-2">
              <Input
                type="date"
                aria-label={t("payments.period_from")}
                value={value.service_period_start || ""}
                onChange={(event) => onChange("service_period_start", event.target.value)}
              />
              <span className="text-sm text-muted-foreground">–</span>
              <Input
                type="date"
                aria-label={t("payments.period_to")}
                value={value.service_period_end || ""}
                onChange={(event) => onChange("service_period_end", event.target.value)}
              />
            </div>
          </div>
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-border bg-muted/30 p-4">
          <p className="text-sm font-medium">{t("payments.no_account")}</p>
          <p className="mt-1 text-sm text-muted-foreground">{t("payments.no_account_desc")}</p>
          <Button asChild variant="outline" size="sm" className="mt-3">
            <Link to="/settings">{t("payments.manage")}</Link>
          </Button>
        </div>
      )}
    </section>
  );
}