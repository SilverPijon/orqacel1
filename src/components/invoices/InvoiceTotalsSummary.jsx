import React from "react";
import { formatMoney } from "@/lib/format";
import { useI18n } from "@/lib/i18n/I18nContext";

// Subtotal, one row per VAT rate used on the invoice, then the total. When VAT was never
// configured no VAT row appears at all, rather than a rate nobody chose being printed as 0%.
export default function InvoiceTotalsSummary({ totals, currency, vatConfigured }) {
  const { t, lang } = useI18n();
  const summary = vatConfigured ? totals?.vat_summary || [] : [];

  return (
    <div className="flex flex-col gap-2 sm:items-end">
      <div className="flex w-full items-center justify-between gap-4 sm:w-72">
        <span className="text-sm text-muted-foreground">{t("common.subtotal")}</span>
        <span className="font-mono text-sm tabular-nums">{formatMoney(totals?.subtotal || 0, currency, lang)}</span>
      </div>
      {summary.map((row) => (
        <div key={row.rate} className="flex w-full items-center justify-between gap-4 sm:w-72">
          <span className="text-sm text-muted-foreground">
            {t("invoices.vat")} ({row.rate}%)
          </span>
          <span className="font-mono text-sm tabular-nums">{formatMoney(row.amount, currency, lang)}</span>
        </div>
      ))}
      <div className="flex w-full items-center justify-between gap-4 border-t border-border pt-2 sm:w-72">
        <span className="text-sm font-semibold">{t("common.total")}</span>
        <span className="font-mono text-base font-bold tabular-nums">{formatMoney(totals?.total || 0, currency, lang)}</span>
      </div>
    </div>
  );
}