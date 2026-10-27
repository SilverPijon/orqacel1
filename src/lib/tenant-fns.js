import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireUser } from "@/lib/auth-middleware";
import {
  asArray,
  getActiveSession,
  httpError,
  isOwner,
  readUserRecord,
  requireCompanyContext,
  syncUserCompanies,
  unique,
} from "@/lib/tenant.server";
import { invitationState, inviteExpiresAt } from "@/lib/invitations.server";
import { INVOICE_COUNTER_START } from "@/lib/invoiceNumber.server";
import { QUOTATION_COUNTER_START } from "@/lib/quotationNumber.server";

const COMPANY_PROFILE = {
  legal_name: z.string().max(160).optional(),
  registration_number: z.string().max(40).optional(),
  tax_number: z.string().max(40).optional(),
  email: z.string().max(160).optional(),
  phone: z.string().max(40).optional(),
  website: z.string().max(160).optional(),
  address: z.string().max(200).optional(),
  city: z.string().max(100).optional(),
  postal_code: z.string().max(20).optional(),
  country: z.string().max(8).optional(),
  currency: z.string().max(8).optional(),
  timezone: z.string().max(64).optional(),
  default_language: z.string().max(8).optional(),
};

function cleanProfile(input) {
  const patch = {};
  Object.entries(COMPANY_PROFILE).forEach(([field]) => {
    const value = input[field];
    if (typeof value === "string") patch[field] = value.trim();
  });
  return patch;
}

export const getSession = createServerFn({ method: "GET" })
  .middleware([requireUser])
  .handler(({ context }) => getActiveSession(context));

export const createCompany = createServerFn({ method: "POST" })
  .middleware([requireUser])
  .validator(z.object({ name: z.string().min(1).max(120), ...COMPANY_PROFILE }))
  .handler(async ({ data, context }) => {
    const service = context.getBase44().asServiceRole;
    const user = context.user;

    const company = await service.entities.Company.create({
      name: data.name.trim(),
      ...cleanProfile(data),
      owner_user_id: user.id,
      plan: "free",
      status: "active",
      // The document counters are created with the company, so its first invoice is INV-1001 and its
      // first quotation QT-1001. Only the app's server functions ever write them.
      invoice_sequence: INVOICE_COUNTER_START,
      quotation_sequence: QUOTATION_COUNTER_START,
    });

    await service.entities.CompanyMembership.create({
      company_id: company.id,
      company_name: company.name,
      user_id: user.id,
      user_email: (user.email || "").toLowerCase(),
      full_name: user.full_name || "",
      role: "owner",
      status: "active",
    });

    const record = await readUserRecord(service, user.id);
    await service.entities.User.update(user.id, {
      company_ids: unique([...(record?.company_ids || []), company.id]),
      active_company_id: company.id,
    });

    return getActiveSession(context);
  });

export const switchCompany = createServerFn({ method: "POST" })
  .middleware([requireUser])
  .validator(z.object({ company_id: z.string().min(1).max(64) }))
  .handler(async ({ data, context }) => {
    const service = context.getBase44().asServiceRole;
    const user = context.user;

    const membership = asArray(
      await service.entities.CompanyMembership.filter({
        company_id: data.company_id,
        user_id: user.id,
        status: "active",
      }),
    )[0];
    if (!membership) throw httpError(403, "You don't have access to this company", "NOT_MEMBER");

    await service.entities.User.update(user.id, { active_company_id: data.company_id });
    return getActiveSession(context);
  });

export const updateCompany = createServerFn({ method: "POST" })
  .middleware([requireUser])
  .validator(z.object({ name: z.string().min(1).max(120).optional(), ...COMPANY_PROFILE }))
  .handler(async ({ data, context }) => {
    const session = await requireCompanyContext(context, "admin");
    const service = context.getBase44().asServiceRole;

    const patch = cleanProfile(data);
    if (data.name) patch.name = data.name.trim();

    const updated = await service.entities.Company.update(session.activeCompany.id, patch);
    return { ...updated };
  });

