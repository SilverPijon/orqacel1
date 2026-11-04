import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createLifecycleCoordinator } from "../export/lifecycleCoordinator.server.js";
import { inspectPending, withPendingAudit, auditProjection, eventIdentity, MAX_PENDING_EVENT_BYTES } from "../export/auditOutbox.js";
import { createLifecycleAuditStore } from "../testing/lifecycleAuditStore.js";
import { makeInvoice, makeActor } from "../testing/fixtures.js";
import { MERIT_FIELDS as f, createExportCandidate, cancelInvoice } from "../export/claimProtocol.js";
import { canTransition, isDraft } from "../../invoiceLifecycle.js";
import { MOCK_LOOKUP_CONTRACT } from "../export/reconciliation.js";

function setup({ invoice = makeInvoice(), events = [], actor = makeActor(), projectionLimit } = {}) {
  const binding = { companyId: invoice.company_id, provider: "merit", connectionId: "c1", connectionRevision: 1,
    environment: "test", region: "ee", ledgerId: "synthetic-ledger", bindingId: "synthetic-binding" };
  const row = createExportCandidate({ invoice, actor: makeActor({ companyId: invoice.company_id }), binding, exportId: "export-1" }).row;
  const context = { ...actor, binding, membershipActive: true };
  const port = createLifecycleAuditStore({ invoices: [invoice], candidates: [row], events, context, projectionLimit });
  let now = 1000, token = 0, evidence;
  const factory = () => createLifecycleCoordinator({ port, clock: () => now, newToken: () => `server-worker-${++token}`, lookupEvidence: () => evidence });
  const c = factory(), input = { invoiceId: invoice.id };
  return { invoice, row, context, port, c, input, factory, read: () => port.readInvoice(invoice.id),
    setTime(value) { now = value; }, setEvidence(value) { evidence = value; },
    plan: (operation, extra = {}) => c.prepare(operation, { ...input, ...extra }),
    drain: () => c.projectAudit(input) };
}
async function acquired() {
  const ctx = setup();
  ctx.claim = await ctx.plan("acquire", { exportId: ctx.row.id });
  assert.equal((await ctx.c.commit(ctx.claim)).outcome, "applied");
  return ctx;
}
async function prepared() {
  const ctx = await acquired(); assert.equal((await ctx.drain()).outcome, "projected"); return ctx;
}
async function sending() {
  const ctx = await prepared();
  ctx.send = await ctx.plan("authorize_send", { worker: ctx.claim.worker });
  assert.ok((await ctx.c.commit(ctx.send)).sendPermit);
  return ctx;
}
const finance = (invoice) => Object.fromEntries(["number", "currency", "seller_snapshot", "buyer_snapshot", "payment_snapshot", "line_items", "vat_summary", "subtotal", "vat_amount", "total"].map((key) => [key, invoice[key]]));

test("claim and bounded audit evidence commit in the same Invoice CAS", async () => {
  const ctx = await acquired();
  const pending = inspectPending(ctx.read());
  assert.equal(pending.status, "pending");
  assert.equal(pending.event.action, "export_claimed");
  assert.equal(pending.event.claim_ref, ctx.row.id);
  assert.equal(pending.event.to_revision, ctx.read().accounting_revision);
  assert.ok(Buffer.byteLength(JSON.stringify(pending.event)) <= MAX_PENDING_EVENT_BYTES);
  assert.equal(ctx.port.readEvents().length, 0, "no independent event create is implied by transition success");
  assert.deepEqual(ctx.port.writes.map((w) => w.operation), ["invoice_transition"]);
});

test("occupied outbox blocks all further transitions without overwriting evidence", async () => {
  const ctx = await acquired(), before = ctx.read();
  for (const operation of ["acquire", "cancel", "authorize_send", "recover", "resume_preparation", "reconcile"]) {
    const plan = await ctx.plan(operation, { worker: ctx.claim.worker, exportId: ctx.row.id, retryApproved: true });
    assert.equal(plan.decision.code, "audit_pending_or_invalid");
    assert.equal((await ctx.c.commit(plan)).sendPermit, null);
    assert.deepEqual(ctx.read(), before);
  }
});

