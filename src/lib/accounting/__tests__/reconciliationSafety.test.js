import test from "node:test";
import assert from "node:assert/strict";
import { reconcileExport, runExport } from "../export/exportService.js";
import { expectedDocument, matchDocument, reconcileResponse, MOCK_LOOKUP_CONTRACT, MOCK_DOCUMENT_CONTRACT } from "../export/reconciliation.js";
import { exportKey, initialRecord } from "../export/stateMachine.js";
import { createMemoryStore } from "../testing/memoryStore.js";
import { createMockMeritAdapter } from "../testing/mockMeritAdapter.js";
import { makeActor, makeConnection, makeInvoice } from "../testing/fixtures.js";

const invoice = makeInvoice();
const expected = expectedDocument(invoice);
const key = exportKey(invoice);
const document = {
  SIHId: "mock-document-1", InvoiceNo: invoice.number, CurrencyCode: invoice.currency,
  TotalAmount: invoice.subtotal, VatAmount: invoice.vat_amount, TotalSum: invoice.total,
};
const evidence = {
  contract: MOCK_LOOKUP_CONTRACT, complete: true, authoritative: true,
  invoiceNo: invoice.number, currency: invoice.currency, nextCursor: null,
};
const response = (matches = []) => ({ status: 200, bodyText: JSON.stringify(matches), lookupEvidence: { ...evidence } });
const ambiguous = () => ({ ...initialRecord(key), state: "needs_reconciliation", version: 3, attempts: 1 });
function reconcile(store, adapter) {
  return reconcileExport({ invoice, connection: makeConnection(), actor: makeActor(), store, adapter });
}

const invalidResponses = [
  ["missing response", undefined],
  ...[0, 199, 202, 204, 206, 300, 400, 401, 403, 404, 408, 429, 500, 503].map((status) => [`HTTP ${status}`, { ...response(), status }]),
  ["missing status", { ...response(), status: undefined }],
  ["coerced status", { ...response(), status: "200" }],
  ["empty body", { ...response(), bodyText: "" }],
  ["malformed JSON", { ...response(), bodyText: "[" }],
  ["HTML", { ...response(), bodyText: "<html>error</html>" }],
  ...[null, false, 0, "", {}, { error: "bad request" }, { items: [] }, { items: [], next_cursor: "page2" }]
    .map((value) => [`invalid envelope ${JSON.stringify(value)}`, { ...response(), bodyText: JSON.stringify(value) }]),
  ["missing evidence", { ...response(), lookupEvidence: undefined }],
  ...[
    { complete: false }, { complete: undefined }, { complete: "true" },
    { authoritative: false }, { authoritative: undefined }, { authoritative: "true" },
    { contract: "unverified-merit-contract" }, { invoiceNo: "another-invoice" },
    { currency: "USD" }, { nextCursor: "more-results" }, { nextCursor: undefined },
  ].map((patch) => [`unverified search ${JSON.stringify(patch)}`, { ...response(), lookupEvidence: { ...evidence, ...patch } }]),
  ["null candidate", response([null])],
  ["multiple matches", response([document, document])],
  ["valid plus invalid candidate", response([document, null])],
];

for (const [name, lookupResponse] of invalidResponses) {
  test(`reconciliation fails closed: ${name}`, async () => {
    const store = createMemoryStore({ [key]: ambiguous() });
    let sends = 0;
    const adapter = {
      lookupByInvoiceNo: async () => lookupResponse,
      sendInvoice: async () => { sends++; throw new Error("must not send"); },
    };
    const result = await reconcile(store, adapter);
    assert.equal(result.outcome, "needs_reconciliation");
    assert.equal(store.peek(key).state, "needs_reconciliation");
    assert.equal(store.operations.filter((op) => op.op === "cas").length, 0);
    assert.equal(store.audit.at(-1).action, "reconcile_conflict");
    const retried = await runExport({ invoice, connection: makeConnection(), actor: makeActor(), store, adapter });
    assert.equal(retried.code, "needs_reconciliation");
    assert.equal(sends, 0);
  });
}

