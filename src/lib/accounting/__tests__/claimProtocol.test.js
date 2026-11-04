import test from "node:test";
import assert from "node:assert/strict";
import {
  MERIT_FIELDS as f, CLAIM_STATES as states, claimIdentity, createExportCandidate,
  acquireClaim, authorizeSend, recoverClaim, resumePreparation, cancelInvoice, reconcileClaim,
} from "../export/claimProtocol.js";
import { commitClaimDecision } from "../export/claimPort.js";
import { MOCK_LOOKUP_CONTRACT } from "../export/reconciliation.js";
import { createInvoiceClaimStore } from "../testing/invoiceClaimStore.js";
import { makeInvoice, makeActor, deepFreeze } from "../testing/fixtures.js";

function setup({ invoice = makeInvoice(), actor = makeActor(), binding = {}, exportId = "export_1" } = {}) {
  binding = {
    companyId: invoice.company_id, provider: "merit", connectionId: "connection_1", connectionRevision: 1,
    environment: "test", region: "ee", ledgerId: "mock-ledger", bindingId: "mock-binding", ...binding,
  };
  const candidate = createExportCandidate({ invoice, actor, binding, exportId });
  const row = candidate.row;
  const store = createInvoiceClaimStore({ invoices: [invoice], candidates: row ? [row] : [] });
  const read = () => store.getInvoice({ id: invoice.id, companyId: invoice.company_id });
  const args = (patch = {}) => ({ invoice: read(), actor, binding, exportRow: row, now: 1000, leaseMs: 1000, ...patch });
  const acquire = (patch = {}) => acquireClaim(args({ attemptToken: "worker-1", ...patch }));
  const owner = (patch = {}) => ({ claimRef: row.id, attemptToken: "worker-1", attemptNumber: 1, ...patch });
  const send = (patch = {}) => authorizeSend(args({ ownership: owner(), ...patch }));
  return { invoice, actor, binding, row, store, read, args, acquire, owner, send,
    commit: (decision) => commitClaimDecision(store, decision) };
}

async function prepared(options) {
  const ctx = setup(options);
  assert.equal((await ctx.commit(ctx.acquire())).outcome, "applied");
  return ctx;
}

async function sending(options) {
  const ctx = await prepared(options);
  const sent = await ctx.commit(ctx.send({ now: 1500 }));
  assert.equal(sent.outcome, "applied");
  assert.ok(sent.sendPermit);
  return ctx;
}

function lookup(ctx, matches) {
  return {
    status: 200, bodyText: JSON.stringify(matches),
    lookupEvidence: { contract: MOCK_LOOKUP_CONTRACT, complete: true, authoritative: true,
      invoiceNo: ctx.invoice.number, currency: ctx.invoice.currency, nextCursor: null },
  };
}

test("claim identity is provider-specific and independent of connection/environment", () => {
  const invoice = makeInvoice();
  assert.equal(claimIdentity(invoice), "co_1:inv_1:merit:invoice");
  assert.notEqual(claimIdentity(invoice, "another-provider"), claimIdentity(invoice));
  const a = setup(), b = setup({ binding: { connectionId: "other", environment: "live" } });
  assert.equal(a.row.export_key, b.row.export_key);
});

test("acquisition is pure, detached, and only proposes Invoice metadata", () => {
  const ctx = setup({ invoice: deepFreeze(makeInvoice()) });
  const before = structuredClone(ctx.invoice);
  const decision = ctx.acquire();
  assert.equal(decision.ok, true);
  assert.equal(decision.command.where.id, ctx.invoice.id);
  assert.equal(decision.command.patch[f.ref], ctx.row.id);
  assert.deepEqual(decision.command.patch[f.binding], ctx.binding);
  assert.deepEqual(ctx.read(), before);
  assert.ok(Object.isFrozen(decision.command.patch[f.binding]));
  assert.throws(() => { decision.command.patch[f.binding].ledgerId = "other"; }, TypeError);
});

