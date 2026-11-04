/**
 * Offline single-process Invoice + projection model. No SDK, backend, credentials
 * or database guarantee. Authorization is synthetic trusted context, not RLS proof.
 */
import { isDeepStrictEqual } from "node:util";
import { MERIT_FIELDS as f, sameBinding, revisionValue } from "../export/claimProtocol.js";
import { invoiceHead, inspectPending, auditProjection, projectionMatches } from "../export/auditOutbox.js";

const copy = structuredClone;
const patchFields = new Set(["status", "revision", "cancelled_at", "accounting_revision", "accounting_pending_event", ...Object.values(f)]);
const faultModes = new Set(["reject", "unknown_before", "unknown_after", "throw_before", "throw_after", "pause_before", "pause_after", "incomplete", "missing", "ack_without_commit"]);

export function createLifecycleAuditStore({ invoices = [], candidates = [], events = [], context, projectionLimit = 16 } = {}) {
  const invoiceRows = new Map(invoices.map((row) => [row.id, copy(row)]));
  const exportRows = new Map(candidates.map((row) => [row.id, copy(row)]));
  const eventRows = new Map(events.map((row) => [row.id, copy(row)]));
  const faults = [], writes = [];
  let sequence = 0;
  function authorize() {
    if (!context?.userId || !["owner", "admin"].includes(context.role) || context.membershipActive !== true || !context.companyId) throw new Error("forbidden");
  }
  function faultFor(operation) {
    const index = faults.findIndex((fault) => fault.operation === operation);
    return index < 0 ? null : faults.splice(index, 1)[0];
  }
  async function before(fault) {
    if (fault?.mode === "pause_before") { fault.entered?.(); await fault.wait; }
    if (fault?.mode === "throw_before") throw new Error("synthetic interruption");
    return fault?.mode === "unknown_before";
  }
  async function after(fault, value) {
    if (fault?.mode === "pause_after") { fault.entered?.(); await fault.wait; }
    if (fault?.mode === "throw_after") throw new Error("synthetic lost acknowledgement");
    return fault?.mode === "unknown_after" ? { status: "unknown" } : copy(value);
  }
  function ownInvoice(id) {
    authorize();
    const row = invoiceRows.get(id);
    if (!row || row.company_id !== context.companyId) throw new Error("invoice_not_found");
    return row;
  }
  function scope(scope) {
    const invoice = ownInvoice(scope.invoiceId);
    if (scope.companyId !== context.companyId) throw new Error("forbidden_company");
    return invoice;
  }

  async function loadAuthorized({ invoiceId, exportId }) {
    const invoice = ownInvoice(invoiceId);
    const row = exportRows.get(exportId ?? invoice[f.ref]);
    if (row && row.company_id !== context.companyId) throw new Error("candidate_not_found");
    return copy({ invoice, actor: { userId: context.userId, role: context.role, companyId: context.companyId },
      binding: context.binding, exportRow: row });
  }

  async function compareAndSet(input) {
    const command = copy(input), fault = faultFor("invoice_cas");
    if (await before(fault)) return { status: "unknown" };
    authorize();
    const { where, patch, unset = [] } = command;
    const row = invoiceRows.get(where?.id);
    const conflict = () => ({ status: "conflict", updated: 0, invoice: null });
    if (!row || row.company_id !== context.companyId || where.company_id !== context.companyId ||
        typeof where.id !== "string" || !patch || fault?.mode === "reject") return conflict();
    const head = invoiceHead(row);
    if (Object.keys(head).some((key) => !Object.hasOwn(where, key) || !isDeepStrictEqual(where[key], head[key])) ||
        Object.keys(where).some((key) => !Object.hasOwn(head, key) && key !== "accounting_pending_event") ||
        Object.keys(patch).some((key) => !patchFields.has(key)) || !Number.isSafeInteger(patch.accounting_revision) ||
        patch.accounting_revision !== revisionValue(row.accounting_revision) + 1) return conflict();
    const clearing = unset.length === 1 && unset[0] === "accounting_pending_event";
    if (clearing) {
      if (Object.keys(patch).length !== 1 || inspectPending(row).status !== "pending" ||
          !isDeepStrictEqual(command.expectedPendingEvent, row.accounting_pending_event)) return conflict();
    } else if (unset.length || where.accounting_pending_event !== null || row.accounting_pending_event != null ||
        !patch.accounting_pending_event) return conflict();
    for (const key of [f.ref, f.at, f.connection_id, f.binding, f.send_authorized_at, f.recovered_at]) {
      if (row[key] != null && row[key] !== "" && key in patch && !isDeepStrictEqual(row[key], patch[key])) return conflict();
    }
    if (patch[f.ref] && !row[f.ref]) {
      const candidate = exportRows.get(patch[f.ref]);
      if (!candidate || candidate.company_id !== row.company_id || candidate.invoice_id !== row.id ||
          candidate.source_revision !== (row.revision ?? null) || !sameBinding(candidate.binding, patch[f.binding])) return conflict();
    }
    if ("status" in patch && (patch.status !== "cancelled" || !["draft", "issued"].includes(row.status) ||
        patch.revision !== revisionValue(row.revision) + 1 || row[f.send_authorized_at])) return conflict();
    const next = { ...row, ...patch };
    if (clearing) delete next.accounting_pending_event;
    else if (inspectPending(next).status !== "pending") return conflict();
    // Atomic MODEL write: matching, transition and pending event have no await gap.
    invoiceRows.set(row.id, next);
    writes.push({ operation: clearing ? "audit_clear" : "invoice_transition", id: row.id, accountingRevision: next.accounting_revision });
    return after(fault, { status: "applied", updated: 1, invoice: next });
  }

  async function findAuditProjections(input) {
    const fault = faultFor("event_find");
    if (await before(fault)) return { complete: false, items: [], nextCursor: "unknown" };
    scope(input);
    const all = [...eventRows.values()].filter((row) => row.company_id === input.companyId && row.invoice_id === input.invoiceId && row.event_key === input.eventKey);
    const complete = fault?.mode !== "incomplete" && all.length <= projectionLimit;
    if (fault?.mode === "reject") throw new Error("synthetic search failure");
    return after(fault, { items: all.slice(0, projectionLimit), complete, nextCursor: complete ? null : "more" });
  }

  async function createAuditProjection(payload) {
    const fault = faultFor("event_create");
    if (await before(fault)) return { status: "unknown" };
    const invoice = scope({ companyId: payload.company_id, invoiceId: payload.invoice_id });
    const pending = inspectPending(invoice);
    if (pending.status !== "pending" || !isDeepStrictEqual(payload, auditProjection(invoice, pending.event))) throw new Error("untrusted_projection");
    if (fault?.mode === "reject") return { status: "conflict" };
    let id;
    do { id = `synthetic-audit-${++sequence}`; } while (eventRows.has(id));
    if (fault?.mode !== "ack_without_commit") eventRows.set(id, { id, ...copy(payload) });
    writes.push({ operation: "event_create", id, eventKey: payload.event_key });
    return after(fault, { status: "applied", id });
  }

  async function readAuditProjection(input) {
    const fault = faultFor("event_read");
    if (await before(fault)) return null;
    scope(input);
    const row = eventRows.get(input.id);
    if (fault?.mode === "missing" || !row || row.company_id !== input.companyId || row.invoice_id !== input.invoiceId) return null;
    return after(fault, row);
  }

  return {
    loadAuthorized, compareAndSet, findAuditProjections, createAuditProjection, readAuditProjection,
    injectFault(fault) {
      if (!["invoice_cas", "event_create", "event_find", "event_read"].includes(fault?.operation) || !faultModes.has(fault.mode)) throw new Error("invalid_fault");
      faults.push({ ...fault });
    },
    readInvoice(id) { return copy(ownInvoice(id)); },
    readEvents() { authorize(); return copy([...eventRows.values()].filter((row) => row.company_id === context.companyId)); },
    get writes() { return copy(writes); },
    // No event update/delete operation: projections are append-only in this model.
    verifyProjection(row, payload) { return projectionMatches(row, payload); },
  };
}
