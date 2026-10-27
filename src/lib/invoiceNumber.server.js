// Company-scoped invoice numbering. Server-only: it reads and writes the company's counter.
//
// Format: INV-1001, INV-1002, … — a fixed prefix and a numeric part that keeps counting up for the
// company. The number is stored on the invoice the moment it is created and is never re-derived,
// so an invoice keeps the number it was given even if other invoices are deleted, and an existing
// invoice is never renumbered. Numbers past 9999 simply grow a digit, so the format needs no change
// as a company grows.
//
// The counter lives on the company record and only server functions may write it. Each create
// claims the counter before it uses a number, and the finished invoice is then checked against the
// company's other invoices: if two creates raced, the record that loses takes the next free number
// a moment later, while it is still an unseen draft.
import { asArray } from "@/lib/tenant.server";

const PREFIX = "INV";
const FIRST_NUMBER = 1001;
const MIN_WIDTH = 4;
const CLAIM_ATTEMPTS = 4;
const SETTLE_MS = 60;

export const INVOICE_NUMBER_FORMAT = `${PREFIX}-1001, ${PREFIX}-1002, ${PREFIX}-1003 …`;

function formatInvoiceNumber(value) {
  return `${PREFIX}-${String(value).padStart(MIN_WIDTH, "0")}`;
}

function numericPart(number) {
  const match = new RegExp(`^${PREFIX}-(\\d+)$`).exec(String(number || ""));
  return match ? Number(match[1]) : null;
}

// The counter is authoritative once it exists. A company that already holds invoices without one
// (an import, or records made before the counter) gets the highest of those numbers as its floor,
// so numbering never drops back onto an existing invoice.
async function highestIssuedNumber(service, companyId) {
  const rows = asArray(await service.entities.Invoice.filter({ company_id: companyId }, { limit: 200 }));
  return rows.reduce((highest, row) => Math.max(highest, numericPart(row.number) || 0), 0);
}

export async function claimInvoiceNumber(service, companyId) {
  const company = await service.entities.Company.get(companyId).catch(() => null);
  const claimed = Number(company?.invoice_sequence || 0);
  const floor = claimed > 0 ? claimed : await highestIssuedNumber(service, companyId);
  const candidate = Math.max(claimed, floor, FIRST_NUMBER - 1) + 1;
  await service.entities.Company.update(companyId, { invoice_sequence: candidate });
  return formatInvoiceNumber(candidate);
}

// The older record (earlier created date, then smaller id) keeps the number; the newer one, still
// an unshown draft, moves on. Deterministic for both writers, so exactly one keeps it.
function keeperOf(holders) {
  return holders
    .slice()
    .sort(
      (first, second) =>
        String(first.created_date || "").localeCompare(String(second.created_date || "")) ||
        String(first.id).localeCompare(String(second.id)),
    )[0];
}

export async function settleInvoiceNumber(service, companyId, invoice) {
  let current = invoice;
  for (let attempt = 0; attempt < CLAIM_ATTEMPTS; attempt += 1) {
    // Let a simultaneous create finish writing, so its record is visible when we look.
    if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));
    const holders = asArray(await service.entities.Invoice.filter({ company_id: companyId, number: current.number }));
    if (holders.length <= 1) return current;
    if (keeperOf(holders).id === current.id) return current;
    const next = await claimInvoiceNumber(service, companyId);
    await service.entities.Invoice.update(current.id, { number: next });
    current = { ...current, number: next };
  }
  return current;
}