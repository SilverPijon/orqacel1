import React from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ArrowLeft, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import PageHeader from "@/components/PageHeader";
import EmptyState from "@/components/EmptyState";
import QuotationForm from "@/components/quotations/QuotationForm";
import { getQuotation } from "@/lib/quotations-fns";
import { useI18n } from "@/lib/i18n/I18nContext";

export const Route = createFileRoute("/_authed/quotations/$quotationId_/edit")({
  head: () => ({ meta: [{ title: "Orqacel — Edit quotation" }] }),
  component: EditQuotationPage,
});

function EditQuotationPage() {
  const { quotationId } = Route.useParams();
  const { t } = useI18n();
  const navigate = useNavigate();
  const fetchQuotation = useServerFn(getQuotation);

  const query = useQuery({
    queryKey: ["quotation", quotationId],
    queryFn: () => fetchQuotation({ data: { id: quotationId } }),
  });

  if (query.isLoading) {
    return (
      <div className="grid min-h-[40vh] place-items-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!query.data?.quotation) return <EmptyState title={t("common.not_found")} />;

  return (
    <div className="mx-auto w-full max-w-4xl">
      <Button variant="ghost" size="sm" className="mb-4 gap-2" onClick={() => navigate({ to: "/quotations" })}>
        <ArrowLeft className="h-4 w-4" />
        {t("common.back")}
      </Button>
      <PageHeader title={t("quotations.edit")} subtitle={query.data.quotation.number} />
      <QuotationForm quotation={query.data.quotation} />
    </div>
  );
}