for (const first of ["cancel", "send"]) {
  test(`cancellation/send in competing order: ${first} wins exactly once with its audit`, async () => {
    const ctx = await prepared();
    const send = await ctx.plan("authorize_send", { worker: ctx.claim.worker });
    const cancel = await ctx.plan("cancel");
    const plans = first === "cancel" ? [cancel, send] : [send, cancel];
    const results = await Promise.all(plans.map((plan) => ctx.c.commit(plan)));
    assert.deepEqual(results.map((r) => r.outcome), ["applied", "conflict"]);
    assert.equal(results.filter((r) => r.sendPermit).length, first === "send" ? 1 : 0);
    assert.equal(ctx.read().accounting_pending_event.action, first === "send" ? "export_send_authorized" : "invoice_cancelled_before_send");
    assert.equal(ctx.read().status, first === "send" ? "issued" : "cancelled");
    assert.deepEqual(finance(ctx.read()), finance(ctx.invoice));
  });
}

test("simultaneous authorization and cancellation cannot both commit", async () => {
  const ctx = await prepared();
  const plans = await Promise.all([ctx.plan("cancel"), ctx.plan("authorize_send", { worker: ctx.claim.worker })]);
  const results = await Promise.all(plans.map((plan) => ctx.c.commit(plan)));
  assert.equal(results.filter((r) => r.outcome === "applied").length, 1);
  assert.equal(results.filter((r) => r.sendPermit).length, ctx.read().status === "cancelled" ? 0 : 1);
});

for (const operation of ["acquire", "cancel", "authorize_send"]) {
  for (const mode of ["reject", "unknown_before", "unknown_after", "throw_before", "throw_after"]) {
    test(`${operation} ${mode}: no successful response or permit from an uncertain/rejected write`, async () => {
      const ctx = operation === "acquire" ? setup() : await prepared();
      const plan = await ctx.plan(operation, { exportId: ctx.row.id, worker: ctx.claim?.worker });
      const before = ctx.read();
      ctx.port.injectFault({ operation: "invoice_cas", mode });
      const result = await ctx.c.commit(plan);
      assert.equal(result.outcome, mode === "reject" ? "conflict" : "unknown");
      assert.equal(result.sendPermit, null);
      assert.notEqual(result.projectionConfirmed, true);
      const committed = ["unknown_after", "throw_after"].includes(mode);
      if (committed) assert.equal(inspectPending(ctx.read()).status, "pending");
      else assert.deepEqual(ctx.read(), before);
      assert.equal((await ctx.c.commit(plan)).outcome, "blocked", "no automatic command replay");
    });
  }
}

test("readback confirms projection before outbox clear; clear advances only the accounting fence", async () => {
  const ctx = await acquired(), before = ctx.read();
  const result = await ctx.drain();
  assert.equal(result.outcome, "projected"); assert.equal(result.projectionConfirmed, true); assert.equal(result.sendPermit, null);
  assert.equal(ctx.read().accounting_pending_event, undefined);
  assert.equal(ctx.read().accounting_revision, before.accounting_revision + 1);
  assert.equal(ctx.read().revision, before.revision);
  assert.deepEqual(finance(ctx.read()), finance(before));
  const event = ctx.port.readEvents()[0];
  assert.equal(event.event_key, before.accounting_pending_event.event_key);
  assert.equal(event.occurred_at, before.accounting_pending_event.occurred_at);
  assert.equal("created_at" in event, false, "use the schema's occurred_at convention");
  assert.equal("actor_user_id" in event, false, "do not attribute old work to the projector");
});

