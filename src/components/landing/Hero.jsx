import React from "react";
import { Link } from "@tanstack/react-router";
import { ArrowRight, Languages, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import DashboardMock from "@/components/landing/DashboardMock";
import { useAuth } from "@/lib/AuthContext";
import { useI18n } from "@/lib/i18n/I18nContext";

export default function Hero() {
  const { t } = useI18n();
  const { isAuthenticated } = useAuth();

  return (
    <section className="relative overflow-hidden">
      <div className="pointer-events-none absolute inset-x-0 -top-40 h-96 bg-gradient-to-b from-primary/15 to-transparent" />
      <div className="relative mx-auto grid w-full max-w-6xl gap-12 px-4 py-16 sm:px-6 lg:grid-cols-2 lg:items-center lg:py-24">
        <div>
          <span className="inline-flex items-center gap-2 rounded-full border border-border bg-card shadow-card px-3 py-1 text-xs font-medium text-muted-foreground">
            <ShieldCheck className="h-3.5 w-3.5 text-primary" />
            {t("landing.badge")}
          </span>
          <h1 className="mt-5 font-heading text-4xl font-extrabold leading-tight tracking-tight sm:text-5xl">
            {t("landing.hero_title")}
          </h1>
          <p className="mt-5 max-w-xl text-base leading-relaxed text-muted-foreground sm:text-lg">
            {t("landing.hero_subtitle")}
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            {isAuthenticated ? (
              <Button asChild size="lg" className="gap-2">
                <Link to="/dashboard">
                  {t("landing.cta_dashboard")}
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </Button>
            ) : (
              <>
                <Button asChild size="lg" className="gap-2">
                  <Link to="/register">
                    {t("landing.cta_start")}
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                </Button>
                <Button asChild size="lg" variant="outline">
                  <Link to="/login" search={{ returnTo: "/dashboard" }}>
                    {t("landing.cta_sign_in")}
                  </Link>
                </Button>
              </>
            )}
          </div>
          <p className="mt-6 inline-flex items-center gap-2 text-sm text-muted-foreground">
            <Languages className="h-4 w-4 text-primary" />
            {t("landing.lang_note")}
          </p>
        </div>
        <DashboardMock />
      </div>
    </section>
  );
}