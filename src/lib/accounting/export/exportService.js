/**
 * Export orchestration.
 *
 * Provider-independent: the mapping step is selected from a registry, so adding a provider means
 * adding an entry, not changing this flow.
 *
 * Storage is a port (`store`) and the provider client is a port (`adapter`). Nothing here imports
 * an entity, an SDK, or performs network access — the tests drive it entirely in memory.
 */

import { buildCanonicalInvoice } from "../canonicalInvoice.js";
import { buildMeritPayload } from "../merit/mapper.js";
import { OUTCOMES, classifyMeritResponse, classifyTransportError } from "../merit/response.js";
import {
  EXPORT_STATES,
  applyResult,
  claimForExport,
  exportKey,
  initialRecord,
  markSending,
  recoverInterrupted,
  resolveAsAbsent,
  resolveAsExported,
} from "./stateMachine.js";
import { RECONCILE_OUTCOMES, reconcileLookup } from "./reconciliation.js";
import { AUDIT_ACTIONS, createAuditEvent } from "./audit.js";

export const AUTHORIZED_ROLES = Object.freeze(["owner", "admin"]);

/** Provider registry — the only provider-specific thing in this flow. */
export const PAYLOAD_MAPPERS = Object.freeze({
  merit: buildMeritPayload,
});

export function authorizeAccess(actor = {}, { connection = {}, invoice = {} } = {}) {
  if (!actor.userId) return { ok: false, code: "unauthenticated" };
  if (!AUTHORIZED_ROLES.includes(actor.role)) return { ok: false, code: "forbidden_role" };
  if (!actor.companyId) return { ok: false, code: "no_company_context" };
  if (actor.companyId !== connection.company_id) return { ok: false, code: "forbidden_company" };
  if (connection.company_id !== invoice.company_id) return { ok: false, code: "cross_company" };
  if (connection.status !== "connected") return { ok: false, code: "connection_not_connected" };
  if (connection.export_mode === "disabled") return { ok: false, code: "export_disabled" };
  return { ok: true, code: null };
}

function baseEvent({ action, actor, invoice, key, fromState, toState, attempt, errorCode, providerDocumentId, providerDocumentNo }) {
  return createAuditEvent({
    action,
    actor,
    companyId: invoice?.company_id ?? null,
    exportKey: key,
    invoiceId: invoice?.id ?? null,
    fromState,
    toState,
    attempt,
    errorCode,
    providerDocumentId,
    providerDocumentNo,
  });
}

function actionFor(classification) {
  if (classification.outcome === OUTCOMES.CONFIRMED) return AUDIT_ACTIONS.EXPORT_CONFIRMED;
  if (classification.outcome === OUTCOMES.REJECTED) return AUDIT_ACTIONS.EXPORT_FAILED;
  if (classification.outcome === OUTCOMES.RETRYABLE) return AUDIT_ACTIONS.EXPORT_FAILED;
  return AUDIT_ACTIONS.EXPORT_AMBIGUOUS;
}

function parseLookupMatches(response) {
  const text = response?.bodyText ?? response?.body ?? "";
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) return parsed;
    if (parsed && typeof parsed === "object") return [parsed];
    return [];
  } catch {
    return [];
  }
}

/**
 * Run one export attempt.
 *
 * @returns {Promise<{outcome: string, code: string|null, record?: object, issues?: Array}>}
 * The provider payload is deliberately not returned: it carries customer data and must not
 * travel back to a caller or into a log.
 */
