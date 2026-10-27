import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import ConfirmDeleteDialog from "@/components/ConfirmDeleteDialog";
import InviteForm from "@/components/settings/InviteForm";
import MemberRow from "@/components/settings/MemberRow";
import InvitationRow from "@/components/settings/InvitationRow";
import { useSession } from "@/lib/SessionContext";
import { listMembers, removeMember, updateMemberRole } from "@/lib/tenant-fns";
import { resendInvitation, revokeInvitation } from "@/lib/invitations-fns";
import { useI18n } from "@/lib/i18n/I18nContext";

// Accepted members and not-yet-accepted invitations are listed separately: only the
// first group has access to this company's data.
export default function MembersPanel() {
  const { t } = useI18n();
  const { activeCompany, permissions, refresh } = useSession();
  const fetchMembers = useServerFn(listMembers);
  const roleFn = useServerFn(updateMemberRole);
  const removeFn = useServerFn(removeMember);
  const resendFn = useServerFn(resendInvitation);
  const revokeFn = useServerFn(revokeInvitation);

  const [pendingRemoval, setPendingRemoval] = useState(null);
  const [pendingRevoke, setPendingRevoke] = useState(null);
  const [busyId, setBusyId] = useState(null);

  const query = useQuery({
    queryKey: ["members", activeCompany?.id],
    queryFn: () => fetchMembers(),
    enabled: Boolean(activeCompany?.id),
  });

  const rows = query.data || [];
  const members = rows.filter((row) => row.status === "active");
  const invitations = rows.filter((row) => row.status !== "active");

  const refreshAll = async () => {
    await query.refetch();
    await refresh();
  };

  const changeRole = async (membershipId, role) => {
    try {
      await roleFn({ data: { membership_id: membershipId, role } });
      await refreshAll();
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
      await refreshAll();
      toast.success(t("settings.member_removed"));
    } catch (error) {
      toast.error(error?.message || t("common.error"));
    }
  };

  // Resending re-issues the invitation with a fresh single-use link and expiry.
  const resend = async (invitation) => {
    setBusyId(invitation.id);
    try {
      const result = await resendFn({ data: { membership_id: invitation.id } });
      await refreshAll();
      if (result?.email_sent) toast.success(t("settings.invitation_resent"));
      else toast.warning(t("settings.invitation_saved_no_email"));
    } catch (error) {
      toast.error(error?.message || t("common.error"));
    } finally {
      setBusyId(null);
    }
  };

  const confirmRevoke = async () => {
    if (!pendingRevoke) return;
    try {
      await revokeFn({ data: { membership_id: pendingRevoke.id } });
      setPendingRevoke(null);
      await refreshAll();
      toast.success(t("settings.invitation_revoked"));
    } catch (error) {
      toast.error(error?.message || t("common.error"));
    }
  };

  return (
    <section className="rounded-2xl border border-border bg-card shadow-card p-5 sm:p-6">
      <header className="mb-5">
        <h2 className="type-section-title">{t("settings.members")}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{t("settings.members_desc")}</p>
      </header>

      {permissions.canManage ? <InviteForm onInvited={refreshAll} /> : null}

      {query.isLoading ? (
        <div className="grid place-items-center py-8">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <>
          <h3 className="mb-2 mt-6 type-group-label">
            {t("settings.active_members")}
          </h3>
          <div className="divide-y divide-border rounded-xl border border-border">
            {members.map((member) => (
              <MemberRow
                key={member.id}
                member={member}
                locked={!permissions.canManage}
                isOwner={permissions.isOwner}
                onRoleChange={changeRole}
                onRemove={
                  permissions.canManage && member.role !== "owner" && !member.is_me
                    ? setPendingRemoval
                    : null
                }
              />
            ))}
          </div>

          <h3 className="mb-2 mt-6 type-group-label">
            {t("settings.pending_invitations")}
          </h3>
          <div className="divide-y divide-border rounded-xl border border-border">
            {invitations.length ? (
              invitations.map((invitation) => (
                <InvitationRow
                  key={invitation.id}
                  invitation={invitation}
                  locked={!permissions.canManage}
                  isOwner={permissions.isOwner}
                  busy={busyId === invitation.id}
                  onRoleChange={changeRole}
                  onResend={resend}
                  onRevoke={setPendingRevoke}
                />
              ))
            ) : (
              <p className="px-4 py-6 text-sm text-muted-foreground">
                {t("settings.no_pending_invitations")}
              </p>
            )}
          </div>
        </>
      )}

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

      <ConfirmDeleteDialog
        open={Boolean(pendingRevoke)}
        onOpenChange={(open) => (open ? null : setPendingRevoke(null))}
        title={t("settings.revoke_invitation")}
        description={t("settings.revoke_invitation_desc")}
        confirmLabel={t("settings.revoke_invitation")}
        onConfirm={confirmRevoke}
      />
    </section>
  );
}