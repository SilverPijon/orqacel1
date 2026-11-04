/** Executable observation checks shared by local models and a future approved backend driver. */
import assert from "node:assert/strict";

export function checkAcknowledgement(ack) {
  assert.equal(ack?.success, true, "success must be explicit true");
  assert.equal(typeof ack.updated, "number", "updated must not be coerced");
  assert.ok([0, 1].includes(ack.updated), "scalar-id write must change zero or one record");
  assert.equal(ack.has_more, false, "a scalar-id write cannot have more matching batches");
}

export function checkScalarRace({ workers, persistedToken }) {
  assert.ok(Array.isArray(workers) && workers.length >= 2);
  assert.equal(new Set(workers.map((worker) => worker.pid)).size, workers.length, "independent process IDs required");
  assert.equal(new Set(workers.map((worker) => worker.token)).size, workers.length, "distinct attempt tokens required");
  workers.forEach((worker) => {
    assert.ok(Number.isSafeInteger(worker.pid) && worker.pid > 0);
    assert.ok(typeof worker.token === "string" && worker.token.length > 0);
    assert.ok(typeof worker.query?.id === "string" && worker.query.id.length > 0, "plain nonempty scalar id required");
    assert.ok(typeof worker.query.company_id === "string" && worker.query.company_id.length > 0, "tenant predicate required");
    assert.ok(Object.entries(worker.query).every(([key, value]) => !key.startsWith("$") &&
      (value === null || ["string", "number", "boolean"].includes(typeof value))), "exact scalar predicates required");
    assert.deepEqual(worker.query, workers[0].query, "every contender must use the same observed precondition");
    checkAcknowledgement(worker.acknowledgement);
  });
  const winners = workers.filter((worker) => worker.acknowledgement.updated === 1);
  assert.equal(winners.length, 1, "exactly one conditional winner required");
  assert.equal(persistedToken, winners[0].token, "persisted ownership must match the acknowledged winner");
}

export function checkPermissionEvidence(observations, { companyId, invoiceId }) {
  assert.ok(typeof companyId === "string" && companyId.length > 0);
  assert.ok(typeof invoiceId === "string" && invoiceId.length > 0);
  const expected = {
    "adminA-read-A": "allowed", "memberA-read-A": "allowed", "userB-read-A": "denied",
    "anonymous-read-A": "denied", "adminA-write-A": "denied", "memberA-write-A": "denied", "userB-write-A": "denied",
  };
  assert.equal(observations.length, Object.keys(expected).length);
  assert.equal(new Set(observations.map((item) => item.caseId)).size, observations.length);
  for (const item of observations) {
    assert.ok(Object.hasOwn(expected, item.caseId));
    if (expected[item.caseId] === "allowed") {
      assert.equal(item.status, 200);
      assert.equal(item.returnedRecord, true);
      assert.equal(item.recordId, invoiceId);
      assert.equal(item.companyId, companyId);
    }
    else {
      assert.ok([401, 403, 404].includes(item.status), "outages are not evidence of permission enforcement");
      assert.equal(item.returnedRecord, false, "denied reads must expose no record");
    }
    if (item.caseId.includes("write")) {
      assert.equal(item.changed, false, "denied writes must change nothing");
      assert.match(item.beforeDigest, /^[a-f0-9]{64}$/);
      assert.equal(item.afterDigest, item.beforeDigest);
    }
  }
}

export function checkSchemaEvidence(observations) {
  assert.equal(observations.length, 4);
  assert.deepEqual(observations.map((item) => item.schema).sort(), ["AccountingConnection", "AccountingExport", "AccountingExportEvent", "Invoice"]);
  for (const item of observations) {
    assert.equal(item.accepted, true);
    assert.equal(item.allNewFieldsReadBack, true, "schema acceptance alone is insufficient");
    assert.equal(item.nullsReadBack, true);
    assert.equal(item.historicalShapeAccepted, true);
    assert.equal(item.invalidBindingRejected, true);
    assert.equal(item.oldFinancialDigest, item.newFinancialDigest);
    assert.match(item.oldFinancialDigest, /^[a-f0-9]{64}$/);
  }
}
