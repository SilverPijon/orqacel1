import React from "react";
import { Pencil, Star, StarOff, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatIban } from "@/lib/iban";
import { useI18n } from "@/lib/i18n/I18nContext";

// One saved bank account. Owners and admins get the controls; members only ever see the details,
// which their invoices need, and the server refuses a change from a member regardless of the UI.
export default function BankAccountRow({ account, canEdit, busy, onEdit, onDelete, onMakeDefault, onRemoveDefault }) {
  const { t } = useI18n();

  return (
    <div className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-border p-4">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-medium">{account.account_holder}</p>
          {account.is_default ? <Badge variant="secondary">{t("bank.default_badge")}</Badge> : null}
        </div>
        <p className="mt-0.5 font-mono text-xs text-muted-foreground">{formatIban(account.iban)}</p>
        {account.bank_name || account.bic ? (
          <p className="mt-0.5 text-xs text-muted-foreground">
            {[account.bank_name, account.bic].filter(Boolean).join(" · ")}
          </p>
        ) : null}
      </div>

      {canEdit ? (
        <div className="flex shrink-0 items-center gap-1">
          {account.is_default ? (
            <Button
              variant="ghost"
              size="sm"
              className="gap-2"
              disabled={busy}
              onClick={() => onRemoveDefault(account)}
            >
              <StarOff className="h-4 w-4" />
              {t("bank.remove_default")}
            </Button>
          ) : (
            <Button variant="ghost" size="sm" className="gap-2" disabled={busy} onClick={() => onMakeDefault(account)}>
              <Star className="h-4 w-4" />
              {t("bank.set_default")}
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            disabled={busy}
            onClick={() => onEdit(account)}
            aria-label={t("common.edit")}
          >
            <Pencil className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="text-destructive hover:text-destructive"
            disabled={busy}
            onClick={() => onDelete(account)}
            aria-label={t("common.delete")}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      ) : null}
    </div>
  );
}