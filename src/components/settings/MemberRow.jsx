import React from "react";
import { UserMinus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import StatusBadge from "@/components/StatusBadge";
import { ROLE } from "@/lib/statusMeta";
import { useI18n } from "@/lib/i18n/I18nContext";

// One accepted member. `locked` means the viewer may not manage memberships at all;
// an admin's role additionally stays untouched unless the viewer is the owner.
export default function MemberRow({ member, locked, isOwner, onRoleChange, onRemove }) {
  const { t } = useI18n();
  const roleLocked = locked || (member.role === "admin" && !isOwner);
  const role = ROLE[member.role] || ROLE.member;

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">
          {member.full_name || member.user_email}
          {member.is_me ? ` · ${t("settings.account")}` : ""}
        </p>
        <p className="truncate text-xs text-muted-foreground">{member.user_email}</p>
      </div>
      <div className="flex items-center gap-2">
        {member.role === "owner" || roleLocked ? (
          <StatusBadge label={t(role.key)} tone={role.tone} />
        ) : (
          <Select value={member.role} onValueChange={(value) => onRoleChange(member.id, value)}>
            <SelectTrigger className="h-8 w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="member">{t("settings.role_member")}</SelectItem>
              <SelectItem value="admin">{t("settings.role_admin")}</SelectItem>
            </SelectContent>
          </Select>
        )}
        {onRemove ? (
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-muted-foreground hover:text-destructive"
            onClick={() => onRemove(member)}
            aria-label={t("settings.remove_member")}
          >
            <UserMinus className="h-4 w-4" />
          </Button>
        ) : null}
      </div>
    </div>
  );
}