test("unclaimed and acquired reads cannot mint a send permit", async () => {
  const ctx = setup();
  assert.equal((await ctx.commit(ctx.acquire())).sendPermit, null);
  assert.equal(ctx.read()[f.state], states.PREPARING);
  const sent = await ctx.commit(ctx.send({ now: 1500 }));
  assert.ok(sent.sendPermit);
  assert.deepEqual(sent.sendPermit, {
    invoiceId: ctx.invoice.id, companyId: ctx.invoice.company_id, claimRef: ctx.row.id,
    attemptToken: "worker-1", attemptNumber: 1, binding: ctx.binding,
  });
  assert.equal((await ctx.commit(ctx.send())).sendPermit, null);
});

test("two concurrent acquisitions from independent snapshots install one permanent claim", async () => {
  const ctx = setup();
  const otherRow = createExportCandidate({ invoice: ctx.invoice, actor: ctx.actor, binding: ctx.binding, exportId: "duplicate" }).row;
  await ctx.store.createCandidate(otherRow);
  const decisions = [ctx.acquire(), ctx.acquire({ exportRow: otherRow, attemptToken: "worker-2" })];
  const results = await Promise.all(decisions.map(ctx.commit));
  assert.deepEqual(results.map((r) => r.outcome).sort(), ["applied", "conflict"]);
  const current = ctx.read();
  const row = ctx.store.getCandidate({ id: current[f.ref], companyId: ctx.invoice.company_id });
  assert.equal(current.accounting_revision, 1);
  const sendResults = await Promise.all([ctx.commit(ctx.send({ exportRow: row, ownership: {
    claimRef: row.id, attemptToken: current[f.attempt_token], attemptNumber: 1,
  }, now: 1500 })), ctx.commit(ctx.send({ exportRow: row, ownership: {
    claimRef: row.id, attemptToken: current[f.attempt_token], attemptNumber: 1,
  }, now: 1500 }))]);
  assert.equal(sendResults.filter((r) => r.sendPermit).length, 1);
});

test("duplicate export rows never acquire authority from their export key", async () => {
  const ctx = await prepared();
  const orphan = { ...ctx.row, id: "orphan" };
  assert.equal((await ctx.store.createCandidate(orphan)).status, "applied");
  assert.equal(orphan.export_key, ctx.row.export_key);
  assert.equal(ctx.send({ exportRow: orphan }).code, "noncanonical_export");
  assert.equal(recoverClaim(ctx.args({ exportRow: orphan, now: 3000 })).code, "noncanonical_export");
  assert.equal(reconcileClaim(ctx.args({ exportRow: orphan })).code, "noncanonical_export");
  assert.equal(ctx.acquire({ exportRow: orphan }).code, "already_claimed");
});

test("a candidate must be durable before the Invoice pointer can reference it", async () => {
  const ctx = setup();
  const row = { ...ctx.row, id: "not-persisted" };
  const result = await ctx.commit(ctx.acquire({ exportRow: row }));
  assert.equal(result.outcome, "conflict");
  assert.equal(ctx.read()[f.ref], undefined);
});

for (const first of ["claim", "cancel"]) {
  test(`claim/cancellation race: ${first} wins one-record CAS`, async () => {
    const ctx = setup();
    const claim = ctx.acquire();
    const cancel = cancelInvoice(ctx.args());
    const decisions = first === "claim" ? [claim, cancel] : [cancel, claim];
    const result = await Promise.all(decisions.map(ctx.commit));
    assert.deepEqual(result.map((r) => r.outcome), ["applied", "conflict"]);
    assert.equal(ctx.read().status, first === "cancel" ? "cancelled" : "issued");
    if (first === "cancel") assert.equal(ctx.send().ok, false);
  });
}

for (const first of ["authorize", "cancel"]) {
  test(`send/cancellation race: ${first} wins and excludes the other`, async () => {
    const ctx = await prepared();
    const send = ctx.send({ now: 1500 });
    const cancel = cancelInvoice(ctx.args({ now: 1500 }));
    const decisions = first === "authorize" ? [send, cancel] : [cancel, send];
    const result = await Promise.all(decisions.map(ctx.commit));
    assert.deepEqual(result.map((r) => r.outcome), ["applied", "conflict"]);
    assert.equal(result.filter((r) => r.sendPermit).length, first === "authorize" ? 1 : 0);
    assert.equal(ctx.read().status, first === "authorize" ? "issued" : "cancelled");
    if (first === "cancel") {
      assert.equal(ctx.read()[f.state], states.ABORTED);
      assert.equal(ctx.read()[f.ref], ctx.row.id);
    } else assert.equal(cancelInvoice(ctx.args()).code, "accounting_outcome_unresolved");
  });
}

