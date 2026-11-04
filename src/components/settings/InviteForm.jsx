import React, { useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import FormField, { fieldErrorProps } from "@/components/FormField";
import { useSession } from "@/lib/SessionContext";
import { inviteMember } from "@/lib/invitations-fns";
import { INVITE_REQUIRED_FIELDS, firstInvalidField, validateInviteForm } from "@/lib/formValidation";
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
  const [error, setError] = useState(null);
  const emailRef = useRef(null);

  const changeEmail = (value) => {
    setEmail(value);
    // A corrected address stops claiming to be wrong as soon as it holds a value again.
    if (error && String(value).trim()) setError(null);
  };

  // Validates the address, shows the message under the field and moves focus to it. Returns whether
  // the invitation may be sent.
  const showErrors = () => {
    const next = validateInviteForm({ email }, t);
    const first = firstInvalidField(next, INVITE_REQUIRED_FIELDS);
    setError(first ? next[first] : null);
    if (first) emailRef.current?.focus();
    return !first;
  };

  const submit = async (event) => {
    event.preventDefault();
    if (!showErrors()) return;
    setSaving(true);
    try {
      const result = await inviteFn({ data: { email: email.trim(), role } });
      setEmail("");
      setRole("member");
      setError(null);
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
    <form
      onSubmit={submit}
      noValidate
      // Native validation is off above; if a browser applies it anyway, the form still answers with
      // its own inline message instead of a bubble in the browser's language.
      onInvalid={(event) => {
        event.preventDefault();
        showErrors();
      }}
    >
      <FormField id="invite-email" label={t("settings.member_email")} error={error} required>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input
            id="invite-email"
            ref={emailRef}
            type="email"
            value={email}
            onChange={(event) => changeEmail(event.target.value)}
            placeholder={t("settings.member_email")}
            className="sm:flex-1"
            aria-required="true"
            {...fieldErrorProps("invite-email", error)}
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
          <Button type="submit" formNoValidate disabled={saving} className="gap-2">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            {t("settings.send_invitation")}
          </Button>
        </div>
      </FormField>
    </form>
  );
}