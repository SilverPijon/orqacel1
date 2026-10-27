import React, { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { PAUSE_REASONS } from "@/lib/jobStatus";
import { useI18n } from "@/lib/i18n/I18nContext";

const NO_REASON = "none";

export default function PauseJobDialog({ open, onOpenChange, onConfirm, pending }) {
  const { t } = useI18n();
  const [reason, setReason] = useState(NO_REASON);
  const [note, setNote] = useState("");

  useEffect(() => {
    if (open) {
      setReason(NO_REASON);
      setNote("");
    }
  }, [open]);

  const submit = (event) => {
    event.preventDefault();
    onConfirm({ reason: reason === NO_REASON ? "" : reason, note });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("jobs.pause_title")}</DialogTitle>
          <DialogDescription>{t("jobs.pause_desc")}</DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-4">
          <div>
            <Label htmlFor="pause-reason">{t("jobs.pause_reason")}</Label>
            <Select value={reason} onValueChange={setReason}>
              <SelectTrigger id="pause-reason" className="mt-1.5">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_REASON}>{t("jobs.pause_reason_none")}</SelectItem>
                {PAUSE_REASONS.map((value) => (
                  <SelectItem key={value} value={value}>
                    {t(`jobs.pause_reason_${value}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label htmlFor="pause-note">{t("jobs.pause_note")}</Label>
            <Textarea
              id="pause-note"
              className="mt-1.5"
              rows={3}
              maxLength={500}
              value={note}
              placeholder={t("jobs.pause_note_placeholder")}
              onChange={(event) => setNote(event.target.value)}
            />
          </div>

          <DialogFooter className="gap-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={pending}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={pending} className="gap-2">
              {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {t("jobs.pause")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}