test("expired preparation is fenced and requires explicit new preparation", async () => {
  const ctx = await prepared();
  assert.equal(ctx.send({ now: 2000 }).code, "preparation_expired");
  const staleAuthorization = ctx.send({ now: 1500 });
  assert.equal((await ctx.commit(recoverClaim(ctx.args({ now: 2000 })))).outcome, "applied");
  assert.equal(ctx.read()[f.state], states.PREPARATION_FAILED);
  assert.equal((await ctx.commit(staleAuthorization)).outcome, "conflict");
  assert.equal(resumePreparation(ctx.args({ attemptToken: "worker-2", now: 3000 })).code, "explicit_retry_required");
  assert.equal(resumePreparation(ctx.args({ retryApproved: true, attemptToken: "worker-1", now: 3000 })).code, "invalid_attempt");
  assert.equal((await ctx.commit(resumePreparation(ctx.args({ retryApproved: true, attemptToken: "worker-2", now: 3000 })))).outcome, "applied");
  assert.equal(ctx.read()[f.ref], ctx.row.id);
  assert.equal(ctx.read()[f.attempt_number], 2);
  assert.equal(ctx.read()[f.at], new Date(1000).toISOString());
  assert.equal(ctx.send({ now: 3500 }).code, "stale_worker");
  assert.ok((await ctx.commit(ctx.send({ ownership: ctx.owner({ attemptToken: "worker-2", attemptNumber: 2 }), now: 3500 }))).sendPermit);
});

test("attempt generation fences token reuse after multiple preparation recoveries", async () => {
  const ctx = await prepared();
  for (const [index, token] of [[0, "worker-2"], [1, "worker-1"]]) {
    const now = 3000 + index * 3000;
    await ctx.commit(recoverClaim(ctx.args({ now })));
    await ctx.commit(resumePreparation(ctx.args({ retryApproved: true, attemptToken: token, now: now + 1 })));
  }
  assert.equal(ctx.read()[f.attempt_token], "worker-1");
  assert.equal(ctx.read()[f.attempt_number], 3);
  assert.equal(ctx.send({ now: 6500 }).code, "stale_worker");
});

test("repeated preparation recovery preserves the first recovery evidence", async () => {
  const ctx = await prepared();
  await ctx.commit(recoverClaim(ctx.args({ now: 3000 })));
  const original = ctx.read()[f.recovered_at];
  await ctx.commit(resumePreparation(ctx.args({ retryApproved: true, attemptToken: "worker-2", now: 4000 })));
  await ctx.commit(recoverClaim(ctx.args({ now: 6000 })));
  assert.equal(ctx.read()[f.recovered_at], original);
  assert.equal((await ctx.commit(cancelInvoice(ctx.args({ now: 7000 })))).outcome, "applied");
});

test("expired sending retains irreversible authorization and blocks replacement/cancellation", async () => {
  const ctx = await sending();
  const marker = ctx.read()[f.send_authorized_at];
  const result = await ctx.commit(recoverClaim(ctx.args({ now: 3000 })));
  assert.equal(result.outcome, "applied");
  assert.equal(ctx.read()[f.state], states.NEEDS_RECONCILIATION);
  assert.equal(ctx.read()[f.send_authorized_at], marker);
  assert.equal(ctx.send({ now: 4000 }).code, "send_already_authorized");
  assert.equal(resumePreparation(ctx.args({ retryApproved: true, attemptToken: "new", now: 4000 })).code, "send_already_authorized");
  assert.equal(cancelInvoice(ctx.args()).code, "accounting_outcome_unresolved");
  assert.equal(ctx.acquire().code, "already_claimed");
});

test("even authoritative absence cannot prove the old sender is quiescent", async () => {
  const ctx = await sending();
  await ctx.commit(recoverClaim(ctx.args({ now: 3000 })));
  const before = ctx.read();
  const decision = reconcileClaim(ctx.args({ response: lookup(ctx, []) }));
  assert.equal(decision.code, "sender_quiescence_unproven");
  assert.equal((await ctx.commit(decision)).outcome, "blocked");
  assert.deepEqual(ctx.read(), before);
  assert.equal(ctx.send().code, "send_already_authorized");
});

