import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireUser } from "@/lib/auth-middleware";
import {
  asArray,
  httpError,
  isOwner,
  readUserRecord,
  requireCompanyContext,
  syncUserCompanies,
} from "@/lib/tenant.server";
import {
  deliverInvitation,
  generateInviteToken,
  hashInviteToken,
  invitationState,
  inviteExpiresAt,
  inviteExpiryIso,
} from "@/lib/invitations.server";
import {
  assertInviteAllowed,
  assertResendAllowed,
  assertSenderTrusted,
} from "@/lib/invite-limits.server";

const InviteInput = z.object({
  email: z.string().email().max(160),
  role: z.enum(["admin", "member"]),
  full_name: z.string().max(120).optional(),
});

const InvitationRef = z
  .object({
    invitation_id: z.string().min(1).max(64).optional(),
    token: z.string().min(16).max(256).optional(),
  })
  .refine((value) => Boolean(value.invitation_id || value.token), {
    message: "An invitation reference is required",
  });

function first(result) {
  if (!result) return null;
  const items = Array.isArray(result) ? result : result.items || [];
  return items[0] || null;
}

async function issueToken() {
  const raw = generateInviteToken();
  return { raw, hash: await hashInviteToken(raw) };
}

// Only the Owner may touch an invitation carrying the Admin role; admins manage members.
async function requireManageableInvitation(context, membershipId) {
  const session = await requireCompanyContext(context, "admin");
  const service = context.getBase44().asServiceRole;

  const membership = await service.entities.CompanyMembership.get(membershipId).catch(() => null);
  if (!membership || membership.company_id !== session.activeCompany.id) {
    throw httpError(404, "Invitation not found", "NOT_FOUND");
  }
  if (isOwner(membership.role)) {
    throw httpError(403, "The company owner's membership can't be changed", "OWNER_ONLY");
  }
  if (membership.role === "admin" && !isOwner(session.activeCompany.role)) {
    throw httpError(403, "Only the company owner can manage an admin's invitation", "OWNER_ONLY");
  }
  const state = invitationState(membership);
  if (state === "active") {
    throw httpError(409, "This person is already an active member", "ALREADY_MEMBER");
  }

  return { session, service, membership, state };
}

// Accepting or declining is driven by the signed-in user's own verified email address and
// the invitation row itself -- never by an email, company or role sent from the browser.
async function resolveInvitation(context, { invitation_id, token }) {
  const service = context.getBase44().asServiceRole;
  const user = context.user;
  const email = (user.email || "").trim().toLowerCase();
  if (!email) throw httpError(403, "Your account has no email address", "NO_EMAIL");

  const record = await readUserRecord(service, user.id);
  if (record && record.is_verified === false) {
    throw httpError(403, "Verify your email address first", "NOT_VERIFIED");
  }

  const membership = token
    ? first(
        await service.entities.CompanyMembership.filter({
          token_hash: await hashInviteToken(token),
        }),
      )
    : await service.entities.CompanyMembership.get(invitation_id).catch(() => null);

  if (!membership) throw httpError(404, "Invitation not found", "NOT_FOUND");
  if ((membership.user_email || "").trim().toLowerCase() !== email) {
    throw httpError(403, "This invitation was issued to a different email address", "EMAIL_MISMATCH");
  }

  const state = invitationState(membership);
  if (state === "active") {
    throw httpError(409, "You are already a member of this company", "ALREADY_MEMBER");
  }
  if (state !== "pending") {
    if (state === "expired") {
      await service.entities.CompanyMembership.update(membership.id, {
        status: "expired",
        token_hash: null,
      });
      throw httpError(409, "This invitation has expired", "EXPIRED");
    }
    throw httpError(409, "This invitation is no longer active", "NOT_PENDING");
  }

  return { service, user, membership };
}

export const inviteMember = createServerFn({ method: "POST" })
  .middleware([requireUser])
  .validator(InviteInput)
  .handler(async ({ data, context }) => {
    const session = await requireCompanyContext(context, "admin");
    const service = context.getBase44().asServiceRole;
    const email = data.email.trim().toLowerCase();

    if (data.role === "admin" && !isOwner(session.activeCompany.role)) {
      throw httpError(403, "Only the company owner can invite admins", "OWNER_ONLY");
    }

    const existing = first(
      await service.entities.CompanyMembership.filter({
        company_id: session.activeCompany.id,
        user_email: email,
      }),
    );
    if (existing) {
      const state = invitationState(existing);
      if (state === "active") {
        throw httpError(409, "That person is already a member of this company", "MEMBER_EXISTS");
      }
      if (state === "pending") {
        throw httpError(409, "That person already has a pending invitation", "INVITE_PENDING");
      }
      // declined / revoked / expired rows are superseded by a fresh invitation below.
    }

    const person = first(await service.entities.User.filter({ email }));

    // Who may send mail out of the app's domain, and how much of it. Both are checked before
    // the row is written and before anything is sent, so a blocked invitation leaves no trace.
    const sender = await readUserRecord(service, session.user.id);
    assertSenderTrusted(sender, { recipientIsRegistered: Boolean(person) });
    await assertInviteAllowed(service, {
      companyId: session.activeCompany.id,
      userId: session.user.id,
      email,
    });
    const token = await issueToken();
    const now = new Date().toISOString();
    const expiresAt = inviteExpiryIso();

    const fields = {
      company_id: session.activeCompany.id,
      company_name: session.activeCompany.name,
      user_id: person?.id || null,
      user_email: email,
      full_name: data.full_name?.trim() || existing?.full_name || person?.full_name || "",
      role: data.role,
      status: "pending",
      invited_by_id: session.user.id,
      invited_by_name: session.user.full_name || "",
      invited_at: now,
      expires_at: expiresAt,
      last_sent_at: now,
      // This row is about to be emailed once; a resend raises it, up to a small ceiling.
      send_count: 1,
      token_hash: token.hash,
      responded_at: null,
    };

    const membership = existing
      ? await service.entities.CompanyMembership.update(existing.id, fields)
      : await service.entities.CompanyMembership.create(fields);

    // No company list sync here: a pending invitation must not grant any access.
    const delivery = await deliverInvitation(context, {
      email,
      companyName: session.activeCompany.name,
      role: data.role,
      inviterEmail: session.user.email,
      token,
      expiresAt,
      needsAccountInvite: !person,
    });

    return { id: membership.id, status: "pending", expires_at: expiresAt, ...delivery };
  });

