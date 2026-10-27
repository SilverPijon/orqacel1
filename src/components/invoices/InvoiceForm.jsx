import React, { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import InvoiceLinesEditor from "@/components/invoices/InvoiceLinesEditor";
import InvoiceTotalsSummary from "@/components/invoices/InvoiceTotalsSummary";
import { useSession } from "@/lib/SessionContext";
import { listClients } from "@/lib/clients-fns";
import { createInvoice, updateInvoice } from "@/lib/invoices-fns";
import { addDaysISO, todayISO } from "@/lib/format";
import { computeInvoiceTotals, hasConfiguredInvoiceVat } from "@/lib/invoiceTotals";
import { taxFlagForInput } from "@/lib/quotationTax";
import { useI18n } from "@/lib/i18n/I18nContext";

const DUE_DAYS = 14;
const EMPTY_LINE = { description: "", quantity: "1", unit_price: "0", vat_rate: "" };

function toFormState(invoice) {
  if (!invoice) {
    return {
      client_id: "",
      issue_date: todayISO(),
      due_date: addDaysISO(DUE_DAYS),
      notes: "",
      line_items: [{ ...EMPTY_LINE }],
    };
  }
  // A stored rate above zero is shown; so is a zero that was entered deliberately. A rate nobody
  // ever configured leaves the field empty instead of presenting a zero the user did not choose.
  const vatChosen = invoice.vat_rate_set === true;
  return {
    client_id: invoice.client_id || "",
    issue_date: invoice.issue_date || todayISO(),
    due_date: invoice.due_date || "",
    notes: invoice.notes || "",
    line_items: (invoice.line_items || []).length
      ? invoice.line_items.map((line) => ({
          description: line.description || "",
          quantity: String(line.quantity ?? 1),
          unit_price: String(line.unit_price ?? 0),
          vat_rate: Number(line.vat_rate || 0) > 0 || vatChosen ? String(line.vat_rate ?? 0) : "",
        }))
      : [{ ...EMPTY_LINE }],
  };
}

export default function InvoiceForm({ invoice }) {
  const { t } = useI18n();
  const { activeCompany } = useSession();
  const navigate = useNavigate();
  const fetchClients = useServerFn(listClients);
  const createFn = useServerFn(createInvoice);
  const updateFn = useServerFn(updateInvoice);
  const [form, setForm] = useState(() => toFormState(invoice));
  const [saving, setSaving] = useState(false);
  const currency = invoice?.currency || activeCompany?.currency || "EUR";

  useEffect(() => {
    setForm(toFormState(invoice));
  }, [invoice]);

  const clientsQuery = useQuery({
    queryKey: ["clients-for-select"],
    queryFn: () => fetchClients({ data: { limit: 50 } }),
  });
  const clients = clientsQuery.data?.items || [];

  // The preview uses the same calculation the server stores, so what is on screen — line totals,
  // VAT per rate and the grand total — is exactly what gets saved.
  const totals = useMemo(() => computeInvoiceTotals(form.line_items), [form.line_items]);
  const vatRateSet = form.line_items.some((line) => taxFlagForInput(line.vat_rate));
  const vatConfigured = hasConfiguredInvoiceVat({ vat_rate_set: vatRateSet, line_items: totals.line_items });

  const update = (field, value) => setForm((previous) => ({ ...previous, [field]: value }));
  const updateLine = (index, field, value) =>
    setForm((previous) => ({
      ...previous,
      line_items: previous.line_items.map((line, lineIndex) =>
        lineIndex === index ? { ...line, [field]: value } : line,
      ),
    }));
  const addLine = () => setForm((previous) => ({ ...previous, line_items: [...previous.line_items, { ...EMPTY_LINE }] }));
  const removeLine = (index) =>
    setForm((previous) => ({
      ...previous,
      line_items: previous.line_items.filter((_, lineIndex) => lineIndex !== index),
    }));

  const submit = async (event) => {
    event.preventDefault();
    if (!form.client_id) {
      toast.error(t("invoices.select_customer"));
      return;
    }
    setSaving(true);
    try {
      const payload = {
        client_id: form.client_id,
        issue_date: form.issue_date,
        due_date: form.due_date,
        notes: form.notes,
        vat_rate_set: vatRateSet,
        line_items: form.line_items.map((line) => ({
          description: line.description,
          quantity: Number(line.quantity) || 0,
          unit_price: Number(line.unit_price) || 0,
          vat_rate: Number(line.vat_rate) || 0,
        })),
      };
      const result = invoice
        ? await updateFn({ data: { id: invoice.id, ...payload } })
        : await createFn({ data: payload });
      toast.success(t("common.saved"));
      navigate({ to: "/invoices/$invoiceId", params: { invoiceId: result.id } });
    } catch (error) {
      toast.error(error?.message || t("common.error"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-6">
      <section className="rounded-2xl border border-border bg-card p-5 sm:p-6">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Label>{t("invoices.customer")}</Label>
            <Select
              value={form.client_id || "none"}
              onValueChange={(value) => update("client_id", value === "none" ? "" : value)}
            >
              <SelectTrigger className="mt-1.5">
                <SelectValue placeholder={t("invoices.select_customer")} />
              </SelectTrigger>
              <SelectContent className="max-h-72">
                <SelectItem value="none">{t("invoices.select_customer")}</SelectItem>
                {clients.map((client) => (
                  <SelectItem key={client.id} value={client.id}>
                    {client.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="invoice-issue">{t("invoices.issue_date")}</Label>
            <Input
              id="invoice-issue"
              type="date"
              className="mt-1.5"
              value={form.issue_date}
              onChange={(event) => update("issue_date", event.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="invoice-due">{t("invoices.due_date")}</Label>
            <Input
              id="invoice-due"
              type="date"
              className="mt-1.5"
              value={form.due_date}
              onChange={(event) => update("due_date", event.target.value)}
            />
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-border bg-card p-5 sm:p-6">
        <h2 className="mb-4 font-heading text-sm font-semibold">{t("invoices.line_items")}</h2>
        <InvoiceLinesEditor
          lines={form.line_items}
          lineTotals={totals.line_items.map((line) => line.line_total)}
          currency={currency}
          onUpdate={updateLine}
          onAdd={addLine}
          onRemove={removeLine}
        />
        <div className="mt-6 border-t border-border pt-4">
          <InvoiceTotalsSummary totals={totals} currency={currency} vatConfigured={vatConfigured} />
        </div>
      </section>

      <section className="rounded-2xl border border-border bg-card p-5 sm:p-6">
        <Label htmlFor="invoice-notes">{t("common.notes")}</Label>
        <Textarea
          id="invoice-notes"
          className="mt-1.5"
          rows={3}
          value={form.notes}
          onChange={(event) => update("notes", event.target.value)}
          placeholder={t("invoices.notes_placeholder")}
        />
      </section>

      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={saving} className="gap-2">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {saving ? t("common.saving") : t("common.save")}
        </Button>
        <Button type="button" variant="ghost" onClick={() => navigate({ to: "/invoices" })}>
          {t("common.cancel")}
        </Button>
      </div>
    </form>
  );
}