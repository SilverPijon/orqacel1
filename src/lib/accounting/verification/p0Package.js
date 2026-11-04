/** P0 recipes/checks only. No SDK bootstrap, credentials, network or activation. */
import { isDeepStrictEqual } from "node:util";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { checkAcknowledgement, checkScalarRace } from "./evidenceChecks.js";
import { evidenceDigest } from "../export/platformAttestation.server.js";
import { freezeCopy, withPendingAudit, clearVerifiedPending } from "../export/auditOutbox.js";
import { acquireClaim, createExportCandidate, MERIT_FIELDS as f } from "../export/claimProtocol.js";
import { compileInvoiceCAS } from "../export/safePersistenceContracts.js";

export const P0_CATALOGUE = freezeCopy([
  { id: "A", title: "Independent scalar-ID CAS", pass: "Distinct worker clients compete on identical predicates; exactly one updated=1, all others updated=0; independent read equals full winner patch.", fail: "Two winners, invalid acknowledgement, or persisted state contradicts winner.", inconclusive: "Missing worker/reader evidence or timed-out contender." },
  { id: "B", title: "Atomic revision/state/outbox", pass: "Independent samples contain only complete pre/post images and final read contains complete acknowledged patch.", fail: "Any torn image, omitted field or contradictory final image.", inconclusive: "No concurrent read sampling, missing pre/post control or unknown write." },
  { id: "C", title: "Legacy predicates", pass: "All nine missing/null/empty equality and exists:false cases match the declared adapter truth table and independent persisted counts.", fail: "Observed matching or persisted change differs from truth table.", inconclusive: "A representation cannot be created/read back or a request has no definitive result." },
  { id: "D", title: "Whole-field unset", pass: "Exact scalar CAS unsets the complete pending field, increments accounting revision and preserves other fields.", fail: "Null/empty replacement, partial clear, lost unrelated data or contradictory acknowledgement.", inconclusive: "Missing readback or unknown write." },
  { id: "E", title: "Raw acknowledgements", pass: "Positive and zero-match controls expose success:true, numeric updated:1/0 and has_more:false, consistent with persisted images.", fail: "Malformed/coerced/contradictory fields or multi-record count.", inconclusive: "Missing response or missing positive/negative control." },
  { id: "F", title: "Schema roundtrip/generated ID", pass: "Each isolated schema has a positive create/read control with assigned ID; nullable values survive; unknown binding keys are rejected with a schema-specific error.", fail: "Accepted invalid binding, ID mismatch, rejected required supported shape or lossy roundtrip.", inconclusive: "Missing provisioning receipt, ambiguous error or unproven identity/permissions." },
  { id: "G", title: "Protected direct writes", pass: "Authenticated admin/member can read own record but direct metadata writes are denied and independent before/after images match.", fail: "Unauthorized protected write persisted.", inconclusive: "Unverified identity, failed positive read, outage or ambiguous denial." },
  { id: "H", title: "Tenant/anonymous isolation", pass: "Verified own-tenant reads succeed; foreign/anonymous reads and direct writes are denied, with unchanged independent image.", fail: "Foreign data returned or unauthorized mutation persisted.", inconclusive: "Identity/tenant setup unproven, outage or incomplete controls." },
  { id: "I", title: "Delay/dropped acknowledgement", pass: "Explicit barrier delays old writer; independent newer CAS fences it; suppressed replies produce unknown without retry, followed by independent read.", fail: "Stale write applies, retry occurs, or suppressed acknowledgement is reported as applied.", inconclusive: "Barrier ordering, caller outcome or independent persisted result missing." },
  { id: "J", title: "Independent persisted verification", pass: "New reader process/client confirms ID/company and full expected winner image, excluding contradictory mixed writes.", fail: "Persisted image differs from acknowledged winner.", inconclusive: "Missing independent reader, target identity or complete result." },
]);

