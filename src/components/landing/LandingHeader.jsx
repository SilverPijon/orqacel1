import React from "react";
import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import LanguageSwitcher from "@/components/LanguageSwitcher";
import { useI18n } from "@/lib/i18n/I18nContext";

export default function LandingHeader() {
  const { t } = useI18n();

  return (
    <header className="sticky top-0 z-40 border-b border-border/70 bg-background/80 backdrop-blur">
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between gap-3 px-4 sm:px-6">
        <Link to="/" className="flex items-center gap-2">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-primary font-heading text-lg font-bold text-primary-foreground">
            T
          </span>
          <span className="font-heading text-lg font-bold tracking-tight">{t("app.name")}</span>
        </Link>
        <div className="flex items-center gap-2">
          <LanguageSwitcher />
          <Button asChild variant="ghost" size="sm" className="hidden sm:inline-flex">
            <Link to="/login">{t("auth.sign_in")}</Link>
          </Button>
          <Button asChild size="sm">
            <Link to="/register">{t("auth.sign_up")}</Link>
          </Button>
        </div>
      </div>
    </header>
  );
}