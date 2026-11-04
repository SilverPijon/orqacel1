import test from "node:test";
import assert from "node:assert/strict";

import { reconcileExport, runExport } from "../export/exportService.js";
import { EXPORT_STATES, exportKey, initialRecord } from "../export/stateMachine.js";
import { createMemoryStore } from "../testing/memoryStore.js";
import { createMockMeritAdapter } from "../testing/mockMeritAdapter.js";
import { makeActor, makeConnection, makeInvoice } from "../testing/fixtures.js";

function setup({ invoice = makeInvoice(), connection = makeConnection(), behaviour = {}, delayMs = 0, seed = {} } = {}) {
  const store = createMemoryStore(seed);
  const adapter = createMockMeritAdapter({ behaviour, delayMs });
  const key = exportKey(invoice);
  const run = (overrides = {}) =>
    runExport({ invoice, connection, store, adapter, actor: makeActor(), now: 1_000, ...overrides });
  const reconcile = (overrides = {}) =>
    reconcileExport({ invoice, connection, store, adapter, actor: makeActor(), now: 5_000, ...overrides });
  return { store, adapter, key, invoice, connection, run, reconcile };
}

test("1. exports a valid invoice once and records the provider document", async () => {
  const { adapter, store, key, invoice, run } = setup();

  const result = await run();

  assert.equal(result.outcome, EXPORT_STATES.EXPORTED);
  assert.equal(adapter.sendCount, 1);
  assert.equal(store.peek(key).state, EXPORT_STATES.EXPORTED);
  assert.equal(store.peek(key).provider_document_no, "INV-1001");
  assert.equal(adapter.calls[0].payload.InvoiceNo, "INV-1001");
  assert.equal(adapter.calls[0].payload.TotalAmount, invoice.subtotal);
  assert.equal(store.audit.at(-1).action, "export_confirmed");
});

test("16. the provider payload keeps the original number and amounts", async () => {
  const { adapter, run } = setup();

  await run();

  const payload = adapter.calls[0].payload;
  assert.equal(payload.InvoiceNo, "INV-1001");
  assert.equal(payload.TotalAmount, 1500);
  assert.equal(payload.TaxAmount.reduce((sum, row) => sum + row.Amount, 0), 285);
  assert.equal(payload.InvoiceRow[0].Price, 100);
  assert.equal(payload.InvoiceRow[1].Price, 100);
});

test("a second click is refused and does not create a second document", async () => {
  const { adapter, run } = setup();

  await run();
  const again = await run();

  assert.equal(again.outcome, "blocked");
  assert.equal(again.code, "already_exported");
  assert.equal(adapter.sendCount, 1);
});

test("11. concurrent export attempts produce exactly one document", async () => {
  const { adapter, run } = setup({ delayMs: 10 });

  const results = await Promise.all([run(), run()]);
  const outcomes = results.map((result) => result.outcome);

  assert.equal(adapter.sendCount, 1, "the provider must be called exactly once");
  assert.ok(outcomes.includes(EXPORT_STATES.EXPORTED));
  assert.ok(outcomes.includes("conflict") || outcomes.includes("blocked"));
});

test("invalid configuration blocks before any provider call", async () => {
  const { adapter, store, key, run } = setup({ connection: makeConnection({ item_codes: { 24: "ORQ-SVC-24" } }) });

  const result = await run();

  assert.equal(result.outcome, "invalid");
  assert.equal(result.code, "validation_failed");
  assert.ok(result.issues.some((issue) => issue.code === "item_code_missing"));
  assert.equal(adapter.sendCount, 0);
  assert.equal(store.peek(key).state, EXPORT_STATES.FAILED_PERMANENT);
  assert.equal(store.audit.at(-1).action, "export_validation_failed");
});

test("9. a timeout after a possible commit is never retried automatically", async () => {
  const behaviour = { send: "timeout" };
  const { adapter, store, key, run } = setup({ behaviour });

  const result = await run();

  assert.equal(result.outcome, EXPORT_STATES.NEEDS_RECONCILIATION);
  assert.equal(result.code, "timeout_unknown_commit");
  assert.equal(store.peek(key).state, EXPORT_STATES.NEEDS_RECONCILIATION);

  // A further click must not resend while the outcome is unknown.
  const retry = await run({ now: 2_000 });
  assert.equal(retry.outcome, "blocked");
  assert.equal(retry.code, "needs_reconciliation");
  assert.equal(adapter.sendCount, 1);
});

test("10. reconciliation adopts the existing document instead of creating a duplicate", async () => {
  const { adapter, store, key, run, reconcile } = setup({ behaviour: { send: "timeoutAfterCommit" } });

  const first = await run();
  assert.equal(first.outcome, EXPORT_STATES.NEEDS_RECONCILIATION);

  const resolved = await reconcile();

  assert.equal(resolved.outcome, EXPORT_STATES.EXPORTED);
  assert.equal(adapter.sendCount, 1, "reconciliation must never send");
  assert.equal(adapter.lookupCount, 1);
  assert.equal(store.peek(key).state, EXPORT_STATES.EXPORTED);
  assert.equal(store.audit.at(-1).action, "reconcile_found");
});

