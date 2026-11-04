/**
 * Offline verification-gate PROTOTYPE. Not wired to the adapter and does not
 * produce its boolean platformProof object or activate any runtime capability.
 * Trust anchors and policy must come from reviewed server deployment code.
 */
import { createHash, verify } from "node:crypto";

export function canonicalEvidence(value) {
  if (Array.isArray(value)) return value.map(canonicalEvidence);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalEvidence(value[key])]));
  return value;
}
export function evidenceDigest(value) {
  return createHash("sha256").update(JSON.stringify(canonicalEvidence(value))).digest("hex");
}
export const REQUIRED_BACKEND_CHECKS = Object.freeze([
  "schema_roundtrip", "scalar_id_concurrency", "legacy_predicates", "strict_acknowledgements",
  "candidate_ids", "tenant_rls", "cancellation_race", "preparing_recovery", "sending_recovery",
  "uncertain_acknowledgements", "delayed_workers", "financial_integrity",
]);
const reject = (reason) => ({ verified: false, reason, activationAllowed: false });
const digest = (value) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const text = (value) => typeof value === "string" && value.length > 0 && value.length <= 200;

/**
 * The signed payload binds raw evidence to exact app, runtime, schema, adapter,
 * SDK and probe versions. Public keys/policy cannot be accepted from a request,
 * environment toggle, test report, or the attestation itself.
 *
 * A valid disposable-app attestation still cannot authorize production writes:
 * lifecycle coordination and rollout approval are separate missing gates.
 */
export function verifyPlatformAttestation({ envelope, report, policy, trustedKeys, now }) {
  try {
    if (!Number.isSafeInteger(now) || now < 0 || !policy || !trustedKeys || !envelope?.payload ||
        !text(policy.disposableAppId) || !text(policy.environmentId) ||
        !Number.isSafeInteger(policy.maxAgeMs) || policy.maxAgeMs <= 0 ||
        !Array.isArray(policy.productionAppIds) || !policy.productionAppIds.length ||
        !policy.productionAppIds.every(text)) return reject("invalid_input");
    const payload = envelope.payload;
    const key = trustedKeys[envelope.keyId];
    if (!key || key.asymmetricKeyType !== "ed25519" || typeof envelope.signature !== "string") return reject("untrusted_signer");
    if (!verify(null, Buffer.from(JSON.stringify(canonicalEvidence(payload))), key, Buffer.from(envelope.signature, "base64"))) return reject("invalid_signature");
    if (payload.version !== 1 || payload.purpose !== "disposable-base44-verification" ||
        payload.appId !== policy.disposableAppId || policy.productionAppIds?.includes(payload.appId) ||
        payload.environmentId !== policy.environmentId || !text(payload.runId) || payload.runId !== report?.runId ||
        !text(payload.reviewerId) || !text(payload.reviewId) || policy.revokedRunIds?.includes(payload.runId)) return reject("wrong_scope");
    if (!Number.isSafeInteger(payload.issuedAt) || !Number.isSafeInteger(payload.expiresAt) ||
        payload.issuedAt < 0 || payload.issuedAt > now || payload.expiresAt <= now || payload.expiresAt <= payload.issuedAt ||
        payload.expiresAt - payload.issuedAt > policy.maxAgeMs) return reject("expired_or_invalid_time");
    for (const field of ["schemaDigest", "adapterDigest", "sdkDigest", "harnessDigest"]) {
      if (!digest(payload[field]) || payload[field] !== policy[field]) return reject("version_mismatch");
      if (report?.[field] !== payload[field]) return reject("version_mismatch");
    }
    if (!digest(payload.reportDigest) || payload.reportDigest !== evidenceDigest(report)) return reject("evidence_mismatch");
    if (report?.mode !== "disposable-backend" || report.appId !== payload.appId ||
        report.environmentId !== payload.environmentId || report.syntheticOnly !== true || report.status !== "passed" ||
        report.backendChecksExecuted !== REQUIRED_BACKEND_CHECKS.length) return reject("not_backend_evidence");
    if (!Array.isArray(report.checks) || report.checks.length !== REQUIRED_BACKEND_CHECKS.length ||
        new Set(report.checks.map((check) => check.id)).size !== REQUIRED_BACKEND_CHECKS.length ||
        report.checks.some((check) => !REQUIRED_BACKEND_CHECKS.includes(check.id) || check.status !== "passed" ||
          !check.evidence || !digest(check.evidenceDigest) || evidenceDigest(check.evidence) !== check.evidenceDigest)) return reject("incomplete_evidence");
    return Object.freeze({ verified: true, reason: null, appId: payload.appId, runId: payload.runId,
      reportDigest: payload.reportDigest, activationAllowed: false });
  } catch { return reject("invalid_input"); }
}
