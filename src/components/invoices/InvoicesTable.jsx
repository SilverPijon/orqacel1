import React from "react";
import { Link } from "@tanstack/react-router";
import { MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import StatusBadge from "@/components/StatusBadge";
import { INVOICE_STATUS } from "@/lib/statusMeta";
import { isDraft } from "@/lib/invoiceLifecycle";
import { formatDate, formatMoney } from "@/lib/format";
import { useI18n } from "@/lib/i18n/I18nContext";

export default function InvoicesTable({ invoices, onEdit, onDelete, canManage }) {
  const { t, lang } = useI18n();

  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-card">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("invoices.number")}</TableHead>
            <TableHead className="hidden md:table-cell">{t("invoices.customer")}</TableHead>
            <TableHead className="hidden lg:table-cell">{t("invoices.issue_date")}</TableHead>
            <TableHead className="hidden xl:table-cell">{t("invoices.due_date")}</TableHead>
            <TableHead className="hidden sm:table-cell">{t("common.status")}</TableHead>
            <TableHead className="text-right">{t("common.total")}</TableHead>
            <TableHead className="w-12" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {invoices.map((invoice) => (
            <TableRow key={invoice.id}>
              <TableCell className="font-mono text-xs font-semibold">
                <Link
                  to="/invoices/$invoiceId"
                  params={{ invoiceId: invoice.id }}
                  className="hover:text-primary hover:underline"
                >
                  {invoice.number}
                </Link>
                <span className="block font-sans text-xs font-normal text-muted-foreground md:hidden">
                  {invoice.client_name || ""}
                </span>
              </TableCell>
              <TableCell className="hidden md:table-cell text-muted-foreground">
                {invoice.client_name || "—"}
              </TableCell>
              <TableCell className="hidden lg:table-cell text-muted-foreground">
                {formatDate(invoice.issue_date, lang)}
              </TableCell>
              <TableCell className="hidden xl:table-cell text-muted-foreground">
                {formatDate(invoice.due_date, lang)}
              </TableCell>
              <TableCell className="hidden sm:table-cell">
                <StatusBadge
                  label={t(INVOICE_STATUS[invoice.status]?.key || "invoices.status_draft")}
                  tone={INVOICE_STATUS[invoice.status]?.tone}
                />
              </TableCell>
              <TableCell className="text-right font-mono text-xs font-semibold tabular-nums">
                {/* The currency the invoice was written in, never the company's current one. */}
                {formatMoney(invoice.total, invoice.currency || "EUR", lang)}
              </TableCell>
              <TableCell>
                {/* Only a draft may change, and only for owners and admins: anything else has no
                    actions to offer, so no menu is shown at all. */}
                {canManage && isDraft(invoice) ? (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={t("common.actions")}>
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => onEdit(invoice)}>
                        <Pencil className="mr-2 h-4 w-4" />
                        {t("common.edit")}
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => onDelete(invoice)}
                        className="text-destructive focus:text-destructive"
                      >
                        <Trash2 className="mr-2 h-4 w-4" />
                        {t("common.delete")}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                ) : null}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}