test("10. reconciliation proves absence, and only then may a retry send again", async () => {
  const behaviour = { send: "timeout" };
  const { adapter, store, key, run, reconcile } = setup({ behaviour });

  await run();
  const resolved = await reconcile();

  assert.equal(resolved.outcome, EXPORT_STATES.FAILED_RETRYABLE);
  assert.equal(resolved.code, "absent_confirmed");
  assert.equal(adapter.sendCount, 1);

  behaviour.send = "ok";
  const retried = await run({ now: 10_000 });

  assert.equal(retried.outcome, EXPORT_STATES.EXPORTED);
  assert.equal(adapter.sendCount, 2);
  assert.equal(store.peek(key).attempts, 2);
});

test("duplicate documents at the provider are surfaced as a conflict, never resolved silently", async () => {
  const { adapter, store, key, reconcile } = setup({ behaviour: { send: "timeout", lookup: "multiple" } });

  await runExport({ invoice: makeInvoice(), connection: makeConnection(), store, adapter, actor: makeActor(), now: 1_000 });
  const resolved = await reconcile();

  assert.equal(resolved.outcome, EXPORT_STATES.NEEDS_RECONCILIATION);
  assert.equal(resolved.code, "multiple_matches");
  assert.equal(store.peek(key).state, EXPORT_STATES.NEEDS_RECONCILIATION);
  assert.equal(adapter.sendCount, 1);
});

test("a provider document with different amounts is not adopted", async () => {
  const { adapter, store, key, reconcile } = setup({ behaviour: { send: "timeout", lookup: "mismatch" } });

  await runExport({ invoice: makeInvoice(), connection: makeConnection(), store, adapter, actor: makeActor(), now: 1_000 });
  const resolved = await reconcile();

  assert.equal(resolved.outcome, EXPORT_STATES.NEEDS_RECONCILIATION);
  assert.equal(resolved.code, "amount_mismatch");
  assert.equal(store.peek(key).state, EXPORT_STATES.NEEDS_RECONCILIATION);
});

test("12. an export interrupted mid-flight is recovered into reconciliation, not resent", async () => {
  const invoice = makeInvoice();
  const key = exportKey(invoice);
  const seed = {
    [key]: { ...initialRecord(key), state: EXPORT_STATES.SENDING, version: 5, attempts: 1, lease_expires_at: 500 },
  };
  const { adapter, store, run } = setup({ invoice, seed });

  const result = await run({ now: 10_000 });

  assert.equal(result.outcome, EXPORT_STATES.NEEDS_RECONCILIATION);
  assert.equal(result.code, "lease_expired");
  assert.equal(adapter.sendCount, 0, "an interrupted attempt must never be resent blindly");
  assert.equal(store.peek(key).state, EXPORT_STATES.NEEDS_RECONCILIATION);
  assert.equal(store.audit.at(-1).action, "export_recovery_required");
});

test("13. cross-company exports are refused before any provider call", async () => {
  const { adapter, run } = setup({ invoice: makeInvoice({ company_id: "co_other" }) });

  const result = await run();

  assert.equal(result.outcome, "blocked");
  assert.equal(result.code, "cross_company");
  assert.equal(adapter.sendCount, 0);
});

test("14. ordinary members and foreign tenants cannot export", async () => {
  const { adapter, run } = setup();

  const member = await run({ actor: makeActor({ role: "member" }) });
  assert.equal(member.code, "forbidden_role");

  const foreign = await run({ actor: makeActor({ companyId: "co_other" }) });
  assert.equal(foreign.code, "forbidden_company");

  const anonymous = await run({ actor: {} });
  assert.equal(anonymous.code, "unauthenticated");

  assert.equal(adapter.sendCount, 0);
});

test("a disabled connection exports nothing", async () => {
  const { adapter, run } = setup({ connection: makeConnection({ export_mode: "disabled" }) });

  const result = await run();

  assert.equal(result.code, "export_disabled");
  assert.equal(adapter.sendCount, 0);
});

test("15. credentials and payloads never appear in results or audit events", async () => {
  const secret = "SUPER-SECRET-API-KEY-123";
  const connection = makeConnection({
    api_key: secret,
    api_id: "api-id-abc",
    credential_ciphertext: `cipher-${secret}`,
  });
  const { adapter, store, run } = setup({ connection, behaviour: { send: "licence401" } });

  const result = await run();

  assert.equal(result.outcome, EXPORT_STATES.FAILED_PERMANENT);
  assert.equal(result.code, "licence_required");

  // The service returns no provider payload at all.
  assert.equal("payload" in result, false);

  const serialized = JSON.stringify(result) + JSON.stringify(store.audit);
  assert.equal(serialized.includes(secret), false, "a credential must never be serialized");
  assert.equal(serialized.includes("api-id-abc"), false);
  assert.equal(serialized.includes("api_key"), false);
  assert.equal(serialized.includes("ciphertext"), false);

  // Audit events are built from a whitelist, so no request payload is stored.
  for (const event of store.audit) {
    assert.equal("payload" in event, false);
    assert.equal("InvoiceRow" in event, false);
  }

  assert.equal(adapter.sendCount, 1);
});