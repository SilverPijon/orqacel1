import React from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ArrowLeft, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import PageHeader from "@/components/PageHeader";
import EmptyState from "@/components/EmptyState";
import InvoiceForm from "@/components/invoices/InvoiceForm";
import { getInvoice } from "@/lib/invoices-fns";
import { isDraft } from "@/lib/invoiceLifecycle";
import { useI18n } from "@/lib/i18n/I18nContext";

export const Route = createFileRoute("/_authed/invoices/$invoiceId_/edit")({
  head: () => ({ meta: [{ title: "Orqacel — Edit invoice" }] }),
  component: EditInvoicePage,
});

function EditInvoicePage() {
  const { invoiceId } = Route.useParams();
  const { t } = useI18n();
  const navigate = useNavigate();
  const fetchInvoice = useServerFn(getInvoice);

  const query = useQuery({
    queryKey: ["invoice", invoiceId],
    queryFn: () => fetchInvoice({ data: { id: invoiceId } }),
  });

  if (query.isLoading) {
    return (
      <div className="grid min-h-[40vh] place-items-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const invoice = query.data?.invoice;
  if (!invoice) return <EmptyState title={t("common.not_found")} />;

  return (
    <div className="mx-auto w-full max-w-4xl">
      <Button variant="ghost" size="sm" className="mb-4 gap-2" onClick={() => navigate({ to: "/invoices" })}>
        <ArrowLeft className="h-4 w-4" />
        {t("common.back")}
      </Button>
      <PageHeader title={t("invoices.edit")} subtitle={invoice.number} />
      {isDraft(invoice) ? (
        <InvoiceForm invoice={invoice} />
      ) : (
        <EmptyState
          title={invoice.status === "issued" ? t("invoices.issued_note") : t("invoices.cancelled_note")}
        />
      )}
    </div>
  );
}