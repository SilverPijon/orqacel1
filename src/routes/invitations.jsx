import React from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Mail } from "lucide-react";
import EmptyState from "@/components/EmptyState";
import InvitationCard from "@/components/invitations/InvitationCard";
import InvitationsSignedOut from "@/components/invitations/InvitationsSignedOut";
import { useAuth } from "@/lib/AuthContext";
import { listMyInvitations } from "@/lib/invitations-fns";
import { useI18n } from "@/lib/i18n/I18nContext";

export const Route = createFileRoute("/invitations")({
  // The invitee's own invitations: resolved in the browser from their session, never
  // rendered into cacheable HTML.
  ssr: false,
  validateSearch: (search) => ({
    token: typeof search?.token === "string" && search.token ? search.token : undefined,
  }),
  head: () => ({ meta: [{ title: "Orqacel — Invitations" }] }),
  component: InvitationsPage,
});

function InvitationsPage() {
  const { t } = useI18n();
  const { isAuthenticated, isLoadingAuth } = useAuth();
  const fetchInvitations = useServerFn(listMyInvitations);

  // Enabled only once signed in: the server resolves invitations from the signed-in
  // user's verified email address, so there is nothing to fetch beforehand.
  const query = useQuery({
    queryKey: ["my-invitations"],
    queryFn: () => fetchInvitations(),
    enabled: isAuthenticated,
  });

  const invitations = query.data || [];

  return (
    <div className="min-h-dvh bg-secondary/30 px-4 py-10">
      <div className="mx-auto w-full max-w-2xl">
        <div className="mb-6 flex items-center gap-2">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-primary font-heading text-lg font-bold text-primary-foreground">
            O
          </span>
          <span className="font-heading text-lg font-bold">{t("app.name")}</span>
        </div>

        <h1 className="font-heading text-2xl font-bold">{t("invitations.title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("invitations.subtitle")}</p>

        <div className="mt-6">
          {isLoadingAuth || (isAuthenticated && query.isLoading) ? (
            <div className="grid place-items-center py-16">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : !isAuthenticated ? (
            <InvitationsSignedOut />
          ) : invitations.length ? (
            <div className="space-y-3">
              {invitations.map((invitation) => (
                <InvitationCard
                  key={invitation.id}
                  invitation={invitation}
                  onChanged={query.refetch}
                />
              ))}
            </div>
          ) : (
            <EmptyState
              icon={Mail}
              title={t("invitations.empty_title")}
              description={t("invitations.empty_desc")}
            />
          )}
        </div>
      </div>
    </div>
  );
}