export const P0_REPORT_SCHEMA = freezeCopy({
  type:"object", required:["version","runId","status","mode","appId","environmentId","sdkVersion","schemaHashes","adapterHash","driverHash","workerHash","probeHash","activationAllowed","backendChecksExecuted","probes"],
  properties:{version:{const:1},runId:{type:"string"},status:{const:"PREPARED"},mode:{const:"SYNTHETIC ONLY"},
    appId:{type:"null"},environmentId:{type:"null"},sdkVersion:{type:"string"},schemaHashes:{type:"object"},adapterHash:{type:"string"},driverHash:{type:"string"},workerHash:{type:"string"},probeHash:{type:"string"},
    activationAllowed:{const:false},backendChecksExecuted:{const:0},probes:{type:"array",minItems:10,maxItems:10,items:{type:"object",
      required:["probeId","classification","reason","evidence","remainingUncertainty"],properties:{probeId:{enum:P0_CATALOGUE.map(p=>p.id)},
        classification:{enum:["PASS","FAIL","INCONCLUSIVE"]},reason:{type:"string"},evidence:{type:["object","null"]},remainingUncertainty:{type:"string"}}}}},
});

export function p0Plan() {
  const schemas = ["Invoice", "AccountingConnection", "AccountingExport", "AccountingExportEvent"].map(name => {
    const original = JSON.parse(readFileSync(new URL(`../../../../base44/entities/${name}.jsonc`, import.meta.url), "utf8"));
    const schema = { ...original, name: `P0Capability${name}` };
    return { source: name, entity: schema.name, hash: evidenceDigest(schema), schema };
  });
  return { version: 1, status: "PREPARED", execution: "BLOCKED_SEPARATE_REVIEW_REQUIRED", activationAllowed: false,
    schemas, probes: P0_CATALOGUE, reportSchema:P0_REPORT_SCHEMA,
    sdkVersion: JSON.parse(readFileSync(new URL("../../../../node_modules/@base44/sdk/package.json", import.meta.url), "utf8")).version,
    adapterHash: evidenceDigest(readFileSync(new URL("../export/base44ClaimStore.server.js", import.meta.url), "utf8")),
    driverHash: evidenceDigest(readFileSync(new URL("./p0Driver.js", import.meta.url), "utf8")),
    workerHash: evidenceDigest(readFileSync(new URL("./p0Worker.js", import.meta.url), "utf8")),
    probeHash: evidenceDigest(readFileSync(new URL("./p0Package.js", import.meta.url), "utf8")),
    identities: ["service", "adminA", "memberA", "userB", "anonymous"],
    requiredExecutionEvidence:["explicit_user_execution_approval","new_app_creation_receipt","independently_verified_app_and_environment",
      "production_denylist_and_exact_allowlist","dedicated_schema_provisioning_receipt","test_only_identity_provenance",
      "run_owned_fixture_registry","separately_reviewed_worker_bootstrap"],
    crossRecordRevocation: "BLOCKED_NO_VERIFIED_COMPOUND_ATOMIC_OPERATION" };
}

/** Registered synthetic fixture only; scalar IDs are assigned by backend creation. */
export function claimRecipe(invoice, token) {
  const actor = { userId: "p0-synthetic-admin", role: "admin", companyId: invoice.company_id };
  const binding = { companyId: invoice.company_id, provider: "merit", connectionId: "p0-synthetic-connection", connectionRevision: 0,
    environment: "test", region: "ee", ledgerId: "p0-synthetic-ledger", bindingId: "p0-synthetic-binding" };
  const candidate = createExportCandidate({ invoice, actor, binding, exportId: "p0-synthetic-candidate" });
  const decision = withPendingAudit({ invoice, now: 1000, decision: acquireClaim({ invoice, actor, binding, exportRow: candidate.row, attemptToken: token, now: 1000 }) });
  if (!decision.ok) throw new Error("invalid_synthetic_fixture");
  const compiled = compileInvoiceCAS(invoice, decision.command);
  return { identity: "service", entity: "P0CapabilityInvoice", operation: "write", query: compiled.query,
    update: compiled.update, expected: compiled.expectedInvoice };
}
export function clearRecipe(invoice) {
  const clear = clearVerifiedPending(invoice, invoice.accounting_pending_event);
  if (!clear.ok) throw new Error("invalid_synthetic_pending");
  const compiled = compileInvoiceCAS(invoice, clear.command);
  return { identity: "service", entity: "P0CapabilityInvoice", operation: "write", query: compiled.query,
    update: compiled.update, expected: compiled.expectedInvoice };
}
export function predicateRecipes(fixtures) {
  if (new Set(Object.values(fixtures).map(row=>row?.id)).size !== 9) throw new Error("nine_fresh_registered_fixtures_required");
  return ["missing", "null", "empty"].flatMap(shape => ["null", "empty", "missing"].map(predicate => {
    const invoice = fixtures[`${shape}:${predicate}`];
    if (!invoice?.id) throw new Error("nine_fresh_registered_fixtures_required");
    const expectedUpdated = predicate === "null" ? Number(shape !== "empty") : predicate === "empty" ? Number(shape === "empty") : Number(shape === "missing");
    return { identity: "service", entity: "P0CapabilityInvoice", operation: "write", shape, predicate, expectedUpdated,
      query: { id: invoice.id, company_id: invoice.company_id, [f.attempt_token]: predicate === "missing" ? { $exists: false } : predicate === "null" ? null : "" },
      update: { $set: { accounting_revision: 1 } } };
  }));
}

