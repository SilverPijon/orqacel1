import test from "node:test";
import assert from "node:assert/strict";
import { createBase44ClaimStore } from "../export/base44ClaimStore.server.js";
import { commitClaimDecision } from "../export/claimPort.js";
import { MERIT_FIELDS as f, acquireClaim } from "../export/claimProtocol.js";
import { createBase44ClaimSdkFake, SYNTHETIC_PROOF } from "../testing/base44ClaimSdkFake.js";
import { makeInvoice, makeActor } from "../testing/fixtures.js";
import { MOCK_LOOKUP_CONTRACT } from "../export/reconciliation.js";

function setup(options = {}) {
  const fake = createBase44ClaimSdkFake(options);
  const store = createBase44ClaimStore({ context: fake.context, platformProof: SYNTHETIC_PROOF,
    clock: fake.clock, newToken: fake.newToken, lookupEvidence: () => fake.state.lookupResponse });
  return { ...fake, store, commit: (plan) => commitClaimDecision(store, plan.decision) };
}

async function candidate(ctx) {
  const row = await ctx.store.prepareCandidate({ invoiceId: ctx.invoice.id, connectionId: ctx.binding.connectionId });
  const result = await ctx.store.createCandidate(row);
  assert.equal(result.status, "applied");
  return result.row;
}

async function prepared(options) {
  const ctx = setup(options);
  ctx.row = await candidate(ctx);
  ctx.claim = await ctx.store.prepareTransition("acquire", { invoiceId: ctx.invoice.id, exportId: ctx.row.id });
  assert.equal((await ctx.commit(ctx.claim)).outcome, "applied");
  return ctx;
}

async function sending(options) {
  const ctx = await prepared(options);
  ctx.state.now = 2000;
  const plan = await ctx.store.prepareTransition("authorize_send", { invoiceId: ctx.invoice.id, worker: ctx.claim.worker });
  assert.ok((await ctx.commit(plan)).sendPermit);
  return ctx;
}

test("unwired factory has no side effects; default writes are disabled even for known commands", async () => {
  const ctx = setup();
  const store = createBase44ClaimStore({ context: ctx.context });
  assert.equal(ctx.calls.length, 0);
  assert.equal((await store.createCandidate({})).code, "writes_disabled_platform_unverified");
  assert.equal((await store.compareAndSet({})).code, "writes_disabled_platform_unverified");
  assert.equal(ctx.calls.length, 0);
});

test("incomplete platform evidence cannot enable writes", async () => {
  const ctx = setup();
  for (const patch of [{ scalarIdCAS: false }, { legacyNullEquality: false }, { nullableSchemaAccepted: false }, { evidenceId: "" }]) {
    const store = createBase44ClaimStore({ context: ctx.context, platformProof: { ...SYNTHETIC_PROOF, ...patch } });
    assert.equal((await store.compareAndSet({})).status, "unknown");
  }
  assert.equal(ctx.calls.length, 0);
});

test("Base44-assigned candidate ID replaces the server-only placeholder", async () => {
  const ctx = setup();
  const row = await candidate(ctx);
  assert.match(row.id, /^base44-export-/);
  const call = ctx.calls.find((c) => c.name === "AccountingExport.create");
  assert.equal("id" in call.args[0], false);
  assert.equal(call.args[0].projection_status, "candidate");
  assert.equal(call.args[0].requested_by_id, "u_1");
  const claim = await ctx.store.prepareTransition("acquire", { invoiceId: ctx.invoice.id, exportId: row.id });
  await ctx.commit(claim);
  assert.equal(ctx.read()[f.ref], row.id);
});

test("raw JSON candidates and commands are not executable claim metadata", async () => {
  const ctx = setup();
  const row = await ctx.store.prepareCandidate({ invoiceId: ctx.invoice.id, connectionId: ctx.binding.connectionId });
  assert.equal((await ctx.store.createCandidate(structuredClone(row))).code, "untrusted_candidate");
  const saved = await ctx.store.createCandidate(row);
  const plan = await ctx.store.prepareTransition("acquire", { invoiceId: ctx.invoice.id, exportId: saved.row.id });
  assert.equal((await ctx.store.compareAndSet(structuredClone(plan.decision.command))).code, "untrusted_or_consumed_command");
  assert.equal(ctx.calls.some((call) => call.name === "Invoice.updateMany"), false);
});

