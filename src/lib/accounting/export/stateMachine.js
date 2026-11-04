/**
 * Export state machine.
 *
 * Pure functions over a plain record. Persistence is a port supplied by the caller, so the same
 * logic runs against an in-memory store today and a database tomorrow.
 *
 * The record shape mirrors the future entity:
 *   { key, state, version, attempts, lease_expires_at, next_attempt_at,
 *     provider_document_id, provider_document_no, error_code, updated_at }
 */

import { OUTCOMES } from "../merit/response.js";

export const EXPORT_STATES = Object.freeze({
  NOT_EXPORTED: "not_exported",
  PREPARING: "preparing",
  SENDING: "sending",
  EXPORTED: "exported",
  FAILED_RETRYABLE: "failed_retryable",
  FAILED_PERMANENT: "failed_permanent",
  NEEDS_RECONCILIATION: "needs_reconciliation",
});

export const DEFAULT_LEASE_MS = 60_000;
export const BACKOFF_BASE_MS = 30_000;
export const BACKOFF_MAX_MS = 30 * 60_000;

const TRANSITIONS = {
  [EXPORT_STATES.NOT_EXPORTED]: [EXPORT_STATES.PREPARING],
  [EXPORT_STATES.PREPARING]: [
    EXPORT_STATES.SENDING,
    EXPORT_STATES.FAILED_PERMANENT,
    EXPORT_STATES.FAILED_RETRYABLE,
    EXPORT_STATES.NEEDS_RECONCILIATION,
  ],
  [EXPORT_STATES.SENDING]: [
    EXPORT_STATES.EXPORTED,
    EXPORT_STATES.FAILED_PERMANENT,
    EXPORT_STATES.FAILED_RETRYABLE,
    EXPORT_STATES.NEEDS_RECONCILIATION,
  ],
  [EXPORT_STATES.FAILED_RETRYABLE]: [EXPORT_STATES.PREPARING, EXPORT_STATES.FAILED_PERMANENT],
  // Reconciliation is the only route out of an ambiguous outcome.
  [EXPORT_STATES.NEEDS_RECONCILIATION]: [EXPORT_STATES.EXPORTED, EXPORT_STATES.FAILED_RETRYABLE],
  // Reopening a permanent failure is an explicit administrative act, never automatic.
  [EXPORT_STATES.FAILED_PERMANENT]: [EXPORT_STATES.PREPARING],
  [EXPORT_STATES.EXPORTED]: [],
};

export function canTransition(from, to) {
  return (TRANSITIONS[from] || []).includes(to);
}

export function isTerminal(state) {
  return state === EXPORT_STATES.EXPORTED;
}

export function backoffMs(attempt) {
  const n = Math.max(1, Number(attempt) || 1);
  return Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** (n - 1));
}

export function exportKey(invoice, kind = "invoice") {
  return `${invoice.company_id}:${invoice.id}:${kind}`;
}

export function initialRecord(key) {
  return {
    key,
    state: EXPORT_STATES.NOT_EXPORTED,
    version: 0,
    attempts: 0,
    lease_expires_at: null,
    next_attempt_at: null,
    provider_document_id: null,
    provider_document_no: null,
    error_code: null,
    updated_at: null,
  };
}

export function leaseExpired(record, now = Date.now()) {
  if (record.state !== EXPORT_STATES.SENDING) return false;
  if (record.lease_expires_at === null || record.lease_expires_at === undefined) return false;
  return Number(record.lease_expires_at) <= Number(now);
}

function blocked(code, record) {
  return { ok: false, code, record, next: null };
}

/**
 * Claim exclusive responsibility for exporting this invoice.
 *
 * Exactly one caller can win: the transition is only granted while the record is still in a
 * claimable state, and the caller must persist it with a compare-and-set on `version`.
 */
export function claimForExport(record, { now = Date.now(), leaseMs = DEFAULT_LEASE_MS } = {}) {
  switch (record.state) {
    case EXPORT_STATES.EXPORTED:
      return blocked("already_exported", record);
    case EXPORT_STATES.NEEDS_RECONCILIATION:
      // Never resent. A human-confirmed reconciliation is the only exit.
      return blocked("needs_reconciliation", record);
    case EXPORT_STATES.FAILED_PERMANENT:
      return blocked("failed_permanent", record);
    case EXPORT_STATES.SENDING:
      return blocked(leaseExpired(record, now) ? "lease_expired" : "in_flight", record);
    case EXPORT_STATES.FAILED_RETRYABLE:
      if (record.next_attempt_at && Number(now) < Number(record.next_attempt_at)) {
        return blocked("retry_not_due", record);
      }
      break;
    default:
      break;
  }

  if (!canTransition(record.state, EXPORT_STATES.PREPARING)) {
    return blocked("invalid_transition", record);
  }

  return {
    ok: true,
    code: null,
    record,
    next: {
      ...record,
      state: EXPORT_STATES.PREPARING,
      version: record.version + 1,
      attempts: (record.attempts || 0) + 1,
      lease_expires_at: null,
      next_attempt_at: null,
      error_code: null,
      updated_at: now,
    },
  };
}

