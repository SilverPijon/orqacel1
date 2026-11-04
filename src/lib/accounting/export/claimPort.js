/**
 * Stage-A persistence port. No Base44 implementation and no sending endpoint.
 *
 * getInvoice({id, companyId}) -> detached Invoice|null, strictly tenant scoped.
 * createCandidate(row) -> {status: 'applied', row}|{status: 'unknown'}.
 * getCandidate({id, companyId}) -> detached candidate|null.
 * compareAndSet(command) -> {status: 'applied', updated: 1, invoice}
 *                       | {status: 'conflict', updated: 0, invoice|null}
 *                       | {status: 'unknown'}.
 *
 * Commands contain scalar id + exact expected predicates and an allowlisted patch.
 * No upsert, broad query, $inc, claim-by-export-key, or cross-record transaction.
 * A future Base44 store must prove scalar-id CAS and legacy/null semantics in an
 * isolated app. It must not infer write success from a subsequent read.
 */
import { MERIT_FIELDS, CLAIM_STATES, sameBinding, validBinding } from "./claimProtocol.js";

/**
 * @typedef {{where: Object, patch: Object}} InvoiceClaimCommand
 * @typedef {{status: 'applied', updated: 1, invoice: Object} |
 *   {status: 'conflict', updated: 0, invoice: Object|null} |
 *   {status: 'unknown'}} InvoiceClaimWriteResult
 * @typedef {Object} InvoiceClaimPort
 * @property {function({id: string, companyId: string}): (Object|null|Promise<Object|null>)} getInvoice
 * @property {function(Object): Promise<Object>} createCandidate
 * @property {function({id: string, companyId: string}): (Object|null|Promise<Object|null>)} getCandidate
 * @property {function(InvoiceClaimCommand): Promise<InvoiceClaimWriteResult>} compareAndSet
 *
 * Never replay a cached applied acknowledgement for a new invocation. An adapter
 * must not retry a send or reconstruct a send permit after an uncertain write.
 */

/** Interpret acknowledgements only; an unknown result never grants permission. */
export async function commitClaimDecision(port, decision) {
  if (!decision?.ok) return { outcome: "blocked", code: decision?.code ?? "invalid_decision", sendPermit: null };
  const f = MERIT_FIELDS;
  const { where, patch } = decision.command ?? {};
  if (!where || !patch || !["acquire", "authorize_send", "cancel", "recover", "resume_preparation", "reconcile_found"].includes(decision.kind) ||
      (decision.kind === "authorize_send" && (where[f.state] !== CLAIM_STATES.PREPARING ||
        (where[f.send_authorized_at] != null && where[f.send_authorized_at] !== "") ||
        patch[f.state] !== CLAIM_STATES.SENDING || typeof patch[f.send_authorized_at] !== "string" ||
        !patch[f.send_authorized_at] || !validBinding(decision.binding)))) {
    return { outcome: "blocked", code: "invalid_decision", sendPermit: null };
  }
  let result;
  try {
    result = await port.compareAndSet(decision.command);
  } catch {
    return { outcome: "unknown", code: "write_outcome_unknown", sendPermit: null };
  }
  if (result?.status === "conflict" && result.updated === 0) {
    return { outcome: "conflict", code: "cas_conflict", invoice: result.invoice ?? null, sendPermit: null };
  }
  if (result?.status !== "applied" || result.updated !== 1 || result.invoice?.id !== where.id ||
      result.invoice?.company_id !== where.company_id ||
      (result.invoice[f.ref] ?? null) !== (patch[f.ref] ?? where[f.ref]) ||
      (decision.binding !== null && !sameBinding(decision.binding, result.invoice[f.binding])) ||
      Object.entries(patch).some(([key, value]) => JSON.stringify(result.invoice[key]) !== JSON.stringify(value))) {
    return { outcome: "unknown", code: "write_outcome_unknown", sendPermit: null };
  }
  return {
    outcome: "applied", code: null, invoice: result.invoice,
    // A diagnostic capability for a future caller, not an actual network dispatcher.
    // Issued only for the one acknowledged transition. Never reconstructed from reads.
    sendPermit: decision.kind === "authorize_send" ? Object.freeze({
      invoiceId: where.id, companyId: where.company_id, claimRef: patch[f.ref] ?? where[f.ref],
      attemptToken: where[f.attempt_token], attemptNumber: where[f.attempt_number],
      binding: Object.freeze(structuredClone(result.invoice[f.binding])),
    }) : null,
  };
}