const invalidDocuments = [
  ["missing id", { SIHId: undefined }], ["null id", { SIHId: null }],
  ["empty id", { SIHId: " " }], ["numeric id", { SIHId: 1 }],
  ["conflicting ids", { InvoiceId: "different-id" }],
  ["missing number", { InvoiceNo: undefined }], ["wrong number", { InvoiceNo: "OTHER" }],
  ["missing currency", { CurrencyCode: undefined }], ["wrong currency", { CurrencyCode: "USD" }],
  ["missing net", { TotalAmount: undefined }], ["missing VAT", { VatAmount: undefined }],
  ["missing gross", { TotalSum: undefined }], ["net substituted for gross", { TotalSum: invoice.subtotal }],
  ["wrong net", { TotalAmount: 1499 }], ["wrong VAT", { VatAmount: 284 }], ["wrong gross", { TotalSum: 1784 }],
  ["same gross different tax split", { TotalAmount: 1490, VatAmount: 295 }],
  ["sub-cent mismatch", { TotalSum: invoice.total + 0.004 }], ["unsafe amount", { TotalSum: Number.MAX_SAFE_INTEGER }],
  ["null amount", { TotalSum: null }], ["string amount", { TotalSum: "1785" }],
  ["negative amount", { TotalAmount: -1500 }], ["NaN", { TotalSum: NaN }], ["infinity", { TotalSum: Infinity }],
  ["error beside valid document", { error: "request failed" }],
  ["incomplete envelope", { next_cursor: "more" }],
];
for (const [name, patch] of invalidDocuments) {
  test(`invalid document cannot confirm reconciliation or send: ${name}`, async () => {
    const candidate = { ...document, ...patch };
    assert.equal(matchDocument(candidate, expected).outcome, "conflict");
    const store = createMemoryStore({ [key]: ambiguous() });
    const result = await reconcile(store, { lookupByInvoiceNo: async () => response([candidate]) });
    assert.equal(result.outcome, "needs_reconciliation");
    assert.equal(store.peek(key).state, "needs_reconciliation");
    const sendStore = createMemoryStore();
    const sent = await runExport({ invoice, connection: makeConnection(), actor: makeActor(), store: sendStore, adapter: {
      sendInvoice: async () => ({ status: 200, bodyText: JSON.stringify(candidate), documentEvidence: { contract: MOCK_DOCUMENT_CONTRACT } }),
    } });
    assert.equal(sent.outcome, "needs_reconciliation");
    assert.equal(sendStore.peek(key).state, "needs_reconciliation");
    assert.equal(sendStore.audit.at(-1).action, "export_ambiguous");
  });
}

test("unverified acknowledgement stays ambiguous even with matching fields", async () => {
  const store = createMemoryStore();
  const result = await runExport({ invoice, connection: makeConnection(), actor: makeActor(), store, adapter: {
    sendInvoice: async () => ({ status: 200, bodyText: JSON.stringify(document) }),
  } });
  assert.equal(result.outcome, "needs_reconciliation");
});

test("lookup transport failure retains ambiguity and never sends", async () => {
  const store = createMemoryStore({ [key]: ambiguous() });
  const result = await reconcile(store, { lookupByInvoiceNo: async () => { throw new Error("offline"); } });
  assert.equal(result.code, "lookup_failed");
  assert.deepEqual(store.peek(key), ambiguous());
  assert.equal(store.audit.length, 0);
});

test("only complete authoritative exact mock lookup proves absence; it never sends", async () => {
  const store = createMemoryStore({ [key]: ambiguous() });
  const result = await reconcile(store, { lookupByInvoiceNo: async (number, options) => {
    assert.equal(number, invoice.number);
    assert.deepEqual(options, { currency: invoice.currency });
    return response();
  } });
  assert.equal(result.outcome, "failed_retryable");
  assert.equal(store.peek(key).state, "failed_retryable");
  assert.equal(store.audit.at(-1).action, "reconcile_absent");
});

test("complete matching document is adopted with either consistent identifier spelling", async () => {
  for (const candidate of [document, { ...document, InvoiceId: document.SIHId }, { ...document, SIHId: undefined, InvoiceId: document.SIHId }]) {
    const store = createMemoryStore({ [key]: ambiguous() });
    const result = await reconcile(store, { lookupByInvoiceNo: async () => response([candidate]) });
    assert.equal(result.outcome, "exported");
    assert.equal(store.peek(key).provider_document_id, document.SIHId);
    assert.equal(store.audit.at(-1).action, "reconcile_found");
  }
});

