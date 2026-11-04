import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";

import { buildSignedRequest, meritTimestamp, signMeritRequest } from "../merit/signature.js";

const API_ID = "test-api-id";
const API_KEY = "test-api-key";
const BODY = JSON.stringify({ InvoiceNo: "INV-1001", TotalAmount: 1500 });
const DATE = new Date("2026-02-01T09:05:07.000Z");

test("builds a UTC timestamp in the documented yyyyMMddHHmmss form", () => {
  assert.equal(meritTimestamp(DATE), "20260201090507");
  assert.equal(meritTimestamp(new Date("2026-12-31T23:59:59.000Z")), "20261231235959");
});

test("signs apiId + timestamp + body with HMAC-SHA256 in base64", () => {
  const signature = signMeritRequest({ apiId: API_ID, apiKey: API_KEY, timestamp: "20260201090507", body: BODY });
  const expected = createHmac("sha256", API_KEY).update(`${API_ID}20260201090507${BODY}`, "utf8").digest("base64");

  assert.equal(signature, expected);
  assert.match(signature, /^[A-Za-z0-9+/]+=*$/);
});

test("the signature is sensitive to every signed component", () => {
  const base = signMeritRequest({ apiId: API_ID, apiKey: API_KEY, timestamp: "20260201090507", body: BODY });

  const otherId = signMeritRequest({ apiId: "other", apiKey: API_KEY, timestamp: "20260201090507", body: BODY });
  const otherKey = signMeritRequest({ apiId: API_ID, apiKey: "other", timestamp: "20260201090507", body: BODY });
  const otherTime = signMeritRequest({ apiId: API_ID, apiKey: API_KEY, timestamp: "20260201090508", body: BODY });
  const otherBody = signMeritRequest({ apiId: API_ID, apiKey: API_KEY, timestamp: "20260201090507", body: "{}" });

  for (const variant of [otherId, otherKey, otherTime, otherBody]) {
    assert.notEqual(variant, base);
  }
});

test("builds a signed, URL-encoded request without performing any call", () => {
  const request = buildSignedRequest({ apiId: API_ID, apiKey: API_KEY, body: BODY, date: DATE, endpoint: "/api/v1/sendinvoice" });

  assert.equal(request.endpoint, "/api/v1/sendinvoice");
  assert.equal(request.body, BODY);
  assert.equal(request.params.timestamp, "20260201090507");
  assert.ok(request.query.includes("apiId=test-api-id"));
  assert.ok(request.query.includes("timestamp=20260201090507"));
  assert.ok(request.query.includes("signature="));

  // The signature is URL-encoded, since base64 contains characters unsafe in a query string.
  const encoded = request.query.split("signature=")[1];
  assert.equal(decodeURIComponent(encoded), request.params.signature);
});

test("refuses to sign without credentials rather than emitting an unsigned request", () => {
  assert.throws(() => signMeritRequest({ apiId: "", apiKey: API_KEY, timestamp: "20260201090507" }));
  assert.throws(() => signMeritRequest({ apiId: API_ID, apiKey: "", timestamp: "20260201090507" }));
});