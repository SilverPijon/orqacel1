import React from "react";
import { createFileRoute } from "@tanstack/react-router";
import PageHeader from "@/components/PageHeader";
import QuotationForm from "@/components/quotations/QuotationForm";
import { useI18n } from "@/lib/i18n/I18nContext";

export const Route = createFileRoute("/_authed/quotations/new")({
  head: () => ({ meta: [{ title: "Orqacel — New quotation" }] }),
  component: NewQuotationPage,
});

function NewQuotationPage() {
  const { t } = useI18n();

  return (
    <div className="mx-auto w-full max-w-4xl">
      <PageHeader title={t("quotations.new")} subtitle={t("quotations.subtitle")} />
      <QuotationForm />
    </div>
  );
}