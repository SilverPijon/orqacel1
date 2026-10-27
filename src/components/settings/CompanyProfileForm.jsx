import React, { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useSession } from "@/lib/SessionContext";
import { updateCompany } from "@/lib/tenant-fns";
import { COUNTRY_CODES, CURRENCIES, TIMEZONES, countryLabel } from "@/lib/constants";
import { useI18n } from "@/lib/i18n/I18nContext";

const EMPTY = {
  name: "", legal_name: "", registration_number: "", tax_number: "",
  email: "", phone: "", website: "",
  address: "", city: "", postal_code: "", country: "",
  currency: "EUR", timezone: "Europe/Tallinn", default_language: "en",
};

export default function CompanyProfileForm() {
  const { t, lang } = useI18n();
  const { activeCompany, permissions, refresh } = useSession();
  const updateFn = useServerFn(updateCompany);
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);
  const canEdit = permissions.canManage;

  useEffect(() => {
    if (!activeCompany) return;
    const next = { ...EMPTY };
    Object.keys(EMPTY).forEach((field) => {
      if (activeCompany[field] !== undefined && activeCompany[field] !== null) next[field] = activeCompany[field];
    });
    setForm(next);
  }, [activeCompany]);

  const update = (field, value) => setForm((previous) => ({ ...previous, [field]: value }));

  const submit = async (event) => {
    event.preventDefault();
    if (!form.name.trim()) {
      toast.error(t("common.required"));
      return;
    }
    setSaving(true);
    try {
      await updateFn({ data: { ...form, name: form.name.trim() } });
      await refresh();
      toast.success(t("common.saved"));
    } catch (error) {
      toast.error(error?.message || t("common.error"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="rounded-2xl border border-border bg-card p-5 sm:p-6">
      <header className="mb-5">
        <h2 className="font-heading text-base font-semibold">{t("settings.company_profile")}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{t("settings.company_profile_desc")}</p>
      </header>

      <form onSubmit={submit} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Label htmlFor="company-name">{t("settings.company_name")}</Label>
            <Input
              id="company-name"
              className="mt-1.5"
              value={form.name}
              disabled={!canEdit}
              onChange={(event) => update("name", event.target.value)}
              required
            />
          </div>
          <div>
            <Label htmlFor="legal-name">{t("settings.legal_name")}</Label>
            <Input
              id="legal-name"
              className="mt-1.5"
              value={form.legal_name}
              disabled={!canEdit}
              onChange={(event) => update("legal_name", event.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="company-registration">{t("settings.registration_number")}</Label>
            <Input
              id="company-registration"
              className="mt-1.5"
              value={form.registration_number}
              disabled={!canEdit}
              onChange={(event) => update("registration_number", event.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="company-tax">{t("settings.tax_number")}</Label>
            <Input
              id="company-tax"
              className="mt-1.5"
              value={form.tax_number}
              disabled={!canEdit}
              onChange={(event) => update("tax_number", event.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="company-email">{t("settings.contact_email")}</Label>
            <Input
              id="company-email"
              className="mt-1.5"
              value={form.email}
              disabled={!canEdit}
              onChange={(event) => update("email", event.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="company-phone">{t("settings.contact_phone")}</Label>
            <Input
              id="company-phone"
              className="mt-1.5"
              value={form.phone}
              disabled={!canEdit}
              onChange={(event) => update("phone", event.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="company-website">{t("common.website")}</Label>
            <Input
              id="company-website"
              className="mt-1.5"
              value={form.website}
              disabled={!canEdit}
              onChange={(event) => update("website", event.target.value)}
            />
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="company-address">{t("common.address")}</Label>
            <Input
              id="company-address"
              className="mt-1.5"
              value={form.address}
              disabled={!canEdit}
              onChange={(event) => update("address", event.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="company-city">{t("common.city")}</Label>
            <Input
              id="company-city"
              className="mt-1.5"
              value={form.city}
              disabled={!canEdit}
              onChange={(event) => update("city", event.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="company-postal">{t("common.postal_code")}</Label>
            <Input
              id="company-postal"
              className="mt-1.5"
              value={form.postal_code}
              disabled={!canEdit}
              onChange={(event) => update("postal_code", event.target.value)}
            />
          </div>
          <div>
            <Label>{t("common.country")}</Label>
            <Select
              value={form.country || "none"}
              disabled={!canEdit}
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
          <div>
            <Label>{t("common.currency")}</Label>
            <Select value={form.currency} disabled={!canEdit} onValueChange={(value) => update("currency", value)}>
              <SelectTrigger className="mt-1.5">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="max-h-72">
                {CURRENCIES.map((code) => (
                  <SelectItem key={code} value={code}>
                    {code}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>{t("common.timezone")}</Label>
            <Select value={form.timezone} disabled={!canEdit} onValueChange={(value) => update("timezone", value)}>
              <SelectTrigger className="mt-1.5">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="max-h-72">
                {TIMEZONES.map((zone) => (
                  <SelectItem key={zone} value={zone}>
                    {zone}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {canEdit ? (
          <Button type="submit" disabled={saving} className="gap-2">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {saving ? t("common.saving") : t("common.save")}
          </Button>
        ) : (
          <p className="text-xs text-muted-foreground">{t("errors.admin_only")}</p>
        )}
      </form>
    </section>
  );
}