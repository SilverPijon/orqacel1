/** Pure preparation contracts. SDK shape is modeled, Base44 semantics remain UNVERIFIED. */
import { isDeepStrictEqual } from "node:util";
import { MERIT_FIELDS as f, revisionValue, sameBinding } from "./claimProtocol.js";
import { invoiceHead, inspectPending, freezeCopy } from "./auditOutbox.js";

const text = (value) => typeof value === "string" && value.trim() === value && value.length > 0 && value.length <= 200;
const integer = (value) => Number.isSafeInteger(value) && value >= 0;
const fail = (code) => Object.assign(new Error(code), { code });
const patchFields = new Set(["status", "revision", "cancelled_at", "accounting_revision", "accounting_pending_event", ...Object.values(f)]);

export function deriveServerAuthority(session) {
  if (!text(session?.user?.id) || session.userRecord?.id !== session.user.id) throw fail("unauthenticated");
  const companyId = session.userRecord.active_company_id;
  if (!text(companyId) || session.complete !== true || !Array.isArray(session.memberships) || session.nextCursor !== null) throw fail("membership_unverified");
  const matches = session.memberships.filter((m) => m.user_id === session.user.id && m.company_id === companyId && m.status === "active");
  if (matches.some((m) => !text(m.id) || !Number.isFinite(Date.parse(m.created_date)))) throw fail("membership_unverified");
  matches.sort((a, b) => Date.parse(a.created_date) - Date.parse(b.created_date) || a.id.localeCompare(b.id));
  if (!["owner", "admin"].includes(matches[0]?.role)) throw fail("forbidden_role");
  return freezeCopy({ userId: session.user.id, companyId, role: matches[0].role });
}

export function classifyCASAcknowledgement(ack) {
  if (ack?.success !== true || ack.has_more !== false || typeof ack.updated !== "number") return "unknown";
  return ack.updated === 1 ? "applied" : ack.updated === 0 ? "conflict" : "unknown";
}

/** Compile only accounting/cancellation/clear commands, NEVER arbitrary financial edits. */
export function compileInvoiceCAS(invoice, command) {
  if (!invoice || !text(invoice.id) || !text(invoice.company_id) || !command?.where || !command.patch) throw fail("invalid_command");
  const { where, patch, unset = [] } = command;
  const head = invoiceHead(invoice);
  const clearing = unset.length === 1 && unset[0] === "accounting_pending_event";
  const expectedWhere = clearing ? head : { ...head, accounting_pending_event: null };
  if (!isDeepStrictEqual(where, expectedWhere) || typeof where.id !== "string") throw fail("stale_or_broad_predicate");
  if (!integer(revisionValue(invoice.revision)) || !integer(revisionValue(invoice.accounting_revision)) ||
      !integer(patch.accounting_revision) || patch.accounting_revision !== revisionValue(invoice.accounting_revision) + 1 ||
      Object.keys(patch).some((key) => !patchFields.has(key))) throw fail("unsafe_patch");
  for (const key of [f.ref, f.at, f.connection_id, f.binding, f.send_authorized_at, f.recovered_at]) {
    if (invoice[key] != null && invoice[key] !== "" && key in patch && !isDeepStrictEqual(invoice[key], patch[key])) throw fail("immutable_claim_changed");
  }
  const next = { ...structuredClone(invoice), ...structuredClone(patch) };
  if (clearing) {
    if (Object.keys(patch).length !== 1 || inspectPending(invoice).status !== "pending" ||
        !isDeepStrictEqual(command.expectedPendingEvent, invoice.accounting_pending_event)) throw fail("pending_event_changed");
    delete next.accounting_pending_event;
  } else {
    if (unset.length || inspectPending(invoice).status !== "empty" || inspectPending(next).status !== "pending") throw fail("pending_audit_unprotected");
    if ("revision" in patch && patch.status !== "cancelled") throw fail("financial_revision_not_allowed");
    if ("status" in patch && (patch.status !== "cancelled" || !["draft", "issued"].includes(invoice.status) ||
        patch.revision !== revisionValue(invoice.revision) + 1 || invoice[f.send_authorized_at])) throw fail("unsafe_cancellation");
    if (patch[f.state] === "sending" && (invoice.status !== "issued" || invoice[f.state] !== "preparing" ||
        invoice[f.send_authorized_at] || !text(patch[f.send_authorized_at]))) throw fail("replacement_authorization");
    if (invoice[f.binding] && patch[f.binding] && !sameBinding(invoice[f.binding], patch[f.binding])) throw fail("destination_changed");
  }
  return freezeCopy({
    query: where, update: { $set: patch, ...(clearing ? { $unset: { accounting_pending_event: "" } } : {}) },
    expectedInvoice: next, clearing,
    platformStatus: "UNVERIFIED",
    requiredEvidence: clearing ? ["scalar_id_cas", "whole_field_unset", "strict_ack", "immutable_projection_readback"]
      : ["scalar_id_cas", "missing_null_equality", "atomic_patch_and_outbox", "strict_ack"],
  });
}

/** Advisory specs only: no create/edit/issue/delete/restore command is enabled. */
export function lifecycleIntegrationSpec(operation, invoice) {
  if (!["create", "edit", "issue", "cancel", "delete", "restore"].includes(operation)) throw fail("unsupported_lifecycle_operation");
  const requirements = {
    create: ["pre_create_operation_identity", "atomic_creation_and_audit", "server_derived_number_and_snapshots"],
    edit: ["draft_only", "financial_and_accounting_fence", "empty_outbox", "audited_financial_patch_allowlist"],
    issue: ["draft_only", "financial_and_accounting_fence", "empty_outbox", "atomic_snapshot_freeze_and_audit"],
    cancel: ["shared_claim_and_outbox_gate", "no_authorized_send", "unambiguous_cas_ack"],
    delete: ["draft_only", "no_claim_or_pending_evidence", "fenced_delete_identity", "durable_tombstone_and_audit_retention"],
    restore: ["server_owned_delete_identity", "exact_tombstone_generation", "both_revision_fences", "no_claim_or_pending_evidence"],
  };
  let blocker = "active_handler_not_integrated";
  if (operation !== "create") {
    if (!invoice || !text(invoice.id) || !text(invoice.company_id)) blocker = "invalid_invoice";
    else if (inspectPending(invoice).status !== "empty") blocker = "audit_pending_or_invalid";
    else if (invoice[f.send_authorized_at]) blocker = "authorized_export_requires_resolution_or_correction";
    else if (["edit", "issue", "delete"].includes(operation) && invoice.status !== "draft") blocker = "financial_record_locked";
    else if (["delete", "restore"].includes(operation) && Object.entries(invoice).some(([key, value]) => key.startsWith("claim_") && value != null && value !== "")) blocker = "accounting_claim_present";
    else if (operation === "delete") blocker = "fenced_delete_protocol_missing";
    else if (operation === "restore") blocker = "fenced_compensation_protocol_missing";
  } else blocker = "pre_create_identity_unresolved";
  return freezeCopy({ operation, activationReady: false, canPhysicallyDelete: false, blocker, requirements: requirements[operation], platformStatus: "UNVERIFIED" });
}
