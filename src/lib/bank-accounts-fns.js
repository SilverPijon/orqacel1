import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireUser } from "@/lib/auth-middleware";
import { asArray, httpError, requireCompanyContext } from "@/lib/tenant.server";
import { publicAccount, readBankAccountInput, sortAccounts } from "@/lib/bankAccounts";

// Company bank accounts. Which company a caller may act on is resolved on the server from the signed
// in user's own record — a company id or an account id sent by the browser is never trusted, and an
// account of another company is indistinguishable from one that does not exist.
//
// Reading is open to every member of the company, because an invoice has to show where it is paid.
// Changing accounts is owner/admin work: the UI hides the controls for members and the server
// refuses them regardless of the UI.
//
// A company may keep as many accounts as it likes, at as many banks as it likes. Which one is the
// default is kept in ONE field on the company (default_bank_account_id), not as a flag on the
// accounts: a single field can only hold one id, so two accounts can never both be the default,
// however concurrent writes interleave. The flags on the accounts only mirror it for display.

const POINTER_ATTEMPTS = 5;

const AccountInput = z.object({
  account_holder: z.string().max(160).optional(),
  iban: z.string().max(64).optional(),
  bank_name: z.string().max(160).optional(),
  bic: z.string().max(32).optional(),
  is_default: z.boolean().optional(),
});

// One message per thing that can be wrong, so the person knows what to correct.
const ACCOUNT_ERRORS = {
  HOLDER_REQUIRED: "Enter the account holder name",
  HOLDER_TOO_LONG: "That account holder name is too long",
  BANK_NAME_TOO_LONG: "That bank name is too long",
  BAD_IBAN: "Enter a valid IBAN, including its check digits",
  BAD_BIC: "Enter a valid BIC/SWIFT code",
};

// The same reader the settings form uses, so nothing reaches the database unvalidated.
function readAccount(data) {
  const parsed = readBankAccountInput(data);
  if (parsed.error) {
    throw httpError(400, ACCOUNT_ERRORS[parsed.error] || "That bank account could not be saved", parsed.error);
  }
  return parsed.value;
}

async function listAccounts(service, companyId) {
  return sortAccounts(asArray(await service.entities.CompanyBankAccount.filter({ company_id: companyId })));
}

async function loadCompanyAccount(service, companyId, id) {
  const account = await service.entities.CompanyBankAccount.get(id).catch((error) => {
    if (error?.status === 404) return null;
    throw error;
  });
  if (!account || account.company_id !== companyId) {
    throw httpError(404, "Bank account not found", "NOT_FOUND");
  }
  return account;
}

// The condition that says "only if the pointer still holds what I read". A company that has never
// had a default has no field at all, which is matched explicitly rather than guessed at.
function pointerFilter(companyId, expected) {
  if (expected) return { id: companyId, default_bank_account_id: expected };
  return {
    id: companyId,
    $or: [{ default_bank_account_id: { $exists: false } }, { default_bank_account_id: "" }],
  };
}

// Points the company at a different default. The write only applies while the pointer still holds
// what was just read, so a racing change is detected and the attempt is repeated against the value
// that actually won — never silently overwritten. One field means one default, always.
async function claimDefault(service, companyId, accountId) {
  for (let attempt = 0; attempt < POINTER_ATTEMPTS; attempt += 1) {
    const company = await service.entities.Company.get(companyId).catch(() => null);
    if (!company) return false;
    const current = String(company.default_bank_account_id || "");
    if (current === accountId) return true;
    const written = await service.entities.Company.updateMany(pointerFilter(companyId, current), {
      $set: { default_bank_account_id: accountId },
    });
    if (Number(written?.updated || 0) === 1) return true;
  }
  return false;
}

// Keeps the older per-account flags in step with the pointer, so a list read straight from the
// accounts table still shows one default. The pointer decides; this only mirrors it.
async function mirrorFlags(service, companyId, defaultId) {
  await service.entities.CompanyBankAccount.updateMany(
    { company_id: companyId, is_default: true, ...(defaultId ? { id: { $ne: defaultId } } : {}) },
    { $set: { is_default: false } },
  );
  if (defaultId) await service.entities.CompanyBankAccount.update(defaultId, { is_default: true });
}

// A pointer is only ever cleared when the account it names is really gone. An account list read a
// moment earlier is not proof of that on its own: it can miss an account another request has just
// created or just promoted, and clearing on that basis would quietly undo a valid choice.
async function pointerIsLive(service, companyId, pointer) {
  if (!pointer) return false;
  const account = await service.entities.CompanyBankAccount.get(pointer).catch(() => null);
  return Boolean(account && account.company_id === companyId);
}

// The company's default, checked against the accounts that really exist: a pointer naming an account
// that has gone is dropped, and an account flagged default from before the pointer existed is
// adopted once. Returns "" when the company has no default.
async function resolveDefaultId(service, companyId, company, accounts) {
  const fresh = await service.entities.Company.get(companyId).catch(() => null);
  const pointer = String((fresh || company)?.default_bank_account_id || "");
  if (pointer && accounts.some((account) => account.id === pointer)) return pointer;
  if (await pointerIsLive(service, companyId, pointer)) return pointer;

  const legacy = accounts.find((account) => account.is_default === true);
  const next = legacy ? legacy.id : "";
  if (next === pointer) return next;

  await claimDefault(service, companyId, next);
  await mirrorFlags(service, companyId, next);
  return next;
}

