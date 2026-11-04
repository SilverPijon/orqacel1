import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  canonicalEvidence, evidenceDigest, verifyPlatformAttestation, REQUIRED_BACKEND_CHECKS,
} from "../export/platformAttestation.server.js";
import { verificationPlan, EXECUTION_STATUS } from "../verification/plan.js";
import { runLocalVerification } from "../verification/localHarness.js";
import { checkAcknowledgement, checkScalarRace, checkPermissionEvidence, checkSchemaEvidence } from "../verification/evidenceChecks.js";
import { independentRace } from "../verification/independentRace.js";

// Ephemeral format/signature test keys only. No real signing/production keys,
// credentials, app connections or attestation files are created.
const keys = generateKeyPairSync("ed25519");
function fixture() {
  const policy = {
    disposableAppId: "disposable-test-app", productionAppIds: ["deny-production-sentinel"], environmentId: "isolated-test-runtime",
    schemaDigest: "a".repeat(64), adapterDigest: "b".repeat(64), sdkDigest: "c".repeat(64), harnessDigest: "d".repeat(64), maxAgeMs: 10000,
  };
  const report = { mode: "disposable-backend", status: "passed", runId: "synthetic-attestation-format-test",
    appId: policy.disposableAppId, environmentId: policy.environmentId, syntheticOnly: true,
    backendChecksExecuted: REQUIRED_BACKEND_CHECKS.length,
    ...Object.fromEntries(["schemaDigest", "adapterDigest", "sdkDigest", "harnessDigest"].map((field) => [field, policy[field]])),
    checks: REQUIRED_BACKEND_CHECKS.map((id) => {
      const evidence = { caseId: id, observation: "synthetic format test; NOT actual backend observations" };
      return { id, status: "passed", evidence, evidenceDigest: evidenceDigest(evidence) };
    }),
  };
  const payload = { version: 1, purpose: "disposable-base44-verification", appId: report.appId,
    environmentId: report.environmentId, runId: report.runId, reviewerId: "test-reviewer", reviewId: "test-review-1",
    issuedAt: 1000, expiresAt: 9000, reportDigest: evidenceDigest(report),
    ...Object.fromEntries(["schemaDigest", "adapterDigest", "sdkDigest", "harnessDigest"].map((field) => [field, policy[field]])),
  };
  return { policy, report, payload };
}
function seal(payload, privateKey = keys.privateKey) {
  return { keyId: "pinned-test-reviewer", payload,
    signature: sign(null, Buffer.from(JSON.stringify(canonicalEvidence(payload))), privateKey).toString("base64") };
}
function verify(ctx, overrides = {}) {
  return verifyPlatformAttestation({ envelope: seal(ctx.payload), report: ctx.report, policy: ctx.policy,
    trustedKeys: { "pinned-test-reviewer": keys.publicKey }, now: 2000, ...overrides });
}

test("valid signed format verifies offline but can never authorize activation", () => {
  const result = verify(fixture());
  assert.equal(result.verified, true);
  assert.equal(result.activationAllowed, false);
  assert.equal("scalarIdCAS" in result, false, "never emit Stage-B activation booleans");
});

test("canonical digests do not depend on object insertion order", () => {
  assert.equal(evidenceDigest({ b: 2, a: { d: 4, c: 3 } }), evidenceDigest({ a: { c: 3, d: 4 }, b: 2 }));
});

test("a self-supplied envelope key cannot replace the trusted server key", () => {
  const ctx = fixture(), attacker = generateKeyPairSync("ed25519");
  const envelope = { ...seal(ctx.payload, attacker.privateKey), publicKey: attacker.publicKey };
  assert.equal(verify(ctx, { envelope }).reason, "invalid_signature");
  assert.equal(verify(ctx, { trustedKeys: {} }).reason, "untrusted_signer");
});

test("tampered signatures and payloads fail closed", () => {
  const ctx = fixture(), envelope = seal(ctx.payload);
  envelope.payload = { ...ctx.payload, runId: "tampered" };
  assert.equal(verify(ctx, { envelope }).reason, "invalid_signature");
  assert.equal(verify(ctx, { envelope: { ...seal(ctx.payload), signature: "invalid" } }).verified, false);
});

for (const patch of [
  { appId: "another-app" }, { environmentId: "another-runtime" }, { purpose: "production-enable" },
  { runId: "another-run" }, { reviewerId: "" }, { reviewId: "" },
]) {
  test(`signed scope mismatch is rejected: ${JSON.stringify(patch)}`, () => {
    const ctx = fixture(); Object.assign(ctx.payload, patch);
    assert.equal(verify(ctx).verified, false);
    assert.equal(verify(ctx).activationAllowed, false);
  });
}

