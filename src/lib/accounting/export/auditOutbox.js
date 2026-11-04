/** Bounded single-slot protocol. No persistence, clock, network or event-table authority. */
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { MERIT_FIELDS as f, revisionValue } from "./claimProtocol.js";

export const MAX_PENDING_EVENT_BYTES = 1024;
const fields = new Set(["event_key", "claim_ref", "action", "provider", "from_revision", "to_revision", "occurred_at"]);
const actions = {
  acquire: "export_claimed", authorize_send: "export_send_authorized", cancel: "invoice_cancelled_before_send",
  resume_preparation: "export_preparation_resumed", reconcile_found: "reconcile_found",
};
const allowedActions = new Set([...Object.values(actions), "export_preparation_abandoned", "export_recovery_required"]);
const text = (value) => typeof value === "string" && value.trim() === value && value.length > 0 && value.length <= 200;
const integer = (value) => Number.isSafeInteger(value) && value >= 0;
const deny = (code) => ({ ok: false, code });
export function freezeCopy(value) {
  const copied = structuredClone(value);
  const freeze = (item) => { if (item && typeof item === "object") { Object.values(item).forEach(freeze); Object.freeze(item); } };
  freeze(copied); return copied;
}

export function eventIdentity(invoice, event) {
  return `invoice-audit:v1:${createHash("sha256").update(JSON.stringify([
    invoice.company_id, invoice.id, event.action, event.provider, event.claim_ref ?? null, event.from_revision, event.to_revision,
  ])).digest("hex")}`;
}

export function inspectPending(invoice) {
  const event = invoice?.accounting_pending_event;
  if (event == null) return { status: "empty" };
  if (typeof event !== "object" || Array.isArray(event) || Object.keys(event).some((key) => !fields.has(key)) ||
      !text(invoice?.id) || !text(invoice?.company_id) || !allowedActions.has(event.action) ||
      !integer(event.from_revision) || !integer(event.to_revision) || event.to_revision !== event.from_revision + 1 ||
      event.to_revision !== invoice.accounting_revision || !integer(event.occurred_at) || event.occurred_at <= 0 ||
      event.occurred_at > 8640000000000000 || !["merit", "invoice"].includes(event.provider)) return { status: "invalid" };
  const claim = invoice[f.ref];
  if (claim != null && claim !== "") {
    if (!text(claim) || event.claim_ref !== claim || event.provider !== "merit") return { status: "invalid" };
  } else if ("claim_ref" in event || event.provider !== "invoice") return { status: "invalid" };
  if (event.event_key !== eventIdentity(invoice, event) || Buffer.byteLength(JSON.stringify(event)) > MAX_PENDING_EVENT_BYTES) return { status: "invalid" };
  return { status: "pending", event: freezeCopy(event) };
}

export function invoiceHead(invoice) {
  return {
    id: invoice.id, company_id: invoice.company_id, status: invoice.status,
    revision: invoice.revision ?? null, accounting_revision: invoice.accounting_revision ?? null,
    [f.ref]: invoice[f.ref] ?? null, [f.state]: invoice[f.state] ?? null,
    [f.attempt_token]: invoice[f.attempt_token] ?? null, [f.attempt_number]: invoice[f.attempt_number] ?? null,
    [f.send_authorized_at]: invoice[f.send_authorized_at] ?? null,
  };
}

/** Attach the minimal event to the SAME Invoice CAS, never to an independent event create. */
export function withPendingAudit({ invoice, decision, now }) {
  if (!decision?.ok) return decision;
  if (inspectPending(invoice).status !== "empty") return deny("audit_pending_or_invalid");
  if (!isDeepStrictEqual(decision.command?.where, invoiceHead(invoice))) return deny("stale_or_invalid_head");
  const action = decision.kind === "recover"
    ? decision.command.patch[f.state] === "preparation_failed" ? "export_preparation_abandoned" : "export_recovery_required"
    : actions[decision.kind];
  if (!action || !integer(now) || now <= 0 || now > 8640000000000000) return deny("invalid_audit_transition");
  const claim = decision.command.patch[f.ref] ?? invoice[f.ref];
  const event = {
    action, provider: claim ? "merit" : "invoice", ...(claim ? { claim_ref: claim } : {}),
    from_revision: revisionValue(invoice.accounting_revision), to_revision: decision.command.patch.accounting_revision, occurred_at: now,
  };
  event.event_key = eventIdentity(invoice, event);
  const next = { ...invoice, ...decision.command.patch, accounting_pending_event: event };
  if (inspectPending(next).status !== "pending") return deny("invalid_audit_transition");
  return freezeCopy({ ...decision, command: {
    where: { ...decision.command.where, accounting_pending_event: null },
    patch: { ...decision.command.patch, accounting_pending_event: event },
  } });
}

/** Project only immutable facts actually captured in the authoritative slot. */
export function auditProjection(invoice, event) {
  if (inspectPending(invoice).status !== "pending" || !isDeepStrictEqual(event, invoice.accounting_pending_event)) throw new Error("invalid_pending_event");
  return freezeCopy({
    company_id: invoice.company_id, invoice_id: invoice.id, event_key: event.event_key, action: event.action,
    kind: "invoice", accounting_revision: event.to_revision, occurred_at: event.occurred_at,
    ...(event.provider === "merit" ? { provider: "merit", claim_ref: event.claim_ref, export_id: event.claim_ref } : {}),
  });
}

const serverFields = new Set(["id", "created_date", "updated_date", "created_by", "created_by_id", "is_sample"]);
export function projectionMatches(row, expected) {
  return Boolean(row && text(row.id) && Object.keys(row).every((key) => serverFields.has(key) || Object.hasOwn(expected, key)) &&
    Object.entries(expected).every(([key, value]) => isDeepStrictEqual(row[key], value)));
}

/** Housekeeping CAS, not a second logical transition; never grants send authority. */
export function clearVerifiedPending(invoice, expectedEvent) {
  const pending = inspectPending(invoice);
  if (pending.status !== "pending" || !isDeepStrictEqual(pending.event, expectedEvent) ||
      !integer(invoice.accounting_revision) || invoice.accounting_revision >= Number.MAX_SAFE_INTEGER) return deny("outbox_changed");
  return freezeCopy({ ok: true, command: {
    where: invoiceHead(invoice), patch: { accounting_revision: invoice.accounting_revision + 1 },
    unset: ["accounting_pending_event"], expectedPendingEvent: expectedEvent,
  } });
}
