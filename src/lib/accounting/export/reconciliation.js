/**
 * Reconciliation of an ambiguous export.
 *
 * An ambiguous outcome means: the request may or may not have created a document. The only safe
 * resolution is to ask the provider. This module interprets that answer; it makes no network call.
 */

import { EPSILON } from "../canonicalInvoice.js";

export const RECONCILE_OUTCOMES = Object.freeze({
  FOUND: "found",
  ABSENT: "absent",
  CONFLICT: "conflict",
});

export const RECONCILE_CODES = Object.freeze({
  MULTIPLE_MATCHES: "multiple_matches",
  AMOUNT_MISMATCH: "amount_mismatch",
});

function totalOf(match) {
  const raw = match?.TotalSum ?? match?.TotalAmount ?? match?.total;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

/**
 * @param {{matches: Array, expected: {total: number}}} input
 */
export function reconcileLookup({ matches = [], expected = {} } = {}) {
  const found = (Array.isArray(matches) ? matches : []).filter(Boolean);

  if (found.length === 0) {
    // Proven absent. Only now may a retry happen.
    return { outcome: RECONCILE_OUTCOMES.ABSENT, code: null, document: null };
  }

  if (found.length > 1) {
    // Same number twice: the provider accepted a duplicate, or the lookup is too broad.
    // A human must resolve it — never delete anything automatically.
    return { outcome: RECONCILE_OUTCOMES.CONFLICT, code: RECONCILE_CODES.MULTIPLE_MATCHES, matches: found.length, document: null };
  }

  const match = found[0];
  const providerTotal = totalOf(match);
  const expectedTotal = expected.total === undefined ? null : Number(expected.total);

  if (providerTotal !== null && expectedTotal !== null && Math.abs(providerTotal - expectedTotal) >= EPSILON) {
    // A document with our number exists but holds different figures. Adopting it would be a lie.
    return {
      outcome: RECONCILE_OUTCOMES.CONFLICT,
      code: RECONCILE_CODES.AMOUNT_MISMATCH,
      providerTotal,
      expectedTotal,
      document: null,
    };
  }

  return {
    outcome: RECONCILE_OUTCOMES.FOUND,
    code: null,
    document: {
      id: match.SIHId ?? match.InvoiceId ?? null,
      number: match.InvoiceNo ?? null,
    },
  };
}