test("production denylist and run revocation override otherwise valid attestations", () => {
  const ctx = fixture();
  ctx.policy.productionAppIds.push(ctx.policy.disposableAppId);
  assert.equal(verify(ctx).reason, "wrong_scope");
  ctx.policy.productionAppIds.pop(); ctx.policy.revokedRunIds = [ctx.payload.runId];
  assert.equal(verify(ctx).reason, "wrong_scope");
});

for (const patch of [{ issuedAt: 3000 }, { expiresAt: 2000 }, { issuedAt: -1 }, { expiresAt: 100000 }, { issuedAt: "1000" }]) {
  test(`invalid attestation time is rejected: ${JSON.stringify(patch)}`, () => {
    const ctx = fixture(); Object.assign(ctx.payload, patch);
    assert.equal(verify(ctx).verified, false);
  });
}

for (const field of ["schemaDigest", "adapterDigest", "sdkDigest", "harnessDigest"]) {
  test(`version drift cannot reuse old evidence: ${field}`, () => {
    const ctx = fixture(); ctx.policy[field] = "f".repeat(64);
    assert.equal(verify(ctx).reason, "version_mismatch");
  });
}

test("modified evidence cannot retain a prior report signature", () => {
  const ctx = fixture(); ctx.report.checks[0].evidence.observation = "changed";
  assert.equal(verify(ctx).reason, "evidence_mismatch");
  ctx.payload.reportDigest = evidenceDigest(ctx.report);
  assert.equal(verify(ctx).reason, "incomplete_evidence", "a newly signed report must also bind actual case artifacts");
});

for (const status of ["skipped", "unrun", "failed", "model-passed"]) {
  test(`required check outcome cannot be omitted or promoted: ${status}`, () => {
    const ctx = fixture(); ctx.report.checks[0].status = status;
    ctx.payload.reportDigest = evidenceDigest(ctx.report);
    assert.equal(verify(ctx).reason, "incomplete_evidence");
  });
}

test("duplicate or missing check identifiers cannot satisfy the evidence gate", () => {
  for (const change of [(r) => r.checks.pop(), (r) => { r.checks[1] = structuredClone(r.checks[0]); }]) {
    const ctx = fixture(); change(ctx.report); ctx.payload.reportDigest = evidenceDigest(ctx.report);
    assert.equal(verify(ctx).reason, "incomplete_evidence");
  }
});

test("local/model evidence remains ineligible even if explicitly signed", () => {
  const ctx = fixture(); ctx.report.mode = "local-model"; ctx.report.backendChecksExecuted = 0;
  ctx.payload.reportDigest = evidenceDigest(ctx.report);
  assert.equal(verify(ctx).reason, "not_backend_evidence");
});

for (const patch of [{ maxAgeMs: undefined }, { maxAgeMs: 0 }, { disposableAppId: "" }, { productionAppIds: [] }, { environmentId: undefined }]) {
  test(`incomplete server policy fails closed: ${JSON.stringify(patch)}`, () => {
    const ctx = fixture(); Object.assign(ctx.policy, patch);
    assert.equal(verify(ctx).reason, "invalid_input");
  });
}

test("plan and CLI expose no live backend execution mode", () => {
  assert.equal(verificationPlan().executionStatus, EXECUTION_STATUS);
  assert.deepEqual(verificationPlan().cases.map((c) => c.id), REQUIRED_BACKEND_CHECKS);
  const cli = new URL("../../../../scripts/accounting-verification.js", import.meta.url);
  const plan = JSON.parse(execFileSync(process.execPath, [cli.pathname, "--plan"], { encoding: "utf8", env: {} }));
  assert.equal(plan.executionStatus, EXECUTION_STATUS);
  for (const args of [["--backend"], ["--execute", "--app-id=some-app"], ["--approve=true"], ["--token=do-not-echo-this"]]) {
    try { execFileSync(process.execPath, [cli.pathname, ...args], { encoding: "utf8", env: {}, stdio: "pipe" }); assert.fail("backend mode accepted"); }
    catch (failure) {
      assert.equal(failure.status, 2);
      assert.match(failure.stderr, /REAL_BASE44_EXECUTION_DISABLED/);
      assert.equal(failure.stderr.includes("do-not-echo-this"), false);
    }
  }
});

