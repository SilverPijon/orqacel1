import React, { useState } from "react";
import { CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import ConfirmDeleteDialog from "@/components/ConfirmDeleteDialog";
import IssueWithoutBankDialog from "@/components/invoices/IssueWithoutBankDialog";
import { isDraft } from "@/lib/invoiceLifecycle";
import { useI18n } from "@/lib/i18n/I18nContext";

// Issuing freezes the invoice, cancelling voids it while keeping it on record, and only a draft may
// be deleted. Members see none of these actions; the server refuses them regardless of the UI.
export default function InvoiceStatusActions({ invoice, canManage, busy, onIssue, onCancel, onDelete }) {
  const { t } = useI18n();
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [confirmingIssue, setConfirmingIssue] = useState(false);
  // Where to pay is part of what an invoice is for, so issuing without it asks first — and then
  // still goes ahead, because nothing is filled in on the person's behalf.
  const hasBankDetails = Boolean(invoice.payment_snapshot?.iban || invoice.iban);

  if (!canManage) return null;

  return (
    <>
      <div className="mt-6 flex flex-wrap gap-2">
        {isDraft(invoice) ? (
          <Button
            className="gap-2"
            disabled={busy}
            onClick={() => (hasBankDetails ? onIssue() : setConfirmingIssue(true))}
          >
            <CheckCircle2 className="h-4 w-4" />
            {t("invoices.issue")}
          </Button>
        ) : null}
        {invoice.status !== "cancelled" ? (
          <Button variant="outline" disabled={busy} onClick={() => setConfirmingCancel(true)}>
            {t("invoices.cancel_invoice")}
          </Button>
        ) : null}
        {isDraft(invoice) ? (
          <Button
            variant="ghost"
            className="text-destructive hover:text-destructive"
            disabled={busy}
            onClick={() => setConfirmingDelete(true)}
          >
            {t("common.delete")}
          </Button>
        ) : null}
      </div>

      <ConfirmDeleteDialog
        open={confirmingCancel}
        onOpenChange={setConfirmingCancel}
        title={t("invoices.cancel_title")}
        description={t("invoices.cancel_desc")}
        confirmLabel={t("invoices.cancel_invoice")}
        pending={busy}
        onConfirm={() => {
          setConfirmingCancel(false);
          onCancel();
        }}
      />

      <IssueWithoutBankDialog
        open={confirmingIssue}
        onOpenChange={setConfirmingIssue}
        pending={busy}
        onConfirm={() => {
          setConfirmingIssue(false);
          onIssue();
        }}
      />

      <ConfirmDeleteDialog
        open={confirmingDelete}
        onOpenChange={setConfirmingDelete}
        title={t("invoices.delete_title")}
        description={t("invoices.delete_desc")}
        pending={busy}
        onConfirm={() => {
          setConfirmingDelete(false);
          onDelete();
        }}
      />
    </>
  );
}