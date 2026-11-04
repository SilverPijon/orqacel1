/** SDK-shape test double only. No Base44 SDK, credentials, or network. */
import { createInvoiceClaimStore } from "./invoiceClaimStore.js";
import { makeInvoice } from "./fixtures.js";

export const SYNTHETIC_PROOF = Object.freeze({
  scalarIdCAS: true, legacyNullEquality: true, nullableSchemaAccepted: true,
  evidenceId: "SDK-FAKE-ONLY-NOT-BASE44-PROOF",
});

export function createBase44ClaimSdkFake({ invoice = makeInvoice(), moreInvoices = [] } = {}) {
  const clone = structuredClone;
  const storage = createInvoiceClaimStore({ invoices: [invoice, ...moreInvoices] });
  const calls = [];
  let nextId = 0, nextToken = 0;
  const binding = { companyId: invoice.company_id, provider: "merit", connectionId: "connection_1",
    connectionRevision: 1, environment: "test", region: "ee", ledgerId: "synthetic-ledger", bindingId: "synthetic-binding" };
  const state = {
    now: 1000, user: { id: "u_1" }, userRecord: { id: "u_1", active_company_id: invoice.company_id },
    memberships: [{ id: "membership_1", user_id: "u_1", company_id: invoice.company_id,
      role: "admin", status: "active", created_date: "2026-01-01T00:00:00Z" }],
    nextCursor: null,
    connection: { id: binding.connectionId, company_id: binding.companyId, provider: "merit", status: "active",
      environment: "test", configuration_revision: 1, destination_binding: clone(binding),
      destination_verified_at: "2026-01-01T00:00:00Z" },
    updateResponse: undefined, updateError: false, readError: false,
  };
  function call(name, ...args) { calls.push({ name, args: clone(args) }); }
  function missing() { throw Object.assign(new Error("synthetic missing entity"), { status: 404 }); }
  const service = { entities: {
    User: { async get(id) { call("User.get", id); return clone(state.userRecord); } },
    CompanyMembership: { async filter(query, options) {
      call("CompanyMembership.filter", query, options);
      return { items: clone(state.memberships), next_cursor: state.nextCursor };
    } },
    AccountingConnection: { async get(id) {
      call("AccountingConnection.get", id);
      return state.connection?.id === id ? clone(state.connection) : missing();
    } },
    AccountingExport: {
      async get(id) { call("AccountingExport.get", id); return storage.getCandidate({ id, companyId: invoice.company_id }) ?? missing(); },
      async create(data) {
        call("AccountingExport.create", data);
        if ("id" in data) throw new Error("test double rejects caller-assigned IDs");
        const result = await storage.createCandidate({ ...clone(data), id: `base44-export-${++nextId}` });
        return result.status === "applied" ? clone(result.row) : undefined;
      },
    },
    Invoice: {
      async get(id) {
        call("Invoice.get", id);
        if (state.readError) throw new Error("synthetic read outage");
        for (const record of [invoice, ...moreInvoices]) {
          const found = storage.getInvoice({ id, companyId: record.company_id });
          if (found) return found;
        }
        return missing();
      },
      async updateMany(where, data) {
        call("Invoice.updateMany", where, data);
        if (state.updateError) throw new Error("synthetic update outage");
        const result = await storage.compareAndSet({ where, patch: data.$set });
        if (state.updateResponse !== undefined) return clone(state.updateResponse);
        return result.status === "unknown" ? undefined : { success: true, updated: result.updated, has_more: false };
      },
    },
  } };
  const client = { asServiceRole: service, auth: { async me() { call("auth.me"); return clone(state.user); } } };
  const context = { user: { id: "untrusted-context-user", role: "owner" }, getBase44: () => client };
  return { invoice, binding, context, storage, calls, state,
    clock: () => state.now, newToken: () => `server-generated-${++nextToken}`,
    read: () => storage.getInvoice({ id: invoice.id, companyId: invoice.company_id }) };
}
