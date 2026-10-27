import React from "react";
import { Link } from "@tanstack/react-router";
import { formatDate } from "@/lib/format";
import { formatIban } from "@/lib/iban";
import { useI18n } from "@/lib/i18n/I18nContext";

function Detail({ label, mono = false, children }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={`mt-1 break-words text-sm font-medium ${mono ? "font-mono" : ""}`}>{children}</p>
    </div>
  );
}

// How this invoice is paid. Everything shown here comes from the invoice's own record: the payment
// snapshot written when it was created and frozen again at issue, so changing the company's bank
// settings later cannot rewrite a document that already exists.
export default function InvoicePaymentDetails({ invoice }) {
  const { t, lang } = useI18n();
  const frozen = invoice.payment_snapshot || {};

  // An invoice made before payment details existed still shows anything it does carry.
  const details = {
    account_holder: frozen.account_holder || "",
    iban: frozen.iban || "",
    bank_name: frozen.bank_name || "",
    bic: frozen.bic || "",
    reference: frozen.reference || invoice.payment_reference || "",
    description: frozen.description || invoice.payment_description || "",
    terms: frozen.terms || invoice.payment_terms || "",
    service_date: frozen.service_date || invoice.service_date || "",
    service_period_start: frozen.service_period_start || invoice.service_period_start || "",
    service_period_end: frozen.service_period_end || invoice.service_period_end || "",
  };

  const hasDetails = Object.values(details).some(Boolean);
  const period =
    details.service_period_start || details.service_period_end
      ? `${details.service_period_start ? formatDate(details.service_period_start, lang) : "—"} – ${
          details.service_period_end ? formatDate(details.service_period_end, lang) : "—"
        }`
      : "";

  return (
    <section className="mt-6 rounded-2xl border border-border bg-card shadow-card p-5 sm:p-6">
      <h2 className="mb-4 type-section-title">{t("payments.title")}</h2>

      {hasDetails ? (
        <div className="grid gap-4 sm:grid-cols-3">
          {details.account_holder ? <Detail label={t("bank.account_holder")}>{details.account_holder}</Detail> : null}
          {details.iban ? (
            <Detail label={t("bank.iban")} mono>
              {formatIban(details.iban)}
            </Detail>
          ) : null}
          {details.bank_name ? <Detail label={t("bank.bank_name")}>{details.bank_name}</Detail> : null}
          {details.bic ? (
            <Detail label={t("bank.bic")} mono>
              {details.bic}
            </Detail>
          ) : null}
          {details.reference ? (
            <Detail label={t("payments.reference")} mono>
              {details.reference}
            </Detail>
          ) : null}
          {details.service_date ? (
            <Detail label={t("payments.service_date")}>{formatDate(details.service_date, lang)}</Detail>
          ) : null}
          {period ? <Detail label={t("payments.service_period")}>{period}</Detail> : null}
          {details.terms ? <Detail label={t("payments.terms")}>{details.terms}</Detail> : null}
          {details.description ? <Detail label={t("payments.description")}>{details.description}</Detail> : null}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          {t("payments.none")}
          {invoice.status === "draft" ? (
            <>
              {" "}
              <Link to="/settings" className="underline">
                {t("payments.manage")}
              </Link>
            </>
          ) : null}
        </p>
      )}
    </section>
  );
}