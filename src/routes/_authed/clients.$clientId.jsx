import React, { useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ArrowLeft, Briefcase, FileText, Loader2, Mail, MapPin, Pencil, Phone } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import PageHeader from "@/components/PageHeader";
import StatusBadge from "@/components/StatusBadge";
import EmptyState from "@/components/EmptyState";
import ConfirmDeleteDialog from "@/components/ConfirmDeleteDialog";
import ClientFormDialog from "@/components/clients/ClientFormDialog";
import { useSession } from "@/lib/SessionContext";
import { deleteClient, getClient } from "@/lib/clients-fns";
import { listQuotations } from "@/lib/quotations-fns";
import { listJobs } from "@/lib/jobs-fns";
import { formatDate, formatMoney } from "@/lib/format";
import { JOB_STATUS, QUOTATION_STATUS } from "@/lib/statusMeta";
import { useI18n } from "@/lib/i18n/I18nContext";

export const Route = createFileRoute("/_authed/clients/$clientId")({
  head: () => ({ meta: [{ title: "Orqacel — Client" }] }),
  component: ClientDetailPage,
});

function ClientDetailPage() {
  const { clientId } = Route.useParams();
  const { t, lang } = useI18n();
  const { activeCompany, permissions } = useSession();
  const navigate = useNavigate();
  const fetchClient = useServerFn(getClient);
  const fetchQuotations = useServerFn(listQuotations);
  const fetchJobs = useServerFn(listJobs);
  const deleteFn = useServerFn(deleteClient);
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const clientQuery = useQuery({
    queryKey: ["client", clientId],
    queryFn: () => fetchClient({ data: { id: clientId } }),
  });

  const quotationsQuery = useQuery({
    queryKey: ["client-quotations", clientId],
    queryFn: () => fetchQuotations({ data: { client_id: clientId, limit: 10 } }),
  });

  const jobsQuery = useQuery({
    queryKey: ["client-jobs", clientId],
    queryFn: () => fetchJobs({ data: { client_id: clientId, limit: 10 } }),
  });

  if (clientQuery.isLoading) {
    return (
      <div className="grid min-h-[40vh] place-items-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const client = clientQuery.data;
  if (!client) return <EmptyState title={t("common.not_found")} />;

  const currency = activeCompany?.currency || "EUR";

  const confirmDelete = async () => {
    setDeleting(true);
    try {
      await deleteFn({ data: { id: client.id } });
      toast.success(t("common.saved"));
      navigate({ to: "/clients" });
    } catch (error) {
      toast.error(error?.message || t("common.error"));
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-4xl">
      <Button variant="ghost" size="sm" className="mb-4 gap-2" asChild>
        <Link to="/clients">
          <ArrowLeft className="h-4 w-4" />
          {t("common.back")}
        </Link>
      </Button>

      <PageHeader title={client.name} subtitle={client.contact_name || undefined}>
        <Button variant="outline" className="gap-2" onClick={() => setEditing(true)}>
          <Pencil className="h-4 w-4" />
          {t("common.edit")}
        </Button>
        {permissions.canManage ? (
          <Button variant="ghost" className="text-destructive hover:text-destructive" onClick={() => setConfirming(true)}>
            {t("common.delete")}
          </Button>
        ) : null}
      </PageHeader>

      <section className="rounded-2xl border border-border bg-card shadow-card p-5">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge label={client.status === "archived" ? t("clients.archived") : t("clients.active")} tone={client.status === "archived" ? "muted" : "success"} />
          {client.created_date ? (
            <span className="text-xs text-muted-foreground">
              {t("clients.since")} {formatDate(client.created_date, lang)}
            </span>
          ) : null}
        </div>

        <dl className="mt-5 grid gap-4 sm:grid-cols-2">
          {[
            { icon: Mail, label: t("common.email"), value: client.email },
            { icon: Phone, label: t("common.phone"), value: client.phone },
            { icon: MapPin, label: t("common.address"), value: [client.address, client.postal_code, client.city, client.country].filter(Boolean).join(", ") },
            { icon: FileText, label: t("clients.tax_id"), value: client.tax_id },
          ].map((row) => (
            <div key={row.label} className="flex items-start gap-3">
              <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-secondary text-muted-foreground">
                <row.icon className="h-3.5 w-3.5" />
              </span>
              <div className="min-w-0">
                <dt className="text-xs uppercase tracking-wide text-muted-foreground">{row.label}</dt>
                <dd className="truncate text-sm">{row.value || "—"}</dd>
              </div>
            </div>
          ))}
        </dl>

        {client.notes ? (
          <div className="mt-5 border-t border-border pt-4">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">{t("common.notes")}</p>
            <p className="mt-1 whitespace-pre-line text-sm">{client.notes}</p>
          </div>
        ) : null}
      </section>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <section className="rounded-2xl border border-border bg-card shadow-card">
          <header className="border-b border-border px-5 py-3.5">
            <h2 className="type-section-title">{t("clients.related_quotations")}</h2>
          </header>
          <div className="divide-y divide-border">
            {quotationsQuery.data?.items?.length ? (
              quotationsQuery.data.items.map((quotation) => (
                <Link
                  key={quotation.id}
                  to="/quotations/$quotationId"
                  params={{ quotationId: quotation.id }}
                  className="flex items-center justify-between gap-3 px-5 py-3 transition-colors hover:bg-accent/50"
                >
                  <span className="truncate text-sm font-medium">{quotation.number}</span>
                  <span className="flex shrink-0 items-center gap-2">
                    <span className="font-mono text-xs font-semibold tabular-nums">
                      {formatMoney(quotation.total, quotation.currency || currency, lang)}
                    </span>
                    <StatusBadge
                      label={t(QUOTATION_STATUS[quotation.status]?.key || "quotations.status_draft")}
                      tone={QUOTATION_STATUS[quotation.status]?.tone}
                    />
                  </span>
                </Link>
              ))
            ) : (
              <p className="px-5 py-6 text-sm text-muted-foreground">{t("clients.no_quotations")}</p>
            )}
          </div>
        </section>

        <section className="rounded-2xl border border-border bg-card shadow-card">
          <header className="border-b border-border px-5 py-3.5">
            <h2 className="type-section-title">{t("clients.related_jobs")}</h2>
          </header>
          <div className="divide-y divide-border">
            {jobsQuery.data?.items?.length ? (
              jobsQuery.data.items.map((job) => (
                <Link
                  key={job.id}
                  to="/jobs/$jobId"
                  params={{ jobId: job.id }}
                  className="flex items-center justify-between gap-3 px-5 py-3 transition-colors hover:bg-accent/50"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <Briefcase className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <span className="truncate text-sm font-medium">{job.title}</span>
                  </span>
                  <StatusBadge
                    label={t(JOB_STATUS[job.status]?.key || "jobs.status_scheduled")}
                    tone={JOB_STATUS[job.status]?.tone}
                  />
                </Link>
              ))
            ) : (
              <p className="px-5 py-6 text-sm text-muted-foreground">{t("clients.no_jobs")}</p>
            )}
          </div>
        </section>
      </div>

      <ClientFormDialog
        open={editing}
        onOpenChange={setEditing}
        client={client}
        onSaved={() => clientQuery.refetch()}
      />

      <ConfirmDeleteDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={t("clients.delete_title")}
        description={t("clients.delete_desc")}
        onConfirm={confirmDelete}
        pending={deleting}
      />
    </div>
  );
}