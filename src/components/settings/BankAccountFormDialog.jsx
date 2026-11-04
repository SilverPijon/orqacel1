import React, { useEffect, useRef, useState } from "react";
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
import { Switch } from "@/components/ui/switch";
import FormField, { fieldErrorProps } from "@/components/FormField";
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
  const fieldRefs = useRef({});

  useEffect(() => {
    setError(null);
    setForm(account ? { ...EMPTY, ...account } : EMPTY);
  }, [account, open]);

  const set = (field, value) => {
    setForm((previous) => ({ ...previous, [field]: value }));
    // An edited field stops claiming to be wrong; the next save checks it again.
    if (error && ERROR_FIELD[error] === field) setError(null);
  };

  // Runs the same reader the server runs, shows its message under the field it belongs to and moves
  // focus there. Returns the value to save, or null when the form may not be saved.
  const showErrors = () => {
    const parsed = readBankAccountInput(form);
    setError(parsed.error || null);
    if (parsed.error) {
      const control = fieldRefs.current[ERROR_FIELD[parsed.error]];
      control?.focus();
      return null;
    }
    return parsed.value;
  };

  const submit = async (event) => {
    event.preventDefault();
    const value = showErrors();
    if (!value) return;
    await onSubmit({ ...value, is_default: form.is_default === true });
  };

  const errorFor = (field) => (error && ERROR_FIELD[error] === field ? t(ERROR_KEY[error]) : null);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{account ? t("bank.edit") : t("bank.add")}</DialogTitle>
          <DialogDescription>{t("bank.desc")}</DialogDescription>
        </DialogHeader>

        <form
          onSubmit={submit}
          noValidate
          className="space-y-4"
          // Native validation is off above; if a browser applies it anyway, the form still answers
          // with its own inline message instead of a bubble in the browser's language.
          onInvalid={(event) => {
            event.preventDefault();
            showErrors();
          }}
        >
          <FormField
            id="bank-holder"
            label={t("bank.account_holder")}
            error={errorFor("account_holder")}
            required
          >
            <Input
              id="bank-holder"
              ref={(element) => {
                fieldRefs.current.account_holder = element;
              }}
              value={form.account_holder}
              onChange={(event) => set("account_holder", event.target.value)}
              aria-required="true"
              {...fieldErrorProps("bank-holder", errorFor("account_holder"))}
            />
          </FormField>

          <FormField id="bank-iban" label={t("bank.iban")} error={errorFor("iban")} required>
            <Input
              id="bank-iban"
              ref={(element) => {
                fieldRefs.current.iban = element;
              }}
              className="font-mono"
              value={form.iban}
              onChange={(event) => set("iban", event.target.value)}
              aria-required="true"
              {...fieldErrorProps("bank-iban", errorFor("iban"))}
            />
          </FormField>

          <div className="grid gap-4 sm:grid-cols-2">
            <FormField id="bank-name" label={t("bank.bank_name")} error={errorFor("bank_name")}>
              <Input
                id="bank-name"
                ref={(element) => {
                  fieldRefs.current.bank_name = element;
                }}
                value={form.bank_name}
                onChange={(event) => set("bank_name", event.target.value)}
                {...fieldErrorProps("bank-name", errorFor("bank_name"))}
              />
            </FormField>
            <FormField id="bank-bic" label={t("bank.bic")} error={errorFor("bic")}>
              <Input
                id="bank-bic"
                ref={(element) => {
                  fieldRefs.current.bic = element;
                }}
                className="font-mono"
                value={form.bic}
                onChange={(event) => set("bic", event.target.value)}
                {...fieldErrorProps("bank-bic", errorFor("bic"))}
              />
            </FormField>
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
            <Button type="submit" formNoValidate disabled={pending} className="gap-2">
              {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {t("common.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}