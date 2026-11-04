import test from "node:test";
import assert from "node:assert/strict";

import { AUDIT_ACTIONS, REDACTED, containsSecret, createAuditEvent, sanitize } from "../export/audit.js";

test("15. audit events are built from a whitelist and cannot carry credentials", () => {
  const event = createAuditEvent({
    action: AUDIT_ACTIONS.EXPORT_CONFIRMED,
    actor: { userId: "u_1", role: "admin" },
    companyId: "co_1",
    exportKey: "co_1:inv_1:invoice",
    invoiceId: "inv_1",
    fromState: "sending",
    toState: "exported",
    attempt: 1,
    providerDocumentNo: "INV-1001",
    at: 1234,
    // Nothing below may reach the event.
    apiKey: "SECRET-KEY",
    api_key: "SECRET-KEY",
    payload: { InvoiceRow: [{ Price: 100 }] },
  });

  assert.deepEqual(Object.keys(event).sort(), [
    "action",
    "actor_role",
    "actor_user_id",
    "attempt",
    "company_id",
    "created_at",
    "error_code",
    "export_key",
    "from_state",
    "invoice_id",
    "kind",
    "provider_document_id",
    "provider_document_no",
    "to_state",
  ]);

  const serialized = JSON.stringify(event);
  assert.equal(serialized.includes("SECRET-KEY"), false);
  assert.equal(serialized.includes("InvoiceRow"), false);
  assert.equal(event.provider_document_no, "INV-1001");
});

test("sanitize redacts sensitive keys and truncates long text", () => {
  const cleaned = sanitize({
    apiKey: "x",
    nested: { token: "t", password: "p", safe: "keep" },
    note: "a".repeat(500),
  });

  assert.equal(cleaned.apiKey, REDACTED);
  assert.equal(cleaned.nested.token, REDACTED);
  assert.equal(cleaned.nested.password, REDACTED);
  assert.equal(cleaned.nested.safe, "keep");
  assert.ok(cleaned.note.length < 500);
});

test("containsSecret detects leaked values in serialized structures", () => {
  const secret = "abc123secret";

  assert.equal(containsSecret({ a: 1 }, [secret]), false);
  assert.equal(containsSecret({ nested: { key: secret } }, [secret]), true);
  assert.equal(containsSecret(`plain ${secret} text`, [secret]), true);
});