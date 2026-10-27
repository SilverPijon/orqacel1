import React, { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import ConfirmDeleteDialog from "@/components/ConfirmDeleteDialog";
import { base44 } from "@/api/base44Client";
import { useSession } from "@/lib/SessionContext";
import { getCompanyLogoUrl, removeCompanyLogo, setCompanyLogo } from "@/lib/logo-fns";
import { useI18n } from "@/lib/i18n/I18nContext";

const ACCEPTED_TYPES = ["image/png", "image/jpeg", "image/webp"];
const MAX_BYTES = 2 * 1024 * 1024;

export default function CompanyLogoPanel() {
  const { t } = useI18n();
  const { activeCompany, permissions, refresh } = useSession();
  const fetchLogo = useServerFn(getCompanyLogoUrl);
  const saveFn = useServerFn(setCompanyLogo);
  const removeFn = useServerFn(removeCompanyLogo);
  const inputRef = useRef(null);
  const [pending, setPending] = useState(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const canEdit = permissions.canManage;
  const hasLogo = Boolean(activeCompany?.has_logo);

  // A fresh short-lived link is minted per load; the private reference never reaches the browser.
  const logoQuery = useQuery({
    queryKey: ["company-logo", activeCompany?.id, activeCompany?.logo_updated_at],
    queryFn: () => fetchLogo(),
    enabled: Boolean(activeCompany?.id) && hasLogo,
    staleTime: 4 * 60 * 1000,
  });

  const signedUrl = logoQuery.data?.signed_url || null;
  const previewUrl = pending?.url || signedUrl;

  const clearPending = () => {
    if (pending?.url) URL.revokeObjectURL(pending.url);
    setPending(null);
  };

  const pickFile = (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!ACCEPTED_TYPES.includes(file.type)) {
      toast.error(t("logo.error_type"));
      return;
    }
    if (!file.size || file.size > MAX_BYTES) {
      toast.error(t("logo.error_size"));
      return;
    }
    clearPending();
    setPending({ file, url: URL.createObjectURL(file) });
  };

  const save = async () => {
    if (!pending?.file) return;
    setBusy(true);
    try {
      const { file_uri } = await base44.integrations.Core.UploadPrivateFile({ file: pending.file });
      await saveFn({ data: { file_uri } });
      await refresh();
      toast.success(t("logo.saved"));
      clearPending();
    } catch (error) {
      toast.error(error?.message || t("logo.error"));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      await removeFn({ data: {} });
      await refresh();
      toast.success(t("logo.removed"));
    } catch (error) {
      toast.error(error?.message || t("logo.error"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-2xl border border-border bg-card p-5 sm:p-6">
      <header className="mb-5">
        <h2 className="font-heading text-base font-semibold">{t("logo.title")}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{t("logo.desc")}</p>
      </header>

      <div className="flex flex-wrap items-start gap-5">
        <div className="grid h-24 w-24 shrink-0 place-items-center overflow-hidden rounded-xl border border-border bg-muted/40">
          {hasLogo && logoQuery.isLoading ? (
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          ) : previewUrl ? (
            <img src={previewUrl} alt={activeCompany?.name || ""} className="h-full w-full object-contain" />
          ) : (
            <span className="px-2 text-center text-sm font-semibold leading-tight">{activeCompany?.name}</span>
          )}
        </div>

        <div className="min-w-0 flex-1 space-y-3">
          {hasLogo ? null : <p className="text-xs text-muted-foreground">{t("logo.fallback")}</p>}
          {pending ? <p className="text-xs font-medium text-primary">{t("logo.pending")}</p> : null}

          {canEdit ? (
            <div className="flex flex-wrap gap-2">
              {pending ? (
                <>
                  <Button className="gap-2" disabled={busy} onClick={save}>
                    {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                    {t("logo.save")}
                  </Button>
                  <Button variant="ghost" disabled={busy} onClick={clearPending}>
                    {t("logo.cancel")}
                  </Button>
                </>
              ) : (
                <>
                  <Button
                    variant="outline"
                    className="gap-2"
                    disabled={busy}
                    onClick={() => inputRef.current?.click()}
                  >
                    <Upload className="h-4 w-4" />
                    {hasLogo ? t("logo.replace") : t("logo.upload")}
                  </Button>
                  {hasLogo ? (
                    <Button
                      variant="ghost"
                      className="gap-2 text-destructive hover:text-destructive"
                      disabled={busy}
                      onClick={() => setConfirming(true)}
                    >
                      <Trash2 className="h-4 w-4" />
                      {t("logo.remove")}
                    </Button>
                  ) : null}
                </>
              )}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">{t("errors.admin_only")}</p>
          )}

          <p className="text-xs text-muted-foreground">{t("logo.hint")}</p>
        </div>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={pickFile}
      />

      <ConfirmDeleteDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={t("logo.remove_title")}
        description={t("logo.remove_desc")}
        onConfirm={remove}
        pending={busy}
      />
    </section>
  );
}