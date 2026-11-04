/**
 * PREPARATION ONLY. Server-only, unwired, writes disabled without an explicitly
 * supplied trusted platform proof. No SDK/client construction or external calls
 * at import/factory time. Tests inject SDK fakes, never a real Base44 context.
 */
import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import {
  MERIT_FIELDS as f, validBinding, sameBinding, createExportCandidate,
  acquireClaim, authorizeSend, cancelInvoice, recoverClaim, resumePreparation, reconcileClaim,
} from "./claimProtocol.js";

const clone = (value) => structuredClone(value);
const text = (value) => typeof value === "string" && value.trim() === value && value.length > 0 && value.length <= 200;
const error = (code) => Object.assign(new Error(code), { code });
const unknown = (code = "write_outcome_unknown") => ({ status: "unknown", code });
const conflict = () => ({ status: "conflict", updated: 0, invoice: null });
const operations = { acquire: acquireClaim, authorize_send: authorizeSend, cancel: cancelInvoice,
  recover: recoverClaim, resume_preparation: resumePreparation, reconcile: reconcileClaim };

function intent(input, allowed) {
  if (!input || Object.getPrototypeOf(input) !== Object.prototype ||
      Object.keys(input).some((key) => !allowed.includes(key))) throw error("invalid_intent");
}

// This switch does not prove anything. Only trusted server configuration may
// eventually supply actual independently established evidence. No env/UI flag.
function writesProven(proof) {
  return proof?.scalarIdCAS === true && proof?.legacyNullEquality === true &&
    proof?.nullableSchemaAccepted === true && text(proof.evidenceId);
}

