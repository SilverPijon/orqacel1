import React, { useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { FileText, Loader2, Plus, Search } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import PageHeader from "@/components/PageHeader";
import EmptyState from "@/components/EmptyState";
import ConfirmDeleteDialog from "@/components/ConfirmDeleteDialog";
import QuotationsTable from "@/components/quotations/QuotationsTable";
import { usePagedList } from "@/hooks/usePagedList";
import { useSession } from "@/lib/SessionContext";
import { deleteQuotation, listQuotations } from "@/lib/quotations-fns";
import { useI18n } from "@/lib/i18n/I18nContext";

export const Route = createFileRoute("/_authed/quotations/")({
  head: () => ({ meta: [{ title: "Taskivo — Quotations" }] }),
  component: QuotationsPage,
});

function QuotationsPage() {
  const { t } = useI18n();
  const { activeCompany, permissions } = useSession();
  const navigate = useNavigate();
  const fetchQuotations = useServerFn(listQuotations);
  const deleteFn = useServerFn(deleteQuotation);

  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [pendingDelete, setPendingDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);

  const list = usePagedList(fetchQuotations, {
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
      <PageHeader title={t("quotations.title")} subtitle={t("quotations.subtitle")}>
        <Button asChild className="gap-2">
          <Link to="/quotations/new">
            <Plus className="h-4 w-4" />
            {t("quotations.new")}
          </Link>
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
            <SelectItem value="draft">{t("quotations.status_draft")}</SelectItem>
            <SelectItem value="sent">{t("quotations.status_sent")}</SelectItem>
            <SelectItem value="accepted">{t("quotations.status_accepted")}</SelectItem>
            <SelectItem value="declined">{t("quotations.status_declined")}</SelectItem>
            <SelectItem value="expired">{t("quotations.status_expired")}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {list.loading ? (
        <div className="grid min-h-[30vh] place-items-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : list.items.length ? (
        <>
          <QuotationsTable
            quotations={list.items}
            currency={activeCompany?.currency || "EUR"}
            canDelete={permissions.canManage}
            onEdit={(quotation) =>
              navigate({ to: "/quotations/$quotationId/edit", params: { quotationId: quotation.id } })
            }
            onDelete={(quotation) => setPendingDelete(quotation)}
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
        <EmptyState icon={FileText} title={t("quotations.empty")} description={t("quotations.empty_desc")}>
          <Button asChild className="gap-2">
            <Link to="/quotations/new">
              <Plus className="h-4 w-4" />
              {t("quotations.new")}
            </Link>
          </Button>
        </EmptyState>
      )}

      <ConfirmDeleteDialog
        open={Boolean(pendingDelete)}
        onOpenChange={(open) => (open ? null : setPendingDelete(null))}
        title={t("quotations.delete_title")}
        description={t("quotations.delete_desc")}
        onConfirm={confirmDelete}
        pending={deleting}
      />
    </div>
  );
}