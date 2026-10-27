import React from "react";
import { LINE_COLUMNS } from "@/components/invoices/lineItemLayout";
import { useI18n } from "@/lib/i18n/I18nContext";

// Column headings for the line item editor. They are on screen from the first moment and stay
// there whether or not the fields hold values, so no field is identified by a placeholder alone.
// Below lg the headings are replaced by a permanent label on each field.
export default function InvoiceLinesHeader() {
  const { t } = useI18n();

  return (
    <div
      className={`hidden text-xs font-medium text-muted-foreground lg:grid lg:items-center lg:gap-3 lg:pb-2 ${LINE_COLUMNS}`}
    >
      <span>{t("common.description")}</span>
      <span>{t("common.quantity")}</span>
      <span>{t("common.unit_price")}</span>
      <span>{t("invoices.vat_rate")}</span>
      <span className="text-right">{t("invoices.line_total")}</span>
      <span className="text-right">{t("common.actions")}</span>
    </div>
  );
}