import React, { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Briefcase, Loader2, Plus, Search } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import PageHeader from "@/components/PageHeader";
import EmptyState from "@/components/EmptyState";
import ConfirmDeleteDialog from "@/components/ConfirmDeleteDialog";
import JobFormDialog from "@/components/jobs/JobFormDialog";
import JobsTable from "@/components/jobs/JobsTable";
import { usePagedList } from "@/hooks/usePagedList";
import { useSession } from "@/lib/SessionContext";
import { deleteJob, listJobs } from "@/lib/jobs-fns";
import { useI18n } from "@/lib/i18n/I18nContext";

export const Route = createFileRoute("/_authed/jobs/")({
  head: () => ({ meta: [{ title: "Orqacel — Jobs" }] }),
  component: JobsPage,
});

function JobsPage() {
  const { t } = useI18n();
  const { activeCompany, permissions } = useSession();
  const fetchJobs = useServerFn(listJobs);
  const deleteFn = useServerFn(deleteJob);

  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [pendingDelete, setPendingDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);

  const list = usePagedList(fetchJobs, {
    ...(search.trim() ? { search: search.trim() } : {}),
    ...(status !== "all" ? { status } : {}),
  });

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      await deleteFn({ data: { id: pendingDelete.id } });
      setPendingDelete(null);
      await list.reload();
      toast.success(t("common.saved"));
    } catch (error) {
      toast.error(error?.message || t("common.error"));
    } finally {
      setDeleting(false);
    }
  };

  const openNew = () => {
    setEditing(null);
    setFormOpen(true);
  };

  return (
    <div>
      <PageHeader title={t("jobs.title")} subtitle={t("jobs.subtitle")}>
        <Button className="gap-2" onClick={openNew}>
          <Plus className="h-4 w-4" />
          {t("jobs.new")}
        </Button>
      </PageHeader>

      <div className="mb-4 flex flex-col gap-2 sm:flex-row">
        <div className="relative sm:max-w-xs sm:flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={`${t("common.search")}…`}
            className="pl-9"
          />
        </div>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="sm:w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("common.all")}</SelectItem>
            <SelectItem value="scheduled">{t("jobs.status_scheduled")}</SelectItem>
            <SelectItem value="in_progress">{t("jobs.status_in_progress")}</SelectItem>
            <SelectItem value="paused">{t("jobs.status_paused")}</SelectItem>
            <SelectItem value="completed">{t("jobs.status_completed")}</SelectItem>
            <SelectItem value="cancelled">{t("jobs.status_cancelled")}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {list.loading ? (
        <div className="grid min-h-[30vh] place-items-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : list.items.length ? (
        <>
          <JobsTable
            jobs={list.items}
            currency={activeCompany?.currency || "EUR"}
            canDelete={permissions.canManage}
            onEdit={(job) => {
              setEditing(job);
              setFormOpen(true);
            }}
            onDelete={(job) => setPendingDelete(job)}
          />
          {list.hasMore ? (
            <div className="mt-4 flex justify-center">
              <Button variant="outline" onClick={list.loadMore} disabled={list.loadingMore} className="gap-2">
                {list.loadingMore ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                {t("common.more")}
              </Button>
            </div>
          ) : null}
        </>
      ) : (
        <EmptyState icon={Briefcase} title={t("jobs.empty")} description={t("jobs.empty_desc")}>
          <Button className="gap-2" onClick={openNew}>
            <Plus className="h-4 w-4" />
            {t("jobs.new")}
          </Button>
        </EmptyState>
      )}

      <JobFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        job={editing}
        onSaved={() => list.reload()}
        onConflict={() => list.reload()}
      />

      <ConfirmDeleteDialog
        open={Boolean(pendingDelete)}
        onOpenChange={(open) => (open ? null : setPendingDelete(null))}
        title={t("jobs.delete_title")}
        description={t("jobs.delete_desc")}
        onConfirm={confirmDelete}
        pending={deleting}
      />
    </div>
  );
}