import React, { useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ArrowLeft, Loader2, Pencil } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import PageHeader from "@/components/PageHeader";
import StatusBadge from "@/components/StatusBadge";
import EmptyState from "@/components/EmptyState";
import InvoiceLinesTable from "@/components/invoices/InvoiceLinesTable";
import InvoiceTotalsSummary from "@/components/invoices/InvoiceTotalsSummary";
import InvoiceStatusActions from "@/components/invoices/InvoiceStatusActions";
import InvoicePaymentDetails from "@/components/invoices/InvoicePaymentDetails";
import { useSession } from "@/lib/SessionContext";
import { deleteInvoice, getInvoice, setInvoiceStatus } from "@/lib/invoices-fns";
import { formatDate } from "@/lib/format";
import { hasConfiguredInvoiceVat } from "@/lib/invoiceTotals";
import { isDraft } from "@/lib/invoiceLifecycle";
import { INVOICE_STATUS } from "@/lib/statusMeta";
import { useI18n } from "@/lib/i18n/I18nContext";

export const Route = createFileRoute("/_authed/invoices/$invoiceId")({
  head: () => ({ meta: [{ title: "Orqacel — Invoice" }] }),
  component: InvoiceDetailPage,
});

function InvoiceDetailPage() {
  const { invoiceId } = Route.useParams();
  const { t, lang } = useI18n();
  const { activeCompany, permissions } = useSession();
  const navigate = useNavigate();
  const fetchInvoice = useServerFn(getInvoice);
  const statusFn = useServerFn(setInvoiceStatus);
  const deleteFn = useServerFn(deleteInvoice);
  const [busy, setBusy] = useState(false);

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

  const client = query.data?.client;
  const currency = invoice.currency || activeCompany?.currency || "EUR";
  const meta = INVOICE_STATUS[invoice.status] || INVOICE_STATUS.draft;
  const lines = invoice.line_items || [];

  const changeStatus = async (status) => {
    setBusy(true);
    try {
      await statusFn({ data: { id: invoice.id, status } });
      await query.refetch();
      toast.success(t("common.saved"));
    } catch (error) {
      // A conflict means the invoice moved on (issued or cancelled) while this was open: show it.
      toast.error(error?.message || t("common.error"));
      await query.refetch();
    } finally {
      setBusy(false);
    }
  };

  const removeInvoice = async () => {
    setBusy(true);
    try {
      await deleteFn({ data: { id: invoice.id } });
      toast.success(t("common.saved"));
      navigate({ to: "/invoices" });
    } catch (error) {
      toast.error(error?.message || t("common.error"));
      await query.refetch();
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-4xl">
      <Button variant="ghost" size="sm" className="mb-4 gap-2" asChild>
        <Link to="/invoices">
          <ArrowLeft className="h-4 w-4" />
          {t("common.back")}
        </Link>
      </Button>

      <PageHeader title={invoice.number} subtitle={invoice.client_name}>
        <StatusBadge label={t(meta.key)} tone={meta.tone} />
        {isDraft(invoice) && permissions.canManage ? (
          <Button asChild variant="outline" className="gap-2">
            <Link to="/invoices/$invoiceId/edit" params={{ invoiceId: invoice.id }}>
              <Pencil className="h-4 w-4" />
              {t("common.edit")}
            </Link>
          </Button>
        ) : null}
      </PageHeader>

      <section className="rounded-2xl border border-border bg-card p-5 sm:p-6">
        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">{t("invoices.customer")}</p>
            <p className="mt-1 text-sm font-medium">
              {client ? (
                <Link
                  to="/clients/$clientId"
                  params={{ clientId: client.id }}
                  className="hover:text-primary hover:underline"
                >
                  {invoice.client_name}
                </Link>
              ) : (
                invoice.client_name || "—"
              )}
            </p>
            {/* The invoice's own record of the customer, not the customer's current details. */}
            {invoice.buyer_snapshot?.email ? (
              <p className="text-xs text-muted-foreground">{invoice.buyer_snapshot.email}</p>
            ) : null}
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">{t("invoices.issue_date")}</p>
            <p className="mt-1 text-sm font-medium">{formatDate(invoice.issue_date, lang)}</p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">{t("invoices.due_date")}</p>
            <p className="mt-1 text-sm font-medium">{formatDate(invoice.due_date, lang)}</p>
          </div>
        </div>

        <div className="mt-6">
          <InvoiceLinesTable lines={lines} currency={currency} />
        </div>

        <div className="mt-5">
          <InvoiceTotalsSummary totals={invoice} currency={currency} vatConfigured={hasConfiguredInvoiceVat(invoice)} />
        </div>

        {invoice.notes ? (
          <div className="mt-6 border-t border-border pt-4">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">{t("common.notes")}</p>
            <p className="mt-1 whitespace-pre-line text-sm">{invoice.notes}</p>
          </div>
        ) : null}
      </section>

      <InvoicePaymentDetails invoice={invoice} />

      {invoice.status === "issued" ? (
        <p className="mt-4 text-sm text-muted-foreground">{t("invoices.issued_note")}</p>
      ) : null}
      {invoice.status === "cancelled" ? (
        <p className="mt-4 text-sm text-muted-foreground">{t("invoices.cancelled_note")}</p>
      ) : null}

      <InvoiceStatusActions
        invoice={invoice}
        canManage={permissions.canManage}
        busy={busy}
        onIssue={() => changeStatus("issued")}
        onCancel={() => changeStatus("cancelled")}
        onDelete={removeInvoice}
      />
    </div>
  );
}