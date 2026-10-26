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
import { JOB_PRIORITY, JOB_STATUS } from "@/lib/statusMeta";
import { formatDate, formatMoney } from "@/lib/format";
import { useI18n } from "@/lib/i18n/I18nContext";

export default function JobsTable({ jobs, currency, onEdit, onDelete, canDelete }) {
  const { t, lang } = useI18n();

  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("jobs.job_title")}</TableHead>
            <TableHead className="hidden md:table-cell">{t("quotations.client")}</TableHead>
            <TableHead className="hidden lg:table-cell">{t("jobs.scheduled_date")}</TableHead>
            <TableHead className="hidden sm:table-cell">{t("jobs.priority")}</TableHead>
            <TableHead>{t("common.status")}</TableHead>
            <TableHead className="text-right">{t("jobs.price")}</TableHead>
            <TableHead className="w-12" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {jobs.map((job) => (
            <TableRow key={job.id}>
              <TableCell className="font-medium">
                <Link to="/jobs/$jobId" params={{ jobId: job.id }} className="hover:text-primary hover:underline">
                  {job.title}
                </Link>
                <span className="block text-xs text-muted-foreground md:hidden">{job.client_name || ""}</span>
              </TableCell>
              <TableCell className="hidden md:table-cell text-muted-foreground">{job.client_name || "—"}</TableCell>
              <TableCell className="hidden lg:table-cell text-muted-foreground">
                {formatDate(job.scheduled_date, lang)}
              </TableCell>
              <TableCell className="hidden sm:table-cell">
                <StatusBadge
                  label={t(JOB_PRIORITY[job.priority]?.key || "jobs.priority_medium")}
                  tone={JOB_PRIORITY[job.priority]?.tone}
                />
              </TableCell>
              <TableCell>
                <StatusBadge
                  label={t(JOB_STATUS[job.status]?.key || "jobs.status_scheduled")}
                  tone={JOB_STATUS[job.status]?.tone}
                />
              </TableCell>
              <TableCell className="text-right font-mono text-xs font-semibold">
                {formatMoney(job.price, job.currency || currency, lang)}
              </TableCell>
              <TableCell>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={t("common.actions")}>
                      <MoreHorizontal className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => onEdit(job)}>
                      <Pencil className="mr-2 h-4 w-4" />
                      {t("common.edit")}
                    </DropdownMenuItem>
                    {canDelete ? (
                      <DropdownMenuItem
                        onClick={() => onDelete(job)}
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