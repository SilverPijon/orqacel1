# P0 Base44 capability package — preparation only

**PREPARED locally / BLOCKED for all backend execution and activation.**
No Base44 SDK client is constructed and no app is selected. The package imports
no provider transport or credential loader. Existing schemas, RLS, handlers and
production configuration are unchanged.

## Run the safe preparation commands

```bash
node scripts/accounting-verification.js --p0-plan
node scripts/accounting-verification.js --p0-local
node src/lib/accounting/__tests__/p0Verification.test.js
```

The existing FIX-2C runner and its `--plan` / `--local` remain intact. Unknown,
backend, app-ID and execution flags remain rejected. `--p0-plan` prints the A–J
catalogue, report schema, exact installed SDK version and checksums. It emits four
**blueprints**, obtained by cloning the existing prepared schemas and changing
only their names to `P0CapabilityInvoice`, `P0CapabilityAccountingConnection`,
`P0CapabilityAccountingExport`, and `P0CapabilityAccountingExportEvent`. It does
not write schema files, deploy them or assume Base44 accepts them.

`--p0-local` starts two independent child processes. Each constructs its OWN
fixed synthetic client/map and performs its own task. It validates process/client
ownership and IPC only. These maps do not share storage: the local run **does not
simulate or establish shared-backend concurrency**. Its A–J report remains
INCONCLUSIVE, with null app/environment and zero backend checks. Local classifier
unit tests use explicitly synthetic observation fixtures, not backend evidence.

## Minimal executable pieces and reuse

* `p0Package.js`: pure recipes, three-way classification and sanitized evidence.
  Reuses Stage-A candidate/claim decisions, Stage-D outbox attach/clear, Stage-E
  CAS compilation, FIX-2C acknowledgement/race checks and canonical digest helper.
* `p0Driver.js`: bounded SDK-shaped create/get/updateMany/sample operations,
  registered-fixture guard, independent worker launcher and live refusal boundary.
  No parent callback executes a child's write. No retry/delete/list/upsert,
  financial-total rewrite, broad ID selector or service-role fallback exists.
* `p0Worker.js`: fixed child bootstrap, start barrier and explicit pre-write pause
  / release. No configurable module, endpoint, app or credential loader.

`openP0Backend()` ALWAYS refuses. `executeP0Task` also refuses any unregistered
client, including a real SDK client injected directly. Only immutable clients
created by the fixed synthetic factory are privately branded. A configuration
flag, app name, approval-shaped JSON, copied client or test report cannot open
the boundary. This is intentionally **not a ready-to-run live launcher**.

## Required future execution boundary — separate review and approval

All of these must be established before changing the hard refusal:

1. Explicit user approval for an identified NEW disposable app, execution window,
   synthetic schemas/records and dedicated identities. This preparation request
   supplies no permission for actual execution.
2. Independently checked app-creation receipt plus service-side app/environment
   identity, ownership and schema inventory. Compare exact IDs to an explicit
   allowlist AND production denylist; reject existing/default Orqacel targets.
   A name containing test/disposable or `approved:true` is not isolation evidence.
3. Provision only the four named synthetic blueprints in that NEW app after
   approval. The package never provisions schemas or changes existing apps.
   Record accepted schema hashes and SDK version; stop on incompatibility.
4. Use test-only service/adminA/memberA/userB/anonymous clients. Verify actual
   identity, tenant memberships and intended RLS setup; positive read/write
   controls distinguish bad authentication from permission enforcement. Configure
   synthetic `User.company_ids` only in the disposable app as required by the
   copied read rules. No production identity/profile/configuration may be inherited.
5. A reviewed fixed worker bootstrap must verify that scope before creating a
   separate SDK client per child. Bind credentials out of band to approved test
   aliases; never put them in task JSON, IPC reports, CLI arguments or logs.
   No accounting provider credentials are needed or accepted.
6. Register every created entity/ID/company against this run and its creation
   receipt. No discovery of existing business records. New generated IDs enter
   the provisional registry from their own create receipt before independent
   readback. Reject unknown IDs, entity aliases and ownership mismatches.
