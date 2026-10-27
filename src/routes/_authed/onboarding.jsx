import React, { useEffect, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Building2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useSession } from "@/lib/SessionContext";
import { createCompany } from "@/lib/tenant-fns";
import { COUNTRY_CODES, CURRENCIES, TIMEZONES, countryLabel } from "@/lib/constants";
import { useI18n } from "@/lib/i18n/I18nContext";

export const Route = createFileRoute("/_authed/onboarding")({
  head: () => ({ meta: [{ title: "Orqacel — Company setup" }] }),
  component: OnboardingPage,
});

function OnboardingPage() {
  const { t, lang } = useI18n();
  const { companies, activeCompany, refresh } = useSession();
  const createCompanyFn = useServerFn(createCompany);
  const navigate = useNavigate();

  const [form, setForm] = useState({
    name: "",
    country: "",
    currency: "EUR",
    timezone: "Europe/Tallinn",
    default_language: lang,
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const detectedTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const detectedCountry = (navigator.language || "").split("-")[1] || "";
    setForm((previous) => ({
      ...previous,
      timezone: TIMEZONES.includes(detectedTz) ? detectedTz : previous.timezone,
      country: COUNTRY_CODES.includes(detectedCountry.toUpperCase()) ? detectedCountry.toUpperCase() : previous.country,
    }));
  }, []);

  const update = (field, value) => setForm((previous) => ({ ...previous, [field]: value }));

  const submit = async (event) => {
    event.preventDefault();
    if (!form.name.trim()) {
      toast.error(t("common.required"));
      return;
    }
    setSaving(true);
    try {
      await createCompanyFn({ data: { ...form, name: form.name.trim() } });
      await refresh();
      toast.success(t("common.saved"));
      navigate({ to: "/dashboard" });
    } catch (error) {
      toast.error(error?.message || t("common.error"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-xl">
      <div className="rounded-2xl border border-border bg-card shadow-card p-6 sm:p-8">
        <span className="grid h-11 w-11 place-items-center rounded-xl bg-primary/10 text-primary">
          <Building2 className="h-5 w-5" />
        </span>
        <h1 className="mt-4 font-heading text-2xl font-bold tracking-tight">
          {companies.length ? t("onboarding.add_company") : t("onboarding.title")}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {activeCompany ? t("onboarding.subtitle") : t("onboarding.no_company_desc")}
        </p>

        <form onSubmit={submit} className="mt-6 space-y-4">
          <div>
            <Label htmlFor="company-name">{t("onboarding.company_name")}</Label>
            <Input
              id="company-name"
              value={form.name}
              onChange={(event) => update("name", event.target.value)}
              className="mt-1.5"
              autoComplete="organization"
              required
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label>{t("common.country")}</Label>
              <Select value={form.country || "none"} onValueChange={(value) => update("country", value === "none" ? "" : value)}>
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
              <Select value={form.currency} onValueChange={(value) => update("currency", value)}>
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
              <Select value={form.timezone} onValueChange={(value) => update("timezone", value)}>
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
            <div>
              <Label>{t("settings.default_language")}</Label>
              <Select value={form.default_language} onValueChange={(value) => update("default_language", value)}>
                <SelectTrigger className="mt-1.5">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="max-h-72">
                  {LANGUAGE_OPTIONS.map((item) => (
                    <SelectItem key={item.code} value={item.code}>
                      {item.native}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <p className="text-xs text-muted-foreground">{t("onboarding.country_hint")}</p>

          <div className="flex flex-wrap gap-2 pt-2">
            <Button type="submit" disabled={saving} className="gap-2">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {saving ? t("onboarding.creating") : t("onboarding.create")}
            </Button>
            {activeCompany ? (
              <Button type="button" variant="ghost" onClick={() => navigate({ to: "/dashboard" })}>
                {t("onboarding.go_dashboard")}
              </Button>
            ) : null}
          </div>
        </form>
      </div>
    </div>
  );
}

const LANGUAGE_OPTIONS = [
  { code: "en", native: "English" },
  { code: "et", native: "Eesti" },
  { code: "lv", native: "Latviešu" },
  { code: "lt", native: "Lietuvių" },
  { code: "ru", native: "Русский" },
  { code: "de", native: "Deutsch" },
  { code: "fi", native: "Suomi" },
  { code: "sv", native: "Svenska" },
  { code: "es", native: "Español" },
  { code: "fr", native: "Français" },
  { code: "pl", native: "Polski" },
];