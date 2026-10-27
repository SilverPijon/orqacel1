import React from "react";
import { Briefcase, FileText, ShieldCheck, Users } from "lucide-react";
import { useI18n } from "@/lib/i18n/I18nContext";

const FEATURES = [
  { icon: Users, title: "landing.feature_clients_title", desc: "landing.feature_clients_desc" },
  { icon: FileText, title: "landing.feature_quotations_title", desc: "landing.feature_quotations_desc" },
  { icon: Briefcase, title: "landing.feature_jobs_title", desc: "landing.feature_jobs_desc" },
  { icon: ShieldCheck, title: "landing.feature_isolation_title", desc: "landing.feature_isolation_desc" },
];

export default function Features() {
  const { t } = useI18n();

  return (
    <section className="border-y border-border/70 bg-secondary/40">
      <div className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6">
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {FEATURES.map((feature) => (
            <div key={feature.title} className="rounded-2xl border border-border bg-card shadow-card p-5">
              <span className="grid h-10 w-10 place-items-center rounded-xl bg-primary/10 text-primary">
                <feature.icon className="h-5 w-5" />
              </span>
              <h3 className="mt-4 font-heading text-base font-semibold">{t(feature.title)}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{t(feature.desc)}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}