/** Concrete SDK tasks for schema/permission controls; fixture IDs are registered
 * by the future approved creator, never discovered by listing existing records. */
export function controlRecipes(invoice) {
  const read = identity => ({operation:"read",identity,entity:"P0CapabilityInvoice",id:invoice.id,companyId:invoice.company_id});
  const write = identity => ({operation:"write",identity,entity:"P0CapabilityInvoice",
    query:{id:invoice.id,company_id:invoice.company_id},update:{$set:{accounting_revision:99}}});
  const binding = claimRecipe(invoice,"p0-schema-token").expected[f.binding];
  const data = {
    Invoice:{company_id:invoice.company_id,number:"p0-synthetic-number",status:"issued",revision:0,accounting_revision:null,[f.attempt_token]:null},
    AccountingConnection:{company_id:invoice.company_id,provider:"merit",environment:"test",configuration_revision:0,destination_binding:binding,destination_verified_at:null},
    AccountingExport:{company_id:invoice.company_id,invoice_id:invoice.id,export_key:"p0-synthetic-export",binding,source_revision:null},
    AccountingExportEvent:{company_id:invoice.company_id,invoice_id:invoice.id,action:"export_claimed",binding},
  };
  return {
    E:[{...write("service"),query:{id:invoice.id,company_id:invoice.company_id,accounting_revision:0}},
      {...write("service"),query:{id:invoice.id,company_id:invoice.company_id,accounting_revision:0}}],
    F:Object.entries(data).flatMap(([source,row])=>[
      {operation:"create",identity:"service",entity:`P0Capability${source}`,data:row},
      {operation:"create",identity:"service",entity:`P0Capability${source}`,data:{...row,
        [source === "AccountingConnection" ? "destination_binding" : source === "Invoice" ? f.binding : "binding"]:{...binding,unexpected:"p0-invalid-key"}}},
    ]),
    G:["adminA","memberA"].map(identity=>({identity,read:read(identity),write:write(identity)})),
    H:["userB","anonymous"].map(identity=>({identity,read:read(identity),write:write(identity)})),
    I:{stale:claimRecipe(invoice,"p0-stale"),newer:claimRecipe(invoice,"p0-newer"),
      dropBefore:{...claimRecipe(invoice,"p0-before"),dropAcknowledgement:"before"},
      dropAfter:{...claimRecipe(invoice,"p0-after"),dropAcknowledgement:"after"}},
    J:read("service"),
  };
}

/** Sanitization keeps types/key shapes, never arbitrary values/error bodies. */
export function shapeOf(value, depth = 0) {
  if (depth > 6) return "truncated";
  if (value === null) return "null";
  if (Array.isArray(value)) return { type: "array", length: value.length };
  if (typeof value === "object") return Object.fromEntries(Object.keys(value).filter(k => /^[a-zA-Z_$][a-zA-Z0-9_$]{0,90}$/.test(k)).slice(0, 60).map(k => [k, shapeOf(value[k], depth + 1)]));
  return typeof value;
}
export function ackShape(ack) {
  return { shape: shapeOf(ack), ...(typeof ack?.success === "boolean" ? { success: ack.success } : {}),
    ...(typeof ack?.updated === "number" && Number.isFinite(ack.updated) ? { updated: ack.updated } : {}),
    ...(typeof ack?.has_more === "boolean" ? { has_more: ack.has_more } : {}) };
}
const independent = (a, b) => a?.pid > 0 && b?.pid > 0 && a.pid !== b.pid && a.clientId && b.clientId && a.clientId !== b.clientId;
const equal = isDeepStrictEqual;
// SDK-managed update timestamp is not an application invariant. Preserve and
// compare every other field; never drop unknown fields or financial snapshots.
const sameImage = (a,b) => {
  if (!a || !b) return false;
  const strip = row => Object.fromEntries(Object.entries(row).filter(([k])=>k!=="updated_date"));
  return equal(strip(a),strip(b));
};