export function createBase44ClaimStore({ context, platformProof = null, clock = Date.now, newToken = randomUUID, lookupEvidence = null } = {}) {
  if (typeof context?.getBase44 !== "function") throw error("server_context_required");
  const enabled = writesProven(platformProof);
  const candidates = new WeakMap();
  const commands = new WeakMap();
  const workers = new WeakMap();

  async function session(expectedCompany) {
    const client = context.getBase44();
    const user = await client.auth.me(); // Never trust context.user or client role metadata.
    if (!text(user?.id)) throw error("unauthenticated");
    const service = client.asServiceRole;
    const record = await service.entities.User.get(user.id);
    if (record?.id !== user.id) throw error("unauthenticated");
    const companyId = record?.active_company_id;
    if (!text(companyId) || (expectedCompany !== undefined && expectedCompany !== companyId)) throw error("forbidden_company");
    const result = await service.entities.CompanyMembership.filter({ user_id: user.id, company_id: companyId, status: "active" }, { limit: 100 });
    // A truncated membership page cannot establish the earliest authoritative membership.
    if (!result || !Array.isArray(result.items) || result.next_cursor) throw error("membership_unverified");
    const memberships = result.items.filter((row) => row.user_id === user.id && row.company_id === companyId && row.status === "active");
    if (memberships.some((row) => !text(row.id) || !Number.isFinite(Date.parse(row.created_date)))) throw error("membership_unverified");
    memberships.sort((a, b) => String(a.created_date).localeCompare(String(b.created_date)) || String(a.id).localeCompare(String(b.id)));
    if (!["owner", "admin"].includes(memberships[0]?.role)) throw error("forbidden_role");
    return { service, actor: { userId: user.id, companyId, role: memberships[0].role } };
  }

  async function readEntity(service, name, id, companyId) {
    if (!text(id)) throw error("invalid_id");
    let row;
    try { row = await service.entities[name].get(id); }
    catch (failure) { if (failure?.status === 404) return null; throw error("entity_read_unverified"); }
    return row?.id === id && row.company_id === companyId ? clone(row) : null;
  }

  async function connectionBinding(service, actor, id, requireActive) {
    const connection = await readEntity(service, "AccountingConnection", id, actor.companyId);
    const binding = connection?.destination_binding;
    if (!validBinding(binding) || binding.companyId !== actor.companyId || binding.connectionId !== id ||
        binding.provider !== connection.provider || binding.environment !== connection.environment ||
        binding.connectionRevision !== connection.configuration_revision ||
        typeof connection.destination_verified_at !== "string" || !Number.isFinite(Date.parse(connection.destination_verified_at))) {
      throw error("destination_unverified");
    }
    if (requireActive && connection.status !== "active") throw error("connection_inactive");
    return clone(binding);
  }

  async function getInvoice({ id, companyId }) {
    if (!text(id) || !text(companyId)) throw error("invalid_scope");
    const { service } = await session(companyId);
    return readEntity(service, "Invoice", id, companyId);
  }

  async function getCandidate({ id, companyId }) {
    if (!text(id) || !text(companyId)) throw error("invalid_scope");
    const { service } = await session(companyId);
    return readEntity(service, "AccountingExport", id, companyId);
  }

  async function prepareCandidate(input) {
    intent(input, ["invoiceId", "connectionId"]);
    const { service, actor } = await session();
    const invoice = await readEntity(service, "Invoice", input.invoiceId, actor.companyId);
    if (!invoice) throw error("invoice_not_found");
    const binding = await connectionBinding(service, actor, input.connectionId, true);
    const planned = createExportCandidate({ invoice, actor, binding, exportId: newToken() });
    if (!planned.ok) throw error(planned.code);
    candidates.set(planned.row, { actorId: actor.userId });
    return planned.row;
  }

  async function createCandidate(row) {
    if (!enabled) return unknown("writes_disabled_platform_unverified");
    const prepared = candidates.get(row);
    if (!prepared) return unknown("untrusted_candidate");
    candidates.delete(row); // Never retry an uncertain create; an orphan is safe.
    const { service, actor } = await session(row.company_id);
    if (actor.userId !== prepared.actorId) throw error("actor_changed");
    const invoice = await readEntity(service, "Invoice", row.invoice_id, actor.companyId);
    const binding = await connectionBinding(service, actor, row.binding.connectionId, true);
    const fresh = createExportCandidate({ invoice, actor, binding, exportId: row.id });
    if (!fresh.ok || !isDeepStrictEqual(fresh.row, row)) return conflict();
    const data = { ...clone(row), connection_id: binding.connectionId, requested_by_id: actor.userId, projection_status: "candidate" };
    delete data.id; // Base44 assigns the real ID. Never assume caller-assigned IDs work.
    try {
      const saved = await service.entities.AccountingExport.create(data);
      if (!text(saved?.id) || Object.entries(data).some(([key, value]) => !isDeepStrictEqual(saved[key], value))) return unknown();
      return { status: "applied", row: clone(saved) };
    } catch { return unknown(); }
  }

  async function loadPlan(operation, input, owner, timestamp, evidence) {
    const { service, actor } = await session();
    const invoice = await readEntity(service, "Invoice", input.invoiceId, actor.companyId);
    if (!invoice) throw error("invoice_not_found");
    let row, binding;
    if (operation !== "cancel" || invoice[f.ref]) {
      const id = input.exportId ?? invoice[f.ref];
      row = await readEntity(service, "AccountingExport", id, actor.companyId);
      if (!row || row.invoice_id !== invoice.id || !validBinding(row.binding)) throw error("candidate_not_found");
      if (operation === "cancel" && (row.id !== invoice[f.ref] || !sameBinding(row.binding, invoice[f.binding]))) throw error("noncanonical_export");
      binding = await connectionBinding(service, actor, row.binding.connectionId, ["acquire", "authorize_send", "resume_preparation"].includes(operation));
      if (!sameBinding(binding, row.binding)) throw error("destination_mismatch");
    }
    // Evidence can only come from a trusted server dependency. Never accept a
    // browser-supplied provider response or completeness/authority assertion.
    const response = operation === "reconcile" && evidence === undefined && typeof lookupEvidence === "function"
      ? await lookupEvidence({ invoice: clone(invoice), binding: clone(binding) }) : evidence;
    const args = {
      invoice, actor, binding, exportRow: row, now: timestamp,
      ownership: owner?.ownership, attemptToken: owner?.token,
      retryApproved: input.retryApproved, response,
    };
    return { service, actor, invoice, response, decision: operations[operation](args) };
  }

  async function prepareTransition(operation, input) {
    if (!Object.hasOwn(operations, operation)) throw error("unsupported_transition");
    intent(input, ["invoiceId", "exportId", "worker", "retryApproved"]);
    // Tokens and ownership cannot be supplied as client JSON or reconstructed from reads.
    let owner;
    if (operation === "authorize_send") {
      owner = workers.get(input.worker);
      if (!owner?.active || owner.invoiceId !== input.invoiceId) throw error("worker_not_authorized");
    } else if (["acquire", "resume_preparation"].includes(operation)) owner = { token: newToken() };
    const now = clock();
    const plan = await loadPlan(operation, input, owner, now);
    if (operation === "authorize_send" && (owner.actorId !== plan.actor.userId || owner.companyId !== plan.actor.companyId)) throw error("worker_not_authorized");
    let worker = null;
    if (plan.decision.ok) {
      if (["acquire", "resume_preparation"].includes(operation)) {
        worker = Object.freeze({}); // Server-process-only handle, initially inactive.
        owner = {
          ...owner, active: false, actorId: plan.actor.userId, companyId: plan.actor.companyId, invoiceId: input.invoiceId,
          ownership: {
            claimRef: plan.decision.command.patch[f.ref] ?? plan.decision.command.where[f.ref],
            attemptToken: plan.decision.command.patch[f.attempt_token], attemptNumber: plan.decision.command.patch[f.attempt_number],
          },
        };
        workers.set(worker, owner);
      }
      commands.set(plan.decision.command, { operation, input: { ...input }, response: clone(plan.response), owner,
        now, actorId: plan.actor.userId, companyId: plan.actor.companyId, decision: plan.decision });
    }
    return { decision: plan.decision, worker };
  }

  async function compareAndSet(command) {
    if (!enabled) return unknown("writes_disabled_platform_unverified");
    const prepared = commands.get(command);
    if (!prepared) return unknown("untrusted_or_consumed_command");
    commands.delete(command);
    // A possibly attempted authorization consumes its worker capability, even if the
    // write never committed. Recovery/resume is the only route to another preparer.
    if (prepared.operation === "authorize_send") {
      if (!prepared.owner.active) return unknown("worker_capability_consumed");
      prepared.owner.active = false;
    }
    const plan = await loadPlan(prepared.operation, prepared.input, prepared.owner, prepared.now, prepared.response);
    if (prepared.actorId !== plan.actor.userId || prepared.companyId !== plan.actor.companyId) throw error("actor_changed");
    if (!plan.decision.ok || !isDeepStrictEqual(plan.decision.command, command)) return conflict();
    const now = clock();
    if (["acquire", "authorize_send", "resume_preparation"].includes(prepared.operation) &&
        (!Number.isFinite(now) || now >= command.patch[f.lease_expires_at] ||
          (prepared.operation === "authorize_send" && now >= plan.invoice[f.lease_expires_at]))) return conflict();
    let result;
    try {
      // The ONLY Invoice write. Scalar ID + exact predicates; no $inc, upsert,
      // broad query, transaction, automatic retry, or post-write permission read.
      result = await plan.service.entities.Invoice.updateMany(clone(command.where), { $set: clone(command.patch) });
    } catch { return unknown(); }
    if (result?.success === true && result.updated === 0 && result.has_more === false) return conflict();
    if (result?.success !== true || result.updated !== 1 || result.has_more !== false) return unknown();
    if (["acquire", "resume_preparation"].includes(prepared.operation)) prepared.owner.active = true;
    // Derived only from an unambiguous acknowledged write, never from a later read.
    return { status: "applied", updated: 1, invoice: { ...clone(plan.invoice), ...clone(command.patch) } };
  }

  return Object.freeze({ getInvoice, getCandidate, createCandidate, compareAndSet, prepareCandidate, prepareTransition });
}