for (const mode of ["unknown_before", "unknown_after", "throw_before", "throw_after", "reject", "ack_without_commit"]) {
  test(`interrupted event create ${mode} preserves pending evidence until independent proof`, async () => {
    const ctx = await acquired(), before = ctx.read();
    ctx.port.injectFault({ operation: "event_create", mode });
    const result = await ctx.drain();
    assert.notEqual(result.outcome, "projected");
    assert.deepEqual(ctx.read(), before);
    assert.equal(ctx.read().accounting_pending_event.event_key, before.accounting_pending_event.event_key);
    // Restart orchestration, preserving only the modeled persistent port data.
    const restarted = ctx.factory();
    assert.equal((await restarted.projectAudit(ctx.input)).outcome, "projected");
    const events = ctx.port.readEvents();
    assert.equal(new Set(events.map((e) => e.event_key)).size, 1);
    assert.equal(events.length, 1, "read existing committed copies before creating on an explicit retry");
  });
}

for (const mode of ["missing", "throw_before", "unknown_before", "unknown_after"]) {
  test(`event readback ${mode} cannot clear the slot merely because create succeeded`, async () => {
    const ctx = await acquired(), before = ctx.read();
    ctx.port.injectFault({ operation: "event_read", mode });
    assert.notEqual((await ctx.drain()).outcome, "projected");
    assert.deepEqual(ctx.read(), before);
    assert.equal(ctx.port.readEvents().length, 1);
    assert.equal((await ctx.drain()).outcome, "projected");
    assert.equal(ctx.port.readEvents().length, 1);
  });
}

for (const mode of ["incomplete", "reject", "unknown_before", "throw_before"]) {
  test(`unverified event search ${mode} retains evidence and creates no new projection`, async () => {
    const ctx = await acquired(), before = ctx.read();
    ctx.port.injectFault({ operation: "event_find", mode });
    assert.notEqual((await ctx.drain()).outcome, "projected");
    assert.deepEqual(ctx.read(), before);
    assert.equal(ctx.port.readEvents().length, 0);
  });
}

test("concurrent duplicate projectors clear once and create one logical event identity", async () => {
  const ctx = await acquired();
  const eventKey = ctx.read().accounting_pending_event.event_key;
  const results = await Promise.all([ctx.drain(), ctx.drain()]);
  assert.equal(results.filter((r) => r.outcome === "projected").length, 1);
  assert.equal(ctx.port.writes.filter((w) => w.operation === "audit_clear").length, 1);
  assert.ok(ctx.port.readEvents().every((row) => row.event_key === eventKey));
  assert.equal(new Set(ctx.port.readEvents().map((row) => row.event_key)).size, 1);
  assert.equal(ctx.read().accounting_revision, 2);
});

test("identical physical duplicate rows may confirm one logical event without uniqueness", async () => {
  const source = await acquired(), invoice = source.read();
  const payload = auditProjection(invoice, invoice.accounting_pending_event);
  const ctx = setup({ invoice, events: [{ id: "copy1", ...payload }, { id: "copy2", ...payload }] });
  assert.equal((await ctx.drain()).outcome, "projected");
  assert.equal(ctx.port.readEvents().length, 2);
  assert.equal(new Set(ctx.port.readEvents().map((row) => row.event_key)).size, 1);
});

test("conflicting duplicate rows block clearing instead of silently adopting a copy", async () => {
  const source = await acquired(), invoice = source.read();
  const payload = auditProjection(invoice, invoice.accounting_pending_event);
  const ctx = setup({ invoice, events: [{ id: "copy1", ...payload }, { id: "copy2", ...payload, occurred_at: 999 }] });
  assert.equal((await ctx.drain()).code, "audit_search_incomplete_or_conflicting");
  assert.deepEqual(ctx.read().accounting_pending_event, invoice.accounting_pending_event);
});

test("projection backpressure bounds duplicate search and never discards the slot", async () => {
  const source = await acquired(), invoice = source.read(), payload = auditProjection(invoice, invoice.accounting_pending_event);
  const ctx = setup({ invoice, projectionLimit: 1, events: [{ id: "a", ...payload }, { id: "b", ...payload }] });
  assert.equal((await ctx.drain()).code, "audit_search_incomplete_or_conflicting");
  assert.deepEqual(ctx.read().accounting_pending_event, invoice.accounting_pending_event);
});

