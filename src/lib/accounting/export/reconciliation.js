/**
 * Fail-closed interpretation of mock accounting evidence. No network access.
 *
 * This is an INTERNAL MOCK contract, not a claim about Merit HTTP guarantees.
 * A future real adapter must verify its search scope, pagination, completeness and
 * amount semantics before supplying equivalent evidence. Raw provider responses
 * alone never establish authoritative absence.
 */

export const RECONCILE_OUTCOMES = Object.freeze({ FOUND: "found", ABSENT: "absent", CONFLICT: "conflict" });
export const RECONCILE_CODES = Object.freeze({
  MULTIPLE_MATCHES: "multiple_matches",
  AMOUNT_MISMATCH: "amount_mismatch",
  INVALID_RESPONSE: "invalid_lookup_response",
  UNVERIFIED_LOOKUP: "unverified_lookup",
  INVALID_DOCUMENT: "invalid_document",
  IDENTITY_MISMATCH: "identity_mismatch",
});
export const MOCK_LOOKUP_CONTRACT = "orqacel-mock-lookup-v1";
export const MOCK_DOCUMENT_CONTRACT = "orqacel-mock-document-v1";

const conflict = (code) => ({ outcome: RECONCILE_OUTCOMES.CONFLICT, code, document: null });
const nonempty = (value) => typeof value === "string" && value.trim().length > 0;
// Existing invoice totals are stored in cents. Accept floating-point representation
// noise only, never a sub-cent adjustment or a coerced/missing monetary value.
function cents(value) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null;
  const scaled = value * 100;
  const integer = Math.round(scaled);
  return Number.isSafeInteger(integer) && Math.abs(scaled - integer) <= 1e-7 ? integer : null;
}
const finiteAmount = (value) => cents(value) !== null;
const DOCUMENT_FIELDS = new Set([
  "SIHId", "InvoiceId", "InvoiceNo", "CurrencyCode", "TotalAmount", "VatAmount", "TotalSum", "CustomerId", "RefNo",
]);

export function expectedDocument(invoice) {
  return { number: invoice?.number, currency: invoice?.currency, subtotal: invoice?.subtotal, vat: invoice?.vat_amount, total: invoice?.total };
}

/** Strict mock document identity and net/VAT/gross matching; no coercion or aliases for amounts. */
export function matchDocument(match, expected = {}) {
  if (!match || typeof match !== "object" || Array.isArray(match) ||
      Object.keys(match).some((key) => !DOCUMENT_FIELDS.has(key))) return conflict(RECONCILE_CODES.INVALID_DOCUMENT);
  const ids = [match.SIHId, match.InvoiceId].filter((value) => value !== undefined);
  if (!ids.length || ids.some((id) => !nonempty(id)) || new Set(ids).size !== 1 ||
      !nonempty(match.InvoiceNo) || !nonempty(match.CurrencyCode) ||
      !nonempty(expected.number) || !nonempty(expected.currency)) return conflict(RECONCILE_CODES.INVALID_DOCUMENT);
  if (match.InvoiceNo !== expected.number || match.CurrencyCode !== expected.currency) {
    return conflict(RECONCILE_CODES.IDENTITY_MISMATCH);
  }
  const amounts = [[match.TotalAmount, expected.subtotal], [match.VatAmount, expected.vat], [match.TotalSum, expected.total]];
  if (amounts.some(([actual, wanted]) => !finiteAmount(actual) || !finiteAmount(wanted))) {
    return conflict(RECONCILE_CODES.INVALID_DOCUMENT);
  }
  if (amounts.some(([actual, wanted]) => cents(actual) !== cents(wanted)) ||
      cents(match.TotalAmount) + cents(match.VatAmount) !== cents(match.TotalSum) ||
      cents(expected.subtotal) + cents(expected.vat) !== cents(expected.total)) {
    return conflict(RECONCILE_CODES.AMOUNT_MISMATCH);
  }
  return { outcome: RECONCILE_OUTCOMES.FOUND, code: null, document: { id: ids[0], number: match.InvoiceNo } };
}

/** Only explicit, complete, authoritative MOCK search evidence can prove absence. */
export function reconcileLookup({ matches, expected = {}, evidence } = {}) {
  if (!Array.isArray(matches)) return conflict(RECONCILE_CODES.INVALID_RESPONSE);
  if (!evidence || evidence.contract !== MOCK_LOOKUP_CONTRACT || evidence.complete !== true ||
      evidence.authoritative !== true || !nonempty(expected.number) || !nonempty(expected.currency) ||
      evidence.invoiceNo !== expected.number || evidence.currency !== expected.currency ||
      evidence.nextCursor !== null) return conflict(RECONCILE_CODES.UNVERIFIED_LOOKUP);
  if (![expected.subtotal, expected.vat, expected.total].every(finiteAmount) ||
      cents(expected.subtotal) + cents(expected.vat) !== cents(expected.total)) {
    return conflict(RECONCILE_CODES.INVALID_DOCUMENT);
  }
  if (!matches.length) return { outcome: RECONCILE_OUTCOMES.ABSENT, code: null, document: null };
  if (matches.length > 1) return conflict(RECONCILE_CODES.MULTIPLE_MATCHES);
  return matchDocument(matches[0], expected);
}

/** A bare send acknowledgement does not prove the identity or finances of the stored document. */
export function confirmResponse(response, expected) {
  if (!response || response.status !== 200 ||
      response.documentEvidence?.contract !== MOCK_DOCUMENT_CONTRACT || typeof response.bodyText !== "string") {
    return conflict(RECONCILE_CODES.INVALID_DOCUMENT);
  }
  let document;
  try { document = JSON.parse(response.bodyText); } catch { return conflict(RECONCILE_CODES.INVALID_DOCUMENT); }
  return matchDocument(document, expected);
}

export function reconcileResponse(response, expected) {
  if (!response || response.status !== 200 ||
      typeof response.bodyText !== "string") return conflict(RECONCILE_CODES.INVALID_RESPONSE);
  let matches;
  try { matches = JSON.parse(response.bodyText); } catch { return conflict(RECONCILE_CODES.INVALID_RESPONSE); }
  return reconcileLookup({ matches, expected, evidence: response.lookupEvidence });
}
