/**
 * Pure Stage-A protocol. These Invoice metadata fields are a PROPOSED model,
 * not deployed Base44 fields. No SDK, persistence, randomness, clock or network.
 * All writers must participate in the shared accounting_revision CAS contract.
 */
import { expectedDocument, reconcileResponse, RECONCILE_OUTCOMES } from "./reconciliation.js";

export const CLAIM_STATES = Object.freeze({
  PREPARING: "preparing",
  PREPARATION_FAILED: "preparation_failed",
  SENDING: "sending",
  NEEDS_RECONCILIATION: "needs_reconciliation",
  EXPORTED: "exported",
  ABORTED: "aborted_before_send",
});

// Providers must be explicitly registered before admission/cancellation can support them.
// The permanent reference and original timestamps reuse the existing flat Invoice names.
export const MERIT_FIELDS = Object.freeze(Object.fromEntries([
  "ref", "at", "connection_id", "recovered_at", "binding", "state", "attempt_token",
  "attempt_number", "lease_expires_at", "send_authorized_at", "provider_document_id", "error_code",
].map((name) => [name, `claim_merit_sendinvoice_${name}`])));

export const BINDING_FIELDS = Object.freeze([
  "companyId", "provider", "connectionId", "connectionRevision", "environment", "region", "ledgerId", "bindingId",
]);
const text = (value) => typeof value === "string" && value.trim() === value && value.length > 0 && value.length <= 200;
const integer = (value) => Number.isSafeInteger(value) && value >= 0;
export const revisionValue = (value) => value == null ? 0 : value;
const deny = (code) => Object.freeze({ ok: false, code });
const empty = (value) => value == null || value === "";

function frozenCopy(value) {
  const copy = structuredClone(value);
  function freeze(item) {
    if (item && typeof item === "object") {
      Object.values(item).forEach(freeze);
      Object.freeze(item);
    }
  }
  freeze(copy);
  return copy;
}

export function sameBinding(left, right) {
  return validBinding(left) && validBinding(right) && BINDING_FIELDS.every((key) => left[key] === right[key]);
}

export function validBinding(binding) {
  return Boolean(binding && typeof binding === "object" && !Array.isArray(binding) &&
    Object.keys(binding).length === BINDING_FIELDS.length &&
    BINDING_FIELDS.every((key) => key === "connectionRevision" ? integer(binding[key]) : text(binding[key])) &&
    binding.provider === "merit" && ["test", "live"].includes(binding.environment));
}

export function claimIdentity(invoice, provider = "merit") {
  return `${invoice.company_id}:${invoice.id}:${provider}:invoice`;
}

function access(invoice, actor, binding) {
  if (!text(actor?.userId)) return "unauthenticated";
  if (!["owner", "admin"].includes(actor.role)) return "forbidden_role";
  if (!text(invoice?.id) || !text(invoice?.company_id)) return "invalid_invoice";
  if (actor.companyId !== invoice.company_id) return "forbidden_company";
  if (!integer(revisionValue(invoice.accounting_revision)) || !integer(revisionValue(invoice.revision)) ||
      revisionValue(invoice.accounting_revision) >= Number.MAX_SAFE_INTEGER ||
      revisionValue(invoice.revision) >= Number.MAX_SAFE_INTEGER) return "invalid_revision";
  if (binding !== undefined && (!validBinding(binding) || binding.companyId !== invoice.company_id)) return "invalid_binding";
  if (Object.keys(invoice).some((key) => key.startsWith("claim_") &&
      !Object.values(MERIT_FIELDS).includes(key) && !empty(invoice[key]))) return "unsupported_claim_metadata";
  return null;
}

function validTime(now, leaseMs) {
  return integer(now) && now > 0 && integer(leaseMs) && leaseMs > 0 &&
    Number.isSafeInteger(now + leaseMs) && now + leaseMs <= 8640000000000000;
}

export function createExportCandidate({ invoice, actor, binding, exportId }) {
  const error = access(invoice, actor, binding);
  if (error) return deny(error);
  if (!validBinding(binding) || !text(exportId)) return deny("invalid_candidate");
  return frozenCopy({ ok: true, row: {
    id: exportId, company_id: invoice.company_id, invoice_id: invoice.id, provider: binding.provider,
    kind: "invoice", export_key: claimIdentity(invoice), binding,
    source_revision: invoice.revision ?? null,
  } });
}

function validRow(invoice, binding, row) {
  return row && text(row.id) && row.company_id === invoice.company_id && row.invoice_id === invoice.id &&
    row.provider === binding.provider && row.kind === "invoice" && row.export_key === claimIdentity(invoice) &&
    row.source_revision === (invoice.revision ?? null) && sameBinding(row.binding, binding);
}