test("strict FIX-1 evidence can settle reconciliation without replacing authorization", async () => {
  const ctx = await sending();
  await ctx.commit(recoverClaim(ctx.args({ now: 3000 })));
  const document = { SIHId: "mock-doc", InvoiceNo: ctx.invoice.number, CurrencyCode: ctx.invoice.currency,
    TotalAmount: ctx.invoice.subtotal, VatAmount: ctx.invoice.vat_amount, TotalSum: ctx.invoice.total };
  assert.equal((await ctx.commit(reconcileClaim(ctx.args({ response: lookup(ctx, [document]) })))).outcome, "applied");
  assert.equal(ctx.read()[f.state], states.EXPORTED);
  assert.equal(ctx.read()[f.provider_document_id], "mock-doc");
  assert.equal(ctx.send().code, "send_already_authorized");
  assert.equal(cancelInvoice(ctx.args()).code, "correction_required");
});

for (const response of [undefined, { status: 500, bodyText: "[]" }, { status: 200, bodyText: "broken" }, { status: 200, bodyText: "[]" }]) {
  test(`unverified reconciliation retains the original claim: ${JSON.stringify(response)}`, async () => {
    const ctx = await sending();
    await ctx.commit(recoverClaim(ctx.args({ now: 3000 })));
    const before = ctx.read();
    const result = await ctx.commit(reconcileClaim(ctx.args({ response })));
    assert.equal(result.outcome, "blocked");
    assert.deepEqual(ctx.read(), before);
  });
}

for (const [key, value] of [
  ["connectionId", "replacement"], ["connectionRevision", 2], ["environment", "live"],
  ["ledgerId", "another-ledger"], ["region", "fi"], ["bindingId", "other-binding"],
  ["provider", "unregistered"], ["companyId", "another-company"],
]) {
  test(`destination binding cannot drift: ${key}`, async () => {
    const ctx = await prepared();
    const binding = { ...ctx.binding, [key]: value };
    for (const decide of [authorizeSend, recoverClaim, resumePreparation, reconcileClaim]) {
      const decision = decide(ctx.args({ binding, ownership: ctx.owner(), now: 4000, retryApproved: true, attemptToken: "new" }));
      assert.equal(decision.ok, false);
    }
    // Even a new candidate for the same invoice cannot move the permanent pointer.
    const candidate = createExportCandidate(ctx.args({ binding, exportId: "replacement" }));
    if (candidate.ok) assert.equal(ctx.acquire({ binding, exportRow: candidate.row }).code, "already_claimed");
  });
}

for (const actor of [{}, makeActor({ role: "member" }), makeActor({ companyId: "other" })]) {
  test(`tenant/role denial across all claim operations: ${JSON.stringify(actor)}`, async () => {
    const ctx = await prepared();
    const before = ctx.read();
    for (const decide of [createExportCandidate, acquireClaim, authorizeSend, recoverClaim, resumePreparation, cancelInvoice, reconcileClaim]) {
      const decision = decide(ctx.args({ actor, exportId: "candidate", ownership: ctx.owner(), now: 4000 }));
      assert.equal(decision.ok, false);
      assert.equal((await ctx.commit(decision)).sendPermit, null);
    }
    assert.deepEqual(ctx.read(), before);
  });
}

test("tenant-scoped port reads and mismatched CAS never expose another tenant", async () => {
  const ctx = setup();
  assert.equal(ctx.store.getInvoice({ id: ctx.invoice.id, companyId: "other" }), null);
  assert.equal(ctx.store.getCandidate({ id: ctx.row.id, companyId: "other" }), null);
  const command = structuredClone(ctx.acquire().command);
  command.where.company_id = "other";
  const result = await ctx.store.compareAndSet(command);
  assert.equal(result.status, "conflict");
  assert.equal(result.invoice, null);
});

