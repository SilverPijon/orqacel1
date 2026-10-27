import React, { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Check, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import StatusBadge from "@/components/StatusBadge";
import { acceptInvitation, declineInvitation } from "@/lib/invitations-fns";
import { MEMBERSHIP_STATUS, ROLE } from "@/lib/statusMeta";
import { formatDate } from "@/lib/format";
import { useI18n } from "@/lib/i18n/I18nContext";

// What an invitation that is no longer pending means for its invitee.
const STATE_NOTES = {
  expired: "invitations.expired_note",
  revoked: "invitations.revoked_note",
  declined: "invitations.declined_note",
  active: "invitations.member_note",
};

export default function InvitationCard({ invitation, onChanged }) {
  const { t, lang } = useI18n();
  const acceptFn = useServerFn(acceptInvitation);
  const declineFn = useServerFn(declineInvitation);
  const [busy, setBusy] = useState(null);

  const status = MEMBERSHIP_STATUS[invitation.state] || MEMBERSHIP_STATUS.pending;
  const role = ROLE[invitation.role] || ROLE.member;

  // Only the id of the row on screen is sent: the server reads the invitation, the role
  // and the invited address from its own records and matches them against the session.
  const submit = async (action) => {
    setBusy(action);
    try {
      const call = action === "accept" ? acceptFn : declineFn;
      await call({ data: { invitation_id: invitation.id } });
      toast.success(t(action === "accept" ? "invitations.accepted" : "invitations.declined"));
      await onChanged();
    } catch (error) {
      toast.error(error?.message || t("common.error"));
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="rounded-2xl border border-border bg-card shadow-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="type-section-title">
            {invitation.company_name || t("common.none")}
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            {t("invitations.invited_by", { name: invitation.invited_by_name || t("common.none") })}
            {" · "}
            {t("settings.invitation_expires", { date: formatDate(invitation.expires_at, lang) })}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge label={t(role.key)} tone={role.tone} />
          <StatusBadge label={t(status.key)} tone={status.tone} />
        </div>
      </div>

      {invitation.state === "pending" ? (
        <div className="mt-4 flex flex-wrap gap-2">
          <Button className="gap-2" disabled={Boolean(busy)} onClick={() => submit("accept")}>
            {busy === "accept" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
            {t("settings.accept_invitation")}
          </Button>
          <Button
            variant="outline"
            className="gap-2"
            disabled={Boolean(busy)}
            onClick={() => submit("decline")}
          >
            {busy === "decline" ? <Loader2 className="h-4 w-4 animate-spin" /> : <X className="h-4 w-4" />}
            {t("settings.decline_invitation")}
          </Button>
        </div>
      ) : (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-secondary/60 px-4 py-3">
          <p className="text-sm text-muted-foreground">
            {t(STATE_NOTES[invitation.state] || "invitations.empty_desc")}
          </p>
          {invitation.state === "active" ? (
            <Button asChild variant="link" className="h-auto p-0">
              <Link to="/dashboard">{t("dashboard.title")}</Link>
            </Button>
          ) : null}
        </div>
      )}
    </section>
  );
}