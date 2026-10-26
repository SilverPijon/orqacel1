import React from "react";
import { Ban, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import StatusBadge from "@/components/StatusBadge";
import { MEMBERSHIP_STATUS, ROLE } from "@/lib/statusMeta";
import { formatDate } from "@/lib/format";
import { useI18n } from "@/lib/i18n/I18nContext";

// Invitations that are not accepted yet: pending, expired, declined or revoked.
const ACTIONABLE = ["pending", "expired", "declined"];

export default function InvitationRow({ invitation, locked, isOwner, busy, onRoleChange, onResend, onRevoke }) {
  const { t, lang } = useI18n();
  const status = MEMBERSHIP_STATUS[invitation.status] || MEMBERSHIP_STATUS.pending;
  const role = ROLE[invitation.role] || ROLE.member;
  const mayEditRole = !locked && invitation.status === "pending" && (invitation.role !== "admin" || isOwner);
  const mayAct = !locked && ACTIONABLE.includes(invitation.status) && (invitation.role !== "admin" || isOwner);

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">{invitation.user_email}</p>
        <p className="truncate text-xs text-muted-foreground">
          {t("settings.invited_by", { name: invitation.invited_by_name || t("common.none") })}
          {" · "}
          {t("settings.invited_on", { date: formatDate(invitation.invited_at, lang) })}
          {" · "}
          {t("settings.invitation_expires", { date: formatDate(invitation.expires_at, lang) })}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge label={t(status.key)} tone={status.tone} />
        {mayEditRole ? (
          <Select value={invitation.role} onValueChange={(value) => onRoleChange(invitation.id, value)}>
            <SelectTrigger className="h-8 w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="member">{t("settings.role_member")}</SelectItem>
              <SelectItem value="admin">{t("settings.role_admin")}</SelectItem>
            </SelectContent>
          </Select>
        ) : (
          <StatusBadge label={t(role.key)} tone={role.tone} />
        )}
        {mayAct ? (
          <>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-muted-foreground"
              disabled={busy}
              onClick={() => onResend(invitation)}
              aria-label={t("settings.resend_invitation")}
              title={t("settings.resend_invitation")}
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-muted-foreground hover:text-destructive"
              disabled={busy}
              onClick={() => onRevoke(invitation)}
              aria-label={t("settings.revoke_invitation")}
              title={t("settings.revoke_invitation")}
            >
              <Ban className="h-4 w-4" />
            </Button>
          </>
        ) : null}
      </div>
    </div>
  );
}