export const listMembers = createServerFn({ method: "GET" })
  .middleware([requireUser])
  .handler(async ({ context }) => {
    const session = await requireCompanyContext(context);
    const service = context.getBase44().asServiceRole;

    const memberships = asArray(
      await service.entities.CompanyMembership.filter({ company_id: session.activeCompany.id }),
    );
    memberships.sort((a, b) => {
      const order = { owner: 0, admin: 1, member: 2 };
      return (order[a.role] ?? 3) - (order[b.role] ?? 3);
    });

    return memberships.map((membership) => ({
      id: membership.id,
      user_id: membership.user_id || null,
      user_email: membership.user_email,
      full_name: membership.full_name || "",
      role: membership.role,
      status: invitationState(membership),
      invited_at: membership.invited_at || membership.created_date || null,
      expires_at: inviteExpiresAt(membership),
      invited_by_name: membership.invited_by_name || "",
      is_me: membership.user_id === session.user.id,
    }));
  });

export const updateMemberRole = createServerFn({ method: "POST" })
  .middleware([requireUser])
  .validator(z.object({ membership_id: z.string().min(1).max(64), role: z.enum(["admin", "member"]) }))
  .handler(async ({ data, context }) => {
    const session = await requireCompanyContext(context, "admin");
    const service = context.getBase44().asServiceRole;

    const membership = await service.entities.CompanyMembership.get(data.membership_id);
    if (!membership || membership.company_id !== session.activeCompany.id) {
      throw httpError(404, "Membership not found", "NOT_FOUND");
    }
    if (isOwner(membership.role)) throw httpError(403, "The company owner's role can't be changed", "OWNER_ONLY");
    if (membership.user_id === session.user.id) throw httpError(403, "You can't change your own role", "SELF_ROLE");
    if (membership.role === "admin" && !isOwner(session.activeCompany.role)) {
      throw httpError(403, "Only the company owner can change an admin's role", "OWNER_ONLY");
    }
    if (data.role === "admin" && !isOwner(session.activeCompany.role)) {
      throw httpError(403, "Only the company owner can assign admins", "OWNER_ONLY");
    }

    const state = invitationState(membership);
    if (state !== "pending" && state !== "active") {
      throw httpError(409, "This membership is no longer active", "NOT_MANAGEABLE");
    }

    await service.entities.CompanyMembership.update(membership.id, { role: data.role });
    return { id: membership.id, role: data.role };
  });

export const removeMember = createServerFn({ method: "POST" })
  .middleware([requireUser])
  .validator(z.object({ membership_id: z.string().min(1).max(64) }))
  .handler(async ({ data, context }) => {
    const session = await requireCompanyContext(context, "admin");
    const service = context.getBase44().asServiceRole;

    const membership = await service.entities.CompanyMembership.get(data.membership_id);
    if (!membership || membership.company_id !== session.activeCompany.id) {
      throw httpError(404, "Membership not found", "NOT_FOUND");
    }
    if (isOwner(membership.role)) throw httpError(403, "The company owner can't be removed", "OWNER_ONLY");
    if (membership.user_id === session.user.id) throw httpError(403, "You can't remove yourself", "SELF_REMOVE");
    if (membership.role === "admin" && !isOwner(session.activeCompany.role)) {
      throw httpError(403, "Only the company owner can remove an admin", "OWNER_ONLY");
    }

    await service.entities.CompanyMembership.delete(membership.id);
    if (membership.user_id) await syncUserCompanies(service, membership.user_id);

    return { id: membership.id };
  });

export const setMyLanguage = createServerFn({ method: "POST" })
  .middleware([requireUser])
  .validator(z.object({ language: z.string().min(2).max(8) }))
  .handler(async ({ data, context }) => {
    const service = context.getBase44().asServiceRole;
    await service.entities.User.update(context.user.id, { language: data.language });
    return { language: data.language };
  });