function scope(invoice, actor, binding, row) {
  const error = access(invoice, actor, binding);
  if (error) return error;
  if (!validBinding(binding) || !validRow(invoice, binding, row)) return "invalid_candidate";
  if (invoice[MERIT_FIELDS.ref] !== row.id) return "noncanonical_export";
  if (!sameBinding(invoice[MERIT_FIELDS.binding], binding) || invoice[MERIT_FIELDS.connection_id] !== binding.connectionId) return "destination_mismatch";
  return null;
}

function coherentClaim(invoice) {
  const f = MERIT_FIELDS;
  return text(invoice[f.ref]) && text(invoice[f.at]) && text(invoice[f.attempt_token]) &&
    integer(invoice[f.attempt_number]) && invoice[f.attempt_number] > 0 &&
    Object.values(CLAIM_STATES).includes(invoice[f.state]);
}

function owns(invoice, ownership) {
  return ownership && ownership.claimRef === invoice[MERIT_FIELDS.ref] &&
    ownership.attemptToken === invoice[MERIT_FIELDS.attempt_token] &&
    ownership.attemptNumber === invoice[MERIT_FIELDS.attempt_number];
}

function transition(invoice, kind, patch) {
  const f = MERIT_FIELDS;
  return frozenCopy({ ok: true, kind, binding: patch[f.binding] ?? invoice[f.binding] ?? null, command: {
    // Scalar id, exact predicates only. Missing-as-null is a MOCK convention;
    // a Base44 implementation must separately prove its legacy-field semantics.
    where: {
      id: invoice.id, company_id: invoice.company_id, status: invoice.status,
      revision: invoice.revision ?? null, accounting_revision: invoice.accounting_revision ?? null,
      [f.ref]: invoice[f.ref] ?? null, [f.state]: invoice[f.state] ?? null,
      [f.attempt_token]: invoice[f.attempt_token] ?? null,
      [f.attempt_number]: invoice[f.attempt_number] ?? null,
      [f.send_authorized_at]: invoice[f.send_authorized_at] ?? null,
    },
    patch: { ...patch, accounting_revision: revisionValue(invoice.accounting_revision) + 1 },
  } });
}

export function acquireClaim({ invoice, actor, binding, exportRow, attemptToken, now, leaseMs = 60000 }) {
  const error = access(invoice, actor, binding);
  if (error) return deny(error);
  if (!validBinding(binding) || !validRow(invoice, binding, exportRow)) return deny("invalid_candidate");
  if (invoice.status !== "issued") return deny("not_issued");
  if (!empty(invoice[MERIT_FIELDS.ref])) return deny("already_claimed");
  if (Object.values(MERIT_FIELDS).some((key) => key !== MERIT_FIELDS.ref && !empty(invoice[key]))) return deny("inconsistent_claim");
  if (!text(attemptToken) || !validTime(now, leaseMs)) return deny("invalid_attempt");
  const f = MERIT_FIELDS;
  return transition(invoice, "acquire", {
    [f.ref]: exportRow.id, [f.at]: new Date(now).toISOString(), [f.connection_id]: binding.connectionId,
    [f.binding]: binding, [f.state]: CLAIM_STATES.PREPARING, [f.attempt_token]: attemptToken,
    [f.attempt_number]: 1, [f.lease_expires_at]: now + leaseMs,
    [f.send_authorized_at]: null, [f.error_code]: null,
  });
}

export function authorizeSend({ invoice, actor, binding, exportRow, ownership, now, leaseMs = 60000 }) {
  const error = scope(invoice, actor, binding, exportRow);
  if (error) return deny(error);
  const f = MERIT_FIELDS;
  if (!coherentClaim(invoice)) return deny("inconsistent_claim");
  if (!empty(invoice[f.send_authorized_at])) return deny("send_already_authorized");
  if (!owns(invoice, ownership)) return deny("stale_worker");
  if (invoice.status !== "issued" || invoice[f.state] !== CLAIM_STATES.PREPARING) return deny("not_preparing");
  if (!validTime(now, leaseMs) || !integer(invoice[f.lease_expires_at]) || now >= invoice[f.lease_expires_at]) return deny("preparation_expired");
  return transition(invoice, "authorize_send", {
    [f.state]: CLAIM_STATES.SENDING, [f.send_authorized_at]: new Date(now).toISOString(),
    [f.lease_expires_at]: now + leaseMs,
  });
}

