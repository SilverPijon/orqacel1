import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createOfflinePersistenceBridge } from "../export/offlinePersistenceBridge.server.js";
import { deriveServerAuthority, classifyCASAcknowledgement, compileInvoiceCAS, lifecycleIntegrationSpec } from "../export/safePersistenceContracts.js";
import { createLifecycleAuditStore } from "../testing/lifecycleAuditStore.js";
import { makeInvoice, makeActor } from "../testing/fixtures.js";
import { createExportCandidate, MERIT_FIELDS as f } from "../export/claimProtocol.js";

function setup(overrides = {}) {
  const invoice = makeInvoice(overrides), auth = makeActor();
  const binding = { companyId: invoice.company_id, provider: "merit", connectionId: "c1", connectionRevision: 1,
    environment: "test", region: "ee", ledgerId: "synthetic", bindingId: "synthetic" };
  const row = createExportCandidate({ invoice: { ...invoice, accounting_revision: 0 }, actor: auth, binding, exportId: "export-1" }).row;
  const context = { ...auth, binding, membershipActive: true };
  const store = createLifecycleAuditStore({ invoices: [invoice], candidates: [row], context });
  const session = { user: { id: auth.userId }, userRecord: { id: auth.userId, active_company_id: auth.companyId },
    memberships: [{ id: "membership", user_id: auth.userId, company_id: auth.companyId, status: "active", role: "admin", created_date: "2026-01-01" }], complete: true, nextCursor: null };
  const connection = { id: "c1", company_id: auth.companyId, provider: "merit", environment: "test", configuration_revision: 1,
    destination_binding: binding, destination_verified_at: "2026-01-01", status: "active" };
  const writes = [];
  const repository = {
    transport: "offline-model",
    readInvoice: async () => store.readInvoice(invoice.id), readExport: async () => structuredClone(row),
    readConnection: async () => structuredClone(connection),
    async conditionalInvoiceWrite({ query, update }) {
      writes.push({ query, update });
      const result = await store.compareAndSet({ where: query, patch: update.$set, unset: Object.keys(update.$unset ?? {}),
        ...(update.$unset ? { expectedPendingEvent: store.readInvoice(invoice.id).accounting_pending_event } : {}) });
      return result.status === "unknown" ? undefined : { success: true, updated: result.updated, has_more: false };
    },
    findAuditProjections: store.findAuditProjections,
    async createAuditProjection(payload) { const result = await store.createAuditProjection(payload); return store.readEvents().find((e) => e.id === result.id); },
    readAuditProjection: store.readAuditProjection,
  };
  let now = 1000, sequence = 0;
  const c = createOfflinePersistenceBridge({ repository, readSession: async () => structuredClone(session), clock: () => now, newToken: () => `token-${++sequence}` });
  const input = { invoiceId: invoice.id };
  return { invoice, store, session, connection, repository, writes, c, input, row,
    setTime: (value) => { now = value; }, read: () => store.readInvoice(invoice.id),
    plan: (operation, extra = {}) => c.prepare(operation, { ...input, ...extra }), drain: () => c.projectAudit(input) };
}
async function acquired() { const s = setup(); s.claim = await s.plan("acquire", { exportId: s.row.id }); assert.equal((await s.c.commit(s.claim)).outcome, "applied"); return s; }
async function prepared() { const s = await acquired(); assert.equal((await s.drain()).outcome, "projected"); return s; }

