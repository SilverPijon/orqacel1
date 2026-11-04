/** Local synthetic experiments only; no live Base44 implementation is loaded. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createBase44ClaimStore } from "../export/base44ClaimStore.server.js";
import { commitClaimDecision } from "../export/claimPort.js";
import { evidenceDigest } from "../export/platformAttestation.server.js";
import { createBase44ClaimSdkFake, SYNTHETIC_PROOF } from "../testing/base44ClaimSdkFake.js";
import { makeInvoice } from "../testing/fixtures.js";
import { MERIT_FIELDS as f } from "../export/claimProtocol.js";
import { MOCK_LOOKUP_CONTRACT } from "../export/reconciliation.js";
import { independentRace } from "./independentRace.js";
import { checkAcknowledgement, checkScalarRace } from "./evidenceChecks.js";
import { VERIFICATION_CASES, EXECUTION_STATUS } from "./plan.js";

function fixture(runId, suffix, metadata = {}) {
  const fake = createBase44ClaimSdkFake({ invoice: makeInvoice({ id: `${runId}-${suffix}`, ...metadata }) });
  const port = createBase44ClaimStore({ context: fake.context, platformProof: SYNTHETIC_PROOF,
    clock: fake.clock, newToken: fake.newToken, lookupEvidence: () => fake.state.lookupResponse });
  return { ...fake, port, commit: (plan) => commitClaimDecision(port, plan.decision) };
}
async function candidate(ctx) {
  const row = await ctx.port.prepareCandidate({ invoiceId: ctx.invoice.id, connectionId: ctx.binding.connectionId });
  const saved = await ctx.port.createCandidate(row);
  assert.equal(saved.status, "applied");
  return saved.row;
}
async function prepared(ctx) {
  const row = await candidate(ctx);
  const plan = await ctx.port.prepareTransition("acquire", { invoiceId: ctx.invoice.id, exportId: row.id });
  assert.equal((await ctx.commit(plan)).outcome, "applied");
  return plan.worker;
}
const finances = (invoice) => evidenceDigest(Object.fromEntries([
  "seller_snapshot", "buyer_snapshot", "payment_snapshot", "line_items", "vat_summary", "subtotal", "vat_amount", "total", "number", "currency",
].map((key) => [key, invoice[key]])));

export async function runLocalVerification({ runId = `local-${randomUUID()}` } = {}) {
  if (typeof runId !== "string" || !/^local-[a-zA-Z0-9-]{1,80}$/.test(runId)) throw new Error("local_run_id_required");
  const experiments = {
    async schema_roundtrip() {
      const schemas = {};
      for (const name of ["Invoice", "AccountingExport", "AccountingConnection", "AccountingExportEvent"]) {
        const schema = JSON.parse(await readFile(new URL(`../../../../base44/entities/${name}.jsonc`, import.meta.url), "utf8"));
        assert.equal(schema.type, "object");
        schemas[name] = evidenceDigest(schema);
      }
      return { observation: "static schema digests ONLY; backend acceptance/roundtrip NOT RUN", schemas };
    },
    async scalar_id_concurrency() {
      const ctx = fixture(runId, "race");
      const rows = await Promise.all([candidate(ctx), candidate(ctx), candidate(ctx), candidate(ctx)]);
      const plans = await Promise.all(rows.map((row) => ctx.port.prepareTransition("acquire", { invoiceId: ctx.invoice.id, exportId: row.id })));
      // Independent worker processes issue IPC requests at a common barrier.
      // Parent dispatches into ONE local fake; this is explicitly not backend proof.
      const results = await independentRace(plans.map((plan) => plan.decision.command), async (command) => {
        assert.equal(typeof command.where.id, "string");
        return ctx.context.getBase44().asServiceRole.entities.Invoice.updateMany(command.where, { $set: command.patch });
      });
      checkScalarRace({ workers: results.map((result, i) => ({ ...result,
        query: plans[i].decision.command.where, token: plans[i].decision.command.patch[f.attempt_token],
      })), persistedToken: ctx.read()[f.attempt_token] });
      const winner = results.findIndex((r) => r.acknowledgement.updated === 1);
      assert.equal(ctx.read()[f.ref], rows[winner].id);
      return { transport: "independent processes -> IPC -> single-process SDK fake", results, winner, canonicalRef: ctx.read()[f.ref] };
    },
    async legacy_predicates() {
      const matrix = [];
      for (const [field, values, predicates] of [[f.ref, ["missing", null, ""], [null, ""]], ["accounting_revision", ["missing", null, 0], [null, 0]]]) {
        for (const stored of values) for (const expected of predicates) {
          // Compare exact predicates by changing only one observed legacy field
          // in a server-prepared synthetic command.
          const ctx = fixture(runId, `legacy-${matrix.length}`, stored === "missing" ? {} : { [field]: stored });
          // Use a valid baseline command solely as a raw predicate probe.
          const source = fixture(runId, `source-${matrix.length}`);
          const row = await candidate(source);
          const plan = await source.port.prepareTransition("acquire", { invoiceId: source.invoice.id, exportId: row.id });
          const probe = structuredClone(plan.decision.command);
          probe.where.id = ctx.invoice.id;
          probe.where[field] = expected;
          // Test matching without installing a candidate pointer.
          probe.patch = { accounting_revision: 1 };
          const ack = await ctx.context.getBase44().asServiceRole.entities.Invoice.updateMany(probe.where, { $set: probe.patch });
          checkAcknowledgement(ack);
          const matches = stored === "missing" || stored === null ? expected === null : stored === expected;
          assert.equal(ack.updated, matches ? 1 : 0);
          matrix.push({ field, stored, expected, acknowledgement: ack });
        }
      }
      // Actual claim-reference empty/missing/null paths are separately modeled.
      for (const reference of [undefined, null, ""]) {
        const ctx = fixture(runId, `ref-${matrix.length}`, { [f.ref]: reference });
        await prepared(ctx);
        matrix.push({ claimReference: reference === undefined ? "missing" : reference, persisted: ctx.read()[f.ref] });
      }
      return { matrix, warning: "local missing-as-null convention; actual Base44 semantics UNVERIFIED" };
    },
    async strict_acknowledgements() {
      const results = [];
      for (const ack of [{ success: true, updated: "1", has_more: false }, { success: true, updated: 1 },
        { success: false, updated: 1, has_more: false }, { success: true, updated: 1, has_more: true }]) {
        const ctx = fixture(runId, `ack-${results.length}`);
        const worker = await prepared(ctx);
        const plan = await ctx.port.prepareTransition("authorize_send", { invoiceId: ctx.invoice.id, worker });
        ctx.state.updateResponse = ack;
        const result = await ctx.commit(plan);
        assert.equal(result.outcome, "unknown"); assert.equal(result.sendPermit, null);
        results.push({ acknowledgement: ack, interpreted: result.outcome });
      }
      return { results, warning: "synthetic malformed acknowledgements; real response fields NOT OBSERVED" };
    },
    async candidate_ids() {
      const ctx = fixture(runId, "ids");
      const a = await candidate(ctx), b = await candidate(ctx);
      assert.notEqual(a.id, b.id); assert.equal(a.export_key, b.export_key);
      const requests = ctx.calls.filter((c) => c.name === "AccountingExport.create");
      assert.ok(requests.every((c) => !("id" in c.args[0])));
      assert.equal(ctx.read()[f.ref], undefined);
      return { assignedIds: [a.id, b.id], duplicateKey: a.export_key, claimAbsent: true };
    },
    async tenant_rls() {
      const ctx = fixture(runId, "tenant");
      await assert.rejects(ctx.port.getInvoice({ id: ctx.invoice.id, companyId: "foreign" }), /forbidden_company/);
      ctx.state.memberships[0].role = "member";
      await assert.rejects(ctx.port.getInvoice({ id: ctx.invoice.id, companyId: ctx.invoice.company_id }), /forbidden_role/);
      return { adapterDenied: ["foreign", "member"], backendRls: "NOT RUN; SDK fake does not implement actual Base44 RLS" };
    },
    async cancellation_race() {
      const outcomes = [];
      for (const cancelFirst of [true, false]) {
        const ctx = fixture(runId, `cancel-${cancelFirst}`);
        const worker = await prepared(ctx);
        const send = await ctx.port.prepareTransition("authorize_send", { invoiceId: ctx.invoice.id, worker });
        const cancel = await ctx.port.prepareTransition("cancel", { invoiceId: ctx.invoice.id });
        const plans = cancelFirst ? [cancel, send] : [send, cancel];
        const results = await Promise.all(plans.map(ctx.commit));
        assert.deepEqual(results.map((r) => r.outcome), ["applied", "conflict"]);
        assert.equal(results.filter((r) => r.sendPermit).length, cancelFirst ? 0 : 1);
        outcomes.push({ cancelFirst, outcomes: results.map((r) => r.outcome), state: ctx.read()[f.state] });
      }
      return { outcomes };
    },
    async preparing_recovery() {
      const ctx = fixture(runId, "preparing"); const oldWorker = await prepared(ctx);
      const stale = await ctx.port.prepareTransition("authorize_send", { invoiceId: ctx.invoice.id, worker: oldWorker });
      ctx.state.now = 100000;
      await ctx.commit(await ctx.port.prepareTransition("recover", { invoiceId: ctx.invoice.id }));
      assert.equal((await ctx.commit(stale)).outcome, "conflict");
      const resumed = await ctx.port.prepareTransition("resume_preparation", { invoiceId: ctx.invoice.id, retryApproved: true });
      await ctx.commit(resumed);
      assert.equal(ctx.read()[f.attempt_number], 2);
      return { oldWorkerFenced: true, generation: 2, permanentRef: ctx.read()[f.ref] };
    },
    async sending_recovery() {
      const ctx = fixture(runId, "sending"); const worker = await prepared(ctx);
      await ctx.commit(await ctx.port.prepareTransition("authorize_send", { invoiceId: ctx.invoice.id, worker }));
      const marker = ctx.read()[f.send_authorized_at]; ctx.state.now = 100000;
      await ctx.commit(await ctx.port.prepareTransition("recover", { invoiceId: ctx.invoice.id }));
      ctx.state.lookupResponse = { status: 200, bodyText: "[]", lookupEvidence: { contract: MOCK_LOOKUP_CONTRACT,
        complete: true, authoritative: true, invoiceNo: ctx.invoice.number, currency: ctx.invoice.currency, nextCursor: null } };
      const absent = await ctx.port.prepareTransition("reconcile", { invoiceId: ctx.invoice.id });
      assert.equal(absent.decision.code, "sender_quiescence_unproven");
      assert.equal(ctx.read()[f.send_authorized_at], marker);
      return { markerRetained: true, state: ctx.read()[f.state], replacementPermissions: 0 };
    },
    async uncertain_acknowledgements() {
      const observations = [];
      for (const mode of ["unknown_before", "unknown_after", "throw_after"]) {
        const ctx = fixture(runId, mode); const worker = await prepared(ctx);
        const plan = await ctx.port.prepareTransition("authorize_send", { invoiceId: ctx.invoice.id, worker });
        ctx.storage.injectFault({ operation: "cas", mode });
        const result = await ctx.commit(plan);
        assert.equal(result.outcome, "unknown"); assert.equal(result.sendPermit, null);
        await ctx.port.getInvoice({ id: ctx.invoice.id, companyId: ctx.invoice.company_id });
        await assert.rejects(ctx.port.prepareTransition("authorize_send", { invoiceId: ctx.invoice.id, worker }), /worker_not_authorized/);
        observations.push({ mode, outcome: result.outcome, state: ctx.read()[f.state], permissions: 0 });
      }
      return { observations };
    },
    async delayed_workers() {
      const observations = [];
      for (const mode of ["pause_before", "pause_after"]) {
        const ctx = fixture(runId, mode); const worker = await prepared(ctx);
        let release, entered;
        const wait = new Promise((resolve) => { release = resolve; });
        const started = new Promise((resolve) => { entered = resolve; });
        ctx.storage.injectFault({ operation: "cas", mode, wait, entered });
        const pending = ctx.commit(await ctx.port.prepareTransition("authorize_send", { invoiceId: ctx.invoice.id, worker }));
        await started;
        ctx.state.now = 100000;
        await ctx.commit(await ctx.port.prepareTransition("recover", { invoiceId: ctx.invoice.id }));
        release();
        const result = await pending;
        assert.equal(Boolean(result.sendPermit), mode === "pause_after");
        await assert.rejects(ctx.port.prepareTransition("authorize_send", { invoiceId: ctx.invoice.id, worker }), /worker_not_authorized/);
        observations.push({ mode, originalPermission: Boolean(result.sendPermit), replacementPermissions: 0, state: ctx.read()[f.state] });
      }
      return { observations };
    },
    async financial_integrity() {
      const ctx = fixture(runId, "finance"); const before = finances(ctx.read());
      await prepared(ctx);
      await ctx.commit(await ctx.port.prepareTransition("cancel", { invoiceId: ctx.invoice.id }));
      const after = finances(ctx.read()); assert.equal(after, before);
      return { before, after, unchanged: true };
    },
  };
  const checks = [];
  for (const { id } of VERIFICATION_CASES) {
    try {
      const evidence = await experiments[id]();
      checks.push({ id, status: "model-passed", evidence, evidenceDigest: evidenceDigest(evidence) });
    } catch (failure) {
      // Never serialize SDK errors, request headers or environment data.
      checks.push({ id, status: "model-failed", evidence: { failure: failure instanceof assert.AssertionError ? "assertion_failed" : "local_experiment_failed" } });
    }
  }
  return { version: 1, runId, mode: "local-model", syntheticOnly: true, appId: null,
    executionStatus: EXECUTION_STATUS, status: checks.every((check) => check.status === "model-passed") ? "local-passed" : "local-failed",
    backendChecksExecuted: 0, checks };
}
