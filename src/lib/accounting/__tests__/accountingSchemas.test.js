import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { MERIT_FIELDS as f, BINDING_FIELDS, createExportCandidate, acquireClaim, authorizeSend, recoverClaim, cancelInvoice } from "../export/claimProtocol.js";
import { makeActor, makeInvoice } from "../testing/fixtures.js";

const schemas = Object.fromEntries(["Invoice", "AccountingExport", "AccountingConnection", "AccountingExportEvent"].map((name) =>
  [name, JSON.parse(readFileSync(new URL(`../../../../base44/entities/${name}.jsonc`, import.meta.url), "utf8"))]));
const canonical = (value) => Array.isArray(value) ? value.map(canonical) : value && typeof value === "object"
  ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])])) : value;

// Hashes of the original JSON documents at approved FIX-2A commit dc47afd.
// Removing ONLY the explicitly approved additions must reproduce every original
// property, description, type, required array and RLS rule. No Git/SDK needed at test time.
const originals = {
  Invoice: "0d3b68c873c8123c1532995aa5408c454e1e085a5af77c91cb876e064d41a0ca",
  AccountingExport: "fef28f898df21d13612f04f22e7ef0b9b6eec2d6fcb56108114198d52973476d",
  AccountingConnection: "e0e53e9da6d99abf22023cda97d2e7d5061110b53a42ecba7ba11304a824a74e",
  AccountingExportEvent: "29c1d58532399920bc3e34363de60abc89f2c93745f6250f019de558501cb76e",
};
const invoiceAdditions = ["accounting_revision", "accounting_pending_event", ...Object.values(f).filter((key) =>
  ![f.ref, f.at, f.connection_id, f.recovered_at].includes(key))];
const additions = {
  Invoice: invoiceAdditions,
  AccountingExport: ["binding", "source_revision", "claim_ref", "accounting_revision", "attempt_token", "attempt_number", "send_authorized_at", "projection_status"],
  AccountingConnection: ["configuration_revision", "destination_binding", "destination_verified_at"],
  AccountingExportEvent: ["event_key", "claim_ref", "connection_id", "binding", "accounting_revision", "attempt_token"],
};
for (const [name, hash] of Object.entries(originals)) {
  test(`${name}: changes are additive and preserve all historical definitions/RLS`, () => {
    const old = structuredClone(schemas[name]);
    for (const key of additions[name]) { assert.ok(old.properties[key], key); delete old.properties[key]; }
    if (name === "AccountingExport") old.properties.state.enum = old.properties.state.enum.filter((v) => !["preparation_failed", "aborted_before_send"].includes(v));
    if (name === "AccountingExportEvent") old.properties.action.enum = old.properties.action.enum.filter((v) => ![
      "export_claimed", "export_send_authorized", "export_preparation_abandoned", "export_preparation_resumed", "invoice_cancelled_before_send",
    ].includes(v));
    assert.equal(createHash("sha256").update(JSON.stringify(canonical(old))).digest("hex"), hash);
    assert.ok(additions[name].every((key) => !schemas[name].required.includes(key)), "no new required historical fields");
    assert.ok(additions[name].every((key) => !("default" in schemas[name].properties[key])), "no implicit backfill defaults");
  });
}

// Deliberately limited local shape checks, NOT a claim that Base44 accepts these
// JSON Schema constructs. Nullable types require separate disposable-app proof.
function shape(schema, value) {
  const type = value === null ? "null" : Array.isArray(value) ? "array" : typeof value;
  assert.ok([schema.type].flat().includes(type), `type ${type} not allowed by ${schema.type}`);
  if (schema.enum) assert.ok(schema.enum.includes(value));
  if (type === "number") { assert.ok(Number.isFinite(value)); if (schema.minimum !== undefined) assert.ok(value >= schema.minimum); }
  if (type === "object") {
    for (const key of schema.required ?? []) assert.ok(key in value, key);
    for (const [key, item] of Object.entries(value)) {
      if (schema.properties?.[key]) shape(schema.properties[key], item);
      else if (schema.additionalProperties === false) assert.fail(`unexpected field ${key}`);
    }
  }
}

test("every Stage-A claim field is declared and immutable binding shapes agree across schemas", () => {
  for (const key of Object.values(f)) assert.ok(schemas.Invoice.properties[key], key);
  const bindings = [schemas.Invoice.properties[f.binding], schemas.AccountingExport.properties.binding,
    schemas.AccountingConnection.properties.destination_binding, schemas.AccountingExportEvent.properties.binding];
  for (const binding of bindings) {
    assert.deepEqual(binding.required, BINDING_FIELDS);
    assert.equal(binding.additionalProperties, false);
    assert.deepEqual(binding, bindings[0]);
  }
});

test("candidate and authoritative transition patches fit the prepared metadata field shapes", () => {
  let invoice = makeInvoice();
  const actor = makeActor();
  const binding = { companyId: invoice.company_id, provider: "merit", connectionId: "c1", connectionRevision: 1,
    environment: "test", region: "ee", ledgerId: "synthetic", bindingId: "synthetic" };
  const row = createExportCandidate({ invoice, actor, binding, exportId: "e1" }).row;
  shape(schemas.AccountingExport, row);
  const apply = (decision) => {
    assert.equal(decision.ok, true);
    for (const [key, value] of Object.entries(decision.command.patch)) {
      assert.ok(schemas.Invoice.properties[key], key);
      shape(schemas.Invoice.properties[key], value);
    }
    invoice = { ...invoice, ...decision.command.patch };
  };
  apply(acquireClaim({ invoice, actor, binding, exportRow: row, attemptToken: "w1", now: 1000 }));
  const original = structuredClone(invoice);
  apply(authorizeSend({ invoice, actor, binding, exportRow: row,
    ownership: { claimRef: row.id, attemptToken: "w1", attemptNumber: 1 }, now: 2000 }));
  apply(recoverClaim({ invoice, actor, binding, exportRow: row, now: 100000 }));
  invoice = original;
  apply(cancelInvoice({ invoice, actor, now: 2000 }));
});

test("null legacy revisions and pre-send marker/lease absence have explicit nullable schemas", () => {
  for (const key of ["accounting_revision", f.state, f.attempt_token, f.attempt_number, f.lease_expires_at, f.send_authorized_at, f.error_code]) {
    shape(schemas.Invoice.properties[key], null);
  }
  shape(schemas.AccountingExport.properties.source_revision, null);
  shape(schemas.AccountingConnection.properties.configuration_revision, null);
});
