import React from "react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatMoney } from "@/lib/format";
import { useI18n } from "@/lib/i18n/I18nContext";

// The invoice as it was saved: each line shows its own VAT rate and its net line total.
export default function InvoiceLinesTable({ lines, currency }) {
  const { t, lang } = useI18n();

  return (
    <div className="overflow-hidden rounded-xl border border-border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("common.description")}</TableHead>
            <TableHead className="text-right">{t("common.quantity")}</TableHead>
            <TableHead className="text-right">{t("common.unit_price")}</TableHead>
            <TableHead className="text-right">{t("invoices.vat_rate")}</TableHead>
            <TableHead className="text-right">{t("invoices.line_total")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {lines.length ? (
            lines.map((line, index) => (
              <TableRow key={index}>
                <TableCell>{line.description || "—"}</TableCell>
                <TableCell className="text-right font-mono text-xs tabular-nums">{line.quantity}</TableCell>
                <TableCell className="text-right font-mono text-xs tabular-nums">
                  {formatMoney(line.unit_price, currency, lang)}
                </TableCell>
                <TableCell className="text-right font-mono text-xs tabular-nums">{`${line.vat_rate || 0}%`}</TableCell>
                <TableCell className="text-right font-mono text-xs tabular-nums font-semibold">
                  {formatMoney(line.line_total, currency, lang)}
                </TableCell>
              </TableRow>
            ))
          ) : (
            <TableRow>
              <TableCell colSpan={5} className="py-6 text-center text-sm text-muted-foreground">
                {t("common.no_results")}
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}