export function markSending(record, { now = Date.now(), leaseMs = DEFAULT_LEASE_MS } = {}) {
  if (record.state !== EXPORT_STATES.PREPARING) {
    return { ok: false, code: "not_preparing", next: null };
  }
  return {
    ok: true,
    next: {
      ...record,
      state: EXPORT_STATES.SENDING,
      version: record.version + 1,
      lease_expires_at: now + leaseMs,
      updated_at: now,
    },
  };
}

/** Settle a send attempt from its classification. */
export function applyResult(record, classification = {}, { now = Date.now() } = {}) {
  const outcome = classification.outcome;

  if (outcome === OUTCOMES.CONFIRMED) {
    return {
      ...record,
      state: EXPORT_STATES.EXPORTED,
      version: record.version + 1,
      lease_expires_at: null,
      next_attempt_at: null,
      error_code: null,
      provider_document_id: classification.document?.id ?? null,
      provider_document_no: classification.document?.number ?? null,
      updated_at: now,
    };
  }

  if (outcome === OUTCOMES.REJECTED) {
    return {
      ...record,
      state: EXPORT_STATES.FAILED_PERMANENT,
      version: record.version + 1,
      lease_expires_at: null,
      error_code: classification.code || "rejected",
      updated_at: now,
    };
  }

  if (outcome === OUTCOMES.RETRYABLE) {
    const delay = Number.isFinite(classification.retryAfterMs)
      ? Math.max(0, classification.retryAfterMs)
      : backoffMs(record.attempts);
    return {
      ...record,
      state: EXPORT_STATES.FAILED_RETRYABLE,
      version: record.version + 1,
      lease_expires_at: null,
      next_attempt_at: now + delay,
      error_code: classification.code || "retryable",
      updated_at: now,
    };
  }

  // Ambiguous by default: the outcome is unknown, so the record must be reconciled, not retried.
  return {
    ...record,
    state: EXPORT_STATES.NEEDS_RECONCILIATION,
    version: record.version + 1,
    lease_expires_at: null,
    error_code: classification.code || "unknown_outcome",
    updated_at: now,
  };
}

/** A sending record whose lease elapsed: the worker died mid-flight. Never re-sent blindly. */
export function recoverInterrupted(record, { now = Date.now() } = {}) {
  if (!leaseExpired(record, now)) return null;
  return {
    ...record,
    state: EXPORT_STATES.NEEDS_RECONCILIATION,
    version: record.version + 1,
    lease_expires_at: null,
    error_code: "lease_expired",
    updated_at: now,
  };
}

export function isRetryEligible(record, now = Date.now()) {
  if (record.state !== EXPORT_STATES.FAILED_RETRYABLE) return false;
  if (!record.next_attempt_at) return true;
  return Number(now) >= Number(record.next_attempt_at);
}

/** Reconciliation proved the document does exist at the provider. */
export function resolveAsExported(record, { document, now = Date.now() } = {}) {
  if (!canTransition(record.state, EXPORT_STATES.EXPORTED)) {
    return { ok: false, code: "invalid_transition", next: null };
  }
  return {
    ok: true,
    next: {
      ...record,
      state: EXPORT_STATES.EXPORTED,
      version: record.version + 1,
      lease_expires_at: null,
      next_attempt_at: null,
      error_code: null,
      provider_document_id: document?.id ?? null,
      provider_document_no: document?.number ?? null,
      updated_at: now,
    },
  };
}

/** Reconciliation proved the document does not exist: the send may be attempted again. */
export function resolveAsAbsent(record, { now = Date.now() } = {}) {
  if (!canTransition(record.state, EXPORT_STATES.FAILED_RETRYABLE)) {
    return { ok: false, code: "invalid_transition", next: null };
  }
  return {
    ok: true,
    next: {
      ...record,
      state: EXPORT_STATES.FAILED_RETRYABLE,
      version: record.version + 1,
      lease_expires_at: null,
      next_attempt_at: now,
      error_code: "absent_confirmed",
      updated_at: now,
    },
  };
}