for (const mode of ["reject", "unknown_before", "unknown_after", "throw_before", "throw_after"]) {
  for (const step of ["acquire", "authorize", "recover", "cancel", "resume", "reconcile"]) {
    test(`${step}: ${mode} cannot report successful transition or mint a permit`, async () => {
      const ctx = step === "acquire" ? setup() : ["recover", "reconcile"].includes(step) ? await sending() : await prepared();
      if (step === "resume") await ctx.commit(recoverClaim(ctx.args({ now: 3000 })));
      if (step === "reconcile") await ctx.commit(recoverClaim(ctx.args({ now: 3000 })));
      const document = { SIHId: "doc", InvoiceNo: ctx.invoice.number, CurrencyCode: ctx.invoice.currency,
        TotalAmount: ctx.invoice.subtotal, VatAmount: ctx.invoice.vat_amount, TotalSum: ctx.invoice.total };
      const decisions = {
        acquire: () => ctx.acquire(), authorize: () => ctx.send({ now: 1500 }),
        recover: () => recoverClaim(ctx.args({ now: 3000 })), cancel: () => cancelInvoice(ctx.args()),
        resume: () => resumePreparation(ctx.args({ retryApproved: true, attemptToken: "worker-2", now: 4000 })),
        reconcile: () => reconcileClaim(ctx.args({ response: lookup(ctx, [document]) })),
      };
      const decision = decisions[step]();
      assert.equal(decision.ok, true);
      const before = ctx.read();
      ctx.store.injectFault({ operation: "cas", mode });
      const result = await ctx.commit(decision);
      assert.equal(result.outcome, mode === "reject" ? "conflict" : "unknown");
      assert.equal(result.sendPermit, null);
      const committed = ["unknown_after", "throw_after"].includes(mode);
      if (committed) assert.equal(ctx.read().accounting_revision, (before.accounting_revision ?? 0) + 1);
      else assert.deepEqual(ctx.read(), before);
      if (committed) {
        assert.equal((await ctx.commit(decision)).outcome, "conflict", "replaying the same decision cannot recover a lost grant");
        if (step === "authorize") {
          assert.equal(ctx.send({ now: 1600 }).code, "send_already_authorized");
          assert.equal(cancelInvoice(ctx.args()).code, "accounting_outcome_unresolved");
        }
      }
    });
  }
}

function pause(store, mode) {
  let release, entered;
  const wait = new Promise((resolve) => { release = resolve; });
  const started = new Promise((resolve) => { entered = resolve; });
  store.injectFault({ operation: "cas", mode, wait, entered });
  return { release, started };
}

test("worker paused before send CAS loses to preparation recovery", async () => {
  const ctx = await prepared();
  const gate = pause(ctx.store, "pause_before");
  const oldWorker = ctx.commit(ctx.send({ now: 1500 }));
  await gate.started;
  await ctx.commit(recoverClaim(ctx.args({ now: 3000 })));
  gate.release();
  assert.equal((await oldWorker).outcome, "conflict");
  assert.equal(ctx.read()[f.state], states.PREPARATION_FAILED);
});

test("worker paused after send CAS may resume, but recovery cannot authorize a replacement", async () => {
  const ctx = await prepared();
  const gate = pause(ctx.store, "pause_after");
  const oldWorker = ctx.commit(ctx.send({ now: 1500 }));
  await gate.started;
  assert.equal(ctx.read()[f.state], states.SENDING);
  await ctx.commit(recoverClaim(ctx.args({ now: 3000 })));
  assert.equal(ctx.send({ now: 4000 }).code, "send_already_authorized");
  assert.equal(cancelInvoice(ctx.args()).code, "accounting_outcome_unresolved");
  gate.release();
  assert.ok((await oldWorker).sendPermit, "local CAS cannot revoke an already authorized external sender");
  assert.equal(ctx.read()[f.state], states.NEEDS_RECONCILIATION);
});

test("replayed successful authorization decision conflicts and grants no second permit", async () => {
  const ctx = await prepared();
  const decision = ctx.send({ now: 1500 });
  assert.ok((await ctx.commit(decision)).sendPermit);
  const replayed = await ctx.commit(decision);
  assert.equal(replayed.outcome, "conflict");
  assert.equal(replayed.sendPermit, null);
});

test("candidate creation uncertainty cannot grant authority", async () => {
  const ctx = setup();
  const row = { ...ctx.row, id: "uncertain-candidate" };
  ctx.store.injectFault({ operation: "create", mode: "unknown_after" });
  assert.equal((await ctx.store.createCandidate(row)).status, "unknown");
  assert.equal(ctx.send({ exportRow: row }).code, "noncanonical_export");
  assert.equal(ctx.read()[f.ref], undefined);
});

