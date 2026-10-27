import React from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Briefcase, FileText, Loader2, Plus, Receipt, TrendingUp, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import PageHeader from "@/components/PageHeader";
import StatCard from "@/components/StatCard";
import StatusBadge from "@/components/StatusBadge";
import EmptyState from "@/components/EmptyState";
import { useSession } from "@/lib/SessionContext";
import { getDashboard } from "@/lib/dashboard-fns";
import { formatMoney } from "@/lib/format";
import { JOB_STATUS, QUOTATION_STATUS } from "@/lib/statusMeta";
import { useI18n } from "@/lib/i18n/I18nContext";

export const Route = createFileRoute("/_authed/dashboard")({
  head: () => ({ meta: [{ title: "Orqacel — Dashboard" }] }),
  component: DashboardPage,
});

function DashboardPage() {
  const { t, lang } = useI18n();
  const { activeCompany } = useSession();
  const fetchDashboard = useServerFn(getDashboard);
  const currency = activeCompany?.currency || "EUR";

  const query = useQuery({
    queryKey: ["dashboard", activeCompany?.id],
    queryFn: () => fetchDashboard(),
    enabled: Boolean(activeCompany?.id),
  });

  if (query.isLoading) {
    return (
      <div className="grid min-h-[40vh] place-items-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const data = query.data;
  const counts = data?.counts || { clients: 0, openQuotations: 0, issuedInvoices: 0, activeJobs: 0, acceptedValue: 0 };

  return (
    <div>
      <PageHeader title={t("dashboard.title")} subtitle={t("dashboard.subtitle")}>
        <Button asChild variant="outline" className="gap-2">
          <Link to="/clients">
            <Plus className="h-4 w-4" />
            {t("dashboard.new_client")}
          </Link>
        </Button>
        <Button asChild className="gap-2">
          <Link to="/quotations/new">
            <Plus className="h-4 w-4" />
            {t("dashboard.new_quotation")}
          </Link>
        </Button>
      </PageHeader>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <StatCard label={t("dashboard.total_clients")} value={counts.clients} icon={Users} to="/clients" />
        <StatCard
          label={t("dashboard.open_quotations")}
          value={counts.openQuotations}
          icon={FileText}
          to="/quotations"
        />
        <StatCard
          label={t("dashboard.issued_invoices")}
          value={counts.issuedInvoices}
          icon={Receipt}
          to="/invoices"
        />
        <StatCard label={t("dashboard.active_jobs")} value={counts.activeJobs} icon={Briefcase} to="/jobs" />
        <StatCard
          label={t("dashboard.accepted_value")}
          value={formatMoney(counts.acceptedValue, currency, lang)}
          icon={TrendingUp}
          className="sm:col-span-2 xl:col-span-1"
        />
      </div>

      {counts.clients === 0 ? (
        <div className="mt-6">
          <EmptyState
            icon={Users}
            title={t("dashboard.setup_title")}
            description={t("dashboard.setup_desc")}
          >
            <Button asChild className="gap-2">
              <Link to="/clients">
                <Plus className="h-4 w-4" />
                {t("clients.new")}
              </Link>
            </Button>
          </EmptyState>
        </div>
      ) : null}

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <section className="rounded-2xl border border-border bg-card shadow-card">
          <header className="flex items-center justify-between gap-2 border-b border-border px-5 py-3.5">
            <h2 className="type-section-title">{t("dashboard.recent_quotations")}</h2>
            <Link to="/quotations" className="text-xs font-medium text-primary hover:underline">
              {t("dashboard.view_all")}
            </Link>
          </header>
          <div className="divide-y divide-border">
            {data?.recentQuotations?.length ? (
              data.recentQuotations.map((quotation) => (
                <Link
                  key={quotation.id}
                  to="/quotations/$quotationId"
                  params={{ quotationId: quotation.id }}
                  className="flex items-center justify-between gap-3 px-5 py-3 transition-colors hover:bg-accent/50"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">
                      {quotation.number} · {quotation.client_name || t("common.none")}
                    </span>
                  </span>
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
              <p className="px-5 py-6 text-sm text-muted-foreground">{t("dashboard.empty_quotations")}</p>
            )}
          </div>
        </section>

        <section className="rounded-2xl border border-border bg-card shadow-card">
          <header className="flex items-center justify-between gap-2 border-b border-border px-5 py-3.5">
            <h2 className="type-section-title">{t("dashboard.recent_jobs")}</h2>
            <Link to="/jobs" className="text-xs font-medium text-primary hover:underline">
              {t("dashboard.view_all")}
            </Link>
          </header>
          <div className="divide-y divide-border">
            {data?.recentJobs?.length ? (
              data.recentJobs.map((job) => (
                <Link
                  key={job.id}
                  to="/jobs/$jobId"
                  params={{ jobId: job.id }}
                  className="flex items-center justify-between gap-3 px-5 py-3 transition-colors hover:bg-accent/50"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{job.title}</span>
                    <span className="block truncate text-xs text-muted-foreground">{job.client_name || t("common.none")}</span>
                  </span>
                  <StatusBadge
                    label={t(JOB_STATUS[job.status]?.key || "jobs.status_scheduled")}
                    tone={JOB_STATUS[job.status]?.tone}
                  />
                </Link>
              ))
            ) : (
              <p className="px-5 py-6 text-sm text-muted-foreground">{t("dashboard.empty_jobs")}</p>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}