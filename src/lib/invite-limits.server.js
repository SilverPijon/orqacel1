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
// One budget for the whole app, so the per-account caps cannot be multiplied by registering
// further accounts: this is the ceiling on how much mail the app can produce in a day.
export const MAX_INVITES_PER_DAY_APP = 50;
// The budgets above bound how much one account may send, but not where it goes: without a ceiling on
// the destination, the shared daily budget could be spent entirely on one mailbox or one domain. These
// count the rows the app last emailed inside the window, so a resend counts as mail too.
export const MAX_INVITES_PER_RECIPIENT_PER_DAY = 3;
export const MAX_INVITES_PER_DOMAIN_PER_DAY = 10;
// One invitation is emailed at most this many times over its whole life, resends included, so a
// single address cannot simply be mailed again every hour for a week.
export const MAX_SENDS_PER_INVITATION = 6;
export const RESEND_COOLDOWN_MINUTES = 60;
// How many of the last day's rows one read looks at. Well above the app-wide ceiling, so the counts
// below are never cut short by the page.
const RECENT_SEND_PAGE = 300;
// How long an account must have existed before it may mail an address with no account here.
export const NEW_ACCOUNT_WAIT_HOURS = 24;

const DAY_MS = 24 * 60 * 60 * 1000;

function withinWindow(value, windowMs) {
  const at = Date.parse(value || "");
  return Number.isFinite(at) && Date.now() - at < windowMs;
}

// Who may send mail out of the app's domain at all: only an account whose own address the
// platform has confirmed, and only after that account has settled, can reach an address that
// has no account here. Inviting someone who is already an Orqacel user stays available
// immediately -- that person is reachable through the platform anyway, and is not a stranger.
export function assertSenderTrusted(sender, { recipientIsRegistered }) {
  if (sender?.is_verified === false) {
    throw httpError(403, "Verify your email address before inviting people", "SENDER_UNVERIFIED");
  }
  if (recipientIsRegistered) return;

  const created = Date.parse(sender?.created_date || "");
  if (Number.isFinite(created) && Date.now() - created < NEW_ACCOUNT_WAIT_HOURS * 60 * 60 * 1000) {
    throw httpError(
      403,
      "New accounts can invite existing Orqacel users right away. Inviting an address that has no account yet unlocks 24 hours after sign-up.",
      "SENDER_TOO_NEW",
    );
  }
}

function recipientOf(row) {
  return String(row.user_email || "").trim().toLowerCase();
}

// The app mailed in the last 24 hours, as the invitation rows that carry it. One read serves the
// app-wide ceiling and both destination ceilings, and counting by last_sent_at means a resend is
// counted as mail exactly like a first invitation.
async function recentSends(service) {
  return asArray(
    await service.entities.CompanyMembership.filter(
      { last_sent_at: { $gte: new Date(Date.now() - DAY_MS).toISOString() } },
      { limit: RECENT_SEND_PAGE },
    ),
  );
}

// Where the mail may go. A single account can invite whoever it likes, but not repeatedly to the same
// mailbox, and not so many strangers inside one domain that the whole domain's budget is gone: the
// address is the thing an abuser would target, so it is the thing that is capped.
function assertRecipientAllowed(recent, email) {
  const address = String(email || "").trim().toLowerCase();
  const at = address.lastIndexOf("@");
  if (at < 1 || at === address.length - 1) {
    throw httpError(400, "A valid recipient address is required", "BAD_RECIPIENT");
  }
  const domain = address.slice(at + 1);

  if (recent.filter((row) => recipientOf(row) === address).length >= MAX_INVITES_PER_RECIPIENT_PER_DAY) {
    throw httpError(
      429,
      "This address has received several invitations today. Please try again tomorrow.",
      "RECIPIENT_LIMIT",
    );
  }
  if (recent.filter((row) => recipientOf(row).endsWith(`@${domain}`)).length >= MAX_INVITES_PER_DOMAIN_PER_DAY) {
    throw httpError(
      429,
      "Invitations to this email domain have reached today's limit",
      "DOMAIN_LIMIT",
    );
  }
}

// Called before a new invitation row is written or emailed.
export async function assertInviteAllowed(service, { companyId, userId, email }) {
  // The app-wide budget comes first: it is the one ceiling that cannot be worked around by
  // creating more companies, or more accounts.
  const recent = await recentSends(service);
  if (recent.length >= MAX_INVITES_PER_DAY_APP) {
    throw httpError(429, "Daily invitation limit reached for Orqacel", "INVITE_LIMIT");
  }
  // Then how much of that budget may go to one destination, so it cannot all be spent on one mailbox.
  assertRecipientAllowed(recent, email);

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

// A resend mails the same address again: allowed, but not in a tight loop and not without end, and it
// passes the same destination ceilings as a first invitation.
export async function assertResendAllowed(service, membership) {
  if (withinWindow(membership.last_sent_at, RESEND_COOLDOWN_MINUTES * 60 * 1000)) {
    throw httpError(
      429,
      "This invitation was sent recently. Please try again later.",
      "RESEND_COOLDOWN",
    );
  }
  if (Number(membership.send_count || 0) >= MAX_SENDS_PER_INVITATION) {
    throw httpError(
      429,
      "This invitation has been sent several times already. Revoke it and invite the person again if it still needs sending.",
      "RESEND_LIMIT",
    );
  }
  assertRecipientAllowed(await recentSends(service), membership.user_email);
}