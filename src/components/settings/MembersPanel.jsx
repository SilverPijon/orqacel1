import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Plus, UserMinus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import StatusBadge from "@/components/StatusBadge";
import ConfirmDeleteDialog from "@/components/ConfirmDeleteDialog";
import { useSession } from "@/lib/SessionContext";
import { listMembers, removeMember, updateMemberRole } from "@/lib/tenant-fns";
import { inviteMember } from "@/lib/invitations-fns";
import { MEMBERSHIP_STATUS, ROLE } from "@/lib/statusMeta";
import { useI18n } from "@/lib/i18n/I18nContext";

const MANAGEABLE_STATUSES = ["pending", "active"];

export default function MembersPanel() {
  const { t } = useI18n();
  const { activeCompany, permissions, refresh } = useSession();
  const fetchMembers = useServerFn(listMembers);
  const inviteFn = useServerFn(inviteMember);
  const roleFn = useServerFn(updateMemberRole);
  const removeFn = useServerFn(removeMember);

  const [email, setEmail] = useState("");
  const [role, setRole] = useState("member");
  const [saving, setSaving] = useState(false);
  const [pendingRemoval, setPendingRemoval] = useState(null);

  const query = useQuery({
    queryKey: ["members", activeCompany?.id],
    queryFn: () => fetchMembers(),
    enabled: Boolean(activeCompany?.id),
  });

  const members = query.data || [];

  const submit = async (event) => {
    event.preventDefault();
    if (!email.trim()) return;
    setSaving(true);
    try {
      const result = await inviteFn({ data: { email: email.trim(), role } });
      setEmail("");
      setRole("member");
      await query.refetch();
      await refresh();
      if (result?.email_sent) toast.success(t("settings.invitation_sent"));
      else toast.warning(t("settings.invitation_saved_no_email"));
    } catch (error) {
      toast.error(error?.message || t("common.error"));
    } finally {
      setSaving(false);
    }
  };

  const changeRole = async (membershipId, nextRole) => {
    try {
      await roleFn({ data: { membership_id: membershipId, role: nextRole } });
      await query.refetch();
      await refresh();
      toast.success(t("common.saved"));
    } catch (error) {
      toast.error(error?.message || t("common.error"));
    }
  };

  const confirmRemoval = async () => {
    if (!pendingRemoval) return;
    try {
      await removeFn({ data: { membership_id: pendingRemoval.id } });
      setPendingRemoval(null);
      await query.refetch();
      await refresh();
      toast.success(t("settings.member_removed"));
    } catch (error) {
      toast.error(error?.message || t("common.error"));
    }
  };

  return (
    <section className="rounded-2xl border border-border bg-card p-5 sm:p-6">
      <header className="mb-5">
        <h2 className="font-heading text-base font-semibold">{t("settings.members")}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{t("settings.members_desc")}</p>
      </header>

      {permissions.canManage ? (
        <form onSubmit={submit} className="mb-5 flex flex-col gap-2 sm:flex-row">
          <Input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder={t("settings.member_email")}
            className="sm:flex-1"
            required
          />
          <Select value={role} onValueChange={setRole}>
            <SelectTrigger className="sm:w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="member">{t("settings.role_member")}</SelectItem>
              <SelectItem value="admin">{t("settings.role_admin")}</SelectItem>
            </SelectContent>
          </Select>
          <Button type="submit" disabled={saving} className="gap-2">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            {t("settings.add_member")}
          </Button>
        </form>
      ) : null}

      <div className="divide-y divide-border rounded-xl border border-border">
        {query.isLoading ? (
          <div className="grid place-items-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          members.map((member) => {
            const locked =
              !permissions.canManage ||
              member.role === "owner" ||
              member.is_me ||
              !MANAGEABLE_STATUSES.includes(member.status);
            return (
              <div key={member.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">
                    {member.full_name || member.user_email}
                    {member.is_me ? ` · ${t("settings.account")}` : ""}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">{member.user_email}</p>
                </div>
                <div className="flex items-center gap-2">
                  {member.status !== "active" && MEMBERSHIP_STATUS[member.status] ? (
                    <StatusBadge
                      label={t(MEMBERSHIP_STATUS[member.status].key)}
                      tone={MEMBERSHIP_STATUS[member.status].tone}
                    />
                  ) : null}
                  {member.role === "owner" || locked ? (
                    <StatusBadge label={t(ROLE[member.role].key)} tone={ROLE[member.role].tone} />
                  ) : (
                    <Select
                      value={member.role}
                      onValueChange={(value) => changeRole(member.id, value)}
                    >
                      <SelectTrigger className="h-8 w-32">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="member">{t("settings.role_member")}</SelectItem>
                        <SelectItem value="admin">{t("settings.role_admin")}</SelectItem>
                      </SelectContent>
                    </Select>
                  )}
                  {permissions.canManage && member.role !== "owner" && !member.is_me ? (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-muted-foreground hover:text-destructive"
                      onClick={() => setPendingRemoval(member)}
                      aria-label={t("settings.remove_member")}
                    >
                      <UserMinus className="h-4 w-4" />
                    </Button>
                  ) : null}
                </div>
              </div>
            );
          })
        )}
      </div>

      {permissions.canManage ? (
        <p className="mt-3 text-xs text-muted-foreground">{t("settings.owner_locked")}</p>
      ) : null}

      <ConfirmDeleteDialog
        open={Boolean(pendingRemoval)}
        onOpenChange={(open) => (open ? null : setPendingRemoval(null))}
        title={t("settings.remove_member")}
        description={t("settings.remove_member_desc")}
        onConfirm={confirmRemoval}
      />
    </section>
  );
}