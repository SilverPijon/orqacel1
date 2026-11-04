import test from "node:test";
import assert from "node:assert/strict";

import { OUTCOMES, RESPONSE_CODES, classifyMeritResponse, classifyTransportError } from "../merit/response.js";

test("7. rejects an invalid provider response as ambiguous, never as success", () => {
  const html = classifyMeritResponse({ status: 200, bodyText: "<html>Service unavailable</html>" });
  assert.equal(html.outcome, OUTCOMES.AMBIGUOUS);
  assert.equal(html.code, RESPONSE_CODES.STACKTRACE_BODY);

  const emptyJson = classifyMeritResponse({ status: 200, bodyText: '{"Unexpected":"shape"}' });
  assert.equal(emptyJson.outcome, OUTCOMES.AMBIGUOUS);
  assert.equal(emptyJson.code, RESPONSE_CODES.INVALID_BODY);

  const empty = classifyMeritResponse({ status: 200, bodyText: "" });
  assert.equal(empty.outcome, OUTCOMES.AMBIGUOUS);
  assert.equal(empty.code, RESPONSE_CODES.EMPTY_BODY);
});

test("8. a 200 carrying an error body is not a success", () => {
  const stacktrace = classifyMeritResponse({
    status: 200,
    bodyText: "System.ArgumentException: Invoice has no rows\n   at Merit.Aktiva.Api.InvoiceService...",
  });

  assert.equal(stacktrace.outcome, OUTCOMES.AMBIGUOUS);
  assert.equal(stacktrace.code, RESPONSE_CODES.STACKTRACE_BODY);
  assert.equal(stacktrace.document, null);
});

test("classifies a documented success", () => {
  const confirmed = classifyMeritResponse({
    status: 200,
    bodyText: JSON.stringify({ CustomerId: "cust-1", InvoiceId: "sih-1", InvoiceNo: "INV-1001", RefNo: null }),
  });

  assert.equal(confirmed.outcome, OUTCOMES.CONFIRMED);
  assert.equal(confirmed.document.id, "sih-1");
  assert.equal(confirmed.document.number, "INV-1001");
});

test("classifies documented rejections as permanent, not retryable", () => {
  const licence = classifyMeritResponse({ status: 401, bodyText: "api-wronglicense" });
  assert.equal(licence.outcome, OUTCOMES.REJECTED);
  assert.equal(licence.code, RESPONSE_CODES.LICENCE_REQUIRED);

  const auth = classifyMeritResponse({ status: 401, bodyText: '{"errors":["bad signature"]}' });
  assert.equal(auth.outcome, OUTCOMES.REJECTED);
  assert.equal(auth.code, RESPONSE_CODES.AUTH_FAILED);

  const payload = classifyMeritResponse({ status: 400, bodyText: '{"errors":["CountryCode"]}' });
  assert.equal(payload.outcome, OUTCOMES.REJECTED);
  assert.equal(payload.code, RESPONSE_CODES.PAYLOAD_REJECTED);
});

test("classifies rate limiting as retryable and honours Retry-After", () => {
  const limited = classifyMeritResponse({ status: 429, bodyText: "", headers: { "retry-after": "2" } });

  assert.equal(limited.outcome, OUTCOMES.RETRYABLE);
  assert.equal(limited.code, RESPONSE_CODES.RATE_LIMITED);
  assert.equal(limited.retryAfterMs, 2000);
});

test("9. a server error or timeout stays ambiguous because the document may exist", () => {
  const server = classifyMeritResponse({ status: 500, bodyText: "Internal Server Error" });
  assert.equal(server.outcome, OUTCOMES.AMBIGUOUS);
  assert.equal(server.code, RESPONSE_CODES.SERVER_ERROR);

  const timeout = new Error("timed out");
  timeout.name = "TimeoutError";
  const classified = classifyTransportError(timeout);
  assert.equal(classified.outcome, OUTCOMES.AMBIGUOUS);
  assert.equal(classified.code, RESPONSE_CODES.TIMEOUT_UNKNOWN_COMMIT);

  const network = classifyTransportError(Object.assign(new Error("socket hang up"), { code: "ECONNRESET" }));
  assert.equal(network.outcome, OUTCOMES.AMBIGUOUS);
  assert.equal(network.code, RESPONSE_CODES.NETWORK_ERROR);
});