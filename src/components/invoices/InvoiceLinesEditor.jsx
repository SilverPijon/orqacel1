import React from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatMoney } from "@/lib/format";
import { useI18n } from "@/lib/i18n/I18nContext";

// One row per invoice line: description, quantity, unit price and that line's own VAT rate, so a
// single invoice can mix rates. An empty VAT field means no rate was configured, which is not the
// same as a deliberate 0%.
export default function InvoiceLinesEditor({ lines, lineTotals, currency, onUpdate, onAdd, onRemove }) {
  const { t, lang } = useI18n();

  return (
    <div className="space-y-3">
      {lines.map((line, index) => (
        <div key={index} className="grid gap-2 sm:grid-cols-12">
          <Input
            className="sm:col-span-4"
            value={line.description}
            onChange={(event) => onUpdate(index, "description", event.target.value)}
            placeholder={t("common.description")}
            aria-label={t("common.description")}
          />
          <Input
            className="sm:col-span-2"
            type="number"
            min="0"
            step="0.01"
            value={line.quantity}
            onChange={(event) => onUpdate(index, "quantity", event.target.value)}
            placeholder={t("common.quantity")}
            aria-label={t("common.quantity")}
          />
          <Input
            className="sm:col-span-2"
            type="number"
            min="0"
            step="0.01"
            value={line.unit_price}
            onChange={(event) => onUpdate(index, "unit_price", event.target.value)}
            placeholder={t("common.unit_price")}
            aria-label={t("common.unit_price")}
          />
          <Input
            className="sm:col-span-2"
            type="number"
            min="0"
            max="100"
            step="0.01"
            value={line.vat_rate}
            onChange={(event) => onUpdate(index, "vat_rate", event.target.value)}
            placeholder={t("invoices.vat_rate")}
            aria-label={t("invoices.vat_rate")}
          />
          <div className="flex items-center justify-end gap-1 sm:col-span-2">
            <span className="font-mono text-xs font-semibold">
              {formatMoney(lineTotals[index] || 0, currency, lang)}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-muted-foreground hover:text-destructive"
              onClick={() => onRemove(index)}
              disabled={lines.length === 1}
              aria-label={t("common.delete")}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </div>
      ))}

      <Button type="button" variant="outline" size="sm" className="gap-2" onClick={onAdd}>
        <Plus className="h-4 w-4" />
        {t("invoices.add_item")}
      </Button>
    </div>
  );
}