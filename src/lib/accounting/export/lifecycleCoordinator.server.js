/**
 * UNWIRED server-only orchestration; no Base44 SDK or transport implementation.
 * Ports are trusted server dependencies, never client input. See the integration
 * contract for real authentication/membership/atomicity requirements.
 */
import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { acquireClaim, authorizeSend, cancelInvoice, recoverClaim, resumePreparation, reconcileClaim, MERIT_FIELDS as f } from "./claimProtocol.js";
import { commitClaimDecision } from "./claimPort.js";
import { withPendingAudit, inspectPending, auditProjection, projectionMatches, clearVerifiedPending, freezeCopy } from "./auditOutbox.js";

const operations = { acquire: acquireClaim, authorize_send: authorizeSend, cancel: cancelInvoice,
  recover: recoverClaim, resume_preparation: resumePreparation, reconcile: reconcileClaim };
const fail = (code) => Object.assign(new Error(code), { code });
const blocked = (code) => ({ outcome: "blocked", code, sendPermit: null });

/**
 * port.loadAuthorized({invoiceId, exportId?}) -> {invoice, actor, binding?, exportRow?}
 * port.compareAndSet({where, patch, unset?, expectedPendingEvent?}) -> Stage-A write result
 * port.findAuditProjections(scope) -> {items, complete:true, nextCursor:null}
 * port.createAuditProjection(payload) -> {status:'applied', id}|{status:'unknown'|'conflict'}
 * port.readAuditProjection({id, companyId, invoiceId}) -> persisted immutable row|null
 * Every port operation must authenticate/authorize and enforce the same tenant.
 */
