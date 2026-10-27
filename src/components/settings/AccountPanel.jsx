import React from "react";
import { useServerFn } from "@tanstack/react-start";
import { Check } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { useSession } from "@/lib/SessionContext";
import { setMyLanguage } from "@/lib/tenant-fns";
import { useI18n } from "@/lib/i18n/I18nContext";
import { PLAN } from "@/lib/statusMeta";

export default function AccountPanel() {
  const { t, lang, setLang, languages } = useI18n();
  const { user, activeCompany } = useSession();
  const languageFn = useServerFn(setMyLanguage);
  const currentPlan = activeCompany?.plan || "free";

  const changeLanguage = async (code) => {
    setLang(code);
    await languageFn({ data: { language: code } });
  };

  return (
    <section className="rounded-2xl border border-border bg-card shadow-card p-5 sm:p-6">
      <header className="mb-5">
        <h2 className="type-section-title">{t("settings.account")}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{t("settings.account_desc")}</p>
      </header>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label>{t("common.email")}</Label>
          <p className="mt-1.5 truncate rounded-lg border border-border bg-secondary/50 px-3 py-2 text-sm text-muted-foreground">
            {user?.email}
          </p>
        </div>
        <div>
          <Label>{t("settings.my_language")}</Label>
          <Select value={lang} onValueChange={changeLanguage}>
            <SelectTrigger className="mt-1.5">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="max-h-72">
              {languages.map((item) => (
                <SelectItem key={item.code} value={item.code}>
                  {item.native}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="mt-6 border-t border-border pt-5">
        <h3 className="font-heading text-sm font-semibold">{t("settings.plan")}</h3>
        <p className="mt-1 text-sm text-muted-foreground">{t("settings.plan_desc")}</p>

        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          {Object.entries(PLAN).map(([id, plan]) => (
            <div
              key={id}
              className={`rounded-xl border p-4 ${
                id === currentPlan ? "border-primary bg-primary/5" : "border-border"
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <p className="font-heading text-sm font-semibold">{t(plan.key)}</p>
                {id === currentPlan ? <Check className="h-4 w-4 text-primary" /> : null}
              </div>
              <p className="mt-2 font-heading text-lg font-bold">
                {plan.price}
                <span className="text-xs font-medium text-muted-foreground">{t("settings.per_month")}</span>
              </p>
              <p className="mt-1 text-xs text-muted-foreground">{t(plan.desc)}</p>
              {id === currentPlan ? (
                <p className="mt-2 text-[11px] font-medium uppercase tracking-wide text-primary">
                  {t("settings.plan_current")}
                </p>
              ) : (
                <p className="mt-2 text-[11px] uppercase tracking-wide text-muted-foreground">
                  {t("settings.plan_coming_soon")}
                </p>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}