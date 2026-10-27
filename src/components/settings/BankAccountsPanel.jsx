import React, { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import ConfirmDeleteDialog from "@/components/ConfirmDeleteDialog";
import BankAccountFormDialog from "@/components/settings/BankAccountFormDialog";
import BankAccountRow from "@/components/settings/BankAccountRow";
import { useSession } from "@/lib/SessionContext";
import { createBankAccount, deleteBankAccount, listBankAccounts, updateBankAccount } from "@/lib/bank-accounts-fns";
import { useI18n } from "@/lib/i18n/I18nContext";

// The company's bank accounts, the place an invoice takes its payment details from. Managing them is
// owner/admin work; members see the list because their company's invoices have to show where money
// is paid.
export default function BankAccountsPanel() {
  const { t } = useI18n();
  const { activeCompany, permissions } = useSession();
  const queryClient = useQueryClient();
  const fetchAccounts = useServerFn(listBankAccounts);
  const createFn = useServerFn(createBankAccount);
  const updateFn = useServerFn(updateBankAccount);
  const deleteFn = useServerFn(deleteBankAccount);
  const [editing, setEditing] = useState(null);
  const [removing, setRemoving] = useState(null);
  const [busy, setBusy] = useState(false);
  const canEdit = permissions.canManage;

  const query = useQuery({
    queryKey: ["bank-accounts", activeCompany?.id],
    queryFn: () => fetchAccounts(),
    enabled: Boolean(activeCompany?.id),
  });
  const accounts = query.data || [];

  const run = async (action) => {
    setBusy(true);
    try {
      await action();
      await queryClient.invalidateQueries({ queryKey: ["bank-accounts"] });
      toast.success(t("common.saved"));
      return true;
    } catch (error) {
      toast.error(error?.message || t("common.error"));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const save = async (values) => {
    const saved = await run(() =>
      editing?.id ? updateFn({ data: { id: editing.id, ...values } }) : createFn({ data: values }),
    );
    if (saved) setEditing(null);
  };

  const makeDefault = (account) =>
    run(() =>
      updateFn({
        data: {
          id: account.id,
          account_holder: account.account_holder,
          iban: account.iban,
          bank_name: account.bank_name,
          bic: account.bic,
          is_default: true,
        },
      }),
    );

  const remove = async () => {
    const removed = await run(() => deleteFn({ data: { id: removing.id } }));
    if (removed) setRemoving(null);
  };

  return (
    <section className="rounded-2xl border border-border bg-card p-5 sm:p-6">
      <header className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-heading text-base font-semibold">{t("bank.title")}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{t("bank.desc")}</p>
        </div>
        {canEdit ? (
          <Button variant="outline" className="gap-2" disabled={busy} onClick={() => setEditing({})}>
            <Plus className="h-4 w-4" />
            {t("bank.add")}
          </Button>
        ) : null}
      </header>

      {query.isLoading ? (
        <div className="flex h-16 items-center">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : accounts.length ? (
        <div className="space-y-3">
          {accounts.map((account) => (
            <BankAccountRow
              key={account.id}
              account={account}
              canEdit={canEdit}
              busy={busy}
              onEdit={setEditing}
              onDelete={setRemoving}
              onMakeDefault={makeDefault}
            />
          ))}
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-border bg-muted/30 p-4">
          <p className="text-sm font-medium">{t("bank.empty")}</p>
          <p className="mt-1 text-sm text-muted-foreground">{t("bank.empty_desc")}</p>
        </div>
      )}

      <p className="mt-4 text-xs text-muted-foreground">
        {canEdit ? t("bank.default_hint") : t("bank.members_readonly")}
      </p>

      <BankAccountFormDialog
        open={Boolean(editing)}
        onOpenChange={(open) => {
          if (!open) setEditing(null);
        }}
        account={editing?.id ? editing : null}
        pending={busy}
        onSubmit={save}
      />

      <ConfirmDeleteDialog
        open={Boolean(removing)}
        onOpenChange={(open) => {
          if (!open) setRemoving(null);
        }}
        title={t("bank.delete_title")}
        description={t("bank.delete_desc")}
        onConfirm={remove}
        pending={busy}
      />
    </section>
  );
}