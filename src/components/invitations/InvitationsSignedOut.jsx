import React from "react";
import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { returnToSearch } from "@/lib/authReturnTo";
import { useI18n } from "@/lib/i18n/I18nContext";

/**
 * Shown to a visitor who followed an invitation link while signed out. Both links come
 * back to /invitations, which is enough to restore the invitation: the list is resolved
 * from the signed-in user's own email address, so the credential in the URL is not
 * carried through the login round-trip.
 */
export default function InvitationsSignedOut() {
  const { t } = useI18n();

  return (
    <section className="rounded-2xl border border-border bg-card p-6 text-center">
      <h2 className="font-heading text-base font-semibold">{t("invitations.sign_in_title")}</h2>
      <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">{t("invitations.sign_in_desc")}</p>
      <div className="mt-5 flex flex-col justify-center gap-2 sm:flex-row">
        <Button asChild>
          <Link to="/login" search={returnToSearch("/invitations")}>
            {t("invitations.sign_in")}
          </Link>
        </Button>
        <Button asChild variant="outline">
          <Link to="/register" search={returnToSearch("/invitations")}>
            {t("invitations.create_account")}
          </Link>
        </Button>
      </div>
    </section>
  );
}