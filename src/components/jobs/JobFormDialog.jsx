import React, { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { listClients } from "@/lib/clients-fns";
import { createJob, updateJob } from "@/lib/jobs-fns";
import { listMembers } from "@/lib/tenant-fns";
import { JOB_PRIORITIES, JOB_STATUSES } from "@/lib/constants";
import { PAUSE_REASONS } from "@/lib/jobStatus";
import { useI18n } from "@/lib/i18n/I18nContext";

const EMPTY = {
  title: "", client_id: "", description: "", status: "scheduled", priority: "medium",
  scheduled_date: "", completed_date: "", assigned_to_id: "", address: "", price: "0",
  pause_reason: "", pause_note: "",
};

export default function JobFormDialog({ open, onOpenChange, job, onSaved, onConflict }) {
  const { t } = useI18n();
  const createFn = useServerFn(createJob);
  const updateFn = useServerFn(updateJob);
  const fetchClients = useServerFn(listClients);
  const fetchMembers = useServerFn(listMembers);
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    const next = { ...EMPTY };
    if (job) {
      Object.keys(EMPTY).forEach((field) => {
        if (job[field] !== undefined && job[field] !== null) next[field] = job[field];
      });
      next.price = String(job.price ?? 0);
    }
    setForm(next);
  }, [open, job]);

  const clientsQuery = useQuery({
    queryKey: ["clients-for-select"],
    queryFn: () => fetchClients({ data: { limit: 50 } }),
    enabled: open,
  });

  const membersQuery = useQuery({
    queryKey: ["members-for-select"],
    queryFn: () => fetchMembers(),
    enabled: open,
  });

  const clients = clientsQuery.data?.items || [];
  const members = (membersQuery.data || []).filter((member) => member.user_id);

  const update = (field, value) => setForm((previous) => ({ ...previous, [field]: value }));

  const submit = async (event) => {
    event.preventDefault();
    if (!form.title.trim()) {
      toast.error(t("common.required"));
      return;
    }
    setSaving(true);
    try {
      const payload = {
        title: form.title.trim(),
        client_id: form.client_id,
        description: form.description,
        status: form.status,
        priority: form.priority,
        scheduled_date: form.scheduled_date,
        completed_date: form.completed_date,
        assigned_to_id: form.assigned_to_id,
        address: form.address,
        price: Number(form.price) || 0,
        // Only sent while paused; leaving paused clears them on the server.
        pause_reason: form.status === "paused" ? form.pause_reason : "",
        pause_note: form.status === "paused" ? form.pause_note.trim() : "",
      };
      if (job) {
        // The revision this form was opened on: a job saved or moved elsewhere meanwhile is
        // reported by the server instead of this stale version overwriting the newer one.
        await updateFn({
          data: {
            id: job.id,
            ...payload,
            expected_revision: Number.isInteger(job.revision) ? job.revision : 0,
          },
        });
      } else await createFn({ data: payload });
      toast.success(t("common.saved"));
      onOpenChange(false);
      onSaved?.();
    } catch (error) {
      if (error?.status === 409) {
        // The job moved while this form was open. Leave the stale version alone and let the detail
        // screen offer the latest data rather than saving over a change nobody here has seen.
        toast.error(t("jobs.status_conflict"));
        onOpenChange(false);
        onConflict?.();
      } else {
        toast.error(error?.message || t("common.error"));
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{job ? t("jobs.edit") : t("jobs.new")}</DialogTitle>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Label htmlFor="job-title">{t("jobs.job_title")}</Label>
              <Input
                id="job-title"
                className="mt-1.5"
                value={form.title}
                onChange={(event) => update("title", event.target.value)}
                required
              />
            </div>
            <div>
              <Label>{t("quotations.client")}</Label>
              <Select
                value={form.client_id || "none"}
                onValueChange={(value) => update("client_id", value === "none" ? "" : value)}
              >
                <SelectTrigger className="mt-1.5">
                  <SelectValue placeholder={t("quotations.select_client")} />
                </SelectTrigger>
                <SelectContent className="max-h-72">
                  <SelectItem value="none">{t("common.none")}</SelectItem>
                  {clients.map((client) => (
                    <SelectItem key={client.id} value={client.id}>
                      {client.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>{t("jobs.assigned_to")}</Label>
              <Select
                value={form.assigned_to_id || "none"}
                onValueChange={(value) => update("assigned_to_id", value === "none" ? "" : value)}
              >
                <SelectTrigger className="mt-1.5">
                  <SelectValue placeholder={t("common.unassigned")} />
                </SelectTrigger>
                <SelectContent className="max-h-72">
                  <SelectItem value="none">{t("common.unassigned")}</SelectItem>
                  {members.map((member) => (
                    <SelectItem key={member.user_id} value={member.user_id}>
                      {member.full_name || member.user_email}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>{t("common.status")}</Label>
              <Select value={form.status} onValueChange={(value) => update("status", value)}>
                <SelectTrigger className="mt-1.5">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {JOB_STATUSES.map((status) => (
                    <SelectItem key={status} value={status}>
                      {t(`jobs.status_${status}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {form.status === "paused" ? (
              <>
                <div>
                  <Label>{t("jobs.pause_reason")}</Label>
                  <Select
                    value={form.pause_reason || "none"}
                    onValueChange={(value) => update("pause_reason", value === "none" ? "" : value)}
                  >
                    <SelectTrigger className="mt-1.5">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">{t("jobs.pause_reason_none")}</SelectItem>
                      {PAUSE_REASONS.map((reason) => (
                        <SelectItem key={reason} value={reason}>
                          {t(`jobs.pause_reason_${reason}`)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="sm:col-span-2">
                  <Label htmlFor="job-pause-note">{t("jobs.pause_note")}</Label>
                  <Textarea
                    id="job-pause-note"
                    className="mt-1.5"
                    rows={2}
                    maxLength={500}
                    placeholder={t("jobs.pause_note_placeholder")}
                    value={form.pause_note}
                    onChange={(event) => update("pause_note", event.target.value)}
                  />
                </div>
              </>
            ) : null}
            <div>
              <Label>{t("jobs.priority")}</Label>
              <Select value={form.priority} onValueChange={(value) => update("priority", value)}>
                <SelectTrigger className="mt-1.5">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {JOB_PRIORITIES.map((priority) => (
                    <SelectItem key={priority} value={priority}>
                      {t(`jobs.priority_${priority}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="job-scheduled">{t("jobs.scheduled_date")}</Label>
              <Input
                id="job-scheduled"
                type="date"
                className="mt-1.5"
                value={form.scheduled_date}
                onChange={(event) => update("scheduled_date", event.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="job-price">{t("jobs.price")}</Label>
              <Input
                id="job-price"
                type="number"
                min="0"
                step="0.01"
                className="mt-1.5"
                value={form.price}
                onChange={(event) => update("price", event.target.value)}
              />
            </div>
            <div className="sm:col-span-2">
              <Label htmlFor="job-address">{t("common.address")}</Label>
              <Input
                id="job-address"
                className="mt-1.5"
                value={form.address}
                onChange={(event) => update("address", event.target.value)}
              />
            </div>
            <div className="sm:col-span-2">
              <Label htmlFor="job-description">{t("common.description")}</Label>
              <Textarea
                id="job-description"
                className="mt-1.5"
                rows={3}
                value={form.description}
                onChange={(event) => update("description", event.target.value)}
              />
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={saving} className="gap-2">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {saving ? t("common.saving") : t("common.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}