export function createLifecycleCoordinator({ port, clock = Date.now, newToken = randomUUID, lookupEvidence = null } = {}) {
  if (!port || typeof port.loadAuthorized !== "function") throw fail("trusted_server_port_required");
  const plans = new WeakMap(), workers = new WeakMap();

  async function load(input) {
    const current = await port.loadAuthorized({ invoiceId: input.invoiceId, exportId: input.exportId });
    if (!current?.actor?.userId || !["owner", "admin"].includes(current.actor.role) ||
        !current.invoice || current.invoice.id !== input.invoiceId || current.actor.companyId !== current.invoice.company_id) throw fail("forbidden");
    return current;
  }

  function decide(operation, current, owner, input, now, response) {
    const raw = operations[operation]({ ...current, now, ownership: owner?.ownership, attemptToken: owner?.token,
      retryApproved: input.retryApproved, response });
    return withPendingAudit({ invoice: current.invoice, decision: raw, now });
  }

  async function prepare(operation, input) {
    if (!Object.hasOwn(operations, operation) || !input || Object.getPrototypeOf(input) !== Object.prototype ||
        Object.keys(input).some((key) => !["invoiceId", "exportId", "worker", "retryApproved"].includes(key))) throw fail("invalid_intent");
    const current = await load(input);
    if (inspectPending(current.invoice).status !== "empty") return { decision: { ok: false, code: "audit_pending_or_invalid" }, worker: null };
    let owner;
    if (operation === "authorize_send") {
      owner = workers.get(input.worker);
      if (!owner?.active || owner.invoiceId !== input.invoiceId || owner.userId !== current.actor.userId ||
          owner.companyId !== current.actor.companyId) throw fail("worker_not_authorized");
    } else if (["acquire", "resume_preparation"].includes(operation)) owner = { token: newToken(), active: false };
    const now = clock();
    const response = operation === "reconcile" && typeof lookupEvidence === "function"
      ? await lookupEvidence({ invoice: structuredClone(current.invoice), binding: structuredClone(current.binding) }) : undefined;
    const decision = decide(operation, current, owner, input, now, response);
    let worker = null;
    if (decision.ok) {
      if (["acquire", "resume_preparation"].includes(operation)) {
        worker = Object.freeze({});
        Object.assign(owner, { invoiceId: input.invoiceId, userId: current.actor.userId, companyId: current.actor.companyId,
          ownership: { claimRef: decision.command.patch[f.ref] ?? decision.command.where[f.ref],
            attemptToken: decision.command.patch[f.attempt_token], attemptNumber: decision.command.patch[f.attempt_number] } });
        workers.set(worker, owner);
      }
    }
    const plan = Object.freeze({ decision, worker });
    plans.set(plan, { operation, input: { ...input }, owner, now, response: structuredClone(response), userId: current.actor.userId, companyId: current.actor.companyId });
    return plan;
  }

  async function commit(plan) {
    const prepared = plans.get(plan);
    if (!prepared) return blocked("untrusted_or_consumed_plan");
    plans.delete(plan);
    if (!plan.decision.ok) return blocked(plan.decision.code);
    if (prepared.operation === "authorize_send") {
      if (!prepared.owner.active) return blocked("worker_consumed");
      prepared.owner.active = false;
    }
    try {
      const current = await load(prepared.input);
      if (prepared.userId !== current.actor.userId || prepared.companyId !== current.actor.companyId) return blocked("actor_changed");
      const fresh = decide(prepared.operation, current, prepared.owner, prepared.input, prepared.now, prepared.response);
      if (!fresh.ok || !isDeepStrictEqual(fresh, plan.decision)) return { outcome: "conflict", code: "head_or_outbox_changed", sendPermit: null };
      const actualNow = clock();
      if (["acquire", "authorize_send", "resume_preparation"].includes(prepared.operation) &&
          (!Number.isSafeInteger(actualNow) || actualNow < prepared.now || actualNow >= fresh.command.patch[f.lease_expires_at] ||
            (prepared.operation === "authorize_send" && actualNow >= current.invoice[f.lease_expires_at]))) return blocked("lease_expired");
      const result = await commitClaimDecision(port, fresh);
      if (result.outcome === "applied" && ["acquire", "resume_preparation"].includes(prepared.operation)) prepared.owner.active = true;
      return { ...result, audit: result.outcome === "applied" ? "pending_on_invoice" : "unverified", projectionConfirmed: false };
    } catch { return { outcome: "unknown", code: "write_or_authorization_unverified", sendPermit: null, audit: "unverified" }; }
  }

  async function projectAudit(input) {
    if (!input || Object.keys(input).some((key) => key !== "invoiceId")) return blocked("invalid_intent");
    try {
      const current = await load(input);
      const pending = inspectPending(current.invoice);
      if (pending.status === "empty") return { outcome: "idle", sendPermit: null };
      if (pending.status !== "pending") return blocked("invalid_pending_audit");
      const event = pending.event, payload = auditProjection(current.invoice, event);
      const scope = { companyId: current.invoice.company_id, invoiceId: current.invoice.id, eventKey: event.event_key };
      const found = await port.findAuditProjections(scope);
      if (found?.complete !== true || found.nextCursor !== null || !Array.isArray(found.items) ||
          found.items.some((row) => !projectionMatches(row, payload))) return blocked("audit_search_incomplete_or_conflicting");
      let id = found.items[0]?.id;
      if (!id) {
        const created = await port.createAuditProjection(payload);
        if (created?.status !== "applied" || typeof created.id !== "string") return { outcome: "unknown", code: "audit_create_unverified", sendPermit: null };
        id = created.id;
      }
      // Independent persisted read is mandatory, even after an apparently successful create.
      const verified = await port.readAuditProjection({ ...scope, id });
      if (!projectionMatches(verified, payload)) return blocked("audit_readback_unverified");
      const latest = await load(input);
      const clear = clearVerifiedPending(latest.invoice, event);
      if (!clear.ok) return { outcome: "conflict", code: clear.code, sendPermit: null };
      const result = await port.compareAndSet(clear.command);
      if (result?.status === "conflict" && result.updated === 0) return { outcome: "conflict", code: "audit_clear_conflict", sendPermit: null };
      const expectedInvoice = { ...latest.invoice, ...clear.command.patch };
      delete expectedInvoice.accounting_pending_event;
      if (result?.status !== "applied" || result.updated !== 1 ||
          !isDeepStrictEqual(result.invoice, expectedInvoice)) {
        return { outcome: "unknown", code: "audit_clear_unverified", sendPermit: null };
      }
      return freezeCopy({ outcome: "projected", eventKey: event.event_key, projectionConfirmed: true, sendPermit: null });
    } catch { return { outcome: "unknown", code: "audit_projection_unverified", sendPermit: null }; }
  }

  return Object.freeze({ prepare, commit, projectAudit });
}