for (const mode of ["reject", "unknown_before", "unknown_after", "throw_after"]) {
  test(`audit-clear CAS ${mode} never reports unverified projection delivery`, async () => {
    const ctx = await acquired(), before = ctx.read();
    ctx.port.injectFault({ operation: "invoice_cas", mode });
    const result = await ctx.drain();
    assert.notEqual(result.outcome, "projected"); assert.equal(result.sendPermit, null);
    assert.equal(ctx.port.readEvents().length, 1);
    if (["unknown_after", "throw_after"].includes(mode)) {
      assert.equal(ctx.read().accounting_pending_event, undefined);
      assert.equal((await ctx.drain()).outcome, "idle", "readback does not recreate the old transition/permission");
    } else {
      assert.deepEqual(ctx.read(), before);
      assert.equal((await ctx.drain()).outcome, "projected");
    }
  });
}

test("a delayed projector cannot clear a newer transition's pending event", async () => {
  const ctx = await acquired();
  let release, entered;
  const wait = new Promise((resolve) => { release = resolve; });
  const started = new Promise((resolve) => { entered = resolve; });
  ctx.port.injectFault({ operation: "event_read", mode: "pause_after", wait, entered });
  const oldProjector = ctx.drain(); await started;
  assert.equal((await ctx.drain()).outcome, "projected");
  await ctx.c.commit(await ctx.plan("authorize_send", { worker: ctx.claim.worker }));
  const newPending = ctx.read().accounting_pending_event;
  release();
  assert.equal((await oldProjector).outcome, "conflict");
  assert.deepEqual(ctx.read().accounting_pending_event, newPending);
});

test("expired preparation recovers, preserves history and fences the old generation", async () => {
  const ctx = await prepared();
  const staleSend = await ctx.plan("authorize_send", { worker: ctx.claim.worker });
  ctx.setTime(100000);
  assert.equal((await ctx.c.commit(await ctx.plan("recover"))).outcome, "applied");
  assert.equal(ctx.read().accounting_pending_event.action, "export_preparation_abandoned");
  assert.equal((await ctx.c.commit(staleSend)).sendPermit, null);
  await ctx.drain();
  const resumed = await ctx.plan("resume_preparation", { retryApproved: true });
  await ctx.c.commit(resumed); await ctx.drain();
  assert.equal(ctx.read()[f.attempt_number], 2);
  assert.equal(ctx.read()[f.ref], ctx.row.id);
  await assert.rejects(ctx.plan("authorize_send", { worker: ctx.claim.worker }), /worker_not_authorized/);
  assert.ok((await ctx.c.commit(await ctx.plan("authorize_send", { worker: resumed.worker }))).sendPermit);
});

test("authorized sending cannot cancel or rearm after expiry, recovery or authoritative absence", async () => {
  const ctx = await sending(), marker = ctx.read()[f.send_authorized_at];
  await ctx.drain(); ctx.setTime(100000);
  assert.equal((await ctx.plan("cancel")).decision.code, "accounting_outcome_unresolved");
  await ctx.c.commit(await ctx.plan("recover")); await ctx.drain();
  assert.equal(ctx.read()[f.state], "needs_reconciliation");
  ctx.setEvidence({ status: 200, bodyText: "[]", lookupEvidence: { contract: MOCK_LOOKUP_CONTRACT, complete: true,
    authoritative: true, invoiceNo: ctx.invoice.number, currency: ctx.invoice.currency, nextCursor: null } });
  assert.equal((await ctx.plan("reconcile")).decision.code, "sender_quiescence_unproven");
  assert.equal((await ctx.plan("resume_preparation", { retryApproved: true })).decision.code, "send_already_authorized");
  assert.equal(ctx.read()[f.send_authorized_at], marker);
});