export const resendInvitation = createServerFn({ method: "POST" })
  .middleware([requireUser])
  .validator(z.object({ membership_id: z.string().min(1).max(64) }))
  .handler(async ({ data, context }) => {
    const { session, service, membership } = await requireManageableInvitation(
      context,
      data.membership_id,
    );
    await assertResendAllowed(service, membership);

    // A resend mails the same address again, so it passes the same trust boundary as a first
    // invitation: a confirmed, settled sender account.
    const sender = await readUserRecord(service, session.user.id);
    const person = first(await service.entities.User.filter({ email: membership.user_email }));
    assertSenderTrusted(sender, { recipientIsRegistered: Boolean(person) });

    const token = await issueToken();
    const now = new Date().toISOString();
    const expiresAt = inviteExpiryIso();

    await service.entities.CompanyMembership.update(membership.id, {
      role: membership.role,
      status: "pending",
      invited_at: membership.invited_at || now,
      expires_at: expiresAt,
      last_sent_at: now,
      send_count: Number(membership.send_count || 0) + 1,
      token_hash: token.hash,
      responded_at: null,
    });

    const delivery = await deliverInvitation(context, {
      email: membership.user_email,
      companyName: session.activeCompany.name,
      role: membership.role,
      inviterEmail: session.user.email,
      token,
      expiresAt,
      // Decided on the address's current account status, not on what the row recorded when
      // it was created: someone who has since registered must not be invited a second time.
      needsAccountInvite: !person,
    });

    return { id: membership.id, status: "pending", expires_at: expiresAt, ...delivery };
  });

export const revokeInvitation = createServerFn({ method: "POST" })
  .middleware([requireUser])
  .validator(z.object({ membership_id: z.string().min(1).max(64) }))
  .handler(async ({ data, context }) => {
    const { service, membership } = await requireManageableInvitation(context, data.membership_id);

    // Single-use: the token is dropped with the revocation, so an emailed link stops working.
    await service.entities.CompanyMembership.update(membership.id, {
      status: "revoked",
      token_hash: null,
    });

    return { id: membership.id, status: "revoked" };
  });

// Pending invitations are not readable through entity access rules (the company is not in
// the inviter's company list yet), so the invitee's own list is resolved server-side from
// their verified email address. Tokens are never part of the response.
export const listMyInvitations = createServerFn({ method: "GET" })
  .middleware([requireUser])
  .handler(async ({ context }) => {
    const service = context.getBase44().asServiceRole;
    const email = (context.user.email || "").trim().toLowerCase();
    if (!email) return [];

    const record = await readUserRecord(service, context.user.id);
    if (record && record.is_verified === false) return [];

    const rows = asArray(await service.entities.CompanyMembership.filter({ user_email: email }));
    const order = { pending: 0, expired: 1, declined: 2, revoked: 3, active: 4 };

    return rows
      // An accepted invitation is worth showing as already used; a membership that was
      // never an invitation (owner onboarding, rows from before the lifecycle) is not.
      .filter((membership) => invitationState(membership) !== "active" || Boolean(membership.responded_at))
      .map((membership) => ({ membership, state: invitationState(membership) }))
      .sort((a, b) => (order[a.state] ?? 9) - (order[b.state] ?? 9))
      .map(({ membership, state }) => ({
        id: membership.id,
        company_id: membership.company_id,
        company_name: membership.company_name || "",
        role: membership.role,
        state,
        invited_at: membership.invited_at || membership.created_date || null,
        expires_at: inviteExpiresAt(membership),
        invited_by_name: membership.invited_by_name || "",
      }));
  });

export const acceptInvitation = createServerFn({ method: "POST" })
  .middleware([requireUser])
  .validator(InvitationRef)
  .handler(async ({ data, context }) => {
    const { service, user, membership } = await resolveInvitation(context, data);

    await service.entities.CompanyMembership.update(membership.id, {
      status: "active",
      user_id: user.id,
      full_name: membership.full_name || user.full_name || "",
      responded_at: new Date().toISOString(),
      token_hash: null,
    });
    await syncUserCompanies(service, user.id);

    return {
      company_id: membership.company_id,
      company_name: membership.company_name || "",
      role: membership.role,
    };
  });

export const declineInvitation = createServerFn({ method: "POST" })
  .middleware([requireUser])
  .validator(InvitationRef)
  .handler(async ({ data, context }) => {
    const { service, membership } = await resolveInvitation(context, data);

    await service.entities.CompanyMembership.update(membership.id, {
      status: "declined",
      responded_at: new Date().toISOString(),
      token_hash: null,
    });

    return { id: membership.id, status: "declined" };
  });