/** Observations are trusted raw test-driver facts; never browser assertions. */
export function classifyP0(id, o) {
  if (!P0_CATALOGUE.some(p => p.id === id)) throw new Error("unknown_probe");
  const result = (classification, reason) => ({ classification, reason });
  if (!o || o.transportError || o.timedOut) return result("INCONCLUSIVE", "missing_or_interrupted_observation");
  try {
    if (["A", "J"].includes(id)) {
      if (!o.workers?.length || !o.reader || o.workers.some(w => !independent(w, o.reader) || !w.acknowledgement)) return result("INCONCLUSIVE", "independent_complete_workers_and_reader_required");
      checkScalarRace({ workers: o.workers, persistedToken: o.persisted?.[f.attempt_token] });
      const winner = o.workers.find(w => w.acknowledgement.updated === 1);
      if (!sameImage(o.persisted, winner.expected)) return result("FAIL", "persisted_image_differs");
    } else if (id === "B") {
      if (!independent(o.writer, o.reader) || !Array.isArray(o.samples) || o.samples.length < 2 || !o.acknowledgement) return result("INCONCLUSIVE", "concurrent_sampling_required");
      checkAcknowledgement(o.acknowledgement);
      if (o.acknowledgement.updated !== 1 || o.samples.some(row => !sameImage(row, o.before) && !sameImage(row, o.expected)) || !sameImage(o.persisted, o.expected)) return result("FAIL", "torn_or_missing_atomic_patch");
      if (!o.samples.some(row => sameImage(row, o.before)) || !o.samples.some(row => sameImage(row, o.expected)) || o.overlapped !== true) return result("INCONCLUSIVE", "pre_post_and_overlap_evidence_required");
    } else if (["C", "E"].includes(id)) {
      if (!Array.isArray(o.cases) || o.cases.length !== (id === "C" ? 9 : 2)) return result("INCONCLUSIVE", "complete_controls_required");
      if (id === "C" && (new Set(o.cases.map(c => `${c.shape}:${c.predicate}`)).size !== 9 ||
          o.cases.some(c=>!["missing","null","empty"].includes(c.shape)||!["missing","null","empty"].includes(c.predicate)))) return result("INCONCLUSIVE", "distinct_predicate_controls_required");
      for (const c of o.cases) {
        if (!c.acknowledgement || !independent(c.writer,c.reader) || !c.persisted) return result("INCONCLUSIVE", "raw_ack_and_independent_read_required");
        checkAcknowledgement(c.acknowledgement);
        const expectedCount = id === "C" ? (c.predicate === "null" ? Number(c.shape !== "empty") : c.predicate === "empty" ? Number(c.shape === "empty") : Number(c.shape === "missing")) : c.control === "positive" ? 1 : 0;
        if (c.acknowledgement.updated !== expectedCount || !sameImage(c.persisted, c.expected)) return result("FAIL", "predicate_or_ack_mismatch");
      }
      if (id === "E" && !["positive","conflict"].every(control=>o.cases.some(c=>c.control===control))) return result("INCONCLUSIVE", "positive_and_conflict_required");
    } else if (id === "D") {
      if (!independent(o.writer,o.reader) || !o.acknowledgement || !o.persisted) return result("INCONCLUSIVE", "independent_clear_read_required");
      checkAcknowledgement(o.acknowledgement);
      if (o.acknowledgement.updated !== 1 || Object.hasOwn(o.persisted,"accounting_pending_event") || !sameImage(o.persisted,o.expected)) return result("FAIL", "unset_or_preservation_failed");
    } else if (id === "F") {
      if (o.provisioningReceiptVerified !== true || !Array.isArray(o.cases) || o.cases.length !== 4) return result("INCONCLUSIVE", "provisioned_schema_controls_required");
      if (!p0Plan().schemas.every(s=>o.cases.some(c=>c.entity===s.entity))) return result("INCONCLUSIVE", "four_distinct_schemas_required");
      for (const c of o.cases) {
        if (!independent(c.writer,c.reader) || !c.created || !c.persisted || !c.requestData) return result("INCONCLUSIVE", "independent_schema_evidence_required");
        if (Object.hasOwn(c.requestData,"id") || typeof c.created.id !== "string" || !c.created.id || !equal(c.created,c.persisted) ||
            Object.entries(c.requestData).some(([k,v])=>!equal(c.created[k],v)) || c.invalidBindingAccepted) return result("FAIL", "schema_or_generated_identity_failed");
        if (c.schemaErrorVerified !== true) return result("INCONCLUSIVE", "schema_specific_error_required");
      }
    } else if (["G", "H"].includes(id)) {
      const identities = id === "G" ? ["adminA","memberA"] : ["userB","anonymous"];
      if (!Array.isArray(o.cases) || o.cases.length !== 2 || !identities.every(identity=>o.cases.some(c=>c.identity===identity))) return result("INCONCLUSIVE", "all_permission_subjects_required");
      for (const c of o.cases) {
        if (c.unauthorizedDataReturned || (c.before && c.persisted && !equal(c.before,c.persisted))) return result("FAIL", "unauthorized_read_or_mutation");
        if (!independent(c.writer,c.reader) || c.identityVerified !== true || c.positiveControlVerified !== true || !c.before || !c.persisted || ![401,403,404].includes(c.denialStatus) ||
            (id === "G" ? c.readStatus !== 200 || c.ownReadMatches !== true : ![401,403,404].includes(c.readStatus))) return result("INCONCLUSIVE", "verified_identity_denial_and_controls_required");
      }
    } else if (id === "I") {
      if (o.retryCount > 0 || o.callerOutcome === "applied" || (o.barrierVerified === true && o.newerUpdated === 1 && o.staleUpdated > 0)) return result("FAIL", "retry_or_stale_success");
      if (!independent(o.writer,o.reader) || o.barrierVerified !== true || o.newerUpdated !== 1 || o.staleUpdated !== 0 ||
          o.callerOutcome !== "unknown" || o.retryCount !== 0 || !o.persisted || !sameImage(o.persisted,o.expected) || o.dropBeforeVerified !== true || o.dropAfterVerified !== true) return result("INCONCLUSIVE", "interruption_controls_incomplete");
    }
    return result("PASS", "specified_observations_match");
  } catch { return result("FAIL", "contract_assertion_failed"); }
}

