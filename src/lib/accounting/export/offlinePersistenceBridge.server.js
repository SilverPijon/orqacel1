/** Offline integration model ONLY. No SDK driver, production activation or endpoint. */
import { isDeepStrictEqual } from "node:util";
import { createLifecycleCoordinator } from "./lifecycleCoordinator.server.js";
import { deriveServerAuthority, compileInvoiceCAS, classifyCASAcknowledgement } from "./safePersistenceContracts.js";
import { MERIT_FIELDS as f, sameBinding, validBinding } from "./claimProtocol.js";
import { inspectPending, auditProjection, projectionMatches } from "./auditOutbox.js";

const fail = (code) => { throw new Error(code); };

/**
 * repository is a trusted server dependency, never JSON/request data. Its read
 * methods return detached records. conditionalInvoiceWrite receives SDK-shaped
 * {query,update} and returns RAW acknowledgements. There is intentionally no live
 * driver. The offline-model tag is a development restriction, NOT attestation.
 */
export function createOfflinePersistenceBridge({ repository, readSession, clock, newToken, lookupEvidence } = {}) {
  if (repository?.transport !== "offline-model" || typeof readSession !== "function") fail("offline_dependencies_required");
  const receipts = new Map();
  let principal;
  const actor = async () => {
    const current = deriveServerAuthority(await readSession());
    if (principal && (principal.userId !== current.userId || principal.companyId !== current.companyId)) fail("principal_changed");
    principal ??= current;
    return current;
  };
  async function loadAuthorized({ invoiceId, exportId }) {
    const auth = await actor();
    const invoice = await repository.readInvoice({ id: invoiceId, companyId: auth.companyId });
    if (!invoice || invoice.id !== invoiceId || invoice.company_id !== auth.companyId) fail("invoice_not_found");
    const id = invoice[f.ref] || exportId;
    if (invoice[f.ref] && exportId && exportId !== invoice[f.ref]) fail("noncanonical_export");
    let exportRow, binding, connection;
    if (id) {
      exportRow = await repository.readExport({ id, companyId: auth.companyId });
      binding = exportRow?.binding;
      if (exportRow?.id !== id || exportRow.company_id !== auth.companyId || exportRow.invoice_id !== invoiceId ||
          !validBinding(binding) || binding.companyId !== auth.companyId || exportRow.provider !== binding.provider) fail("candidate_not_found");
      connection = await repository.readConnection({ id: binding.connectionId, companyId: auth.companyId });
      if (connection?.id !== binding.connectionId || connection.company_id !== auth.companyId ||
          !sameBinding(binding, connection.destination_binding) || connection.provider !== binding.provider ||
          connection.environment !== binding.environment || connection.configuration_revision !== binding.connectionRevision ||
          !Number.isFinite(Date.parse(connection.destination_verified_at))) fail("destination_unverified");
      if (invoice[f.ref] && !sameBinding(binding, invoice[f.binding])) fail("destination_changed");
    }
    return { invoice, actor: auth, exportRow, binding, connection };
  }
  async function pending(scope) {
    const current = await loadAuthorized({ invoiceId: scope.invoiceId });
    const slot = inspectPending(current.invoice);
    if (scope.companyId !== current.actor.companyId || slot.status !== "pending" || scope.eventKey !== slot.event.event_key) fail("pending_scope_changed");
    return { ...current, payload: auditProjection(current.invoice, slot.event) };
  }
  const key = (scope) => JSON.stringify([scope.companyId, scope.invoiceId, scope.eventKey]);
  const port = {
    loadAuthorized,
    async compareAndSet(command) {
      const current = await loadAuthorized({ invoiceId: command.where?.id, exportId: command.patch?.[f.ref] });
      const compiled = compileInvoiceCAS(current.invoice, command);
      if (["preparing", "sending"].includes(command.patch[f.state]) && current.connection?.status !== "active") fail("connection_inactive");
      if (compiled.clearing) {
        const scope = { companyId: current.actor.companyId, invoiceId: current.invoice.id, eventKey: current.invoice.accounting_pending_event.event_key };
        const receipt = receipts.get(key(scope));
        receipts.delete(key(scope)); // consume even when the following write is uncertain
        if (!receipt || receipt.userId !== current.actor.userId || !isDeepStrictEqual(receipt.payload, auditProjection(current.invoice, command.expectedPendingEvent))) fail("independent_read_receipt_required");
      }
      // Exactly one attempt. No permission readback, fallback or reconstruction.
      const ack = await repository.conditionalInvoiceWrite({ query: compiled.query, update: compiled.update });
      const status = classifyCASAcknowledgement(ack);
      return status === "applied" ? { status, updated: 1, invoice: compiled.expectedInvoice }
        : status === "conflict" ? { status, updated: 0, invoice: null } : { status: "unknown" };
    },
    async findAuditProjections(scope) {
      await pending(scope);
      return repository.findAuditProjections(scope);
    },
    async createAuditProjection(payload) {
      const scope = { companyId: payload.company_id, invoiceId: payload.invoice_id, eventKey: payload.event_key };
      const current = await pending(scope);
      if (!isDeepStrictEqual(payload, current.payload)) fail("noncanonical_projection");
      const saved = await repository.createAuditProjection(payload);
      // Create acknowledgement NEVER supplies a delivery receipt.
      return projectionMatches(saved, current.payload) ? { status: "applied", id: saved.id } : { status: "unknown" };
    },
    async readAuditProjection(scope) {
      const current = await pending(scope);
      const row = await repository.readAuditProjection(scope);
      if (row?.id === scope.id && projectionMatches(row, current.payload)) receipts.set(key(scope), { userId: current.actor.userId, payload: current.payload });
      else receipts.delete(key(scope));
      return row;
    },
  };
  // Private port and read receipts cannot be supplied through lifecycle intents.
  return createLifecycleCoordinator({ port, clock, newToken, lookupEvidence });
}
