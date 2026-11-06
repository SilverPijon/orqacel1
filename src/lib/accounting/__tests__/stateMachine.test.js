import test from "node:test";
import assert from "node:assert/strict";

import {
  EXPORT_STATES,
  applyResult,
  backoffMs,
  canTransition,
  claimForExport,
  exportKey,
  initialRecord,
  isRetryEligible,
  markSending,
  recoverInterrupted,
  resolveAsAbsent,
  resolveAsExported,
} from "../export/stateMachine.js";
import { OUTCOMES } from "../merit/response.js";
import { RECONCILE_CODES, RECONCILE_OUTCOMES, MOCK_LOOKUP_CONTRACT, reconcileLookup } from "../export/reconciliation.js";
import { makeInvoice } from "../testing/fixtures.js";

const KEY = exportKey(makeInvoice());

test("allows only the documented transitions", () => {
  assert.equal(canTransition(EXPORT_STATES.NOT_EXPORTED, EXPORT_STATES.PREPARING), true);
  assert.equal(canTransition(EXPORT_STATES.PREPARING, EXPORT_STATES.SENDING), true);
  assert.equal(canTransition(EXPORT_STATES.SENDING, EXPORT_STATES.EXPORTED), true);
  assert.equal(canTransition(EXPORT_STATES.EXPORTED, EXPORT_STATES.PREPARING), false);
  assert.equal(canTransition(EXPORT_STATES.NEEDS_RECONCILIATION, EXPORT_STATES.PREPARING), false);
  assert.equal(canTransition(EXPORT_STATES.NOT_EXPORTED, EXPORT_STATES.SENDING), false);
});

test("claims exactly one attempt and refuses a second while in flight", () => {
  const start = initialRecord(KEY);
  const claim = claimForExport(start, { now: 1000, leaseMs: 60_000 });

  assert.equal(claim.ok, true);
  assert.equal(claim.next.state, EXPORT_STATES.PREPARING);
  assert.equal(claim.next.attempts, 1);
  assert.equal(claim.next.version, start.version + 1);

  const sending = markSending(claim.next, { now: 1000, leaseMs: 60_000 }).next;
  assert.equal(sending.state, EXPORT_STATES.SENDING);
  assert.equal(sending.lease_expires_at, 61_000);

  const second = claimForExport(sending, { now: 2000 });
  assert.equal(second.ok, false);
  assert.equal(second.code, "in_flight");
});

test("never re-sends onto an expired lease; recovery goes to reconciliation", () => {
  const sending = {
    ...initialRecord(KEY),
    state: EXPORT_STATES.SENDING,
    version: 4,
    attempts: 1,
    lease_expires_at: 5_000,
  };

  const claim = claimForExport(sending, { now: 10_000 });
  assert.equal(claim.ok, false);
  assert.equal(claim.code, "lease_expired");

  const recovered = recoverInterrupted(sending, { now: 10_000 });
  assert.equal(recovered.state, EXPORT_STATES.NEEDS_RECONCILIATION);
  assert.equal(recovered.error_code, "lease_expired");

  assert.equal(recoverInterrupted(sending, { now: 1_000 }), null);
});

test("12. an interrupted execution cannot be retried blindly", () => {
  const interrupted = {
    ...initialRecord(KEY),
    state: EXPORT_STATES.NEEDS_RECONCILIATION,
    version: 5,
    attempts: 1,
    error_code: "lease_expired",
  };

  assert.equal(claimForExport(interrupted, { now: 10_000 }).ok, false);
  assert.equal(claimForExport(interrupted, { now: 10_000 }).code, "needs_reconciliation");
  assert.equal(isRetryEligible(interrupted), false);
});