test("trusted matching reconciliation records an audit event and requires correction for cancellation", async () => {
  const ctx = await sending(); await ctx.drain(); ctx.setTime(100000);
  await ctx.c.commit(await ctx.plan("recover")); await ctx.drain();
  ctx.setEvidence({ status: 200, bodyText: JSON.stringify([{ SIHId: "synthetic-doc", InvoiceNo: ctx.invoice.number,
    CurrencyCode: ctx.invoice.currency, TotalAmount: ctx.invoice.subtotal, VatAmount: ctx.invoice.vat_amount, TotalSum: ctx.invoice.total }]),
    lookupEvidence: { contract: MOCK_LOOKUP_CONTRACT, complete: true, authoritative: true, invoiceNo: ctx.invoice.number, currency: ctx.invoice.currency, nextCursor: null } });
  const result = await ctx.c.commit(await ctx.plan("reconcile"));
  assert.equal(result.outcome, "applied"); assert.equal(result.sendPermit, null);
  assert.equal(ctx.read().accounting_pending_event.action, "reconcile_found");
  await ctx.drain(); assert.equal((await ctx.plan("cancel")).decision.code, "correction_required");
});

for (const patch of [{ ledgerId: "other" }, { connectionId: "other" }, { environment: "live" }, { connectionRevision: 2 }]) {
  test(`immutable destination binding holds across audited actions: ${JSON.stringify(patch)}`, async () => {
    const ctx = await prepared(); Object.assign(ctx.context.binding, patch);
    assert.equal((await ctx.plan("authorize_send", { worker: ctx.claim.worker })).decision.ok, false);
    ctx.setTime(100000); assert.equal((await ctx.plan("recover")).decision.ok, false);
    assert.equal(ctx.read()[f.binding].ledgerId, "synthetic-ledger");
  });
}

for (const patch of [{ role: "member" }, { companyId: "foreign" }, { userId: null }, { membershipActive: false }]) {
  test(`authorization applies to transitions and projection: ${JSON.stringify(patch)}`, async () => {
    const ctx = await acquired(); Object.assign(ctx.context, patch);
    await assert.rejects(ctx.plan("cancel"));
    assert.equal((await ctx.drain()).outcome, "unknown");
    assert.equal(ctx.port.writes.length, 1);
  });
}

test("raw client metadata, ownership and reconciliation responses are never accepted", async () => {
  const ctx = await prepared();
  for (const extra of [{ actor: makeActor() }, { binding: ctx.context.binding }, { ownership: {} }, { response: { status: 200 } }, { patch: {} }]) {
    await assert.rejects(ctx.plan("cancel", extra), /invalid_intent/);
  }
  await assert.rejects(ctx.plan("authorize_send", { worker: structuredClone(ctx.claim.worker) }), /worker_not_authorized/);
  const plan = await ctx.plan("cancel");
  assert.equal((await ctx.c.commit(structuredClone(plan))).outcome, "blocked");
});

for (const reference of [undefined, null, ""]) {
  test(`legacy invoice with empty claim ${String(reference)} can cancel without rewriting finance`, async () => {
    const ctx = setup({ invoice: makeInvoice({ accounting_revision: null, [f.ref]: reference }) });
    const plan = await ctx.plan("cancel"); const result = await ctx.c.commit(plan);
    assert.equal(result.outcome, "applied"); assert.equal(result.sendPermit, null);
    assert.equal(ctx.read().status, "cancelled"); assert.equal(ctx.read().revision, ctx.invoice.revision + 1);
    assert.deepEqual(finance(ctx.read()), finance(ctx.invoice));
    assert.equal(ctx.read().accounting_pending_event.provider, "invoice");
    assert.equal((await ctx.drain()).outcome, "projected");
    assert.equal("provider" in ctx.port.readEvents()[0], false, "do not misattribute an unclaimed cancellation to Merit");
  });
}

test("legacy nonempty or partial claims block cancellation rather than resetting history", async () => {
  for (const metadata of [{ [f.ref]: "old-claim" }, { [f.send_authorized_at]: "historical" }, { [f.ref]: "", [f.at]: "historical" }]) {
    const ctx = setup({ invoice: makeInvoice(metadata) });
    assert.equal((await ctx.plan("cancel")).decision.ok, false);
    assert.equal(ctx.port.writes.length, 0);
  }
});

