/**
 * SYNTHETIC ONLY. This queue models a REQUIRED cross-record atomic domain; it is
 * not a distributed lock, Base44 adapter, attestation, or deployable driver.
 * Every mutation including authority changes MUST enter the same domain.
 */
import { createLifecycleAuditStore } from "./lifecycleAuditStore.js";
import { createLifecycleCoordinator } from "../export/lifecycleCoordinator.server.js";
import { deriveServerAuthority, compileInvoiceCAS } from "../export/safePersistenceContracts.js";
import { MERIT_FIELDS as f, sameBinding } from "../export/claimProtocol.js";
import { freezeCopy } from "../export/auditOutbox.js";
import { captureAuthorizationFence, evaluateAuthorizationFence, connectionTransition,
  validConnectionFence, connectionFenceReadiness } from "../export/connectionLifecycle.js";

const fail = (code) => { throw new Error(code); };
const blocked = (code) => ({ outcome: "blocked", code, sendPermit: null });
const key = (userId, companyId) => JSON.stringify([userId, companyId]);
const nextGeneration = (n) => {
  if (!Number.isSafeInteger(n) || n < 0 || n >= Number.MAX_SAFE_INTEGER) fail("generation_exhausted");
  return n + 1;
};

export function createConnectionFenceModel({ invoices = [], candidates = [], events = [], users = [], memberships = [],
  connections = [], clock = Date.now, newToken, lookupEvidence, createInvoiceStore = createLifecycleAuditStore } = {}) {
  const userRows = new Map(), memberRows = new Map(), connectionRows = new Map(), fenceLog = [];
  for (const u of users) {
    if (!u?.id || userRows.has(u.id)) fail("invalid_synthetic_user");
    nextGeneration(u.generation); userRows.set(u.id, structuredClone(u));
  }
  for (const m of memberships) {
    const id = key(m.userId, m.companyId);
    if (!m.userId || !m.companyId || memberRows.has(id) || !["owner", "admin", "member"].includes(m.role) || !["active", "revoked"].includes(m.status)) fail("invalid_synthetic_membership");
    nextGeneration(m.generation); memberRows.set(id, structuredClone(m));
  }
  for (const c of connections) {
    if (!validConnectionFence(c) || connectionRows.has(c.id)) fail("invalid_synthetic_connection");
    connectionRows.set(c.id, structuredClone(c));
  }
  const context = {};
  const store = createInvoiceStore({ invoices, candidates, events, context });
  let tail = Promise.resolve(), connectionFault;
  function exclusive(fn) {
    const run = tail.then(fn);
    tail = run.catch(() => {});
    return run;
  }
  function authority(userId, pinnedCompany) {
    const u = userRows.get(userId), m = memberRows.get(key(userId, u?.activeCompanyId));
    const actor = deriveServerAuthority({ user: { id: userId }, userRecord: { id: u?.id, active_company_id: u?.activeCompanyId },
      memberships: m ? [{ id: key(userId, m.companyId), user_id: userId, company_id: m.companyId,
        role: m.role, status: m.status, created_date: "2026-01-01" }] : [], complete: true, nextCursor: null });
    if (actor.companyId !== pinnedCompany) fail("active_company_changed");
    Object.assign(context, actor, { membershipActive: true });
    return { actor, principalGeneration: u.generation, membershipGeneration: m.generation };
  }
  function originalConnection(data) {
    const row = data.exportRow, invoice = data.invoice;
    if (!row) {
      if (invoice[f.ref]) fail("original_export_missing");
      return undefined;
    }
    const c = connectionRows.get(row.binding?.connectionId);
    if (!validConnectionFence(c) || c.companyId !== invoice.company_id || row.company_id !== invoice.company_id ||
        row.invoice_id !== invoice.id || row.provider !== c.binding.provider || !sameBinding(row.binding, c.binding) ||
        (invoice[f.ref] && (invoice[f.ref] !== row.id || !sameBinding(invoice[f.binding], c.binding)))) fail("original_destination_unverified");
    return c;
  }
  function stamp(auth, connection) {
    const captured = captureAuthorizationFence({ ...auth, connection });
    if (!captured.ok) fail(captured.code);
    return { ...captured.stamp, connectionState: connection?.state ?? null };
  }
  function forUser(userId) {
    // Test/server dependency, NOT an HTTP identity selector. Principal is pinned.
    const pinnedCompany = userRows.get(userId)?.activeCompanyId;
    const plans = new WeakMap(), workers = new WeakMap();
    async function loadAuthorized(input) {
      const auth = authority(userId, pinnedCompany);
      const data = await store.loadAuthorized(input);
      if (data.invoice[f.ref] && input.exportId && input.exportId !== data.invoice[f.ref]) fail("noncanonical_export");
      const connection = originalConnection(data);
      return { ...data, actor: auth.actor, binding: connection?.binding, connection, fence: stamp(auth, connection) };
    }
    const port = {
      loadAuthorized,
      async compareAndSet(command) {
        const current = await loadAuthorized({ invoiceId: command.where.id, exportId: command.patch[f.ref] });
        compileInvoiceCAS(current.invoice, command);
        // Authority/connection and this Invoice CAS are inside the SAME model
        // exclusive section. A real independent SDK read cannot replace it.
        return store.compareAndSet(command);
      },
      findAuditProjections: store.findAuditProjections,
      createAuditProjection: store.createAuditProjection,
      readAuditProjection: store.readAuditProjection,
    };
    const coordinator = createLifecycleCoordinator({ port, clock, newToken, lookupEvidence });
    return Object.freeze({
      prepare(operation, input) {
        return exclusive(async () => {
          if (!input || Object.getPrototypeOf(input) !== Object.prototype ||
              Object.keys(input).some(k => !["invoiceId", "exportId", "worker", "retryApproved"].includes(k))) fail("invalid_intent");
          const current = await loadAuthorized(input);
          const captured = operation === "authorize_send" ? workers.get(input.worker) : current.fence;
          const gate = evaluateAuthorizationFence({ operation, captured, current: current.fence });
          if (!gate.ok) return Object.freeze({ decision: { ok: false, code: gate.code }, worker: null });
          const plan = await coordinator.prepare(operation, input);
          plans.set(plan, { operation, input: { ...input }, captured: current.fence });
          return plan;
        });
      },
      commit(plan) {
        return exclusive(async () => {
          const prepared = plans.get(plan);
          if (!prepared) return blocked("untrusted_or_consumed_plan");
          plans.delete(plan);
          try {
            const current = await loadAuthorized(prepared.input);
            const gate = evaluateAuthorizationFence({ operation: prepared.operation, captured: prepared.captured, current: current.fence });
            if (!gate.ok) return blocked(gate.code);
            const result = await coordinator.commit(plan);
            if (result.outcome === "applied" && ["acquire", "resume_preparation"].includes(prepared.operation)) workers.set(plan.worker, prepared.captured);
            return result;
          } catch { return { outcome: "unknown", code: "authority_or_write_unverified", sendPermit: null }; }
        });
      },
      projectAudit(input) {
        return exclusive(async () => {
          try { authority(userId, pinnedCompany); return await coordinator.projectAudit(input); }
          catch { return blocked("authority_unverified"); }
        });
      },
      changeConnection(input) {
        return exclusive(() => {
          if (!input || Object.keys(input).some(k => !["connectionId", "nextState", "expectedGeneration"].includes(k))) return blocked("invalid_intent");
          let actor;
          try { actor = authority(userId, pinnedCompany).actor; } catch { return blocked("authority_unverified"); }
          const current = connectionRows.get(input.connectionId);
          const decision = connectionTransition({ connection: current, actor, ...input, now: clock() });
          if (!decision.ok) return blocked(decision.code);
          const fault = connectionFault; connectionFault = undefined;
          if (fault === "reject") return { outcome: "conflict", sendPermit: null };
          if (fault === "unknown_before") return { outcome: "unknown", sendPermit: null };
          // MODEL linearization point, including append-only connection audit.
          connectionRows.set(current.id, structuredClone(decision.next));
          fenceLog.push({ kind: "connection", ...structuredClone(decision.event) });
          return fault === "unknown_after" ? { outcome: "unknown", sendPermit: null }
            : { outcome: "applied", generation: decision.next.generation, sendPermit: null };
        });
      },
    });
  }
  return Object.freeze({
    forUser, readiness: connectionFenceReadiness(),
    // Trusted synthetic test controls, not user-facing membership endpoints.
    control: Object.freeze({
      changeMembership({ userId, companyId, role, status }) {
        return exclusive(() => {
          const m = memberRows.get(key(userId, companyId));
          if (!m || !["owner", "admin", "member"].includes(role) || !["active", "revoked"].includes(status)) fail("invalid_membership_control");
          const next = { ...m, role, status, generation: nextGeneration(m.generation) };
          memberRows.set(key(userId, companyId), next);
          fenceLog.push({ kind: "membership", userId, companyId, generation: next.generation });
        });
      },
      switchCompany(userId, companyId) {
        return exclusive(() => {
          const u = userRows.get(userId);
          if (!u || !memberRows.has(key(userId, companyId))) fail("invalid_company_control");
          userRows.set(userId, { ...u, activeCompanyId: companyId, generation: nextGeneration(u.generation) });
          fenceLog.push({ kind: "principal", userId, generation: u.generation + 1 });
        });
      },
      injectInvoiceFault(fault) { store.injectFault(fault); },
      injectConnectionFault(mode) {
        if (!["reject", "unknown_before", "unknown_after"].includes(mode)) fail("invalid_fault");
        connectionFault = mode;
      },
      snapshot() {
        return exclusive(() => {
          const rows = invoices.map(i => {
            Object.assign(context, { userId: "synthetic-observer", role: "owner", companyId: i.company_id, membershipActive: true });
            return store.readInvoice(i.id);
          });
          return structuredClone({ invoices: rows, connections: [...connectionRows.values()], memberships: [...memberRows.values()],
            fenceLog, invoiceWrites: store.writes });
        });
      },
    }),
  });
}