test("settles each classification into the right state", () => {
  const sending = { ...initialRecord(KEY), state: EXPORT_STATES.SENDING, version: 2, attempts: 1 };

  const confirmed = applyResult(sending, { outcome: OUTCOMES.CONFIRMED, document: { id: "sih-1", number: "INV-1001" } }, { now: 100 });
  assert.equal(confirmed.state, EXPORT_STATES.EXPORTED);
  assert.equal(confirmed.provider_document_id, "sih-1");
  assert.equal(confirmed.provider_document_no, "INV-1001");

  const rejected = applyResult(sending, { outcome: OUTCOMES.REJECTED, code: "licence_required" }, { now: 100 });
  assert.equal(rejected.state, EXPORT_STATES.FAILED_PERMANENT);
  assert.equal(claimForExport(rejected).code, "failed_permanent");

  const retryable = applyResult(sending, { outcome: OUTCOMES.RETRYABLE, code: "rate_limited", retryAfterMs: 2000 }, { now: 100 });
  assert.equal(retryable.state, EXPORT_STATES.FAILED_RETRYABLE);
  assert.equal(retryable.next_attempt_at, 2100);
  assert.equal(isRetryEligible(retryable, 1000), false);
  assert.equal(claimForExport(retryable, { now: 1000 }).code, "retry_not_due");
  assert.equal(claimForExport(retryable, { now: 2100 }).ok, true);

  const ambiguous = applyResult(sending, { outcome: OUTCOMES.AMBIGUOUS, code: "timeout_unknown_commit" }, { now: 100 });
  assert.equal(ambiguous.state, EXPORT_STATES.NEEDS_RECONCILIATION);
});

test("backoff grows and stays capped", () => {
  assert.equal(backoffMs(1), 30_000);
  assert.equal(backoffMs(2), 60_000);
  assert.equal(backoffMs(3), 120_000);
  assert.ok(backoffMs(30) <= 1_800_000);
});

test("10. duplicate lookup distinguishes found, absent and conflicting documents", () => {
  const expected = { number: "INV-1001", currency: "EUR", subtotal: 1500, vat: 285, total: 1785 };
  const evidence = { contract: MOCK_LOOKUP_CONTRACT, complete: true, authoritative: true, invoiceNo: expected.number, currency: expected.currency, nextCursor: null };
  const document = { SIHId: "sih-1", InvoiceNo: expected.number, CurrencyCode: expected.currency, TotalAmount: 1500, VatAmount: 285, TotalSum: 1785 };
  const lookup = (matches) => reconcileLookup({ matches, expected, evidence });
  const found = lookup([document]);
  assert.equal(found.outcome, RECONCILE_OUTCOMES.FOUND);
  assert.equal(found.document.id, "sih-1");
  assert.equal(lookup([]).outcome, RECONCILE_OUTCOMES.ABSENT);
  const multiple = lookup([document, { ...document, SIHId: "b" }]);
  assert.equal(multiple.outcome, RECONCILE_OUTCOMES.CONFLICT);
  assert.equal(multiple.code, RECONCILE_CODES.MULTIPLE_MATCHES);
  const mismatch = lookup([{ ...document, TotalSum: 999 }]);
  assert.equal(mismatch.outcome, RECONCILE_OUTCOMES.CONFLICT);
  assert.equal(mismatch.code, RECONCILE_CODES.AMOUNT_MISMATCH);
});

test("reconciliation moves the record out of ambiguity without sending", () => {
  const stuck = { ...initialRecord(KEY), state: EXPORT_STATES.NEEDS_RECONCILIATION, version: 3, attempts: 1 };

  const exported = resolveAsExported(stuck, { document: { id: "sih-9", number: "INV-1001" }, now: 200 });
  assert.equal(exported.next.state, EXPORT_STATES.EXPORTED);
  assert.equal(exported.next.provider_document_no, "INV-1001");

  const absent = resolveAsAbsent(stuck, { now: 200 });
  assert.equal(absent.next.state, EXPORT_STATES.FAILED_RETRYABLE);
  assert.equal(claimForExport(absent.next, { now: 200 }).ok, true);
});