export async function runExport({ invoice, connection, store, adapter, actor = {}, now = Date.now(), leaseMs } = {}) {
  const access = authorizeAccess(actor, { connection, invoice });
  if (!access.ok) return { outcome: "blocked", code: access.code };

  const mapper = PAYLOAD_MAPPERS[connection.provider];
  if (!mapper) return { outcome: "blocked", code: "provider_not_supported" };

  const key = exportKey(invoice);
  const current = (await store.get(key)) || initialRecord(key);

  const recovered = recoverInterrupted(current, { now });
  if (recovered) {
    const saved = await store.cas(key, current.version, recovered);
    if (!saved.ok) return { outcome: "conflict", code: "cas_conflict", record: saved.current };
    await store.appendAudit(
      baseEvent({
        action: AUDIT_ACTIONS.EXPORT_RECOVERY_REQUIRED,
        actor,
        invoice,
        key,
        fromState: current.state,
        toState: recovered.state,
        attempt: current.attempts,
        errorCode: recovered.error_code,
      }),
    );
    return { outcome: EXPORT_STATES.NEEDS_RECONCILIATION, code: "lease_expired", record: recovered };
  }

  const claim = claimForExport(current, { now, leaseMs });
  if (!claim.ok) return { outcome: "blocked", code: claim.code, record: claim.record };

  const claimedSave = await store.cas(key, current.version, claim.next);
  if (!claimedSave.ok) return { outcome: "conflict", code: "cas_conflict", record: claimedSave.current };

  let claimed = claim.next;

  const canonical = buildCanonicalInvoice(invoice);
  const mapped = canonical.ok ? mapper(canonical.dto, connection) : { ok: false, payload: null, issues: canonical.issues };

  if (!mapped.ok) {
    const settled = applyResult(claimed, { outcome: OUTCOMES.REJECTED, code: "validation_failed" }, { now });
    const saved = await store.cas(key, claimed.version, settled);
    const record = saved.ok ? settled : saved.current;
    await store.appendAudit(
      baseEvent({
        action: AUDIT_ACTIONS.EXPORT_VALIDATION_FAILED,
        actor,
        invoice,
        key,
        fromState: claimed.state,
        toState: record.state,
        attempt: claimed.attempts,
        errorCode: "validation_failed",
      }),
    );
    return { outcome: "invalid", code: "validation_failed", issues: mapped.issues, record };
  }

  const sending = markSending(claimed, { now, leaseMs });
  if (!sending.ok) return { outcome: "blocked", code: sending.code };

  const sendingSave = await store.cas(key, claimed.version, sending.next);
  if (!sendingSave.ok) return { outcome: "conflict", code: "cas_conflict", record: sendingSave.current };
  claimed = sending.next;

  let classification;
  try {
    classification = classifyMeritResponse(await adapter.sendInvoice(mapped.payload));
  } catch (error) {
    classification = classifyTransportError(error);
  }

  const settled = applyResult(claimed, classification, { now });
  const saved = await store.cas(key, claimed.version, settled);
  const record = saved.ok ? settled : saved.current;

  await store.appendAudit(
    baseEvent({
      action: actionFor(classification),
      actor,
      invoice,
      key,
      fromState: claimed.state,
      toState: record.state,
      attempt: claimed.attempts,
      errorCode: classification.code,
      providerDocumentId: record.provider_document_id,
      providerDocumentNo: record.provider_document_no,
    }),
  );

  return { outcome: record.state, code: classification.code, record };
}

/**
 * Resolve an ambiguous export by asking the provider what exists.
 *
 * This is the only path out of `needs_reconciliation`, and it never sends anything.
 */
export async function reconcileExport({ invoice, connection, store, adapter, actor = {}, now = Date.now() } = {}) {
  const access = authorizeAccess(actor, { connection, invoice });
  if (!access.ok) return { outcome: "blocked", code: access.code };

  const key = exportKey(invoice);
  const current = (await store.get(key)) || initialRecord(key);

  if (current.state !== EXPORT_STATES.NEEDS_RECONCILIATION) {
    return { outcome: "blocked", code: "not_awaiting_reconciliation", record: current };
  }

  let response;
  try {
    response = await adapter.lookupByInvoiceNo(invoice.number);
  } catch {
    // A failed lookup proves nothing. Stay put rather than guess.
    return { outcome: EXPORT_STATES.NEEDS_RECONCILIATION, code: "lookup_failed", record: current };
  }

  const decision = reconcileLookup({ matches: parseLookupMatches(response), expected: { total: invoice.total } });

  if (decision.outcome === RECONCILE_OUTCOMES.FOUND) {
    const resolved = resolveAsExported(current, { document: decision.document, now });
    if (!resolved.ok) return { outcome: "conflict", code: resolved.code, record: current };
    const saved = await store.cas(key, current.version, resolved.next);
    const record = saved.ok ? resolved.next : saved.current;
    await store.appendAudit({
      ...baseEvent({
        actor,
        invoice,
        key,
        fromState: current.state,
        toState: record.state,
        attempt: current.attempts,
        providerDocumentId: record.provider_document_id,
        providerDocumentNo: record.provider_document_no,
      }),
      action: AUDIT_ACTIONS.RECONCILE_FOUND,
    });
    return { outcome: EXPORT_STATES.EXPORTED, code: null, record, document: decision.document };
  }

  if (decision.outcome === RECONCILE_OUTCOMES.ABSENT) {
    const resolved = resolveAsAbsent(current, { now });
    if (!resolved.ok) return { outcome: "conflict", code: resolved.code, record: current };
    const saved = await store.cas(key, current.version, resolved.next);
    const record = saved.ok ? resolved.next : saved.current;
    await store.appendAudit({
      ...baseEvent({
        actor,
        invoice,
        key,
        fromState: current.state,
        toState: record.state,
        attempt: current.attempts,
        errorCode: "absent_confirmed",
      }),
      action: AUDIT_ACTIONS.RECONCILE_ABSENT,
    });
    return { outcome: EXPORT_STATES.FAILED_RETRYABLE, code: "absent_confirmed", record };
  }

  // A conflicting lookup needs a human: adopt nothing, delete nothing, retry nothing.
  await store.appendAudit({
    ...baseEvent({
      actor,
      invoice,
      key,
      fromState: current.state,
      toState: current.state,
      attempt: current.attempts,
      errorCode: decision.code,
    }),
    action: AUDIT_ACTIONS.RECONCILE_CONFLICT,
  });

  return { outcome: EXPORT_STATES.NEEDS_RECONCILIATION, code: decision.code, record: current };
}