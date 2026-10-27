import React from "react";
import { createFileRoute } from "@tanstack/react-router";
import PageHeader from "@/components/PageHeader";
import CompanyLogoPanel from "@/components/settings/CompanyLogoPanel";
import CompanyProfileForm from "@/components/settings/CompanyProfileForm";
import MembersPanel from "@/components/settings/MembersPanel";
import AccountPanel from "@/components/settings/AccountPanel";
import { useI18n } from "@/lib/i18n/I18nContext";

export const Route = createFileRoute("/_authed/settings")({
  head: () => ({ meta: [{ title: "Orqacel — Settings" }] }),
  component: SettingsPage,
});

function SettingsPage() {
  const { t } = useI18n();

  return (
    <div className="mx-auto w-full max-w-4xl">
      <PageHeader title={t("settings.title")} subtitle={t("settings.subtitle")} />
      <div className="space-y-6">
        <CompanyProfileForm />
        <CompanyLogoPanel />
        <MembersPanel />
        <AccountPanel />
      </div>
    </div>
  );
}