test("client metadata is rejected and opaque worker handles cannot be forged", async () => {
  const ctx = await prepared();
  await assert.rejects(ctx.store.prepareCandidate({ invoiceId: ctx.invoice.id, connectionId: ctx.binding.connectionId, binding: ctx.binding }), /invalid_intent/);
  await assert.rejects(ctx.store.prepareTransition("cancel", { invoiceId: ctx.invoice.id, accounting_revision: 99 }), /invalid_intent/);
  await assert.rejects(ctx.store.prepareTransition("reconcile", { invoiceId: ctx.invoice.id, response: { status: 200, bodyText: "[]" } }), /invalid_intent/);
  await assert.rejects(ctx.store.prepareTransition("authorize_send", { invoiceId: ctx.invoice.id, worker: structuredClone(ctx.claim.worker) }), /worker_not_authorized/);
});

test("only acknowledged acquisition enables a worker; candidate creation and readback do not", async () => {
  const ctx = setup();
  const row = await candidate(ctx);
  const plan = await ctx.store.prepareTransition("acquire", { invoiceId: ctx.invoice.id, exportId: row.id });
  await assert.rejects(ctx.store.prepareTransition("authorize_send", { invoiceId: ctx.invoice.id, worker: plan.worker }), /worker_not_authorized/);
  ctx.storage.injectFault({ operation: "cas", mode: "unknown_after" });
  assert.equal((await ctx.commit(plan)).outcome, "unknown");
  assert.equal((await ctx.store.getInvoice({ id: ctx.invoice.id, companyId: ctx.invoice.company_id }))[f.state], "preparing");
  await assert.rejects(ctx.store.prepareTransition("authorize_send", { invoiceId: ctx.invoice.id, worker: plan.worker }), /worker_not_authorized/);
});

test("scalar-ID conditional write uses only explicit $set and never rereads after acknowledgement", async () => {
  const ctx = await prepared();
  ctx.state.now = 2000;
  const plan = await ctx.store.prepareTransition("authorize_send", { invoiceId: ctx.invoice.id, worker: ctx.claim.worker });
  ctx.calls.length = 0;
  assert.ok((await ctx.commit(plan)).sendPermit);
  const index = ctx.calls.findIndex((call) => call.name === "Invoice.updateMany");
  const [where, data] = ctx.calls[index].args;
  assert.equal(where.id, ctx.invoice.id);
  assert.equal(where.company_id, ctx.invoice.company_id);
  assert.equal(where.accounting_revision, 1);
  assert.deepEqual(Object.keys(data), ["$set"]);
  assert.equal(data.$set.accounting_revision, 2);
  assert.equal(where[f.send_authorized_at], null);
  assert.equal(ctx.calls.slice(index + 1).some((call) => call.name === "Invoice.get"), false);
});

test("concurrent claims with duplicate export rows produce only one canonical owner", async () => {
  const ctx = setup();
  const a = await candidate(ctx), b = await candidate(ctx);
  assert.equal(a.export_key, b.export_key);
  const plans = await Promise.all([a, b].map((row) => ctx.store.prepareTransition("acquire", { invoiceId: ctx.invoice.id, exportId: row.id })));
  const results = await Promise.all(plans.map(ctx.commit));
  assert.deepEqual(results.map((r) => r.outcome).sort(), ["applied", "conflict"]);
  assert.ok([a.id, b.id].includes(ctx.read()[f.ref]));
  const loser = plans[results.findIndex((r) => r.outcome === "conflict")];
  await assert.rejects(ctx.store.prepareTransition("authorize_send", { invoiceId: ctx.invoice.id, worker: loser.worker }), /worker_not_authorized/);
});

for (const first of ["authorize_send", "cancel"]) {
  test(`adapter cancellation race: ${first} wins exclusively`, async () => {
    const ctx = await prepared();
    ctx.state.now = 2000;
    const send = await ctx.store.prepareTransition("authorize_send", { invoiceId: ctx.invoice.id, worker: ctx.claim.worker });
    const cancel = await ctx.store.prepareTransition("cancel", { invoiceId: ctx.invoice.id });
    const plans = first === "authorize_send" ? [send, cancel] : [cancel, send];
    const results = await Promise.all(plans.map(ctx.commit));
    assert.deepEqual(results.map((r) => r.outcome), ["applied", "conflict"]);
    assert.equal(results.filter((r) => r.sendPermit).length, first === "authorize_send" ? 1 : 0);
    assert.equal(ctx.read().status, first === "cancel" ? "cancelled" : "issued");
  });
}

