import React, { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ArrowLeft, FileText, Loader2, Pencil } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import PageHeader from "@/components/PageHeader";
import StatusBadge from "@/components/StatusBadge";
import EmptyState from "@/components/EmptyState";
import ConfirmDeleteDialog from "@/components/ConfirmDeleteDialog";
import JobFormDialog from "@/components/jobs/JobFormDialog";
import { useSession } from "@/lib/SessionContext";
import { deleteJob, getJob, updateJobStatus } from "@/lib/jobs-fns";
import { formatDate, formatMoney } from "@/lib/format";
import { JOB_PRIORITY, JOB_STATUS } from "@/lib/statusMeta";
import { useI18n } from "@/lib/i18n/I18nContext";

export const Route = createFileRoute("/_authed/jobs/$jobId")({
  head: () => ({ meta: [{ title: "Orqacel — Job" }] }),
  component: JobDetailPage,
});

function JobDetailPage() {
  const { jobId } = Route.useParams();
  const { t, lang } = useI18n();
  const { activeCompany, permissions } = useSession();
  const fetchJob = useServerFn(getJob);
  const statusFn = useServerFn(updateJobStatus);
  const deleteFn = useServerFn(deleteJob);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const query = useQuery({
    queryKey: ["job", jobId],
    queryFn: () => fetchJob({ data: { id: jobId } }),
  });

  if (query.isLoading) {
    return (
      <div className="grid min-h-[40vh] place-items-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const job = query.data?.job;
  if (!job) return <EmptyState title={t("common.not_found")} />;

  const client = query.data?.client;
  const currency = job.currency || activeCompany?.currency || "EUR";
  const statusMeta = JOB_STATUS[job.status] || JOB_STATUS.scheduled;
  const priorityMeta = JOB_PRIORITY[job.priority] || JOB_PRIORITY.medium;

  const setStatus = async (status) => {
    setBusy(true);
    try {
      await statusFn({ data: { id: job.id, status } });
      await query.refetch();
      toast.success(t("common.saved"));
    } catch (error) {
      toast.error(error?.message || t("common.error"));
    } finally {
      setBusy(false);
    }
  };

  const confirmDelete = async () => {
    setBusy(true);
    try {
      await deleteFn({ data: { id: job.id } });
      toast.success(t("common.saved"));
      window.history.back();
    } catch (error) {
      toast.error(error?.message || t("common.error"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-4xl">
      <Button variant="ghost" size="sm" className="mb-4 gap-2" asChild>
        <Link to="/jobs">
          <ArrowLeft className="h-4 w-4" />
          {t("common.back")}
        </Link>
      </Button>

      <PageHeader title={job.title} subtitle={job.client_name || undefined}>
        <StatusBadge label={t(priorityMeta.key)} tone={priorityMeta.tone} />
        <StatusBadge label={t(statusMeta.key)} tone={statusMeta.tone} />
        <Button variant="outline" className="gap-2" onClick={() => setEditing(true)}>
          <Pencil className="h-4 w-4" />
          {t("common.edit")}
        </Button>
      </PageHeader>

      <section className="rounded-2xl border border-border bg-card p-5 sm:p-6">
        <dl className="grid gap-4 sm:grid-cols-3">
          {[
            { label: t("quotations.client"), value: job.client_name },
            { label: t("jobs.scheduled_date"), value: formatDate(job.scheduled_date, lang), isDate: true },
            { label: t("jobs.completed_on"), value: formatDate(job.completed_date, lang), isDate: true },
            { label: t("jobs.assigned_to"), value: job.assigned_to_name || t("common.unassigned") },
            { label: t("jobs.price"), value: formatMoney(job.price, currency, lang), isMoney: true },
            { label: t("common.address"), value: job.address },
          ].map((row) => (
            <div key={row.label}>
              <dt className="text-xs uppercase tracking-wide text-muted-foreground">{row.label}</dt>
              <dd className={`mt-1 text-sm ${row.isMoney ? "font-mono font-semibold" : ""}`}>{row.value || "—"}</dd>
            </div>
          ))}
        </dl>

        {job.description ? (
          <div className="mt-6 border-t border-border pt-4">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">{t("common.description")}</p>
            <p className="mt-1 whitespace-pre-line text-sm">{job.description}</p>
          </div>
        ) : null}
      </section>

      <div className="mt-6 flex flex-wrap gap-2">
        {job.status !== "in_progress" && job.status !== "completed" ? (
          <Button variant="outline" disabled={busy} onClick={() => setStatus("in_progress")}>
            {t("jobs.status_in_progress")}
          </Button>
        ) : null}
        {job.status !== "completed" ? (
          <Button variant="outline" disabled={busy} onClick={() => setStatus("completed")}>
            {t("jobs.status_completed")}
          </Button>
        ) : null}
        {job.status !== "cancelled" ? (
          <Button variant="outline" disabled={busy} onClick={() => setStatus("cancelled")}>
            {t("jobs.status_cancelled")}
          </Button>
        ) : null}
        {job.quotation_id ? (
          <Button asChild variant="outline" className="gap-2">
            <Link to="/quotations/$quotationId" params={{ quotationId: job.quotation_id }}>
              <FileText className="h-4 w-4" />
              {t("jobs.linked_quotation")}
            </Link>
          </Button>
        ) : null}
        {client ? (
          <Button asChild variant="ghost">
            <Link to="/clients/$clientId" params={{ clientId: client.id }}>
              {client.name}
            </Link>
          </Button>
        ) : null}
        {permissions.canManage ? (
          <Button variant="ghost" className="text-destructive hover:text-destructive" onClick={() => setConfirming(true)}>
            {t("common.delete")}
          </Button>
        ) : null}
      </div>

      <JobFormDialog open={editing} onOpenChange={setEditing} job={job} onSaved={() => query.refetch()} />

      <ConfirmDeleteDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={t("jobs.delete_title")}
        description={t("jobs.delete_desc")}
        onConfirm={confirmDelete}
        pending={busy}
      />
    </div>
  );
}