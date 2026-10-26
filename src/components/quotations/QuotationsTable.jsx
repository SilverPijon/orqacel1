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
import { QUOTATION_STATUS } from "@/lib/statusMeta";
import { formatDate, formatMoney } from "@/lib/format";
import { useI18n } from "@/lib/i18n/I18nContext";

export default function QuotationsTable({ quotations, currency, onEdit, onDelete, canDelete }) {
  const { t, lang } = useI18n();

  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("quotations.number")}</TableHead>
            <TableHead className="hidden md:table-cell">{t("quotations.client")}</TableHead>
            <TableHead className="hidden lg:table-cell">{t("quotations.issue_date")}</TableHead>
            <TableHead className="hidden sm:table-cell">{t("common.status")}</TableHead>
            <TableHead className="text-right">{t("common.total")}</TableHead>
            <TableHead className="w-12" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {quotations.map((quotation) => (
            <TableRow key={quotation.id}>
              <TableCell className="font-mono text-xs font-semibold">
                <Link
                  to="/quotations/$quotationId"
                  params={{ quotationId: quotation.id }}
                  className="hover:text-primary hover:underline"
                >
                  {quotation.number}
                </Link>
                <span className="block font-sans text-xs font-normal text-muted-foreground md:hidden">
                  {quotation.client_name || ""}
                </span>
              </TableCell>
              <TableCell className="hidden md:table-cell text-muted-foreground">
                {quotation.client_name || "—"}
              </TableCell>
              <TableCell className="hidden lg:table-cell text-muted-foreground">
                {formatDate(quotation.issue_date, lang)}
              </TableCell>
              <TableCell className="hidden sm:table-cell">
                <StatusBadge
                  label={t(QUOTATION_STATUS[quotation.status]?.key || "quotations.status_draft")}
                  tone={QUOTATION_STATUS[quotation.status]?.tone}
                />
              </TableCell>
              <TableCell className="text-right font-mono text-xs font-semibold">
                {formatMoney(quotation.total, quotation.currency || currency, lang)}
              </TableCell>
              <TableCell>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={t("common.actions")}>
                      <MoreHorizontal className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => onEdit(quotation)}>
                      <Pencil className="mr-2 h-4 w-4" />
                      {t("common.edit")}
                    </DropdownMenuItem>
                    {canDelete ? (
                      <DropdownMenuItem
                        onClick={() => onDelete(quotation)}
                        className="text-destructive focus:text-destructive"
                      >
                        <Trash2 className="mr-2 h-4 w-4" />
                        {t("common.delete")}
                      </DropdownMenuItem>
                    ) : null}
                  </DropdownMenuContent>
                </DropdownMenu>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}