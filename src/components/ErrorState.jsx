import React from "react";
import { AlertCircle, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n/I18nContext";

// A load that failed looks different from a list that is genuinely empty, and it can be retried
// in place instead of reloading the page.
export default function ErrorState({ onRetry, className = "" }) {
  const { t } = useI18n();

  return (
    <div
      role="alert"
      className={`rounded-xl border border-border bg-card px-6 py-10 text-center shadow-card ${className}`}
    >
      <AlertCircle className="mx-auto h-6 w-6 text-destructive" aria-hidden="true" />
      <p className="type-section-title mt-3">{t("common.load_failed")}</p>
      {onRetry ? (
        <Button variant="outline" className="mt-4 gap-2" onClick={onRetry}>
          <RotateCw className="h-4 w-4" aria-hidden="true" />
          {t("common.retry")}
        </Button>
      ) : null}
    </div>
  );
}