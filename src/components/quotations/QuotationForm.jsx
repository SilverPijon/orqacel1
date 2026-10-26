import React, { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useSession } from "@/lib/SessionContext";
import { listClients } from "@/lib/clients-fns";
import { createQuotation, updateQuotation } from "@/lib/quotations-fns";
import { addDaysISO, formatMoney, round2, todayISO } from "@/lib/format";
import { useI18n } from "@/lib/i18n/I18nContext";

const EMPTY_LINE = { description: "", quantity: "1", unit_price: "0" };

function toFormState(quotation) {
  if (!quotation) {
    return {
      client_id: "",
      subject: "",
      issue_date: todayISO(),
      valid_until: addDaysISO(30),
      tax_rate: "0",
      notes: "",
      line_items: [{ ...EMPTY_LINE }],
    };
  }
  return {
    client_id: quotation.client_id || "",
    subject: quotation.subject || "",
    issue_date: quotation.issue_date || todayISO(),
    valid_until: quotation.valid_until || "",
    tax_rate: String(quotation.tax_rate ?? 0),
    notes: quotation.notes || "",
    line_items: (quotation.line_items || []).length
      ? quotation.line_items.map((line) => ({
          description: line.description || "",
          quantity: String(line.quantity ?? 1),
          unit_price: String(line.unit_price ?? 0),
        }))
      : [{ ...EMPTY_LINE }],
  };
}