7. Approve the backend execution boundary/code hashes separately. Evidence review
   and any later production activation remain separate decisions. No cleanup or
   destructive migration is included; app disposal needs its own approved scope.

Only after that review can a backend client replace the synthetic factory inside
the child. Keep request execution in the child; never reuse FIX-2C's parent fake
as a backend proxy. The present code cannot authenticate creation/approval receipts
and therefore refuses EVERY real target, even one claimed to meet these conditions.

## Execution recipes and exact outcomes

Use fresh registered records for each independent case. Seed only minimal
synthetic IDs, invoice numbers, metadata and non-secret test bindings; no customer
names, addresses, real financial records or credentials. Provisioning uses only
the approved isolated app. `claimRecipe`, `clearRecipe`, `predicateRecipes` and
`controlRecipes` generate executable SDK tasks; diagnostic expected images are
not sent as SDK update fields.

| Probe | Future approved execution | PASS / FAIL / INCONCLUSIVE |
| --- | --- | --- |
| A | Create one issued synthetic Invoice; generate two claim recipes with distinct tokens; barrier-start separate clients against identical scalar ID/company/head; a NEW reader client reads the full winner | PASS one raw updated=1, all others 0 and full persisted winner; FAIL two winners/contradiction; INCONCLUSIVE missing/interrupted worker or reader |
| B | Run one compiled revision/state/outbox write while another process samples; capture pre/post controls and independently read final state | PASS only whole pre/post images with overlapping sampling and exact final patch; FAIL torn/missing fields; INCONCLUSIVE no overlap/pre/post or unknown write |
| C | Create nine fresh fixtures: missing/null/empty attempt token crossed with equality-null/equality-empty/exists:false; verify seed representation independently before each write and read afterwards | PASS full truth table below and exact persisted changes; FAIL mismatch; INCONCLUSIVE unseedable/unverified representation or incomplete control |
| D | Seed valid pending event from claim recipe; compile Stage-D clear; run scalar-ID $set+$unset and new-reader readback | PASS field absent, revision advanced, other data preserved; FAIL null/empty/partial clear or changed data; INCONCLUSIVE unknown write/read |
| E | On fresh revision-0 fixture, execute positive CAS then repeat original predicate as zero-match control; independently read after each | PASS exact success:true/numeric updated:1 or 0/has_more:false; FAIL malformed/coerced/contradictory response; INCONCLUSIVE missing controls |
| F | For every blueprint, create without ID, register assigned ID and read from NEW client; test explicit null persistence and binding with extra key | PASS assigned ID/full roundtrip and schema-attributed rejection; FAIL lossy/null/identity/validation contradiction; INCONCLUSIVE unknown schema-error meaning or missing provisioning/identity evidence |
| G | Verified adminA/memberA each positively read own Invoice, attempt direct protected metadata write, then service reader checks unchanged full image | PASS verified denial and no mutation; FAIL persisted unauthorized write; INCONCLUSIVE bad identity, failed positive control, outage or unclear denial |
| H | Verified userB and anonymous try A's registered record read and direct write; independent service reader verifies no change; own-tenant positive controls prove setup | PASS no foreign data and denied writes; FAIL leak/mutation; INCONCLUSIVE incomplete setup, auth ambiguity or outage |
| I | Pause stale child before CAS; let separate client commit newer claim; release stale child and verify updated=0. On TWO additional fresh fixtures suppress before-dispatch and after-ack replies; independently read both | PASS verified ordering, zero retries, unknown caller outcomes and expected stored images; FAIL stale commit/retry/fabricated applied; INCONCLUSIVE missing ordering, either drop case or readback |
| J | Use a separate process/client after A to verify scalar ID, company and entire acknowledged winner image | PASS exact winner; FAIL contradictory/mixed image; INCONCLUSIVE incomplete/incorrectly scoped or non-independent read |

For C, rows are seeded field representation, columns are predicate. These are
adapter compatibility requirements, not assumed MongoDB/Base44 semantics:

