import React from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useI18n } from "@/lib/i18n/I18nContext";

// Issuing without bank details is allowed, but never by accident: an invoice with no account cannot
// tell the customer where to pay. Nothing is filled in on the person's behalf.
export default function IssueWithoutBankDialog({ open, onOpenChange, onConfirm, pending }) {
  const { t } = useI18n();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-muted-foreground" />
            {t("invoices.issue_no_bank_title")}
          </DialogTitle>
          <DialogDescription>{t("invoices.issue_no_bank_desc")}</DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2">
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button type="button" disabled={pending} onClick={onConfirm}>
            {t("invoices.issue_anyway")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}