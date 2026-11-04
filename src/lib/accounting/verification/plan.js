/** Reviewed expectations, not claims about Base44's observed implementation. */
export const VERIFICATION_CASES = Object.freeze([
  { id: "schema_roundtrip", expected: "All four prepared schemas accepted; new fields/nulls persisted; invalid binding keys rejected; historical shapes accepted." },
  { id: "scalar_id_concurrency", expected: "Independent workers use the identical scalar-ID precondition: exactly one updated=1, every other updated=0; persisted winner matches its token." },
  { id: "legacy_predicates", expected: "Missing/null match equality-null; empty string matches only empty; numeric zero is distinct. Otherwise current adapter is NOT compatible." },
  { id: "strict_acknowledgements", expected: "Every actual response has success=true, numeric updated=0|1, has_more=false. Missing/coerced/contradictory fields fail." },
  { id: "candidate_ids", expected: "No ID sent in create; assigned nonempty IDs and immutable fields read back. Duplicate export keys never establish authority." },
  { id: "tenant_rls", expected: "Company-A admin/member may read A; foreign/anonymous cannot read A; direct user writes denied even for admin; server-role operations remain scoped." },
  { id: "cancellation_race", expected: "Same Invoice revision/accounting gate admits either cancellation or send authorization, never both." },
  { id: "preparing_recovery", expected: "Expired preparation fenced by revision/token; old worker cannot authorize; explicit new generation may prepare only if never authorized." },
  { id: "sending_recovery", expected: "Authorization marker remains through recovery. Zero replacement permissions, including after authoritative absence." },
  { id: "uncertain_acknowledgements", expected: "Lost/unknown replies grant zero permissions; no automatic replay; later reads remain diagnostic." },
  { id: "delayed_workers", expected: "Before-CAS worker is fenced; after-CAS worker may resume, but recovery never authorizes a replacement." },
  { id: "financial_integrity", expected: "Snapshot, number, currency, line and total digests remain identical during metadata probes." },
]);

export const EXECUTION_STATUS = "REAL_BASE44_EXECUTION_DISABLED_PENDING_SEPARATE_APPROVAL";

export function verificationPlan() {
  return { version: 1, executionStatus: EXECUTION_STATUS, cases: VERIFICATION_CASES,
    backendDriverContract: {
      status: "NOT_LOADED_OR_CONFIGURED",
      identities: ["disposable-service", "adminA", "memberA", "userB", "anonymous"],
      operations: [
        "roundTripPreparedSchemasInNewApprovedApp", "createRunTaggedSyntheticFixture", "readRegisteredFixture",
        "scalarIdConditionalSet", "raceFromIndependentBackendWorkerClients", "probeUserReadAndWritePermissions",
        "pauseBeforeDispatch", "pauseAfterBackendCommit", "dropAcknowledgementWithoutRetry",
      ],
      restrictions: ["approved newly created app only", "created-in-this-run fixture registry", "no delete or financial rewrite methods",
        "no accounting sender", "no inherited production credentials", "no automatic activation"],
    },
    prohibited: ["production apps", "existing-app schema deployment", "provider transports", "real business data", "automatic adapter activation", "destructive cleanup"] };
}