for (const mode of ["reject", "unknown_before", "unknown_after", "throw_before", "throw_after"]) {
  test(`authorization ${mode} fails closed and consumes its handle`, async () => {
    const ctx = await prepared();
    const plan = await ctx.store.prepareTransition("authorize_send", { invoiceId: ctx.invoice.id, worker: ctx.claim.worker });
    ctx.storage.injectFault({ operation: "cas", mode });
    const result = await ctx.commit(plan);
    assert.equal(result.outcome, mode === "reject" ? "conflict" : "unknown");
    assert.equal(result.sendPermit, null);
    assert.equal((await ctx.commit(plan)).outcome, "unknown");
    await assert.rejects(ctx.store.prepareTransition("authorize_send", { invoiceId: ctx.invoice.id, worker: ctx.claim.worker }), /worker_not_authorized/);
    if (["unknown_after", "throw_after"].includes(mode)) assert.equal(ctx.read()[f.state], "sending");
  });
}

for (const result of [
  { success: true, updated: "1", has_more: false }, { success: true, updated: 2, has_more: false },
  { success: false, updated: 1, has_more: false }, { success: true, updated: 1 }, { success: true, updated: 1, has_more: true },
]) {
  test(`malformed update acknowledgement is unknown: ${JSON.stringify(result)}`, async () => {
    const ctx = await prepared();
    const plan = await ctx.store.prepareTransition("authorize_send", { invoiceId: ctx.invoice.id, worker: ctx.claim.worker });
    ctx.state.updateResponse = result;
    const ack = await ctx.commit(plan);
    assert.equal(ack.outcome, "unknown");
    assert.equal(ack.sendPermit, null);
    assert.equal(ctx.read()[f.state], "sending");
  });
}

for (const changed of ["member", "inactive", "foreign", "logged_out", "truncated"]) {
  test(`authorization is revalidated before writes: ${changed}`, async () => {
    const ctx = setup();
    const row = await candidate(ctx);
    const plan = await ctx.store.prepareTransition("acquire", { invoiceId: ctx.invoice.id, exportId: row.id });
    if (changed === "member") ctx.state.memberships[0].role = "member";
    if (changed === "inactive") ctx.state.memberships[0].status = "revoked";
    if (changed === "foreign") ctx.state.userRecord.active_company_id = "other";
    if (changed === "logged_out") ctx.state.user = null;
    if (changed === "truncated") ctx.state.nextCursor = "page2";
    const result = await ctx.commit(plan);
    assert.equal(result.sendPermit, null);
    assert.equal(ctx.calls.some((c) => c.name === "Invoice.updateMany"), false);
  });
}

test("older member membership cannot be overridden by a later admin row", async () => {
  const ctx = setup();
  ctx.state.memberships.push({ ...ctx.state.memberships[0], id: "older", role: "member", created_date: "2025-01-01T00:00:00Z" });
  await assert.rejects(ctx.store.getInvoice({ id: ctx.invoice.id, companyId: ctx.invoice.company_id }), /forbidden_role/);
});

test("foreign records and company scopes are never returned", async () => {
  const foreign = makeInvoice({ id: "foreign-invoice", company_id: "other" });
  const ctx = setup({ moreInvoices: [foreign] });
  assert.equal(await ctx.store.getInvoice({ id: foreign.id, companyId: ctx.invoice.company_id }), null);
  await assert.rejects(ctx.store.getInvoice({ id: foreign.id, companyId: "other" }), /forbidden_company/);
  await assert.rejects(ctx.store.prepareCandidate({ invoiceId: foreign.id, connectionId: ctx.binding.connectionId }), /invoice_not_found/);
});

for (const field of ["connectionId", "connectionRevision", "environment", "ledgerId", "region", "bindingId", "companyId", "provider"]) {
  test(`destination changes between planning and CAS are rejected: ${field}`, async () => {
    const ctx = await prepared();
    const plan = await ctx.store.prepareTransition("authorize_send", { invoiceId: ctx.invoice.id, worker: ctx.claim.worker });
    ctx.state.connection.destination_binding[field] = field === "connectionRevision" ? 99 : "changed";
    const result = await ctx.commit(plan);
    assert.equal(result.sendPermit, null);
    assert.equal(ctx.calls.filter((c) => c.name === "Invoice.updateMany").length, 1, "only the initial acquisition wrote");
  });
}

test("a disconnected connection cannot newly authorize sending", async () => {
  const ctx = await prepared();
  const plan = await ctx.store.prepareTransition("authorize_send", { invoiceId: ctx.invoice.id, worker: ctx.claim.worker });
  ctx.state.connection.status = "disabled";
  assert.equal((await ctx.commit(plan)).sendPermit, null);
  assert.equal(ctx.read()[f.send_authorized_at], null);
});

