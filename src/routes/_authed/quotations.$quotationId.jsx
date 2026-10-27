import React, { useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ArrowLeft, Briefcase, Loader2, Pencil } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import PageHeader from "@/components/PageHeader";
import StatusBadge from "@/components/StatusBadge";
import EmptyState from "@/components/EmptyState";
import ConfirmDeleteDialog from "@/components/ConfirmDeleteDialog";
import DownloadQuotationPdfButton from "@/components/quotations/DownloadQuotationPdfButton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useSession } from "@/lib/SessionContext";
import {
  createJobFromQuotation,
  deleteQuotation,
  getQuotation,
  updateQuotationStatus,
} from "@/lib/quotations-fns";
import { formatDate, formatMoney, round2 } from "@/lib/format";
import { hasConfiguredVat } from "@/lib/quotationTax";
import { QUOTATION_STATUS } from "@/lib/statusMeta";
import { useI18n } from "@/lib/i18n/I18nContext";

export const Route = createFileRoute("/_authed/quotations/$quotationId")({
  head: () => ({ meta: [{ title: "Orqacel — Quotation" }] }),
  component: QuotationDetailPage,
});

function QuotationDetailPage() {
  const { quotationId } = Route.useParams();
  const { t, lang } = useI18n();
  const { activeCompany, permissions } = useSession();
  const navigate = useNavigate();
  const fetchQuotation = useServerFn(getQuotation);
  const statusFn = useServerFn(updateQuotationStatus);
  const deleteFn = useServerFn(deleteQuotation);
  const jobFn = useServerFn(createJobFromQuotation);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const query = useQuery({
    queryKey: ["quotation", quotationId],
    queryFn: () => fetchQuotation({ data: { id: quotationId } }),
  });

  if (query.isLoading) {
    return (
      <div className="grid min-h-[40vh] place-items-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const quotation = query.data?.quotation;
  if (!quotation) return <EmptyState title={t("common.not_found")} />;

  const client = query.data?.client;
  const currency = quotation.currency || activeCompany?.currency || "EUR";
  const meta = QUOTATION_STATUS[quotation.status] || QUOTATION_STATUS.draft;
  const lines = quotation.line_items || [];

  const setStatus = async (status) => {
    setBusy(true);
    try {
      await statusFn({ data: { id: quotation.id, status } });
      await query.refetch();
      toast.success(t("common.saved"));
    } catch (error) {
      toast.error(error?.message || t("common.error"));
    } finally {
      setBusy(false);
    }
  };

  const convertToJob = async () => {
    setBusy(true);
    try {
      const job = await jobFn({ data: { id: quotation.id } });
      toast.success(t("quotations.job_created"));
      navigate({ to: "/jobs/$jobId", params: { jobId: job.id } });
    } catch (error) {
      toast.error(error?.message || t("common.error"));
    } finally {
      setBusy(false);
    }
  };

  const confirmDelete = async () => {
    setDeleting(true);
    try {
      await deleteFn({ data: { id: quotation.id } });
      toast.success(t("common.saved"));
      navigate({ to: "/quotations" });
    } catch (error) {
      toast.error(error?.message || t("common.error"));
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-4xl">
      <Button variant="ghost" size="sm" className="mb-4 gap-2" asChild>
        <Link to="/quotations">
          <ArrowLeft className="h-4 w-4" />
          {t("common.back")}
        </Link>
      </Button>

      <PageHeader title={`${quotation.number}${quotation.subject ? ` · ${quotation.subject}` : ""}`} subtitle={quotation.client_name}>
        <StatusBadge label={t(meta.key)} tone={meta.tone} />
        <DownloadQuotationPdfButton quotation={quotation} client={client} currency={currency} />
        <Button asChild variant="outline" className="gap-2">
          <Link to="/quotations/$quotationId/edit" params={{ quotationId: quotation.id }}>
            <Pencil className="h-4 w-4" />
            {t("common.edit")}
          </Link>
        </Button>
      </PageHeader>

      <section className="rounded-2xl border border-border bg-card shadow-card p-5 sm:p-6">
        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">{t("quotations.for_client")}</p>
            <p className="mt-1 text-sm font-medium">
              {client ? (
                <Link to="/clients/$clientId" params={{ clientId: client.id }} className="hover:text-primary hover:underline">
                  {quotation.client_name}
                </Link>
              ) : (
                quotation.client_name || "—"
              )}
            </p>
            {client?.email ? <p className="text-xs text-muted-foreground">{client.email}</p> : null}
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">{t("quotations.issue_date")}</p>
            <p className="mt-1 text-sm font-medium">{formatDate(quotation.issue_date, lang)}</p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">{t("quotations.valid_until")}</p>
            <p className="mt-1 text-sm font-medium">{formatDate(quotation.valid_until, lang)}</p>
          </div>
        </div>

        <div className="mt-6 overflow-hidden rounded-xl border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("common.description")}</TableHead>
                <TableHead className="text-right">{t("common.quantity")}</TableHead>
                <TableHead className="text-right">{t("common.unit_price")}</TableHead>
                <TableHead className="text-right">{t("common.amount")}</TableHead>
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
                    <TableCell className="text-right font-mono text-xs tabular-nums font-semibold">
                      {formatMoney(round2((line.quantity || 0) * (line.unit_price || 0)), currency, lang)}
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={4} className="py-6 text-center text-sm text-muted-foreground">
                    {t("quotations.no_items")}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>

        <div className="mt-5 flex flex-col gap-2 sm:items-end">
          <div className="flex w-full items-center justify-between gap-4 sm:w-64">
            <span className="text-sm text-muted-foreground">{t("common.subtotal")}</span>
            <span className="font-mono text-sm tabular-nums">{formatMoney(quotation.subtotal, currency, lang)}</span>
          </div>
          {hasConfiguredVat(quotation) ? (
            <div className="flex w-full items-center justify-between gap-4 sm:w-64">
              <span className="text-sm text-muted-foreground">
                {t("common.tax")} ({quotation.tax_rate || 0}%)
              </span>
              <span className="font-mono text-sm tabular-nums">{formatMoney(quotation.tax_amount, currency, lang)}</span>
            </div>
          ) : null}
          <div className="flex w-full items-center justify-between gap-4 border-t border-border pt-2 sm:w-64">
            <span className="text-sm font-semibold">{t("common.total")}</span>
            <span className="font-mono text-base font-bold tabular-nums">{formatMoney(quotation.total, currency, lang)}</span>
          </div>
        </div>

        {quotation.notes ? (
          <div className="mt-6 border-t border-border pt-4">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">{t("common.notes")}</p>
            <p className="mt-1 whitespace-pre-line text-sm">{quotation.notes}</p>
          </div>
        ) : null}
      </section>

      <div className="mt-6 flex flex-wrap gap-2">
        {quotation.status === "draft" ? (
          <Button variant="outline" disabled={busy} onClick={() => setStatus("sent")}>
            {t("quotations.mark_sent")}
          </Button>
        ) : null}
        {quotation.status !== "accepted" ? (
          <Button variant="outline" disabled={busy} onClick={() => setStatus("accepted")}>
            {t("quotations.mark_accepted")}
          </Button>
        ) : null}
        {quotation.status !== "declined" ? (
          <Button variant="outline" disabled={busy} onClick={() => setStatus("declined")}>
            {t("quotations.mark_declined")}
          </Button>
        ) : null}
        {quotation.status === "accepted" ? (
          quotation.job_id ? (
            <Button asChild variant="outline" className="gap-2">
              <Link to="/jobs/$jobId" params={{ jobId: quotation.job_id }}>
                <Briefcase className="h-4 w-4" />
                {t("jobs.title")}
              </Link>
            </Button>
          ) : (
            <Button disabled={busy} className="gap-2" onClick={convertToJob}>
              <Briefcase className="h-4 w-4" />
              {t("quotations.create_job")}
            </Button>
          )
        ) : null}
        {permissions.canManage ? (
          <Button variant="ghost" className="text-destructive hover:text-destructive" onClick={() => setConfirming(true)}>
            {t("common.delete")}
          </Button>
        ) : null}
      </div>

      <ConfirmDeleteDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={t("quotations.delete_title")}
        description={t("quotations.delete_desc")}
        onConfirm={confirmDelete}
        pending={deleting}
      />
    </div>
  );
}