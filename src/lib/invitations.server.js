// Server-only invitation lifecycle helpers. Never import this module in browser code.
//
// The invitation token lives in exactly two places: the raw value inside the invitation
// email, and its SHA-256 hash on the membership row. It is never returned to the browser,
// never logged, and never proof of identity on its own -- accepting an invitation always
// also requires the signed-in user's own verified email address to match the invited one.

export const INVITE_TTL_DAYS = 7;
// The published app address until the orqacel.com custom domain is verified; switch this
// single constant back to the custom domain once it resolves.
export const INVITE_LINK_BASE = "https://taskivo-core-hub.base44.app/invitations";
export const INVITE_EMAIL_TEMPLATE = "CompanyInvite";

const DAY_MS = 24 * 60 * 60 * 1000;
const INVITATION_STATES = ["pending", "active", "declined", "expired", "revoked"];

export function generateInviteToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function hashInviteToken(token) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(token)));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function inviteExpiryIso(days = INVITE_TTL_DAYS) {
  return new Date(Date.now() + days * DAY_MS).toISOString();
}

// Invitations created before the lifecycle existed carry the old "invited" status.
export function isPendingStatus(status) {
  return status === "pending" || status === "invited";
}

export function legacyInviteExpiry(membership) {
  const created = Date.parse(membership?.invited_at || membership?.created_date || "");
  const from = Number.isFinite(created) ? created : Date.now();
  return new Date(from + INVITE_TTL_DAYS * DAY_MS).toISOString();
}

export function inviteExpiresAt(membership) {
  return membership?.expires_at || legacyInviteExpiry(membership);
}

// Effective state, derived on read: a pending row past its expiry is expired, so the list
// stays honest without a scheduled job. Only "active" grants access to company data.
export function invitationState(membership) {
  const status = membership?.status;
  if (!isPendingStatus(status)) {
    return INVITATION_STATES.includes(status) ? status : "pending";
  }
  return Date.parse(inviteExpiresAt(membership)) <= Date.now() ? "expired" : "pending";
}

export function inviteLink(token) {
  return `${INVITE_LINK_BASE}?token=${encodeURIComponent(token)}`;
}

export function roleLabel(role) {
  return role === "admin" ? "Admin" : "Member";
}

export function formatInviteDate(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

// Display text that reaches an email. No markup, no line breaks and no control characters,
// capped so that it stays a name rather than a message: a company or profile name is chosen
// by the person sending the invitation, and it must not become the wording of the mail.
export function safeEmailText(value, maxLength = 60) {
  const text = String(value ?? "")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/[<>]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > maxLength ? text.slice(0, maxLength).trimEnd() : text;
}

// Delivery has two independent, officially supported parts:
//  1. the platform app-user invite, which creates the invitee's application access and
//     sends the platform's own invite email -- only needed when the address has no account;
//  2. this app's invitation email carrying the single-use accept link.
// A delivery problem never destroys the invitation: the pending row stays valid, the caller
// is told what happened, and the invitation can be resent.
export async function deliverInvitation(
  context,
  { email, companyName, role, inviterEmail, token, expiresAt, needsAccountInvite },
) {
  const client = context.getBase44();
  const service = client.asServiceRole;
  const result = { account_invite: "skipped", email_sent: false };

  if (needsAccountInvite) {
    try {
      // Always "user": a company invitation never grants platform admin rights.
      await client.users.inviteUser(email, "user");
      result.account_invite = "sent";
    } catch {
      result.account_invite = "unavailable";
    }
  }

  try {
    await service.integrations.Core.SendEmail({
      to: email,
      template_name: INVITE_EMAIL_TEMPLATE,
      category: "transactional",
      variables: {
        // The sender is identified by their account address, which the platform verifies for
        // them -- never by a free-text display name, so no caller chooses the wording that
        // identifies them. The company name is cleaned and capped, the invitee's own name is
        // never taken from what the inviter typed, and the role, the accept link and the
        // expiry date are all produced server-side.
        inviter_email: safeEmailText(inviterEmail, 120) || "An Orqacel member",
        company_name: safeEmailText(companyName) || "a company",
        role_label: roleLabel(role),
        accept_url: inviteLink(token.raw),
        expires_at: formatInviteDate(expiresAt),
      },
    });
    result.email_sent = true;
  } catch {
    result.email_sent = false;
  }

  return result;
}