test("recovery can read an unchanged disabled original connection without choosing another destination", async () => {
  const ctx = await sending();
  ctx.state.now = 100000;
  ctx.state.connection.status = "disabled";
  const plan = await ctx.store.prepareTransition("recover", { invoiceId: ctx.invoice.id });
  assert.equal((await ctx.commit(plan)).outcome, "applied");
  assert.equal(ctx.read()[f.state], "needs_reconciliation");
  ctx.state.lookupResponse = { status: 200, bodyText: "[]", lookupEvidence: { contract: MOCK_LOOKUP_CONTRACT,
    complete: true, authoritative: true, invoiceNo: ctx.invoice.number, currency: ctx.invoice.currency, nextCursor: null } };
  const absent = await ctx.store.prepareTransition("reconcile", { invoiceId: ctx.invoice.id });
  assert.equal(absent.decision.code, "sender_quiescence_unproven");
  assert.equal(ctx.read()[f.state], "needs_reconciliation");
});

test("expired preparation can recover and explicitly resume with a new server worker", async () => {
  const ctx = await prepared();
  ctx.state.now = 100000;
  assert.equal((await ctx.commit(await ctx.store.prepareTransition("recover", { invoiceId: ctx.invoice.id }))).outcome, "applied");
  const resumed = await ctx.store.prepareTransition("resume_preparation", { invoiceId: ctx.invoice.id, retryApproved: true });
  assert.equal((await ctx.commit(resumed)).outcome, "applied");
  const old = await ctx.store.prepareTransition("authorize_send", { invoiceId: ctx.invoice.id, worker: ctx.claim.worker });
  assert.equal(old.decision.code, "stale_worker");
  assert.ok((await ctx.commit(await ctx.store.prepareTransition("authorize_send", { invoiceId: ctx.invoice.id, worker: resumed.worker }))).sendPermit);
});

for (const value of [undefined, null, ""]) {
  test(`legacy empty claim ${String(value)} uses exact predicates without backfill`, async () => {
    const ctx = await prepared({ invoice: makeInvoice({ accounting_revision: null, [f.ref]: value }) });
    const [where, data] = ctx.calls.find((c) => c.name === "Invoice.updateMany").args;
    assert.equal(where.accounting_revision, null);
    assert.equal(where[f.ref], value ?? null);
    assert.equal(data.$set.accounting_revision, 1);
    for (const key of ["seller_snapshot", "buyer_snapshot", "payment_snapshot", "line_items", "subtotal", "vat_amount", "total"]) {
      assert.equal(key in data.$set, false);
      assert.deepEqual(ctx.read()[key], ctx.invoice[key]);
    }
  });
}

test("existing incomplete Merit claims are preserved and never reset/adopted automatically", async () => {
  const ctx = setup({ invoice: makeInvoice({ [f.ref]: "historical-reference", [f.at]: "2025-01-01T00:00:00Z" }) });
  const row = await candidate(ctx);
  const plan = await ctx.store.prepareTransition("acquire", { invoiceId: ctx.invoice.id, exportId: row.id });
  assert.equal(plan.decision.code, "already_claimed");
  await assert.rejects(ctx.store.prepareTransition("cancel", { invoiceId: ctx.invoice.id }), /candidate_not_found/);
  assert.equal(ctx.read()[f.ref], "historical-reference");
  assert.equal(ctx.calls.some((c) => c.name === "Invoice.updateMany"), false);
});

test("a pure client-forged acquisition command cannot bypass server planning", async () => {
  const ctx = setup();
  const row = await candidate(ctx);
  const decision = acquireClaim({ invoice: ctx.invoice, actor: makeActor(), binding: ctx.binding, exportRow: row, attemptToken: "browser-token", now: 1000 });
  assert.equal((await ctx.store.compareAndSet(decision.command)).code, "untrusted_or_consumed_command");
  assert.equal(ctx.calls.some((c) => c.name === "Invoice.updateMany"), false);
});

test("two prepared send commands cannot reuse a consumed worker after uncertainty", async () => {
  const ctx = await prepared();
  const a = await ctx.store.prepareTransition("authorize_send", { invoiceId: ctx.invoice.id, worker: ctx.claim.worker });
  const b = await ctx.store.prepareTransition("authorize_send", { invoiceId: ctx.invoice.id, worker: ctx.claim.worker });
  ctx.storage.injectFault({ operation: "cas", mode: "unknown_before" });
  assert.equal((await ctx.commit(a)).outcome, "unknown");
  assert.equal((await ctx.commit(b)).outcome, "unknown");
  assert.equal(ctx.read()[f.state], "preparing");
  assert.equal(ctx.calls.filter((c) => c.name === "Invoice.updateMany").length, 2, "acquire plus one uncertain authorization, no replay");
});