test("local synthetic harness runs every experiment and explicitly reports zero backend checks", async () => {
  const report = await runLocalVerification({ runId: "local-regression" });
  assert.equal(report.mode, "local-model"); assert.equal(report.status, "local-passed");
  assert.equal(report.backendChecksExecuted, 0); assert.equal(report.appId, null);
  assert.equal(report.checks.length, REQUIRED_BACKEND_CHECKS.length);
  for (const check of report.checks) {
    assert.equal(check.status, "model-passed");
    assert.equal(check.evidenceDigest, evidenceDigest(check.evidence));
  }
  const race = report.checks.find((c) => c.id === "scalar_id_concurrency").evidence;
  assert.equal(new Set(race.results.map((r) => r.pid)).size, 4);
  const ctx = fixture(); ctx.report = report; ctx.payload.runId = report.runId; ctx.payload.reportDigest = evidenceDigest(report);
  assert.equal(verify(ctx).verified, false);
});

test("local run IDs cannot pretend to identify an approved backend run", async () => {
  await assert.rejects(runLocalVerification({ runId: "production-run" }), /local_run_id_required/);
});

for (const ack of [{}, { success: true, updated: "1", has_more: false }, { success: true, updated: 2, has_more: false },
  { success: false, updated: 1, has_more: false }, { success: true, updated: 1, has_more: true }]) {
  test(`raw acknowledgement mismatch fails the executable checker: ${JSON.stringify(ack)}`, () => {
    assert.throws(() => checkAcknowledgement(ack));
  });
}

test("race checker detects duplicate winners, stale readback, shared processes and changed predicates", () => {
  const workers = [
    { pid: 1, token: "a", query: { id: "synthetic", company_id: "companyA", accounting_revision: 0 }, acknowledgement: { success: true, updated: 1, has_more: false } },
    { pid: 2, token: "b", query: { id: "synthetic", company_id: "companyA", accounting_revision: 0 }, acknowledgement: { success: true, updated: 0, has_more: false } },
  ];
  checkScalarRace({ workers, persistedToken: "a" });
  for (const change of [
    (w) => { w[1].acknowledgement.updated = 1; }, (w) => { w[1].pid = 1; },
    (w) => { w[1].query.accounting_revision = 1; }, (w) => { w[1].query.id = { $in: ["synthetic"] }; },
  ]) { const copy = structuredClone(workers); change(copy); assert.throws(() => checkScalarRace({ workers: copy, persistedToken: "a" })); }
  assert.throws(() => checkScalarRace({ workers, persistedToken: "other" }));
});

test("permission checker cannot confuse outages or leaked records with denied access", () => {
  const cases = ["adminA-read-A", "memberA-read-A", "userB-read-A", "anonymous-read-A", "adminA-write-A", "memberA-write-A", "userB-write-A"];
  const scope = { companyId: "companyA", invoiceId: "synthetic-invoice" };
  const observations = cases.map((caseId, i) => ({ caseId, status: i < 2 ? 200 : 403, returnedRecord: i < 2, changed: false,
    companyId: scope.companyId, recordId: scope.invoiceId, beforeDigest: "a".repeat(64), afterDigest: "a".repeat(64) }));
  checkPermissionEvidence(observations, scope);
  const outage = structuredClone(observations); outage[2].status = 500;
  assert.throws(() => checkPermissionEvidence(outage, scope));
  const leak = structuredClone(observations); leak[2].returnedRecord = true;
  assert.throws(() => checkPermissionEvidence(leak, scope));
  const wrongRecord = structuredClone(observations); wrongRecord[0].companyId = "other";
  assert.throws(() => checkPermissionEvidence(wrongRecord, scope));
  const hiddenMutation = structuredClone(observations); hiddenMutation[4].afterDigest = "b".repeat(64);
  assert.throws(() => checkPermissionEvidence(hiddenMutation, scope));
});

test("schema checker requires persisted fields and negative tests, not just schema acceptance", () => {
  const observations = ["Invoice", "AccountingExport", "AccountingConnection", "AccountingExportEvent"].map((schema) => ({
    schema, accepted: true, allNewFieldsReadBack: true, nullsReadBack: true, historicalShapeAccepted: true,
    invalidBindingRejected: true, oldFinancialDigest: "a".repeat(64), newFinancialDigest: "a".repeat(64),
  }));
  checkSchemaEvidence(observations);
  for (const patch of [{ allNewFieldsReadBack: false }, { invalidBindingRejected: false }, { newFinancialDigest: "b".repeat(64) }]) {
    const copy = structuredClone(observations); Object.assign(copy[0], patch); assert.throws(() => checkSchemaEvidence(copy));
  }
});

test("independent worker failures reject and clean up owned processes", async () => {
  await assert.rejects(independentRace([{}, {}], async () => { throw new Error("synthetic failure"); }), /worker_write_failed/);
});
