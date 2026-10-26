// Server-only tenant helpers. Never import this module in browser code: it holds the
// authorization logic that decides which company a caller may act on and with which role.

export const ROLE_RANK = { member: 1, admin: 2, owner: 3 };

export function httpError(status, message, code) {
  return Object.assign(new Error(message || "Request failed"), { status, code });
}

export function asArray(result) {
  if (!result) return [];
  return Array.isArray(result) ? result : result.items || [];
}

export function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

// A user has one membership per company. If extra rows ever appear for the same
// company, the earliest one wins — a later row can then never be used to raise the
// caller's role in that company. Client-side writes to CompanyMembership are closed
// (editor-only rules), so the app's own server functions are the only writer.
export function dedupeMemberships(memberships) {
  const seen = new Set();
  return [...memberships]
    .sort((a, b) => String(a.created_date).localeCompare(String(b.created_date)))
    .filter((membership) => {
      if (seen.has(membership.company_id)) return false;
      seen.add(membership.company_id);
      return true;
    });
}

export function roleRank(role) {
  return ROLE_RANK[role] || 0;
}

export function canManageCompany(role) {
  return roleRank(role) >= ROLE_RANK.admin;
}

export function isOwner(role) {
  return role === "owner";
}

export async function readUserRecord(service, userId) {
  const rows = asArray(await service.entities.User.filter({ id: userId }));
  return rows[0] || null;
}

// Memberships added by email are activated the first time that person signs in.
export async function claimInvitations(service, user) {
  const email = (user.email || "").toLowerCase();
  if (!email) return;
  const invited = asArray(
    await service.entities.CompanyMembership.filter({ user_email: email, status: "invited" }),
  ).filter((membership) => membership.user_id !== user.id);
  if (!invited.length) return;
  await service.entities.CompanyMembership.bulkUpdate(
    invited.map((membership) => ({
      id: membership.id,
      user_id: user.id,
      status: "active",
      full_name: membership.full_name || user.full_name || "",
    })),
  );
}

// Keeps the locked company list on the user in sync with their active memberships.
export async function syncUserCompanies(service, userId) {
  const memberships = asArray(
    await service.entities.CompanyMembership.filter({ user_id: userId, status: "active" }),
  );
  const companyIds = unique(memberships.map((membership) => membership.company_id));
  const record = await readUserRecord(service, userId);
  const current = Array.isArray(record?.company_ids) ? record.company_ids : [];
  let activeCompanyId = record?.active_company_id || null;
  if (!companyIds.includes(activeCompanyId)) activeCompanyId = companyIds[0] || null;

  const patch = {};
  if (companyIds.join("|") !== current.join("|")) patch.company_ids = companyIds;
  if (activeCompanyId !== (record?.active_company_id || null)) patch.active_company_id = activeCompanyId;
  if (Object.keys(patch).length) await service.entities.User.update(userId, patch);

  return { companyIds, activeCompanyId };
}

const COMPANY_FIELDS = [
  "name", "legal_name", "email", "phone", "website", "address",
  "city", "postal_code", "country", "currency", "timezone",
  "default_language", "plan", "owner_user_id", "status",
];

function pickCompany(company, role, membershipId) {
  const picked = {};
  COMPANY_FIELDS.forEach((field) => {
    if (company[field] !== undefined) picked[field] = company[field];
  });
  return { ...picked, id: company.id, role, membershipId };
}

// The single source of truth for "who is this caller, which company may they act on,
// and what may they do". company_ids / active_company_id are server-managed and locked
// on the user record, so nothing here can be influenced by the browser.
export async function getActiveSession(context) {
  const service = context.getBase44().asServiceRole;
  const user = context.user;

  await claimInvitations(service, user);
  const { companyIds, activeCompanyId } = await syncUserCompanies(service, user.id);

  const memberships = dedupeMemberships(
    asArray(await service.entities.CompanyMembership.filter({ user_id: user.id, status: "active" })),
  );
  const companies = companyIds.length
    ? asArray(await service.entities.Company.filter({ id: { $in: companyIds } }))
    : [];
  const companyById = new Map(companies.map((company) => [company.id, company]));

  const list = memberships
    .filter((membership) => companyById.has(membership.company_id))
    .map((membership) =>
      pickCompany(companyById.get(membership.company_id), membership.role, membership.id),
    )
    .sort((a, b) => String(a.name).localeCompare(String(b.name)));

  const active = list.find((company) => company.id === activeCompanyId) || list[0] || null;

  return {
    user: {
      id: user.id,
      email: user.email,
      full_name: user.full_name || "",
    },
    companies: list,
    activeCompany: active,
    permissions: {
      canManage: active ? canManageCompany(active.role) : false,
      isOwner: active ? isOwner(active.role) : false,
    },
  };
}

// Every tenant-scoped server function starts here. The company is resolved from the
// signed-in user's own record — a company id sent by the browser is never trusted.
export async function requireCompanyContext(context, minimumRole = "member") {
  const session = await getActiveSession(context);
  if (!session.activeCompany) throw httpError(403, "No company selected", "NO_COMPANY");
  if (roleRank(session.activeCompany.role) < roleRank(minimumRole)) {
    throw httpError(403, "You don't have permission to do that", "FORBIDDEN");
  }
  return session;
}

export async function findMembership(service, companyId, userId) {
  const rows = asArray(
    await service.entities.CompanyMembership.filter({ company_id: companyId, user_id: userId }),
  );
  return rows.find((membership) => membership.status === "active") || null;
}