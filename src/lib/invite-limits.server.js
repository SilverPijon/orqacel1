// Server-only abuse guards for the invitation flow. Never import this module in browser code.
//
// An invitation email leaves the app's own domain, and anyone who signs up can create their
// own company -- which makes every company creator an Owner, and therefore able to invite.
// Authorization alone cannot stop that (it is the legitimate flow); what must be bounded is
// how much mail one account can produce and to how many addresses.
//
// Counting happens on rows the flow already keeps, so no extra storage is needed:
//   invited_at     when an invitation was created (a resend does not change it)
//   invited_by_id  which account created it
//   last_sent_at   when that invitation was last emailed (moves on every resend)
import { asArray, httpError } from "@/lib/tenant.server";
import { invitationState } from "@/lib/invitations.server";

// A small team app: far above real use, far below abuse.
export const MAX_PENDING_PER_COMPANY = 25;
export const MAX_INVITES_PER_DAY = 20;
export const RESEND_COOLDOWN_MINUTES = 60;

const DAY_MS = 24 * 60 * 60 * 1000;

function withinWindow(value, windowMs) {
  const at = Date.parse(value || "");
  return Number.isFinite(at) && Date.now() - at < windowMs;
}

// Called before a new invitation row is written or emailed.
export async function assertInviteAllowed(service, { companyId, userId }) {
  const companyRows = asArray(
    await service.entities.CompanyMembership.filter({ company_id: companyId }),
  );

  const pending = companyRows.filter((row) => invitationState(row) === "pending");
  if (pending.length >= MAX_PENDING_PER_COMPANY) {
    throw httpError(429, "Pending invitation limit reached for this company", "PENDING_LIMIT");
  }

  const companyToday = companyRows.filter((row) =>
    withinWindow(row.invited_at || row.created_date, DAY_MS),
  );
  if (companyToday.length >= MAX_INVITES_PER_DAY) {
    throw httpError(429, "Daily invitation limit reached for this company", "INVITE_LIMIT");
  }

  // The same budget per account, so owning several companies cannot multiply the volume,
  // and every account costs a verified email address to keep.
  const ownRows = asArray(
    await service.entities.CompanyMembership.filter({ invited_by_id: userId }),
  );
  const ownToday = ownRows.filter((row) => withinWindow(row.invited_at || row.created_date, DAY_MS));
  if (ownToday.length >= MAX_INVITES_PER_DAY) {
    throw httpError(429, "You have reached your daily invitation limit", "INVITE_LIMIT");
  }
}

// A resend mails the same address again: allowed, but not in a tight loop.
export function assertResendAllowed(membership) {
  if (withinWindow(membership.last_sent_at, RESEND_COOLDOWN_MINUTES * 60 * 1000)) {
    throw httpError(
      429,
      "This invitation was sent recently. Please try again later.",
      "RESEND_COOLDOWN",
    );
  }
}