/** Always preparation/synthetic evidence. No function emits activation proof. */
export function p0Report(observations = {}) {
  const plan = p0Plan();
  return { version: 1, runId:`p0-synthetic-${randomUUID()}`, status: "PREPARED", mode: "SYNTHETIC ONLY", appId: null, environmentId: null,
    activationAllowed: false, backendChecksExecuted: 0, sdkVersion: plan.sdkVersion,
    schemaHashes: Object.fromEntries(plan.schemas.map(s=>[s.entity,s.hash])), adapterHash: plan.adapterHash, driverHash: plan.driverHash,workerHash:plan.workerHash,probeHash:plan.probeHash,
    probes: P0_CATALOGUE.map(p=>({ probeId:p.id,...classifyP0(p.id,observations[p.id]),evidence:sanitizeP0Evidence(observations[p.id]),
      remainingUncertainty: "No real Base44 observation; independent backend verification is blocked." })) };
}

export function sanitizeP0Evidence(o) {
  if (!o) return null;
  const workers=[...(o.workers??[]),o.writer,o.reader,...(o.cases??[]).flatMap(c=>[c.writer,c.reader])].filter(Boolean);
  const rows=o.persisted?[o.persisted]:(o.cases??[]).map(c=>c.persisted).filter(Boolean);
  return {
    workers:workers.map(w=>({pid:Number.isSafeInteger(w.pid)?w.pid:null,clientId:typeof w.clientId === "string"&&/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(w.clientId)?w.clientId:null,
      requestShape:shapeOf(w.query??w.request),rawAcknowledgementShape:ackShape(w.acknowledgement)})),
    rawAcknowledgements:[o.acknowledgement,...(o.cases??[]).map(c=>c.acknowledgement)].map(ackShape),
    independentlyReadPersistedResults:rows.map(row=>({shape:shapeOf(row),digest:evidenceDigest(row)})),
    persistedMatchesExpected:o.persisted&&o.expected?equal(o.persisted,o.expected):null,
    // Deliberately omit raw bodies, rows, configuration, arbitrary strings and errors.
  };
}
