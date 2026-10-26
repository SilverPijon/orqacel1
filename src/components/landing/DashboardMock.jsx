import React from "react";
import { useI18n } from "@/lib/i18n/I18nContext";

const SAMPLE_STATS = [
  { key: "dashboard.total_clients", value: "24" },
  { key: "dashboard.open_quotations", value: "7" },
  { key: "dashboard.active_jobs", value: "5" },
];

const SAMPLE_ROWS = [
  { title: "Kitchen renovation", client: "Kadri Kask", amount: "€2,480", tone: "primary" },
  { title: "Monthly cleaning", client: "Marek Tamm", amount: "€420", tone: "muted" },
  { title: "Bathroom repair", client: "Liis Pärn", amount: "€1,150", tone: "accent" },
];

export default function DashboardMock() {
  const { t } = useI18n();

  const toneClass = (tone) =>
    ({
      primary: "bg-primary/10 text-primary",
      muted: "bg-muted text-muted-foreground",
      accent: "bg-accent text-accent-foreground",
    })[tone];

  return (
    <div className="rounded-2xl border border-border bg-card p-4 shadow-xl shadow-primary/5 sm:p-6">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <p className="font-heading text-sm font-semibold">{t("dashboard.title")}</p>
          <p className="text-xs text-muted-foreground">{t("dashboard.subtitle")}</p>
        </div>
        <span className="rounded-full bg-primary/10 px-3 py-1 font-mono text-[11px] font-medium text-primary">
          QT-1042
        </span>
      </div>

      <div className="grid grid-cols-3 gap-2 sm:gap-3">
        {SAMPLE_STATS.map((stat) => (
          <div key={stat.key} className="rounded-xl border border-border bg-background p-3">
            <p className="font-heading text-xl font-bold">{stat.value}</p>
            <p className="mt-1 text-[11px] leading-tight text-muted-foreground">{t(stat.key)}</p>
          </div>
        ))}
      </div>

      <div className="mt-4 space-y-2">
        {SAMPLE_ROWS.map((row) => (
          <div
            key={row.title}
            className="flex items-center justify-between gap-3 rounded-xl border border-border bg-background px-3 py-2.5"
          >
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{row.title}</p>
              <p className="truncate text-xs text-muted-foreground">{row.client}</p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <span className="font-mono text-xs font-semibold">{row.amount}</span>
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${toneClass(row.tone)}`}>
                {row.tone === "primary"
                  ? t("quotations.status_accepted")
                  : row.tone === "muted"
                    ? t("quotations.status_sent")
                    : t("jobs.status_in_progress")}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}