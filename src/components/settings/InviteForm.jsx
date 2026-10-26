import React, { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useSession } from "@/lib/SessionContext";
import { inviteMember } from "@/lib/invitations-fns";
import { useI18n } from "@/lib/i18n/I18nContext";

// Sends an invitation, never a membership: the invited person has to accept it before
// they can see anything from this company. Only the owner may hand out the admin role.
export default function InviteForm({ onInvited }) {
  const { t } = useI18n();
  const { permissions } = useSession();
  const inviteFn = useServerFn(inviteMember);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("member");
  const [saving, setSaving] = useState(false);

  const submit = async (event) => {
    event.preventDefault();
    if (!email.trim()) return;
    setSaving(true);
    try {
      const result = await inviteFn({ data: { email: email.trim(), role } });
      setEmail("");
      setRole("member");
      await onInvited();
      if (result?.email_sent) toast.success(t("settings.invitation_sent"));
      else toast.warning(t("settings.invitation_saved_no_email"));
    } catch (error) {
      toast.error(error?.message || t("common.error"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-2 sm:flex-row">
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
          {permissions.isOwner ? (
            <SelectItem value="admin">{t("settings.role_admin")}</SelectItem>
          ) : null}
        </SelectContent>
      </Select>
      <Button type="submit" disabled={saving} className="gap-2">
        {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
        {t("settings.send_invitation")}
      </Button>
    </form>
  );
}