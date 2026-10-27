import React from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import InvoiceLinesHeader from "@/components/invoices/InvoiceLinesHeader";
import InvoiceLineRow from "@/components/invoices/InvoiceLineRow";
import { useI18n } from "@/lib/i18n/I18nContext";

// The line items of an invoice: a labelled row per line on wide screens, a compact card per line on
// narrow ones. The editor holds no amounts of its own — it receives the calculated line totals and
// reports every field change back, so the invoice calculation stays exactly where it was.
export default function InvoiceLinesEditor({ lines, lineTotals, currency, onUpdate, onAdd, onRemove }) {
  const { t } = useI18n();

  return (
    <div>
      <div className="space-y-3 lg:space-y-0 lg:divide-y lg:divide-border">
        <InvoiceLinesHeader />
        {lines.map((line, index) => (
          <InvoiceLineRow
            key={index}
            line={line}
            index={index}
            lineTotal={lineTotals?.[index]}
            currency={currency}
            canRemove={lines.length > 1}
            onUpdate={onUpdate}
            onRemove={onRemove}
          />
        ))}
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <Button type="button" variant="outline" size="sm" className="w-full gap-2 sm:w-auto" onClick={onAdd}>
          <Plus className="h-4 w-4" />
          {t("invoices.add_item")}
        </Button>
        <p className="text-xs text-muted-foreground">{t("invoices.vat_hint")}</p>
      </div>
    </div>
  );
}