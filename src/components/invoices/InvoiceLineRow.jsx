import React from "react";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatMoney } from "@/lib/format";
import { LINE_ROW_CLASS } from "@/components/invoices/lineItemLayout";
import { useI18n } from "@/lib/i18n/I18nContext";

// On wide screens the header row names each column. Below lg the header is not on screen, so every
// field carries its own permanent label instead.
function FieldLabel({ children }) {
  return <span className="mb-1 block text-xs font-medium text-muted-foreground lg:hidden">{children}</span>;
}

// A numeric field shared by quantity, unit price and the VAT rate.
function NumberField({ label, value, onChange, max, placeholder }) {
  return (
    <div>
      <FieldLabel>{label}</FieldLabel>
      {/* Entered values are shown at full contrast in weighted, aligned figures, so a lone default
          1 or 0 is never mistaken for an empty field. */}
      <Input
        type="number"
        min="0"
        max={max}
        step="0.01"
        inputMode="decimal"
        className="font-medium tabular-nums text-foreground"
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        aria-label={label}
      />
    </div>
  );
}

// One invoice line: description, quantity, unit price and that line's own VAT rate, so a single
// invoice can mix rates. An empty VAT field means no rate was configured, which is not the same as
// a deliberate 0%: the field says "not set" until a rate is entered. The line total is read-only
// and follows quantity and unit price on every change.
export default function InvoiceLineRow({ line, index, lineTotal, currency, canRemove, onUpdate, onRemove }) {
  const { t, lang } = useI18n();
  const set = (field) => (event) => onUpdate(index, field, event.target.value);

  const deleteButton = (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className="shrink-0 text-muted-foreground hover:text-destructive"
      onClick={() => onRemove(index)}
      disabled={!canRemove}
      aria-label={t("common.delete")}
    >
      <Trash2 className="h-4 w-4" />
    </Button>
  );

  return (
    <div className={LINE_ROW_CLASS}>
      {/* narrow screens: which line this is, and its delete action within easy reach */}
      <div className="flex items-center justify-between gap-2 lg:hidden">
        <span className="text-xs font-semibold text-muted-foreground">
          {t("invoices.line")} {index + 1}
        </span>
        {deleteButton}
      </div>

      <div>
        <FieldLabel>{t("common.description")}</FieldLabel>
        <Input value={line.description} onChange={set("description")} aria-label={t("common.description")} />
      </div>

      {/* two compact columns on a phone, two columns of the grid's template on desktop */}
      <div className="grid grid-cols-2 gap-3 lg:contents">
        <NumberField label={t("common.quantity")} value={line.quantity} onChange={set("quantity")} />
        <NumberField label={t("common.unit_price")} value={line.unit_price} onChange={set("unit_price")} />
      </div>

      {/* the two narrowest phones stack these instead, so the longest "not set" placeholder is never
          squeezed into a field too small to show it */}
      <div className="grid grid-cols-1 gap-3 min-[360px]:grid-cols-2 lg:contents">
        <NumberField
          label={t("invoices.vat_rate")}
          value={line.vat_rate}
          onChange={set("vat_rate")}
          max="100"
          placeholder={t("invoices.vat_not_set")}
        />
        <div>
          <FieldLabel>{t("invoices.line_total")}</FieldLabel>
          <div className="flex h-9 items-center justify-end rounded-md bg-muted/50 px-2.5 font-mono text-sm font-semibold tabular-nums">
            {formatMoney(lineTotal || 0, currency, lang)}
          </div>
        </div>
      </div>

      <div className="hidden justify-end lg:flex">{deleteButton}</div>
    </div>
  );
}