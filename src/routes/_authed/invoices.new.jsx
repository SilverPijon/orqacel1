import React from "react";
import { createFileRoute } from "@tanstack/react-router";
import PageHeader from "@/components/PageHeader";
import InvoiceForm from "@/components/invoices/InvoiceForm";
import { useI18n } from "@/lib/i18n/I18nContext";

export const Route = createFileRoute("/_authed/invoices/new")({
  head: () => ({ meta: [{ title: "Orqacel — New invoice" }] }),
  component: NewInvoicePage,
});

function NewInvoicePage() {
  const { t } = useI18n();

  return (
    <div className="mx-auto w-full max-w-4xl">
      <PageHeader title={t("invoices.new")} subtitle={t("invoices.subtitle")} />
      <InvoiceForm />
    </div>
  );
}