export default function QuotationForm({ quotation }) {
  const { t, lang } = useI18n();
  const { activeCompany } = useSession();
  const navigate = useNavigate();
  const fetchClients = useServerFn(listClients);
  const createFn = useServerFn(createQuotation);
  const updateFn = useServerFn(updateQuotation);
  const [form, setForm] = useState(() => toFormState(quotation));
  const [saving, setSaving] = useState(false);
  const currency = activeCompany?.currency || "EUR";

  useEffect(() => {
    setForm(toFormState(quotation));
  }, [quotation]);

  const clientsQuery = useQuery({
    queryKey: ["clients-for-select"],
    queryFn: () => fetchClients({ data: { limit: 50 } }),
  });
  const clients = clientsQuery.data?.items || [];

  const totals = useMemo(() => {
    const subtotal = round2(
      form.line_items.reduce(
        (sum, line) => sum + (Number(line.quantity) || 0) * (Number(line.unit_price) || 0),
        0,
      ),
    );
    const taxAmount = round2((subtotal * (Number(form.tax_rate) || 0)) / 100);
    return { subtotal, taxAmount, total: round2(subtotal + taxAmount) };
  }, [form.line_items, form.tax_rate]);

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
      toast.error(t("quotations.select_client"));
      return;
    }
    setSaving(true);
    try {
      const payload = {
        client_id: form.client_id,
        subject: form.subject,
        issue_date: form.issue_date,
        valid_until: form.valid_until,
        tax_rate: Number(form.tax_rate) || 0,
        notes: form.notes,
        line_items: form.line_items.map((line) => ({
          description: line.description,
          quantity: Number(line.quantity) || 0,
          unit_price: Number(line.unit_price) || 0,
        })),
      };
      const result = quotation
        ? await updateFn({ data: { id: quotation.id, ...payload } })
        : await createFn({ data: payload });
      toast.success(t("common.saved"));
      navigate({ to: "/quotations/$quotationId", params: { quotationId: result.id } });
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
            <Label>{t("quotations.client")}</Label>
            <Select value={form.client_id || "none"} onValueChange={(value) => update("client_id", value === "none" ? "" : value)}>
              <SelectTrigger className="mt-1.5">
                <SelectValue placeholder={t("quotations.select_client")} />
              </SelectTrigger>
              <SelectContent className="max-h-72">
                <SelectItem value="none">{t("quotations.select_client")}</SelectItem>
                {clients.map((client) => (
                  <SelectItem key={client.id} value={client.id}>
                    {client.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="quotation-subject">{t("quotations.subject")}</Label>
            <Input
              id="quotation-subject"
              className="mt-1.5"
              value={form.subject}
              onChange={(event) => update("subject", event.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="quotation-issue">{t("quotations.issue_date")}</Label>
            <Input
              id="quotation-issue"
              type="date"
              className="mt-1.5"
              value={form.issue_date}
              onChange={(event) => update("issue_date", event.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="quotation-valid">{t("quotations.valid_until")}</Label>
            <Input
              id="quotation-valid"
              type="date"
              className="mt-1.5"
              value={form.valid_until}
              onChange={(event) => update("valid_until", event.target.value)}
            />
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-border bg-card p-5 sm:p-6">
        <div className="mb-4 flex items-center justify-between gap-2">
          <h2 className="font-heading text-sm font-semibold">{t("quotations.line_items")}</h2>
          <Button type="button" variant="outline" size="sm" className="gap-2" onClick={addLine}>
            <Plus className="h-4 w-4" />
            {t("quotations.add_item")}
          </Button>
        </div>

        <div className="space-y-3">
          {form.line_items.map((line, index) => (
            <div key={index} className="grid gap-2 sm:grid-cols-12">
              <Input
                className="sm:col-span-6"
                value={line.description}
                onChange={(event) => updateLine(index, "description", event.target.value)}
                placeholder={t("common.description")}
              />
              <Input
                className="sm:col-span-2"
                type="number"
                min="0"
                step="0.01"
                value={line.quantity}
                onChange={(event) => updateLine(index, "quantity", event.target.value)}
                placeholder={t("common.quantity")}
              />
              <Input
                className="sm:col-span-3"
                type="number"
                min="0"
                step="0.01"
                value={line.unit_price}
                onChange={(event) => updateLine(index, "unit_price", event.target.value)}
                placeholder={t("common.unit_price")}
              />
              <div className="flex items-center sm:col-span-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-9 w-9 text-muted-foreground hover:text-destructive"
                  onClick={() => removeLine(index)}
                  disabled={form.line_items.length === 1}
                  aria-label={t("common.delete")}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-6 flex flex-col gap-3 border-t border-border pt-4 sm:items-end">
          <div className="flex w-full items-center justify-between gap-4 sm:w-64">
            <span className="text-sm text-muted-foreground">{t("common.subtotal")}</span>
            <span className="font-mono text-sm">{formatMoney(totals.subtotal, currency, lang)}</span>
          </div>
          <div className="flex w-full items-center justify-between gap-4 sm:w-64">
            <span className="text-sm text-muted-foreground">{t("common.tax_rate")}</span>
            <Input
              type="number"
              min="0"
              max="100"
              step="0.01"
              value={form.tax_rate}
              onChange={(event) => update("tax_rate", event.target.value)}
              className="h-8 w-24"
            />
          </div>
          <div className="flex w-full items-center justify-between gap-4 sm:w-64">
            <span className="text-sm text-muted-foreground">{t("common.tax")}</span>
            <span className="font-mono text-sm">{formatMoney(totals.taxAmount, currency, lang)}</span>
          </div>
          <div className="flex w-full items-center justify-between gap-4 border-t border-border pt-2 sm:w-64">
            <span className="text-sm font-semibold">{t("common.total")}</span>
            <span className="font-mono text-base font-bold">{formatMoney(totals.total, currency, lang)}</span>
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-border bg-card p-5 sm:p-6">
        <Label htmlFor="quotation-notes">{t("common.notes")}</Label>
        <Textarea
          id="quotation-notes"
          className="mt-1.5"
          rows={3}
          value={form.notes}
          onChange={(event) => update("notes", event.target.value)}
          placeholder={t("quotations.notes_placeholder")}
        />
      </section>

      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={saving} className="gap-2">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {saving ? t("common.saving") : t("common.save")}
        </Button>
        <Button type="button" variant="ghost" onClick={() => navigate({ to: "/quotations" })}>
          {t("common.cancel")}
        </Button>
      </div>
    </form>
  );
}