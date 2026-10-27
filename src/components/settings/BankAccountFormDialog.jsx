import React, { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { readBankAccountInput } from "@/lib/bankAccounts";
import { useI18n } from "@/lib/i18n/I18nContext";

const EMPTY = { account_holder: "", iban: "", bank_name: "", bic: "", is_default: false };

// Which field a problem belongs to, and how to say it. The validation itself is the same reader the
// server runs, so this form cannot accept something the server would refuse.
const ERROR_FIELD = {
  HOLDER_REQUIRED: "account_holder",
  HOLDER_TOO_LONG: "account_holder",
  BANK_NAME_TOO_LONG: "bank_name",
  BAD_IBAN: "iban",
  BAD_BIC: "bic",
};

const ERROR_KEY = {
  HOLDER_REQUIRED: "bank.holder_required",
  HOLDER_TOO_LONG: "bank.too_long",
  BANK_NAME_TOO_LONG: "bank.too_long",
  BAD_IBAN: "bank.invalid_iban",
  BAD_BIC: "bank.invalid_bic",
};

export default function BankAccountFormDialog({ open, onOpenChange, account, pending, onSubmit }) {
  const { t } = useI18n();
  const [form, setForm] = useState(EMPTY);
  const [error, setError] = useState(null);

  useEffect(() => {
    setError(null);
    setForm(account ? { ...EMPTY, ...account } : EMPTY);
  }, [account, open]);

  const set = (field, value) => setForm((previous) => ({ ...previous, [field]: value }));

  const submit = async (event) => {
    event.preventDefault();
    const parsed = readBankAccountInput(form);
    if (parsed.error) {
      setError(parsed.error);
      return;
    }
    setError(null);
    await onSubmit({ ...parsed.value, is_default: form.is_default === true });
  };

  const errorFor = (field) => (error && ERROR_FIELD[error] === field ? t(ERROR_KEY[error]) : null);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{account ? t("bank.edit") : t("bank.add")}</DialogTitle>
          <DialogDescription>{t("bank.desc")}</DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-4">
          <div>
            <Label htmlFor="bank-holder">{t("bank.account_holder")}</Label>
            <Input
              id="bank-holder"
              className="mt-1.5"
              value={form.account_holder}
              onChange={(event) => set("account_holder", event.target.value)}
            />
            {errorFor("account_holder") ? (
              <p className="mt-1 text-xs text-destructive">{errorFor("account_holder")}</p>
            ) : null}
          </div>

          <div>
            <Label htmlFor="bank-iban">{t("bank.iban")}</Label>
            <Input
              id="bank-iban"
              className="mt-1.5 font-mono"
              value={form.iban}
              onChange={(event) => set("iban", event.target.value)}
            />
            {errorFor("iban") ? <p className="mt-1 text-xs text-destructive">{errorFor("iban")}</p> : null}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="bank-name">{t("bank.bank_name")}</Label>
              <Input
                id="bank-name"
                className="mt-1.5"
                value={form.bank_name}
                onChange={(event) => set("bank_name", event.target.value)}
              />
              {errorFor("bank_name") ? (
                <p className="mt-1 text-xs text-destructive">{errorFor("bank_name")}</p>
              ) : null}
            </div>
            <div>
              <Label htmlFor="bank-bic">{t("bank.bic")}</Label>
              <Input
                id="bank-bic"
                className="mt-1.5 font-mono"
                value={form.bic}
                onChange={(event) => set("bic", event.target.value)}
              />
              {errorFor("bic") ? <p className="mt-1 text-xs text-destructive">{errorFor("bic")}</p> : null}
            </div>
          </div>

          <div className="flex items-center justify-between gap-4 rounded-xl border border-border p-3">
            <div className="min-w-0">
              <p className="text-sm font-medium">{t("bank.default")}</p>
              <p className="text-xs text-muted-foreground">{t("bank.default_hint")}</p>
            </div>
            <Switch
              checked={form.is_default === true}
              disabled={account?.is_default === true}
              onCheckedChange={(checked) => set("is_default", checked)}
            />
          </div>

          <DialogFooter className="gap-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={pending} className="gap-2">
              {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {t("common.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}