for (const [ack, expected] of [[undefined,"unknown"],[{},"unknown"],[{success:true,updated:1,has_more:false},"applied"],
  [{success:true,updated:0,has_more:false},"conflict"],[{success:false,updated:1,has_more:false},"unknown"],
  [{success:true,updated:"1",has_more:false},"unknown"],[{success:true,updated:2,has_more:false},"unknown"],
  [{success:true,updated:1},"unknown"],[{success:true,updated:1,has_more:true},"unknown"]]) {
  test(`strict raw acknowledgement ${JSON.stringify(ack)}`, () => assert.equal(classifyCASAcknowledgement(ack), expected));
}
for (const value of [undefined, null]) test(`legacy accounting revision ${value} is modeled, not backend proof`, async () => {
  const s = setup({ accounting_revision: value }); const p = await s.plan("acquire", { exportId: s.row.id });
  assert.equal((await s.c.commit(p)).outcome, "applied"); assert.equal(s.read().accounting_revision, 1);
  assert.equal(s.writes[0].query.accounting_revision, null);
});
for (const value of ["", -1, "0"]) test(`invalid revision ${JSON.stringify(value)} cannot acquire`, async () => {
  const s = setup({ accounting_revision: value }); const p = await s.plan("acquire", { exportId: s.row.id });
  assert.notEqual((await s.c.commit(p)).outcome, "applied"); assert.equal(s.writes.length, 0);
});
for (const field of ["accounting_revision","ownership","attemptToken","send_authorized_at","response","evidence","delivered","actor","companyId","receipt"]) {
  test(`client cannot supply ${field}`, async () => { const s = setup(); await assert.rejects(s.plan("acquire", { [field]: "untrusted" }), /invalid_intent/); });
}
for (const operation of ["create","edit","issue","cancel","delete","restore"]) test(`${operation} handler remains gated by readiness specification`, () => {
  const spec = lifecycleIntegrationSpec(operation, makeInvoice({ status: "draft" }));
  assert.equal(spec.activationReady, false); assert.equal(spec.canPhysicallyDelete, false); assert.equal(spec.platformStatus, "UNVERIFIED");
});
test("server authority requires complete oldest active membership, never caller role", () => {
  const s = setup(); assert.equal(deriveServerAuthority(s.session).role, "admin");
  s.session.memberships.unshift({ ...s.session.memberships[0], id: "old", created_date: "2025-01-01", role: "member" });
  assert.throws(() => deriveServerAuthority(s.session), /forbidden_role/);
});
for (const change of [s => { s.complete = false; }, s => { s.nextCursor = "more"; }, s => { s.userRecord.id = "other"; }, s => { s.userRecord.active_company_id = "foreign"; }]) {
  test("unverified or foreign server membership fails closed", async () => { const s = setup(); change(s.session); await assert.rejects(s.plan("cancel")); assert.equal(s.writes.length,0); });
}
test("membership revoked between prepare and commit cannot write", async () => {
  const s = setup(); const p = await s.plan("cancel"); s.session.memberships[0].status = "disabled";
  assert.equal((await s.c.commit(p)).outcome, "unknown"); assert.equal(s.writes.length,0);
});
for (const first of ["cancel","authorize_send"]) test(`shared fences coordinate ${first} winning race`, async () => {
  const s = await prepared(); const cancel = await s.plan("cancel"), send = await s.plan("authorize_send", { worker: s.claim.worker });
  const results = await Promise.all((first === "cancel" ? [cancel,send] : [send,cancel]).map(p => s.c.commit(p)));
  assert.equal(results.filter(r=>r.outcome === "applied").length,1);
  assert.equal(results.filter(r=>r.sendPermit).length,first === "cancel" ? 0 : 1);
});
test("concurrent claims use scalar company-scoped ID and both revisions", async () => {
  const s = setup(); const plans = await Promise.all([s.plan("acquire", {exportId:s.row.id}),s.plan("acquire", {exportId:s.row.id})]);
  const results = await Promise.all(plans.map(p=>s.c.commit(p)));
  assert.equal(results.filter(r=>r.outcome === "applied").length,1);
  for (const {query} of s.writes) { assert.equal(query.id,s.invoice.id); assert.equal(query.company_id,s.invoice.company_id); assert.ok("revision" in query && "accounting_revision" in query); }
});
for (const mode of ["reject","unknown_before","unknown_after","throw_after"]) test(`CAS ${mode} cannot issue or reconstruct send permit`, async () => {
  const s = await prepared(); const p = await s.plan("authorize_send", {worker:s.claim.worker});
  s.store.injectFault({operation:"invoice_cas",mode}); const result = await s.c.commit(p);
  assert.equal(result.sendPermit,null); assert.notEqual(result.outcome,"applied");
  assert.equal((await s.c.commit(p)).sendPermit,null);
  try {
    const retry = await s.plan("authorize_send", {worker:s.claim.worker});
    assert.equal(retry.decision.code,"audit_pending_or_invalid");
    assert.equal((await s.c.commit(retry)).sendPermit,null);
  } catch (error) { assert.match(error.message,/worker_not_authorized/); }
});
test("malformed acknowledgement after committed authorization stays unknown without readback", async () => {
  const s = await prepared(); const write = s.repository.conditionalInvoiceWrite;
  s.repository.conditionalInvoiceWrite = async q => { await write(q); s.repository.readInvoice = () => { throw Error("no postwrite read"); }; return {success:true,updated:"1",has_more:false}; };
  const p = await s.plan("authorize_send", {worker:s.claim.worker}); assert.equal((await s.c.commit(p)).outcome,"unknown");
  assert.ok(s.read()[f.send_authorized_at]);
});
test("original immutable destination cannot be replaced or disconnected before sending", async () => {
  const s = await prepared(); s.connection.destination_binding.ledgerId = "replacement";
  await assert.rejects(s.plan("authorize_send", {worker:s.claim.worker}), /destination/);
});
test("disabled original connection blocks admission without a write", async () => {
  const s = setup(); s.connection.status = "disabled"; const p = await s.plan("acquire", {exportId:s.row.id});
  assert.notEqual((await s.c.commit(p)).outcome,"applied"); assert.equal(s.writes.length,0);
});
test("projection requires independent persisted read and whole-field unset", async () => {
  const s = await acquired(); assert.equal((await s.drain()).outcome,"projected");
  assert.ok(s.writes[1].update.$unset); assert.equal(Object.hasOwn(s.read(),"accounting_pending_event"),false);
  assert.equal(s.store.readEvents().length,1); assert.equal((await s.drain()).outcome,"idle");
});
for (const mode of ["missing","throw_after"]) test(`failed projection read ${mode} preserves pending`, async () => {
  const s = await acquired(); s.store.injectFault({operation:"event_read",mode});
  assert.notEqual((await s.drain()).outcome,"projected"); assert.ok(s.read().accounting_pending_event);
});
test("append acknowledgement without persistence cannot clear", async () => {
  const s = await acquired(); s.repository.createAuditProjection = async payload => ({...payload,id:"fiction"});
  assert.notEqual((await s.drain()).outcome,"projected"); assert.ok(s.read().accounting_pending_event);
});
for (const mode of ["reject","unknown_before","unknown_after"]) test(`projection clear ${mode} never reports successful delivery`, async () => {
  const s = await acquired(); s.store.injectFault({operation:"invoice_cas",mode});
  assert.notEqual((await s.drain()).outcome,"projected");
  assert.equal(s.store.readEvents().length,1); assert.equal((await s.drain()).sendPermit,null);
});
test("conflicting duplicate logical projections block clearing", async () => {
  const s = await acquired(); const find = s.repository.findAuditProjections;
  s.repository.findAuditProjections = async scope => { const rows = await find(scope); return {...rows,items:[{id:"bad",event_key:scope.eventKey}]}; };
  assert.equal((await s.drain()).outcome,"blocked"); assert.ok(s.read().accounting_pending_event);
});
test("accounting transitions preserve every financial snapshot and total", async () => {
  const s = await prepared(); const before = s.invoice;
  for (const field of Object.keys(before).filter(k=> !["status","revision"].includes(k))) assert.deepEqual(s.read()[field],before[field]);
  const p = await s.plan("authorize_send", {worker:s.claim.worker}); await s.c.commit(p);
  for (const field of ["seller_snapshot","buyer_snapshot","payment_snapshot","line_items","total","vat_summary"]) assert.deepEqual(s.read()[field],before[field]);
});
test("compiler rejects broad predicates and financial mutation", async () => {
  const s = setup(); const p = await s.plan("acquire", {exportId:s.row.id}); const command = p.decision.command;
  assert.throws(()=>compileInvoiceCAS(s.invoice,{...command,where:{...command.where,id:{$in:[s.invoice.id]}}}), /predicate/);
  assert.throws(()=>compileInvoiceCAS(s.invoice,{...command,patch:{...command.patch,total:0}}), /unsafe_patch/);
});
test("known production bypasses remain visible and are not marked compatible", () => {
  const active = readFileSync(new URL("../../invoices-fns.js",import.meta.url),"utf8");
  const helper = readFileSync(new URL("../../invoiceWrites.server.js",import.meta.url),"utf8");
  assert.match(active,/Invoice\.delete/); assert.match(active,/cancelled_at/);
  assert.doesNotMatch(active,/offlinePersistenceBridge|lifecycleCoordinator/);
  assert.match(helper,/Number\(result\?\.updated/);
});
test("expired preparation requires recovery; expired sending cannot gain another permit", async () => {
  const s = await prepared(); s.setTime(s.read()[f.lease_expires_at] + 1);
  const stale = await s.plan("authorize_send", {worker:s.claim.worker}); assert.equal(stale.decision.ok,false);
  const recovery = await s.plan("recover"); assert.equal((await s.c.commit(recovery)).outcome,"applied");
  assert.equal(s.read()[f.state],"preparation_failed"); assert.equal((await s.drain()).outcome,"projected");
  const resume = await s.plan("resume_preparation",{retryApproved:true}); assert.equal((await s.c.commit(resume)).outcome,"applied");
  await s.drain(); const send = await s.plan("authorize_send",{worker:resume.worker}); assert.ok((await s.c.commit(send)).sendPermit);
  await s.drain(); s.setTime(s.read()[f.lease_expires_at] + 1);
  const recoverSend = await s.plan("recover"); assert.equal((await s.c.commit(recoverSend)).outcome,"applied");
  assert.equal(s.read()[f.state],"needs_reconciliation"); await s.drain();
  const retry = await s.plan("resume_preparation",{retryApproved:true}); assert.equal(retry.decision.ok,false);
});
test("identical physical projections deduplicate one logical event", async () => {
  const s = await acquired(); const create = s.repository.createAuditProjection;
  s.repository.createAuditProjection = async payload => { const first = await create(payload); await create(payload); return first; };
  assert.equal((await s.drain()).outcome,"projected"); assert.equal(s.store.readEvents().length,2);
  assert.equal(new Set(s.store.readEvents().map(e=>e.event_key)).size,1);
});
test("foreign record returned by a faulty repository is rejected", async () => {
  const s = setup(); s.repository.readInvoice = async () => ({...s.invoice,company_id:"foreign"});
  await assert.rejects(s.plan("cancel"),/invoice_not_found/); assert.equal(s.writes.length,0);
});
test("empty claim reference is legacy empty but malformed pending metadata is blocked", async () => {
  const s = setup({[f.ref]:"",accounting_pending_event:""});
  const plan = await s.plan("cancel"); assert.equal(plan.decision.code,"audit_pending_or_invalid"); assert.equal(s.writes.length,0);
});
test("deletion and compensation reject issued, claimed and authorized invoices", async () => {
  const s = await prepared();
  for (const operation of ["delete","restore"]) assert.equal(lifecycleIntegrationSpec(operation,s.read()).canPhysicallyDelete,false);
  const send = await s.plan("authorize_send",{worker:s.claim.worker}); await s.c.commit(send); await s.drain();
  for (const operation of ["cancel","delete","restore"]) assert.equal(lifecycleIntegrationSpec(operation,s.read()).blocker,"authorized_export_requires_resolution_or_correction");
  assert.equal(lifecycleIntegrationSpec("delete",makeInvoice()).blocker,"financial_record_locked");
});