test("invalid expected financial data cannot prove absence or adopt a document", () => {
  for (const patch of [{ total: undefined }, { subtotal: NaN }, { vat: null }, { total: 1 }, { number: "" }, { currency: "" }]) {
    for (const matches of [[], [document]]) {
      assert.equal(reconcileResponse(response(matches), { ...expected, ...patch }).outcome, "conflict");
    }
  }
});

for (const stage of ["claim", "sending", "validation", "settlement", "recovery", "reconcile-found", "reconcile-absent"]) {
  test(`CAS rejection never reports a committed transition: ${stage}`, async () => {
    const seed = stage === "recovery"
      ? { ...initialRecord(key), state: "sending", version: 3, attempts: 1, lease_expires_at: 1 }
      : stage.startsWith("reconcile") ? ambiguous() : null;
    const store = createMemoryStore(seed ? { [key]: seed } : {});
    const adapter = createMockMeritAdapter();
    const original = store.cas;
    const target = { claim: "preparing", sending: "sending", validation: "failed_permanent", settlement: "exported", recovery: "needs_reconciliation", "reconcile-found": "exported", "reconcile-absent": "failed_retryable" }[stage];
    store.cas = async (recordKey, version, next) => next.state === target
      ? { ok: false, current: await store.get(recordKey) }
      : original(recordKey, version, next);
    let result;
    if (stage.startsWith("reconcile")) {
      result = await reconcile(store, { lookupByInvoiceNo: async () => response(stage === "reconcile-found" ? [document] : []) });
    } else {
      result = await runExport({ invoice, connection: makeConnection(stage === "validation" ? { item_codes: {} } : {}),
        actor: makeActor(), store, adapter, now: 1000 });
    }
    assert.equal(result.outcome, "conflict");
    assert.equal(result.code, "cas_conflict");
    assert.deepEqual(result.record, store.peek(key));
    assert.equal(store.audit.length, 0, "no event may claim a rejected state transition");
    assert.equal(adapter.sendCount, stage === "settlement" ? 1 : 0);
  });
}

test("competing reconciliations report exactly one committed transition", async () => {
  const store = createMemoryStore({ [key]: ambiguous() });
  const results = await Promise.all([
    reconcile(store, { lookupByInvoiceNo: async () => response([document]) }),
    reconcile(store, { lookupByInvoiceNo: async () => response([]) }),
  ]);
  assert.equal(results.filter((result) => result.outcome === "conflict").length, 1);
  assert.equal(store.audit.length, 1);
  assert.equal(store.peek(key).state, results.find((result) => result.outcome !== "conflict").outcome);
});


test("cent matching tolerates binary representation noise without accepting different cents", () => {
  const expected = { number: "SMALL", currency: "EUR", subtotal: 0.1, vat: 0.2, total: 0.3 };
  const small = { SIHId: "small", InvoiceNo: "SMALL", CurrencyCode: "EUR", TotalAmount: 0.1, VatAmount: 0.2, TotalSum: 0.1 + 0.2 };
  assert.equal(matchDocument(small, expected).outcome, "found");
  assert.equal(matchDocument({ ...small, TotalSum: 0.31 }, expected).outcome, "conflict");
});

for (const mode of ["timeout", "badRequest400", "rateLimit429"]) {
  test(`settlement CAS conflict cannot claim an uncommitted failure: ${mode}`, async () => {
    const store = createMemoryStore();
    const original = store.cas;
    store.cas = async (recordKey, version, next) => ["needs_reconciliation", "failed_permanent", "failed_retryable"].includes(next.state)
      ? { ok: false, current: await store.get(recordKey) } : original(recordKey, version, next);
    const adapter = createMockMeritAdapter({ behaviour: { send: mode } });
    const args = { invoice, connection: makeConnection(), actor: makeActor(), store, adapter, now: 1000 };
    const result = await runExport(args);
    assert.equal(result.outcome, "conflict");
    assert.equal(result.code, "cas_conflict");
    assert.equal(store.peek(key).state, "sending");
    assert.equal(store.audit.length, 0);
    assert.equal((await runExport(args)).code, "in_flight");
    assert.equal(adapter.sendCount, 1);
    // Once the lease expires, recovery leads to reconciliation, never a blind resend.
    store.cas = original;
    assert.equal((await runExport({ ...args, now: 100000 })).outcome, "needs_reconciliation");
    assert.equal(adapter.sendCount, 1);
  });
}
