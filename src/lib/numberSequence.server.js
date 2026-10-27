// Company-scoped document numbering. Server-only: it reads and claims a company counter.
//
// The format is a fixed prefix and a numeric part that keeps counting up for the company (INV-1001,
// QT-1001 …). The number is stored on the document the moment it is created and never re-derived, so
// a document keeps the number it was given even if other documents are deleted, and an existing
// document is never renumbered.
//
// Base44 entities have no unique constraints and there are no transactions across records, so
// uniqueness is enforced by a conditional write: the next number is claimed with an update that only
// applies while the counter still holds the value that was read ("compare and set"). Base44 rechecks
// that condition at the moment of the write, so of two requests that read the same value exactly one
// applies its increment; the other reads the new value and claims the next one. A number is never
// handed out twice, and because the counter only ever moves forward a number is never reused either.
//
// If the counter cannot be claimed within a few attempts the request fails and no document is created.
// A creation that fails after claiming leaves a gap in the numbering, which is never filled in again:
// a gap is the safe direction for a business record, a duplicate number is not.
import { asArray, httpError } from "@/lib/tenant.server";

const CLAIM_ATTEMPTS = 8;
const CLAIM_BACKOFF_MS = 20;

// How far the one-off floor scan looks for a company that has documents but no counter yet.
const FLOOR_PAGE = 200;
const FLOOR_MAX_PAGES = 20;

// The lowest number a company may use. The counter is the authority once it exists; this is consulted
// only for a company that already holds documents but has never had a counter (imported records, or
// records made before the counter existed), so numbering can never drop back onto an existing
// document. Read-only: it looks at documents and changes nothing.
async function numberingFloor(service, { companyId, entityName, prefix, base }) {
  const pattern = new RegExp(`^${prefix}-(\\d+)$`);
  let highest = 0;
  let cursor = null;
  for (let page = 0; page < FLOOR_MAX_PAGES; page += 1) {
    const result = await service.entities[entityName].filter(
      { company_id: companyId },
      { limit: FLOOR_PAGE, ...(cursor ? { cursor } : {}) },
    );
    asArray(result).forEach((row) => {
      const match = pattern.exec(String(row.number || ""));
      if (match) highest = Math.max(highest, Number(match[1]));
    });
    cursor = result?.next_cursor || null;
    if (!cursor) return Math.max(highest, base);
  }
  // Refuse to guess rather than seed a counter below a number that already exists.
  throw httpError(
    409,
    "This company's numbering needs to be set before a new document can be created",
    "NUMBERING_UNSET",
  );
}

// A new company is created with its counters already in place, so this only ever does work for a
// company that predates the counter. The counter is seeded with $max, which can only raise it: two
// requests seeding at the same time write the same value, and neither can pull a counter that the
// other has already advanced back down.
async function ensureCounter(service, { companyId, company, counterField, entityName, prefix, base }) {
  const current = Number(company?.[counterField]);
  if (Number.isFinite(current) && current >= base) return;
  const floor = await numberingFloor(service, { companyId, entityName, prefix, base });
  await service.entities.Company.updateMany({ id: companyId }, { $max: { [counterField]: floor } });
}

// Claims the next number for a company, exclusively, or fails without returning one.
export async function claimSequenceNumber(
  service,
  { companyId, counterField, entityName, prefix, firstNumber, minWidth = 4 },
) {
  const base = firstNumber - 1;
  const format = (value) => `${prefix}-${String(value).padStart(minWidth, "0")}`;

  const company = await service.entities.Company.get(companyId).catch(() => null);
  if (!company) throw httpError(404, "Company not found", "NO_COMPANY");
  await ensureCounter(service, { companyId, company, counterField, entityName, prefix, base });

  for (let attempt = 0; attempt < CLAIM_ATTEMPTS; attempt += 1) {
    if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, CLAIM_BACKOFF_MS * attempt));

    const fresh = await service.entities.Company.get(companyId).catch(() => null);
    if (!fresh) throw httpError(404, "Company not found", "NO_COMPANY");

    const current = Number(fresh[counterField]);
    if (!Number.isFinite(current) || current < base) continue;

    const candidate = current + 1;
    // The condition is rechecked by Base44 at the moment of the write: this applies only while the
    // counter still reads what was just read, so only one of two racing claims can win.
    const result = await service.entities.Company.updateMany(
      { id: companyId, [counterField]: current },
      { $set: { [counterField]: candidate } },
    );
    if (result?.updated === 1) return format(candidate);
  }

  // Nothing was written and no number was returned, so no duplicate and no reused number exists —
  // the caller fails and no document is created.
  throw httpError(
    503,
    "No document number could be allocated just now, please try again",
    "NUMBER_CLAIM_FAILED",
  );
}