| Seed | `= null` | `= ""` | `$exists:false` |
| --- | --- | --- | --- |
| missing | 1 | 0 | 1 |
| null | 1 | 0 | 0 |
| empty string | 0 | 1 | 0 |

Full-image comparisons ignore ONLY SDK-managed `updated_date`; all other fields,
including unknown fields and any synthetic snapshot controls, must be preserved.
Permission-denial checks compare the full before/after image without that exception.
Finite sampling observes atomicity failures; passing a bounded experiment is not
a mathematical guarantee for all future schedules. Keep the SDK contract and
versioned repeatable evidence alongside the observations.

The pause hook establishes application pre-dispatch ordering, not backend-internal
scheduling. The after-ack drop deliberately withholds an SDK response already
captured by the controller. It does NOT prove what happens to a network request
timed out before backend processing. That transport-level experiment remains
INCONCLUSIVE until separately reviewed disposable-app fault instrumentation can
establish its actual history. Never infer cancellation/quiescence or grant send
permission from these probes. No sender exists in this package.

## Evidence schema and export

`P0_REPORT_SCHEMA` is emitted by `--p0-plan`. `p0Report` exports only preparation/
synthetic evidence; it cannot emit a live report or activation capability.

| Field | Meaning |
| --- | --- |
| version/runId/mode/status | Versioned unique synthetic run; PREPARED / SYNTHETIC ONLY |
| appId/environmentId | Null until a reviewed live evidence collector exists |
| sdkVersion/schemaHashes/adapterHash/driverHash/workerHash/probeHash | Exact installed SDK and canonical SHA-256 digests of dedicated schemas and code; text-file digests use existing `evidenceDigest` canonical JSON string encoding |
| probes[].probeId/classification/reason | A–J; PASS, FAIL or INCONCLUSIVE for the explicitly identified observations |
| probes[].evidence.workers | PID/client identity, sanitized request shape and acknowledgement shape |
| rawAcknowledgements | Key/type shape plus exact boolean success/has_more and numeric updated where present; strings are never coerced |
| independentlyReadPersistedResults | Sanitized shapes and canonical digests of independently read results; raw row values are not exported |
| remainingUncertainty | Backend unverified, missing controls, scheduling/transport limits |
| activationAllowed/backendChecksExecuted | Always false / 0 in this package |

Raw task results stay inside the trusted test controller for comparison. Never
serialize them as evidence: SDK rows/errors could contain unexpected data. Export
only `p0Report`/sanitized shapes, not `executeP0Task` return values. Errors expose
only numeric status and type shape, no messages, headers, URLs or response bodies.
The future collector must attach each known planned query to its worker result,
retain identity/provisioning verification provenance, and account for every
missing response. A controller assertion is not authenticated platform evidence.
Synthetic reports cannot satisfy Stage-C backend-mode attestation requirements.

## Revocation remains separately blocked

The SDK documents atomic single-record writes with scalar-ID predicate rechecking
and explicitly says updateMany is not a transaction. No verified mechanism has
been established for atomic coordination of AccountingConnection,
CompanyMembership, User active-company state AND Invoice. None of A–J verifies
that compound operation. FIX-2F strict immediate-revocation remains **BLOCKED**
even if every single-record probe eventually passes. Physical cancellation of
an already-authorized external send is a different, also unverified guarantee.

## Scope and local verification

Exact changed files:

* `scripts/accounting-verification.js` — two safe P0 preparation options only
* `src/lib/accounting/verification/p0Package.js`
* `src/lib/accounting/verification/p0Driver.js`
* `src/lib/accounting/verification/p0Worker.js`
* `src/lib/accounting/verification/P0_PACKAGE.md`
* `src/lib/accounting/__tests__/p0Verification.test.js`

Local verification: **606 accounting tests passed (550 existing + 56 new), zero
failed/skipped/cancelled**. Lint, build and staged whitespace checks passed. Build
retained missing-app-ID and bundle-size warnings; no app ID or credentials were
supplied. P0 plan output confirms SDK 0.8.58, ten probes and four dedicated schema
blueprints. No live probes were run; all real backend findings remain unverified.
No prior PR is merged and no production schema or runtime is activated.