for (const acknowledgement of [undefined, { status: "applied", updated: 0 }, { status: "applied", updated: 2 },
  { status: "applied", updated: "1" }, { status: "applied", updated: 1, invoice: {} }, { status: "conflict", updated: 1 }]) {
  test(`malformed port acknowledgement grants nothing: ${JSON.stringify(acknowledgement)}`, async () => {
    const ctx = await prepared();
    const result = await commitClaimDecision({ compareAndSet: async () => acknowledgement }, ctx.send());
    assert.equal(result.outcome, "unknown");
    assert.equal(result.sendPermit, null);
  });
}

test("historical financial snapshots and amounts remain unchanged through recovery and cancellation", async () => {
  const ctx = await prepared();
  await ctx.commit(recoverClaim(ctx.args({ now: 3000 })));
  await ctx.commit(cancelInvoice(ctx.args({ now: 4000 })));
  const current = ctx.read();
  for (const field of ["seller_snapshot", "buyer_snapshot", "payment_snapshot", "line_items", "vat_summary", "subtotal", "vat_amount", "total", "number", "currency"]) {
    assert.deepEqual(current[field], ctx.invoice[field], field);
  }
  assert.equal(current[f.ref], ctx.row.id);
});

for (const value of [undefined, null, ""]) {
  test(`legacy empty claim representation is explicit in the mock: ${String(value)}`, async () => {
    const ctx = setup({ invoice: makeInvoice({ [f.ref]: value, accounting_revision: null }) });
    assert.equal((await ctx.commit(ctx.acquire())).outcome, "applied");
    assert.equal(ctx.read().accounting_revision, 1);
  });
}

test("unknown-provider and inconsistent legacy metadata fail closed", () => {
  for (const invoice of [makeInvoice({ claim_other_sendinvoice_ref: "unknown" }), makeInvoice({ [f.send_authorized_at]: "historical" })]) {
    const ctx = setup({ invoice });
    assert.equal(ctx.acquire().ok, false);
    assert.equal(cancelInvoice(ctx.args()).ok, false);
  }
});

test("detached store reads and operation logs cannot mutate persistence", async () => {
  const ctx = await prepared();
  ctx.read()[f.binding].ledgerId = "mutated";
  ctx.store.getCandidate({ id: ctx.row.id, companyId: ctx.invoice.company_id }).binding.ledgerId = "mutated";
  ctx.store.operations[0].id = "mutated";
  assert.equal(ctx.read()[f.binding].ledgerId, "mock-ledger");
  assert.equal(ctx.store.operations[0].id, ctx.invoice.id);
  assert.ok((await ctx.commit(ctx.send())).sendPermit);
});

test("port rejects broad selectors, snapshot patches, and attempts to clear irreversible markers", async () => {
  const ctx = await sending();
  const baseline = recoverClaim(ctx.args({ now: 3000 })).command;
  for (const change of [
    (c) => { c.where.id = { $in: [ctx.invoice.id] }; },
    (c) => { delete c.where.company_id; },
    (c) => { c.patch.total = 0; },
    (c) => { c.patch[f.ref] = "replacement"; },
    (c) => { c.patch[f.binding] = { ...ctx.binding, ledgerId: "other" }; },
    (c) => { c.patch[f.send_authorized_at] = null; },
  ]) {
    const command = structuredClone(baseline);
    change(command);
    assert.equal((await ctx.store.compareAndSet(command)).status, "conflict");
    assert.equal(ctx.read()[f.state], states.SENDING);
  }
});

for (const now of [0, -1, NaN, Infinity, "1000", Number.MAX_SAFE_INTEGER]) {
  test(`invalid clock input cannot create a claim or cancellation: ${String(now)}`, () => {
    const ctx = setup();
    assert.equal(ctx.acquire({ now }).ok, false);
    assert.equal(cancelInvoice(ctx.args({ now })).ok, false);
  });
}