test("existing draft/issued/cancelled lifecycle table remains compatible outside accounting conflicts", async () => {
  for (const status of ["draft", "issued", "cancelled"]) {
    const ctx = setup({ invoice: makeInvoice({ status }) });
    assert.equal((await ctx.plan("cancel")).decision.ok, canTransition(status, "cancelled"));
    assert.equal(isDraft(ctx.invoice), status === "draft");
  }
  assert.equal(canTransition("draft", "issued"), true);
  assert.equal(canTransition("issued", "draft"), false);
  assert.equal(canTransition("cancelled", "issued"), false);
});

test("invalid pending metadata and request/credential-shaped objects cannot be overwritten or projected", async () => {
  for (const pending of ["", {}, { event_key: "old" }, { secret: "DO-NOT-STORE", request_body: "DO-NOT-STORE" }]) {
    const ctx = setup({ invoice: makeInvoice({ accounting_pending_event: pending }) });
    assert.equal((await ctx.plan("cancel")).decision.code, "audit_pending_or_invalid");
    assert.equal((await ctx.drain()).code, "invalid_pending_audit");
    assert.deepEqual(ctx.read().accounting_pending_event, pending);
    assert.equal(ctx.port.writes.length, 0);
  }
});

test("event identities are deterministic, tenant scoped and do not incorporate free-form bodies", () => {
  const invoice = makeInvoice(), actor = makeActor();
  const raw = cancelInvoice({ invoice, actor, now: 1000 });
  const a = withPendingAudit({ invoice, decision: raw, now: 1000 });
  const b = withPendingAudit({ invoice, decision: raw, now: 2000 });
  assert.equal(a.command.patch.accounting_pending_event.event_key, b.command.patch.accounting_pending_event.event_key);
  const event = a.command.patch.accounting_pending_event;
  assert.notEqual(eventIdentity({ ...invoice, company_id: "other" }, event), event.event_key);
  assert.ok(!JSON.stringify(event).includes(invoice.buyer_snapshot.email));
  assert.deepEqual(Object.keys(event).sort(), ["action", "event_key", "from_revision", "occurred_at", "provider", "to_revision"].sort());
});

test("outbox and projections use only already prepared schema fields", async () => {
  const ctx = await acquired();
  const invoiceSchema = JSON.parse(readFileSync(new URL("../../../../base44/entities/Invoice.jsonc", import.meta.url), "utf8"));
  const eventSchema = JSON.parse(readFileSync(new URL("../../../../base44/entities/AccountingExportEvent.jsonc", import.meta.url), "utf8"));
  assert.ok(Object.keys(ctx.read().accounting_pending_event).every((key) => key in invoiceSchema.properties.accounting_pending_event.properties));
  await ctx.drain();
  assert.ok(Object.keys(ctx.port.readEvents()[0]).every((key) => key === "id" || key in eventSchema.properties));
});

test("projection payload cannot accept extra credential/provider body fields", async () => {
  const ctx = await acquired(), invoice = ctx.read();
  const payload = auditProjection(invoice, invoice.accounting_pending_event);
  await assert.rejects(ctx.port.createAuditProjection({ ...payload, api_key: "DO-NOT-STORE", response: { secret: "DO-NOT-STORE" } }), /untrusted_projection/);
  assert.equal(ctx.port.readEvents().length, 0);
});

for (const first of ["recover", "cancel"]) {
  test(`expired-preparation recovery and cancellation cannot overwrite each other: ${first} first`, async () => {
    const ctx = await prepared(); ctx.setTime(100000);
    const recover = await ctx.plan("recover"), cancel = await ctx.plan("cancel");
    const plans = first === "recover" ? [recover, cancel] : [cancel, recover];
    const results = await Promise.all(plans.map((plan) => ctx.c.commit(plan)));
    assert.deepEqual(results.map((r) => r.outcome), ["applied", "conflict"]);
    assert.equal(ctx.read().accounting_pending_event.action, first === "cancel" ? "invoice_cancelled_before_send" : "export_preparation_abandoned");
  });
}

