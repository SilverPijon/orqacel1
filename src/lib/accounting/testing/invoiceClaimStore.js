/**
 * Fault-injectable Stage-A Invoice store. Models ONE-record CAS in one JS process.
 * It is not a Base44 adapter and proves nothing about Base44 backend atomicity.
 * Detached reads/writes prevent test-side object mutation bypassing predicates.
 */
import { MERIT_FIELDS, revisionValue, sameBinding } from "../export/claimProtocol.js";

const copy = (value) => structuredClone(value);
const optional = (value) => value ?? null;
const text = (value) => typeof value === "string" && value.length > 0;
const scalar = (value) => value === null || ["string", "boolean"].includes(typeof value) ||
  (typeof value === "number" && Number.isFinite(value));
const predicates = new Set([
  "id", "company_id", "status", "revision", "accounting_revision", MERIT_FIELDS.ref,
  MERIT_FIELDS.state, MERIT_FIELDS.attempt_token, MERIT_FIELDS.attempt_number, MERIT_FIELDS.send_authorized_at,
]);
const patches = new Set(["status", "revision", "cancelled_at", "accounting_revision", ...Object.values(MERIT_FIELDS)]);
const faultModes = new Set(["reject", "unknown_before", "unknown_after", "throw_before", "throw_after", "pause_before", "pause_after"]);

export function createInvoiceClaimStore({ invoices = [], candidates = [] } = {}) {
  const rows = new Map(invoices.map((invoice) => [invoice.id, copy(invoice)]));
  const exports = new Map(candidates.map((row) => [row.id, copy(row)]));
  const faults = [];
  const operations = [];

  function faultFor(operation) {
    const index = faults.findIndex((fault) => fault.operation === operation);
    return index < 0 ? null : faults.splice(index, 1)[0];
  }

  async function before(fault) {
    if (fault?.mode === "pause_before") {
      fault.entered?.();
      await fault.wait;
    }
    if (fault?.mode === "throw_before") throw new Error("synthetic write failure");
    return fault?.mode === "unknown_before";
  }

  async function after(fault, result) {
    if (fault?.mode === "pause_after") {
      fault.entered?.();
      await fault.wait;
    }
    if (fault?.mode === "throw_after") throw new Error("synthetic acknowledgement lost");
    if (fault?.mode === "unknown_after") return { status: "unknown" };
    return copy(result);
  }

  function getInvoice({ id, companyId }) {
    const invoice = rows.get(id);
    return invoice?.company_id === companyId && text(companyId) ? copy(invoice) : null;
  }

  function getCandidate({ id, companyId }) {
    const row = exports.get(id);
    return row?.company_id === companyId && text(companyId) ? copy(row) : null;
  }

  async function createCandidate(input) {
    const row = copy(input);
    const fault = faultFor("create");
    if (await before(fault)) return { status: "unknown" };
    if (!text(row?.id) || !text(row.company_id) || exports.has(row.id) || fault?.mode === "reject") return { status: "conflict" };
    // No uniqueness on export_key: duplicate candidates are intentionally legal.
    exports.set(row.id, row);
    operations.push({ operation: "create", id: row.id });
    return after(fault, { status: "applied", row });
  }

  async function compareAndSet(input) {
    const command = copy(input);
    const fault = faultFor("cas");
    if (await before(fault)) return { status: "unknown" };
    const where = command?.where;
    const patch = command?.patch;
    const row = rows.get(where?.id);
    const conflict = () => ({ status: "conflict", updated: 0, invoice: getInvoice({ id: where?.id, companyId: where?.company_id }) });
    if (!where || !patch || !text(where.id) || !text(where.company_id) || !row ||
        [...predicates].some((key) => !(key in where)) ||
        Object.entries(where).some(([key, value]) => !predicates.has(key) || !scalar(value)) ||
        Object.keys(patch).some((key) => !patches.has(key)) ||
        Object.entries(where).some(([key, value]) => optional(row[key]) !== value) ||
        fault?.mode === "reject") return conflict();

    const f = MERIT_FIELDS;
    if (!Number.isSafeInteger(patch.accounting_revision) || patch.accounting_revision !== revisionValue(row.accounting_revision) + 1) return conflict();
    if (row[f.ref]) {
      for (const key of [f.ref, f.at, f.connection_id, f.binding]) {
        if (key in patch && (key === f.binding ? !sameBinding(patch[key], row[key]) : patch[key] !== row[key])) return conflict();
      }
    } else {
      // Only a persisted canonical candidate may be installed on the existing Invoice.
      const candidate = exports.get(patch[f.ref]);
      if (patch[f.ref] && (!candidate || candidate.company_id !== row.company_id || candidate.invoice_id !== row.id ||
          candidate.source_revision !== (row.revision ?? null) || candidate.provider !== "merit" || candidate.kind !== "invoice" ||
          candidate.export_key !== `${row.company_id}:${row.id}:merit:invoice` ||
          !sameBinding(candidate.binding, patch[f.binding]))) return conflict();
    }
    for (const key of [f.send_authorized_at, f.recovered_at]) {
      if (row[key] != null && row[key] !== "" && key in patch && patch[key] !== row[key]) return conflict();
    }
    if (patch[f.state] === "sending" && (row[f.send_authorized_at] || row[f.state] !== "preparing")) return conflict();
    if ("status" in patch && (patch.status !== "cancelled" || !["draft", "issued"].includes(row.status) ||
        patch.revision !== revisionValue(row.revision) + 1 || row[f.send_authorized_at])) return conflict();

    // NO await between matching predicates and this one-record write.
    const next = { ...row, ...patch };
    rows.set(row.id, next);
    operations.push({ operation: "cas", id: row.id, state: next[f.state] ?? null, accountingRevision: next.accounting_revision });
    return after(fault, { status: "applied", updated: 1, invoice: next });
  }

  return {
    getInvoice, getCandidate, createCandidate, compareAndSet,
    injectFault(fault) {
      if (!["cas", "create"].includes(fault?.operation) || !faultModes.has(fault.mode)) throw new Error("unsupported synthetic fault");
      faults.push({ ...fault });
    },
    get operations() { return copy(operations); },
  };
}
