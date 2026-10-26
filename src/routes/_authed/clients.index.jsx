import React, { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Plus, Search, Users } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import PageHeader from "@/components/PageHeader";
import EmptyState from "@/components/EmptyState";
import ConfirmDeleteDialog from "@/components/ConfirmDeleteDialog";
import ClientFormDialog from "@/components/clients/ClientFormDialog";
import ClientsTable from "@/components/clients/ClientsTable";
import { usePagedList } from "@/hooks/usePagedList";
import { useSession } from "@/lib/SessionContext";
import { deleteClient, listClients } from "@/lib/clients-fns";
import { useI18n } from "@/lib/i18n/I18nContext";

export const Route = createFileRoute("/_authed/clients/")({
  head: () => ({ meta: [{ title: "Taskivo — Clients" }] }),
  component: ClientsPage,
});

function ClientsPage() {
  const { t } = useI18n();
  const { permissions } = useSession();
  const fetchClients = useServerFn(listClients);
  const deleteFn = useServerFn(deleteClient);

  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [pendingDelete, setPendingDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);

  const list = usePagedList(fetchClients, {
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

  return (
    <div>
      <PageHeader title={t("clients.title")} subtitle={t("clients.subtitle")}>
        <Button
          className="gap-2"
          onClick={() => {
            setEditing(null);
            setFormOpen(true);
          }}
        >
          <Plus className="h-4 w-4" />
          {t("clients.new")}
        </Button>
      </PageHeader>

      <div className="mb-4 flex flex-col gap-2 sm:flex-row">
        <div className="relative sm:max-w-xs sm:flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t("clients.search_placeholder")}
            className="pl-9"
          />
        </div>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="sm:w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("common.all")}</SelectItem>
            <SelectItem value="active">{t("clients.active")}</SelectItem>
            <SelectItem value="archived">{t("clients.archived")}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {list.loading ? (
        <div className="grid min-h-[30vh] place-items-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : list.items.length ? (
        <>
          <ClientsTable
            clients={list.items}
            canDelete={permissions.canManage}
            onEdit={(client) => {
              setEditing(client);
              setFormOpen(true);
            }}
            onDelete={(client) => setPendingDelete(client)}
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
        <EmptyState icon={Users} title={t("clients.empty")} description={t("clients.empty_desc")}>
          <Button
            className="gap-2"
            onClick={() => {
              setEditing(null);
              setFormOpen(true);
            }}
          >
            <Plus className="h-4 w-4" />
            {t("clients.new")}
          </Button>
        </EmptyState>
      )}

      <ClientFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        client={editing}
        onSaved={() => list.reload()}
      />

      <ConfirmDeleteDialog
        open={Boolean(pendingDelete)}
        onOpenChange={(open) => (open ? null : setPendingDelete(null))}
        title={t("clients.delete_title")}
        description={t("clients.delete_desc")}
        onConfirm={confirmDelete}
        pending={deleting}
      />
    </div>
  );
}