import React from "react";
import { useI18n } from "@/lib/i18n/I18nContext";

export default function LandingFooter() {
  const { t } = useI18n();
  const year = 2026;

  return (
    <footer className="border-t border-border/70 bg-card">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-2 px-4 py-8 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <p className="text-sm text-muted-foreground">{t("landing.footer_note")}</p>
        <p className="text-xs text-muted-foreground">
          © {year} {t("app.name")}. {t("landing.footer_rights")}
        </p>
      </div>
    </footer>
  );
}