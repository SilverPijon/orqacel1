import React from "react";
import { Link } from "@tanstack/react-router";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n/I18nContext";

const PLANS = [
  { name: "settings.plan_free", price: "€0", desc: "settings.plan_free_desc", featured: false },
  { name: "settings.plan_pro", price: "€7.90", desc: "settings.plan_pro_desc", featured: true },
  { name: "settings.plan_team", price: "€14.90", desc: "settings.plan_team_desc", featured: false },
];

export default function Pricing() {
  const { t } = useI18n();

  return (
    <section className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6 lg:py-24">
      <div className="mx-auto max-w-2xl text-center">
        <h2 className="font-heading text-3xl font-bold tracking-tight sm:text-4xl">{t("landing.pricing_title")}</h2>
        <p className="mt-4 text-muted-foreground">{t("landing.pricing_subtitle")}</p>
      </div>

      <div className="mt-12 grid gap-6 lg:grid-cols-3">
        {PLANS.map((plan) => (
          <div
            key={plan.name}
            className={`flex flex-col rounded-2xl border bg-card p-6 ${
              plan.featured ? "border-primary shadow-lg shadow-primary/10" : "border-border"
            }`}
          >
            <div className="flex items-center justify-between">
              <h3 className="font-heading text-lg font-semibold">{t(plan.name)}</h3>
              {plan.featured ? (
                <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary">
                  {t("landing.most_popular")}
                </span>
              ) : null}
            </div>
            <p className="mt-4 font-heading text-3xl font-bold">
              {plan.price}
              <span className="ml-1 text-sm font-medium text-muted-foreground">{t("settings.per_month")}</span>
            </p>
            <p className="mt-3 flex-1 text-sm text-muted-foreground">{t(plan.desc)}</p>
            <div className="mt-6">
              {plan.price === "€0" ? (
                <Button asChild className="w-full gap-2">
                  <Link to="/register">
                    <Check className="h-4 w-4" />
                    {t("landing.cta_start")}
                  </Link>
                </Button>
              ) : (
                <span className="block rounded-lg border border-dashed border-border py-2 text-center text-sm text-muted-foreground">
                  {t("settings.plan_coming_soon")}
                </span>
              )}
            </div>
          </div>
        ))}
      </div>

      <p className="mt-8 text-center text-sm text-muted-foreground">{t("landing.pricing_note")}</p>
    </section>
  );
}