// The company's accounts together with the authoritative default.
async function readDefaultId(service, companyId, company) {
  const accounts = await listAccounts(service, companyId);
  return { accounts, defaultId: await resolveDefaultId(service, companyId, company, accounts) };
}

export const listBankAccounts = createServerFn({ method: "GET" })
  .middleware([requireUser])
  .handler(async ({ context }) => {
    const session = await requireCompanyContext(context);
    const service = context.getBase44().asServiceRole;
    const { accounts, defaultId } = await readDefaultId(
      service,
      session.activeCompany.id,
      session.activeCompany,
    );
    return accounts.map((account) => publicAccount(account, defaultId));
  });

export const createBankAccount = createServerFn({ method: "POST" })
  .middleware([requireUser])
  .validator(AccountInput)
  .handler(async ({ data, context }) => {
    const session = await requireCompanyContext(context, "admin");
    const service = context.getBase44().asServiceRole;
    const companyId = session.activeCompany.id;
    const value = readAccount(data);
    const { accounts, defaultId } = await readDefaultId(service, companyId, session.activeCompany);

    // The first account a company saves becomes its default, so a new invoice always has one to
    // start from; after that the choice belongs to the user. Any number of accounts may be added:
    // this pointer never limits how many the company keeps.
    const makeDefault = data.is_default === true || accounts.length === 0;

    const created = await service.entities.CompanyBankAccount.create({
      company_id: companyId,
      ...value,
      is_default: false,
    });

    let nextDefault = defaultId;
    if (makeDefault) {
      const claimed = await claimDefault(service, companyId, created.id);
      if (!claimed) {
        throw httpError(409, "The default account changed at the same moment, please try again", "DEFAULT_CONFLICT");
      }
      nextDefault = created.id;
    }
    await mirrorFlags(service, companyId, nextDefault);

    return publicAccount(created, nextDefault);
  });

export const updateBankAccount = createServerFn({ method: "POST" })
  .middleware([requireUser])
  .validator(AccountInput.extend({ id: z.string().min(1).max(64) }))
  .handler(async ({ data, context }) => {
    const session = await requireCompanyContext(context, "admin");
    const service = context.getBase44().asServiceRole;
    const companyId = session.activeCompany.id;
    const account = await loadCompanyAccount(service, companyId, data.id);
    const value = readAccount(data);

    const updated = await service.entities.CompanyBankAccount.update(account.id, value);

    let nextDefault = await resolveDefaultId(
      service,
      companyId,
      session.activeCompany,
      await listAccounts(service, companyId),
    );
    // Switching the default is a claim on the company's single pointer; a lost race is reported
    // rather than leaving two accounts looking default.
    if (data.is_default === true && nextDefault !== account.id) {
      const claimed = await claimDefault(service, companyId, account.id);
      if (!claimed) {
        throw httpError(409, "The default account changed at the same moment, please try again", "DEFAULT_CONFLICT");
      }
      nextDefault = account.id;
    }
    await mirrorFlags(service, companyId, nextDefault);

    return publicAccount(updated, nextDefault);
  });

export const deleteBankAccount = createServerFn({ method: "POST" })
  .middleware([requireUser])
  .validator(z.object({ id: z.string().min(1).max(64) }))
  .handler(async ({ data, context }) => {
    const session = await requireCompanyContext(context, "admin");
    const service = context.getBase44().asServiceRole;
    const companyId = session.activeCompany.id;
    const account = await loadCompanyAccount(service, companyId, data.id);
    const { defaultId } = await readDefaultId(service, companyId, session.activeCompany);
    const wasDefault = defaultId === account.id;

    await service.entities.CompanyBankAccount.delete(account.id);

    // Invoices that already exist keep the payment details frozen into them; only invoices made from
    // now on are affected. When the default is the one that went, the earliest remaining account
    // takes over, and when nothing is left the pointer is cleared rather than left dangling.
    let nextDefault = defaultId;
    if (wasDefault) {
      const remaining = await listAccounts(service, companyId);
      const [next] = [...remaining].sort((a, b) =>
        String(a.created_date).localeCompare(String(b.created_date)),
      );
      nextDefault = next ? next.id : "";
      // Replaces the pointer only while it still names the account that went, so a choice made in
      // the meantime is not overwritten by this cleanup.
      const written = await service.entities.Company.updateMany(pointerFilter(companyId, account.id), {
        $set: { default_bank_account_id: nextDefault },
      });
      if (Number(written?.updated || 0) !== 1) {
        const company = await service.entities.Company.get(companyId).catch(() => null);
        nextDefault = String(company?.default_bank_account_id || "");
      }
    }
    await mirrorFlags(service, companyId, nextDefault);

    return { id: account.id, default_bank_account_id: nextDefault };
  });