for (const leaseMs of [0, -1, NaN, Infinity, "1000", Number.MAX_SAFE_INTEGER]) {
  test(`invalid lease cannot create ownership: ${String(leaseMs)}`, () => {
    assert.equal(setup().acquire({ leaseMs }).ok, false);
  });
}

for (const revision of [-1, "1", NaN, Infinity, Number.MAX_SAFE_INTEGER]) {
  test(`invalid shared accounting revision fails closed: ${String(revision)}`, () => {
    const ctx = setup({ invoice: makeInvoice({ accounting_revision: revision }) });
    assert.equal(ctx.acquire().ok, false);
    assert.equal(cancelInvoice(ctx.args()).ok, false);
  });
}

test("claims cannot be acquired for drafts or cancelled invoices", async () => {
  for (const status of ["draft", "cancelled"]) {
    const ctx = setup({ invoice: makeInvoice({ status }) });
    assert.equal(ctx.acquire().code, "not_issued");
    assert.equal((await ctx.commit(ctx.acquire())).sendPermit, null);
  }
});

test("a stale source candidate cannot claim another revision or another invoice", () => {
  const ctx = setup();
  for (const patch of [{ source_revision: 99 }, { invoice_id: "other" }, { company_id: "other" }, { export_key: "forged" }, { provider: "other" }, { kind: "credit_note" }]) {
    assert.equal(ctx.acquire({ exportRow: { ...ctx.row, ...patch } }).code, "invalid_candidate");
  }
});

test("non-expired leases are not recoverable and stale recovery cannot override a newer attempt", async () => {
  const ctx = await prepared();
  assert.equal(recoverClaim(ctx.args({ now: 1999 })).code, "lease_not_expired");
  const recovery = recoverClaim(ctx.args({ now: 3000 }));
  assert.equal((await ctx.commit(recovery)).outcome, "applied");
  await ctx.commit(resumePreparation(ctx.args({ retryApproved: true, attemptToken: "new", now: 4000 })));
  assert.equal((await ctx.commit(recovery)).outcome, "conflict");
  assert.equal(ctx.read()[f.state], states.PREPARING);
  assert.equal(ctx.read()[f.attempt_number], 2);
});

test("permit binding is detached from mutable acknowledgement records", async () => {
  const ctx = await prepared();
  const result = await ctx.commit(ctx.send({ now: 1500 }));
  result.invoice[f.binding].ledgerId = "different";
  assert.equal(result.sendPermit.binding.ledgerId, "mock-ledger");
  assert.ok(Object.isFrozen(result.sendPermit.binding));
});

test("an acknowledgement with the wrong immutable binding cannot grant permission", async () => {
  const ctx = await prepared();
  const decision = ctx.send({ now: 1500 });
  const invoice = { ...ctx.read(), ...decision.command.patch, [f.binding]: { ...ctx.binding, ledgerId: "other" } };
  const result = await commitClaimDecision({ compareAndSet: async () => ({ status: "applied", updated: 1, invoice }) }, decision);
  assert.equal(result.outcome, "unknown");
  assert.equal(result.sendPermit, null);
});

test("unknown fault types are rejected instead of silently testing successful writes", () => {
  assert.throws(() => setup().store.injectFault({ operation: "cas", mode: "typo" }), /unsupported synthetic fault/);
});

test("mislabeled acquisition/readback objects cannot mint send permits", async () => {
  const ctx = setup();
  for (const decision of [
    { ...ctx.acquire(), kind: "authorize_send" },
    { ok: true, kind: "authorize_send", invoice: ctx.read() },
    { ok: true, kind: "read", command: ctx.acquire().command },
  ]) {
    let calls = 0;
    const result = await commitClaimDecision({ compareAndSet: async () => { calls++; throw new Error("must not write"); } }, decision);
    assert.equal(result.outcome, "blocked");
    assert.equal(result.sendPermit, null);
    assert.equal(calls, 0);
  }
});

test("acknowledging a different canonical reference cannot grant permission", async () => {
  const ctx = await prepared();
  const decision = ctx.send();
  const invoice = { ...ctx.read(), ...decision.command.patch, [f.ref]: "orphan" };
  const result = await commitClaimDecision({ compareAndSet: async () => ({ status: "applied", updated: 1, invoice }) }, decision);
  assert.equal(result.outcome, "unknown");
  assert.equal(result.sendPermit, null);
});
