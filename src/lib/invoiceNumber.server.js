// Company-scoped invoice numbering. Server-only: it reads and claims the company's counter.
//
// Format: INV-1001, INV-1002, … — a fixed prefix and a numeric part that keeps counting up for the
// company. The number is stored on the invoice the moment it is created and is never re-derived, so
// an invoice keeps the number it was given even if other invoices are deleted, and an invoice that
// already exists is never renumbered.
//
// Base44 entities have no unique constraints and there are no transactions across records, so
// uniqueness is enforced by a conditional write: the next number is claimed with an update that only
// applies while the counter still holds the value that was read ("compare and set"). Base44 rechecks
// that condition at the moment of the write, so of two requests that read the same value exactly one
// applies its increment; the other reads the new value and claims the next one. A number is never
// handed out twice, and because the counter only ever moves forward a number is never reused either.
//
// If the counter cannot be claimed within a few attempts the request fails and no invoice is created.
// A creation that fails after claiming leaves a gap in the numbering, which is never filled in again:
// a gap is the safe direction for a financial record, a duplicate number is not.
import { asArray, httpError } from "@/lib/tenant.server";

const PREFIX = "INV";
const FIRST_NUMBER = 1001;
const MIN_WIDTH = 4;
// A company's counter starts here, so its first invoice is INV-1001.
const BASE_SEQUENCE = FIRST_NUMBER - 1;
const CLAIM_ATTEMPTS = 8;
const CLAIM_BACKOFF_MS = 20;

// How far the one-off floor scan looks for a company that has invoices but no counter yet.
const FLOOR_PAGE = 200;
const FLOOR_MAX_PAGES = 20;

export const INVOICE_COUNTER_START = BASE_SEQUENCE;
export const INVOICE_NUMBER_FORMAT = `${PREFIX}-1001, ${PREFIX}-1002, ${PREFIX}-1003 …`;

function formatInvoiceNumber(value) {
  return `${PREFIX}-${String(value).padStart(MIN_WIDTH, "0")}`;
}

function numericPart(number) {
  const match = new RegExp(`^${PREFIX}-(\\d+)$`).exec(String(number || ""));
  return match ? Number(match[1]) : null;
}

// The lowest number a company may use. The counter is the authority once it exists; this is consulted
// only for a company that already holds invoices but has never had a counter (imported records, or
// records made before the counter existed), so numbering can never drop back onto an existing
// invoice. Read-only: it looks at invoices and changes nothing.
async function numberingFloor(service, companyId) {
  let highest = 0;
  let cursor = null;
  for (let page = 0; page < FLOOR_MAX_PAGES; page += 1) {
    const result = await service.entities.Invoice.filter(
      { company_id: companyId },
      { limit: FLOOR_PAGE, ...(cursor ? { cursor } : {}) },
    );
    asArray(result).forEach((row) => {
      highest = Math.max(highest, numericPart(row.number) || 0);
    });
    cursor = result?.next_cursor || null;
    if (!cursor) return Math.max(highest, BASE_SEQUENCE);
  }
  // Refuse to guess rather than seed a counter below a number that already exists.
  throw httpError(
    409,
    "This company's invoice numbering needs to be set before a new invoice can be created",
    "NUMBERING_UNSET",
  );
}

// A new company is created with its counter already in place, so this only ever does work for a
// company that predates the counter. The counter is seeded with $max, which can only raise it: two
// requests seeding at the same time write the same value, and neither can pull a counter that the
// other has already advanced back down.
async function ensureCounter(service, companyId, company) {
  const current = Number(company?.invoice_sequence);
  if (Number.isFinite(current) && current >= BASE_SEQUENCE) return;
  const floor = await numberingFloor(service, companyId);
  await service.entities.Company.updateMany({ id: companyId }, { $max: { invoice_sequence: floor } });
}

// Claims the next invoice number for a company, exclusively, or fails without returning one.
export async function claimInvoiceNumber(service, companyId) {
  const company = await service.entities.Company.get(companyId).catch(() => null);
  if (!company) throw httpError(404, "Company not found", "NO_COMPANY");
  await ensureCounter(service, companyId, company);

  for (let attempt = 0; attempt < CLAIM_ATTEMPTS; attempt += 1) {
    if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, CLAIM_BACKOFF_MS * attempt));

    const fresh = await service.entities.Company.get(companyId).catch(() => null);
    if (!fresh) throw httpError(404, "Company not found", "NO_COMPANY");

    const current = Number(fresh.invoice_sequence);
    if (!Number.isFinite(current) || current < BASE_SEQUENCE) continue;

    const candidate = current + 1;
    // The condition is rechecked by Base44 at the moment of the write: this applies only while the
    // counter still reads what was just read, so only one of two racing claims can win.
    const result = await service.entities.Company.updateMany(
      { id: companyId, invoice_sequence: current },
      { $set: { invoice_sequence: candidate } },
    );
    if (result?.updated === 1) return formatInvoiceNumber(candidate);
  }

  // Nothing was written and no number was returned, so no duplicate and no reused number exists —
  // the caller fails and no invoice is created.
  throw httpError(503, "No invoice number could be allocated just now, please try again", "NUMBER_CLAIM_FAILED");
}