test("expiry between planning and writing cannot grant a late send", async () => {
  const ctx = await prepared();
  const plan = await ctx.store.prepareTransition("authorize_send", { invoiceId: ctx.invoice.id, worker: ctx.claim.worker });
  ctx.state.now = 100000;
  assert.equal((await ctx.commit(plan)).outcome, "conflict");
  assert.equal(ctx.read()[f.state], "preparing");
  assert.equal(ctx.calls.filter((c) => c.name === "Invoice.updateMany").length, 1);
});

test("an outage while reloading the Invoice grants nothing and writes nothing", async () => {
  const ctx = await prepared();
  const plan = await ctx.store.prepareTransition("authorize_send", { invoiceId: ctx.invoice.id, worker: ctx.claim.worker });
  ctx.state.readError = true;
  const result = await ctx.commit(plan);
  assert.equal(result.outcome, "unknown");
  assert.equal(result.sendPermit, null);
  assert.equal(ctx.calls.filter((c) => c.name === "Invoice.updateMany").length, 1);
});

test("an uncertain candidate create cannot install an Invoice claim", async () => {
  const ctx = setup();
  const row = await ctx.store.prepareCandidate({ invoiceId: ctx.invoice.id, connectionId: ctx.binding.connectionId });
  ctx.storage.injectFault({ operation: "create", mode: "unknown_after" });
  assert.equal((await ctx.store.createCandidate(row)).status, "unknown");
  assert.equal((await ctx.store.createCandidate(row)).code, "untrusted_candidate");
  assert.equal(ctx.read()[f.ref], undefined);
  assert.equal(ctx.calls.filter((c) => c.name === "AccountingExport.create").length, 1);
});

test("a new adapter instance cannot reconstruct worker authority from an Invoice read", async () => {
  const ctx = await prepared();
  const other = createBase44ClaimStore({ context: ctx.context, platformProof: SYNTHETIC_PROOF, clock: ctx.clock });
  const read = await other.getInvoice({ id: ctx.invoice.id, companyId: ctx.invoice.company_id });
  assert.equal(read[f.state], "preparing");
  await assert.rejects(other.prepareTransition("authorize_send", { invoiceId: ctx.invoice.id, worker: ctx.claim.worker }), /worker_not_authorized/);
  const plan = await ctx.store.prepareTransition("cancel", { invoiceId: ctx.invoice.id });
  assert.equal((await other.compareAndSet(plan.decision.command)).code, "untrusted_or_consumed_command");
});

test("trusted synthetic matching evidence settles reconciliation without a new send authorization", async () => {
  const ctx = await sending();
  ctx.state.now = 100000;
  await ctx.commit(await ctx.store.prepareTransition("recover", { invoiceId: ctx.invoice.id }));
  const marker = ctx.read()[f.send_authorized_at];
  ctx.state.lookupResponse = { status: 200, bodyText: JSON.stringify([{
    SIHId: "synthetic-document", InvoiceNo: ctx.invoice.number, CurrencyCode: ctx.invoice.currency,
    TotalAmount: ctx.invoice.subtotal, VatAmount: ctx.invoice.vat_amount, TotalSum: ctx.invoice.total,
  }]), lookupEvidence: { contract: MOCK_LOOKUP_CONTRACT, complete: true, authoritative: true,
    invoiceNo: ctx.invoice.number, currency: ctx.invoice.currency, nextCursor: null } };
  const a = await ctx.store.prepareTransition("reconcile", { invoiceId: ctx.invoice.id });
  const b = await ctx.store.prepareTransition("reconcile", { invoiceId: ctx.invoice.id });
  const results = await Promise.all([ctx.commit(a), ctx.commit(b)]);
  assert.deepEqual(results.map((r) => r.outcome).sort(), ["applied", "conflict"]);
  assert.ok(results.every((r) => r.sendPermit === null));
  assert.equal(ctx.read()[f.state], "exported");
  assert.equal(ctx.read()[f.send_authorized_at], marker);
});

for (const patch of [{ configuration_revision: null }, { destination_binding: null }, { destination_verified_at: undefined }]) {
  test(`legacy/unverified connections cannot create bound candidates: ${JSON.stringify(patch)}`, async () => {
    const ctx = setup();
    Object.assign(ctx.state.connection, patch);
    await assert.rejects(ctx.store.prepareCandidate({ invoiceId: ctx.invoice.id, connectionId: ctx.binding.connectionId }), /destination_unverified/);
    assert.equal(ctx.calls.some((c) => c.name === "AccountingExport.create" || c.name === "Invoice.updateMany"), false);
  });
}
