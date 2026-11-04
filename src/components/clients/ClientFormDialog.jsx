import React, { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import FormField, { fieldErrorProps } from "@/components/FormField";
import StickyFormFooter from "@/components/StickyFormFooter";
import { createClient, updateClient } from "@/lib/clients-fns";
import { CLIENT_REQUIRED_FIELDS, firstInvalidField, validateClientForm } from "@/lib/formValidation";
import { COUNTRY_CODES, countryLabel } from "@/lib/constants";
import { useI18n } from "@/lib/i18n/I18nContext";

const EMPTY = {
  name: "", contact_name: "", email: "", phone: "", address: "",
  city: "", postal_code: "", country: "", tax_id: "", notes: "", status: "active",
};

export default function ClientFormDialog({ open, onOpenChange, client, onSaved }) {
  const { t, lang } = useI18n();
  const createFn = useServerFn(createClient);
  const updateFn = useServerFn(updateClient);
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState({});
  const fieldRefs = useRef({});

  useEffect(() => {
    if (!open) return;
    const next = { ...EMPTY };
    if (client) {
      Object.keys(EMPTY).forEach((field) => {
        if (client[field] !== undefined && client[field] !== null) next[field] = client[field];
      });
    }
    setForm(next);
    // A fresh open never shows the previous attempt's messages.
    setErrors({});
  }, [open, client]);

  const update = (field, value) => {
    setForm((previous) => ({ ...previous, [field]: value }));
    // A corrected field stops claiming to be wrong as soon as it holds a value again.
    setErrors((previous) =>
      previous[field] && String(value).trim() ? { ...previous, [field]: undefined } : previous,
    );
  };

  // Validates the form, shows every message under its own field and moves focus to the first
  // problem. Returns whether the form may be saved.
  const showErrors = () => {
    const next = validateClientForm(form, t);
    setErrors(next);
    const first = firstInvalidField(next, CLIENT_REQUIRED_FIELDS);
    if (first) {
      const control = fieldRefs.current[first];
      control?.focus();
      // Centre the field so the message underneath it is not left under the sticky footer.
      control?.scrollIntoView?.({ block: "center" });
    }
    return !first;
  };

  const submit = async (event) => {
    event.preventDefault();
    if (!showErrors()) return;
    setSaving(true);
    try {
      if (client) await updateFn({ data: { id: client.id, ...form, name: form.name.trim() } });
      else await createFn({ data: { ...form, name: form.name.trim() } });
      toast.success(t("common.saved"));
      onOpenChange(false);
      onSaved?.();
    } catch (error) {
      toast.error(error?.message || t("common.error"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{client ? t("clients.edit") : t("clients.new")}</DialogTitle>
        </DialogHeader>

        <form
          onSubmit={submit}
          noValidate
          className="space-y-4"
          // Native validation is off above; if a browser applies it anyway, the form still answers
          // with its own inline messages instead of a bubble in the browser's language.
          onInvalid={(event) => {
            event.preventDefault();
            showErrors();
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField
              id="client-name"
              label={t("common.name")}
              error={errors.name}
              required
              className="sm:col-span-2"
            >
              <Input
                id="client-name"
                ref={(element) => {
                  fieldRefs.current.name = element;
                }}
                value={form.name}
                onChange={(event) => update("name", event.target.value)}
                required
                aria-required="true"
                {...fieldErrorProps("client-name", errors.name)}
              />
            </FormField>
            <div>
              <Label htmlFor="client-contact">{t("clients.contact_name")}</Label>
              <Input
                id="client-contact"
                className="mt-1.5"
                value={form.contact_name}
                onChange={(event) => update("contact_name", event.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="client-email">{t("common.email")}</Label>
              <Input
                id="client-email"
                type="email"
                className="mt-1.5"
                value={form.email}
                onChange={(event) => update("email", event.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="client-phone">{t("common.phone")}</Label>
              <Input
                id="client-phone"
                className="mt-1.5"
                value={form.phone}
                onChange={(event) => update("phone", event.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="client-tax">{t("clients.tax_id")}</Label>
              <Input
                id="client-tax"
                className="mt-1.5"
                value={form.tax_id}
                onChange={(event) => update("tax_id", event.target.value)}
              />
            </div>
            <div className="sm:col-span-2">
              <Label htmlFor="client-address">{t("common.address")}</Label>
              <Input
                id="client-address"
                className="mt-1.5"
                value={form.address}
                onChange={(event) => update("address", event.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="client-city">{t("common.city")}</Label>
              <Input
                id="client-city"
                className="mt-1.5"
                value={form.city}
                onChange={(event) => update("city", event.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="client-postal">{t("common.postal_code")}</Label>
              <Input
                id="client-postal"
                className="mt-1.5"
                value={form.postal_code}
                onChange={(event) => update("postal_code", event.target.value)}
              />
            </div>
            <div>
              <Label>{t("common.country")}</Label>
              <Select
                value={form.country || "none"}
                onValueChange={(value) => update("country", value === "none" ? "" : value)}
              >
                <SelectTrigger className="mt-1.5">
                  <SelectValue placeholder={t("common.none")} />
                </SelectTrigger>
                <SelectContent className="max-h-72">
                  <SelectItem value="none">{t("common.none")}</SelectItem>
                  {COUNTRY_CODES.map((code) => (
                    <SelectItem key={code} value={code}>
                      {countryLabel(code, lang)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {client ? (
              <div>
                <Label>{t("common.status")}</Label>
                <Select value={form.status} onValueChange={(value) => update("status", value)}>
                  <SelectTrigger className="mt-1.5">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">{t("clients.active")}</SelectItem>
                    <SelectItem value="archived">{t("clients.archived")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            ) : null}
            <div className="sm:col-span-2">
              <Label htmlFor="client-notes">{t("common.notes")}</Label>
              <Textarea
                id="client-notes"
                className="mt-1.5"
                rows={3}
                value={form.notes}
                onChange={(event) => update("notes", event.target.value)}
              />
            </div>
          </div>

          <StickyFormFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" formNoValidate disabled={saving} className="gap-2">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {saving ? t("common.saving") : t("common.save")}
            </Button>
          </StickyFormFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}