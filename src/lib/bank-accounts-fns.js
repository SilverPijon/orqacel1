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

// At most one default per company: making one account the default clears the others.
async function clearOtherDefaults(service, companyId, keepId) {
  await service.entities.CompanyBankAccount.updateMany(
    { company_id: companyId, is_default: true, id: { $ne: keepId } },
    { $set: { is_default: false } },
  );
}

export const listBankAccounts = createServerFn({ method: "GET" })
  .middleware([requireUser])
  .handler(async ({ context }) => {
    const session = await requireCompanyContext(context);
    const accounts = await listAccounts(context.getBase44().asServiceRole, session.activeCompany.id);
    return accounts.map(publicAccount);
  });

export const createBankAccount = createServerFn({ method: "POST" })
  .middleware([requireUser])
  .validator(AccountInput)
  .handler(async ({ data, context }) => {
    const session = await requireCompanyContext(context, "admin");
    const service = context.getBase44().asServiceRole;
    const companyId = session.activeCompany.id;
    const value = readAccount(data);
    const existing = await listAccounts(service, companyId);

    // The first account a company saves becomes its default, so a new invoice always has one to
    // start from; after that the choice belongs to the user.
    const makeDefault = data.is_default === true || existing.length === 0;

    const created = await service.entities.CompanyBankAccount.create({
      company_id: companyId,
      ...value,
      is_default: makeDefault,
    });
    if (makeDefault) await clearOtherDefaults(service, companyId, created.id);

    return publicAccount(created);
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

    const patch = { ...value };
    // Switching the default is done by making another account the default, never by clearing this
    // one, so a company with accounts always has exactly one.
    const makeDefault = data.is_default === true;
    if (makeDefault) patch.is_default = true;

    const updated = await service.entities.CompanyBankAccount.update(account.id, patch);
    if (makeDefault) await clearOtherDefaults(service, companyId, account.id);

    return publicAccount(updated);
  });

export const deleteBankAccount = createServerFn({ method: "POST" })
  .middleware([requireUser])
  .validator(z.object({ id: z.string().min(1).max(64) }))
  .handler(async ({ data, context }) => {
    const session = await requireCompanyContext(context, "admin");
    const service = context.getBase44().asServiceRole;
    const companyId = session.activeCompany.id;
    const account = await loadCompanyAccount(service, companyId, data.id);

    await service.entities.CompanyBankAccount.delete(account.id);

    // Invoices that already exist keep the payment details frozen into them; only invoices made from
    // now on are affected. When the default is the one that went, the earliest remaining account
    // takes over so the company still has one.
    if (account.is_default) {
      const remaining = await listAccounts(service, companyId);
      const [next] = [...remaining].sort((a, b) =>
        String(a.created_date).localeCompare(String(b.created_date)),
      );
      if (next) await service.entities.CompanyBankAccount.update(next.id, { is_default: true });
    }

    return { id: account.id };
  });