export function recoverClaim({ invoice, actor, binding, exportRow, now }) {
  const error = scope(invoice, actor, binding, exportRow);
  if (error) return deny(error);
  const f = MERIT_FIELDS;
  if (!coherentClaim(invoice) || invoice.status !== "issued") return deny("inconsistent_claim");
  if (!integer(now) || now <= 0 || now > 8640000000000000 ||
      !integer(invoice[f.lease_expires_at]) || now < invoice[f.lease_expires_at]) return deny("lease_not_expired");
  let state;
  if (invoice[f.state] === CLAIM_STATES.PREPARING && empty(invoice[f.send_authorized_at])) state = CLAIM_STATES.PREPARATION_FAILED;
  else if (invoice[f.state] === CLAIM_STATES.SENDING && !empty(invoice[f.send_authorized_at])) state = CLAIM_STATES.NEEDS_RECONCILIATION;
  else return deny("inconsistent_claim");
  return transition(invoice, "recover", {
    [f.state]: state, [f.lease_expires_at]: null,
    [f.error_code]: state === CLAIM_STATES.PREPARATION_FAILED ? "preparation_abandoned" : "send_outcome_unknown",
    ...(empty(invoice[f.recovered_at]) ? { [f.recovered_at]: new Date(now).toISOString() } : {}),
  });
}

export function resumePreparation({ invoice, actor, binding, exportRow, retryApproved, attemptToken, now, leaseMs = 60000 }) {
  const error = scope(invoice, actor, binding, exportRow);
  if (error) return deny(error);
  const f = MERIT_FIELDS;
  if (!coherentClaim(invoice)) return deny("inconsistent_claim");
  // This marker is irreversible, even after a complete authoritative empty lookup.
  if (!empty(invoice[f.send_authorized_at])) return deny("send_already_authorized");
  if (invoice.status !== "issued" || invoice[f.state] !== CLAIM_STATES.PREPARATION_FAILED) return deny("not_pre_send_failure");
  if (retryApproved !== true) return deny("explicit_retry_required");
  if (!text(attemptToken) || attemptToken === invoice[f.attempt_token] || !validTime(now, leaseMs) ||
      invoice[f.attempt_number] >= Number.MAX_SAFE_INTEGER) return deny("invalid_attempt");
  return transition(invoice, "resume_preparation", {
    [f.state]: CLAIM_STATES.PREPARING, [f.attempt_token]: attemptToken,
    [f.attempt_number]: invoice[f.attempt_number] + 1, [f.lease_expires_at]: now + leaseMs, [f.error_code]: null,
  });
}

export function cancelInvoice({ invoice, actor, now }) {
  const error = access(invoice, actor);
  if (error) return deny(error);
  if (!["draft", "issued"].includes(invoice.status)) return deny("not_cancellable");
  if (!integer(now) || now <= 0 || now > 8640000000000000) return deny("invalid_time");
  const f = MERIT_FIELDS;
  const hasClaim = !empty(invoice[f.ref]);
  if (!hasClaim && Object.values(f).some((key) => !empty(invoice[key]))) return deny("inconsistent_claim");
  if (hasClaim) {
    if (!coherentClaim(invoice) || !validBinding(invoice[f.binding]) || invoice[f.binding].companyId !== invoice.company_id ||
        invoice[f.connection_id] !== invoice[f.binding].connectionId) return deny("inconsistent_claim");
    if (invoice[f.state] === CLAIM_STATES.EXPORTED) return deny("correction_required");
    if (!empty(invoice[f.send_authorized_at]) || ![CLAIM_STATES.PREPARING, CLAIM_STATES.PREPARATION_FAILED].includes(invoice[f.state])) return deny("accounting_outcome_unresolved");
  }
  return transition(invoice, "cancel", {
    status: "cancelled", cancelled_at: new Date(now).toISOString(), revision: revisionValue(invoice.revision) + 1,
    ...(hasClaim ? { [f.state]: CLAIM_STATES.ABORTED, [f.lease_expires_at]: null } : {}),
  });
}

/** Uses FIX-1 evidence validation, but NEVER reopens sending on confirmed absence. */
export function reconcileClaim({ invoice, actor, binding, exportRow, response }) {
  const error = scope(invoice, actor, binding, exportRow);
  if (error) return deny(error);
  const f = MERIT_FIELDS;
  if (!coherentClaim(invoice) || invoice[f.state] !== CLAIM_STATES.NEEDS_RECONCILIATION ||
      empty(invoice[f.send_authorized_at])) return deny("not_awaiting_reconciliation");
  const decision = reconcileResponse(response, expectedDocument(invoice));
  if (decision.outcome === RECONCILE_OUTCOMES.ABSENT) return deny("sender_quiescence_unproven");
  if (decision.outcome !== RECONCILE_OUTCOMES.FOUND) return deny(decision.code);
  return transition(invoice, "reconcile_found", {
    [f.state]: CLAIM_STATES.EXPORTED, [f.provider_document_id]: decision.document.id, [f.error_code]: null,
  });
}