test("late original authorization acknowledgement cannot create a replacement or overwrite recovery evidence", async () => {
  const ctx = await prepared();
  let release, entered;
  const wait = new Promise((resolve) => { release = resolve; });
  const started = new Promise((resolve) => { entered = resolve; });
  ctx.port.injectFault({ operation: "invoice_cas", mode: "pause_after", wait, entered });
  const pending = ctx.c.commit(await ctx.plan("authorize_send", { worker: ctx.claim.worker }));
  await started;
  await ctx.drain(); ctx.setTime(100000);
  await ctx.c.commit(await ctx.plan("recover"));
  const recoveryEvent = ctx.read().accounting_pending_event;
  release();
  assert.ok((await pending).sendPermit, "an already authorized original worker may still resume");
  assert.equal(ctx.read()[f.state], "needs_reconciliation");
  assert.deepEqual(ctx.read().accounting_pending_event, recoveryEvent);
  await ctx.drain();
  await assert.rejects(ctx.plan("authorize_send", { worker: ctx.claim.worker }), /worker_not_authorized/);
});

test("membership revocation during projection prevents outbox acknowledgement", async () => {
  const ctx = await acquired();
  let release, entered;
  const wait = new Promise((resolve) => { release = resolve; });
  const started = new Promise((resolve) => { entered = resolve; });
  ctx.port.injectFault({ operation: "event_read", mode: "pause_after", wait, entered });
  const projection = ctx.drain(); await started;
  const pending = ctx.read().accounting_pending_event;
  ctx.context.membershipActive = false; release();
  assert.equal((await projection).outcome, "unknown");
  ctx.context.membershipActive = true;
  assert.deepEqual(ctx.read().accounting_pending_event, pending);
  assert.equal((await ctx.drain()).outcome, "projected");
});

test("malformed audit-clear images cannot claim that the authorization marker or financial data stayed intact", async () => {
  const ctx = await sending();
  const original = ctx.port.compareAndSet;
  ctx.port.compareAndSet = async (command) => {
    const result = await original(command);
    if (command.unset && result.status === "applied") delete result.invoice[f.send_authorized_at];
    return result;
  };
  assert.equal((await ctx.drain()).outcome, "unknown");
  assert.ok(ctx.read()[f.send_authorized_at], "model persistence did not clear the irreversible marker");
});

test("explicit projection retry preserves the original occurrence time and logical identity", async () => {
  const ctx = await acquired(), before = ctx.read().accounting_pending_event;
  ctx.port.injectFault({ operation: "event_create", mode: "unknown_after" });
  await ctx.drain(); ctx.setTime(999999);
  assert.equal((await ctx.factory().projectAudit(ctx.input)).outcome, "projected");
  const event = ctx.port.readEvents()[0];
  assert.equal(event.occurred_at, before.occurred_at);
  assert.equal(event.event_key, before.event_key);
});

test("an uncommitted planned event cannot be projected as a durable transition", async () => {
  const ctx = setup();
  const plan = await ctx.plan("acquire", { exportId: ctx.row.id });
  const hypothetical = { ...ctx.read(), ...plan.decision.command.patch };
  const payload = auditProjection(hypothetical, hypothetical.accounting_pending_event);
  await assert.rejects(ctx.port.createAuditProjection(payload), /untrusted_projection/);
  assert.equal(ctx.port.readEvents().length, 0);
  assert.equal(ctx.read()[f.ref], undefined);
});

test("current production cancellation predicate remains a documented integration blocker", async () => {
  const ctx = await prepared(), oldRead = ctx.read();
  const oldPredicate = { id: oldRead.id, company_id: oldRead.company_id, status: oldRead.status, revision: oldRead.revision };
  await ctx.c.commit(await ctx.plan("authorize_send", { worker: ctx.claim.worker }));
  const after = ctx.read();
  assert.ok(Object.entries(oldPredicate).every(([key, value]) => after[key] === value), "legacy status/revision-only predicate still matches after authorization");
  assert.notEqual(after.accounting_revision, oldRead.accounting_revision, "the coordinated predicate would lose its race");
});
