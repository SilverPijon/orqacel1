# FIX-2C — isolated Base44 verification preparation

No real backend verification has been executed. No schema, adapter, production
record, environment or earlier PR is activated, deployed, published or merged.
All Stage-B code/schemas and the 301 prior accounting tests are unchanged.

## Executable harness and current execution boundary

From the repository root:

```bash
node scripts/accounting-verification.js --plan
node scripts/accounting-verification.js --local > /tmp/orqacel-verification-local.json
```

`--plan` emits the case catalogue and future backend-driver contract. `--local`
runs twelve synthetic model experiments with SDK fakes. Race clients run in four
independent Node processes at a common IPC barrier, with an empty environment.
Only these owned worker processes are stopped on completion/error/timeout.

These workers dispatch through one parent-process SDK fake. They are NOT
independent backend clients. Actual schema acceptance and user-level RLS are NOT
simulated as proven: their local artifacts explicitly record static inspection
or adapter-level checks only. Reports use `mode: local-model`, `model-passed`,
`status: local-passed`, `appId: null` and `backendChecksExecuted: 0`. Such reports
cannot satisfy the attestation verifier even if someone signs them.

There is no backend flag, SDK bootstrap, credential reader, app-ID argument,
dynamic driver-module loader, schema deploy command, or approval-file loader.
`--backend`, `--execute`, token arguments and all unknown options exit 2 before
any backend work; arguments/credentials are never echoed. Current execution
status is `REAL_BASE44_EXECUTION_DISABLED_PENDING_SEPARATE_APPROVAL`.

The executable runner, process barrier and observation checkers are prepared.
The real SDK transport/identity bootstrap is deliberately not included or loaded
before approval of a separate disposable target. Wiring that driver and its
independent per-process SDK clients is a later reviewed step, not a command-line
override. This is preparation, not a ready-to-run live launch.

## Proposed stronger trusted server gate

Stage B currently trusts three booleans plus a nonempty evidence ID supplied to
its server factory. That does not authenticate backend observations, target,
reviewer, age, or tested code versions. It remains default-disabled and unwired.
No test report should ever be converted automatically into those booleans.

`platformAttestation.server.js` is an offline gate prototype, intentionally NOT
wired to Stage B. It verifies an Ed25519-signed canonical payload against public
keys and policy supplied by trusted, reviewed server deployment code. No keys or
trust policy may come from a browser, report, request body, UI/environment toggle
or the envelope itself. Tests generate ephemeral in-process format-test keys;
there is no actual review/signing key, attestation or approved app in this PR.

The signed payload requires:

- Purpose `disposable-base44-verification`, exact approved app/runtime/run IDs,
  reviewer/review identifiers, issue/expiry times and a server-enforced lifetime.
- Canonical SHA-256 schema, adapter, SDK and harness digests matching current
  server policy AND the report. Drift invalidates previously approved evidence.
- A digest of the entire report, whose twelve required checks must each have
  one passed, non-skipped result and a digest matching its embedded raw evidence.
- A backend-mode report for the same approved target with synthetic-only scope.
  Missing, skipped, duplicated, model, tampered, expired, revoked or wrongly
  scoped evidence is rejected. The production denylist overrides any allowlist.

A valid result only says that a trusted reviewer attested to those artifacts.
Cryptographic checks cannot establish that the reviewer actually performed or
correctly interpreted the experiments. Independent review of raw records remains
mandatory. Local format/signature tests are NOT genuine backend attestations.

Every result, including a valid one, has `activationAllowed: false`. It emits no
`platformProof` booleans or adapter permission. Proposed later integration is an
opaque server-scoped capability issued by a reviewed verifier closure, replacing
caller-supplied activation booleans. It must bind exact runtime, code versions,
target, permitted operations and expiry. No capability may be reconstructed
from Invoice reads or attached to client JSON.

Keep three approvals separate: (1) permission to run synthetic experiments in a
new disposable app, (2) review/attestation of resulting platform evidence, and
(3) any future rollout/activation approval. Passing platform probes does not
prove production cancellation coordination, connection draining, durable audit,
real provider idempotency or accounting destination verification.

## Disposable execution safety checklist — pending separate approval

- [ ] Obtain explicit approval for creation/use of one NEW disposable Base44
  app and its synthetic records/schemas. Record app ID, creation receipt,
  environment ID, run ID, reviewer and bounded execution window out of band.
- [ ] Pin the exact app ID and creation evidence in reviewed server policy;
  independently confirm it is not production or another existing application.
  A name containing "test" or "disposable" is not evidence of isolation.
- [ ] Register exact production-denylist IDs and deny every unapproved app.
  No current repository `.app.jsonc`, default CLI profile or ambient token may
  select the target. Do not read or copy production credential values.
- [ ] Supply only separately authorized disposable identities through a trusted
  bootstrap: service, adminA, memberA, userB and anonymous. Never request secret
  values in chat, commit them, dump environments or log authentication headers.
- [ ] Install schemas only into the newly approved disposable app. Never deploy
  them to Orqacel production or another existing application. Confirm exact
  schema/code/lockfile/SDK/harness digests before fixture creation.
- [ ] Enforce a created-in-this-run fixture registry, run-tagged synthetic names,
  IDs and invoice numbers, bounded operation/record counts, explicit timeouts
  and target assertions before EVERY request. Stop on uncertain target identity.
- [ ] Block Merit, SimplBooks and SmartAccounts destinations. The driver must
  expose no send method. Do not instantiate the production export workflow.
- [ ] Run real race requests in independent processes with independent SDK
  clients. Do not route backend writes through a shared in-memory lock, parent
  fake, serial executor or single request disguised as several workers.
- [ ] Stop writes on a failing/unknown probe. Collect scoped read-only diagnostic
  evidence where authorized. Never reset claim markers to force a passing run.
- [ ] Preserve evidence before any cleanup. No deletion/migration method exists
  in this harness; disposal requires its separately approved test-app plan.

## Backend driver requirements and exact experiments

The driver contract emitted by `--plan` is intentionally transport-neutral. A
future driver must bind requests to the approved target at construction and on
each call, restrict reads/writes to registered synthetic fixtures, create no
client-assigned candidate IDs, and expose raw observations rather than pass
booleans. User-profile permission probes must use separate user credentials,
not a service-role client with a user label. Schema creation/identity bootstrap
must not inherit the development app's configuration.

For every experiment record a preimage, exact scalar-ID query and `$set` patch,
client trace ID, worker PID, identity label, response status and whitelisted
`success/updated/has_more` fields, then scoped readback. No headers, secret
references/values, arbitrary SDK errors, or unrelated records belong in evidence.
Readback verifies test observations only; it never reconstructs send permission.

| Check | Execute after approval | Exact pass / fail criterion |
| --- | --- | --- |
| Schema roundtrip | Apply the four prepared schemas to the NEW disposable app. Create historical-shaped and fully populated synthetic records; exercise nulls and invalid additional binding keys. | All four accepted; every intended field/null read back unchanged; old shapes accepted; invalid binding rejected; financial digests unchanged. Acceptance without persisted fields is a failure. |
| Scalar-ID concurrency | At least four independently authenticated/process-isolated service requests start at a barrier with identical `{id: scalarId, company_id, status, revision, accounting_revision, claim predicates}` and distinct patch tokens. Repeat across fresh fixtures and reversed scheduling. | Exactly one `updated:1`, all others `updated:0`, all strict acknowledgements; persisted owner equals winning token. Two winners, zero winners, changed predicates, broad ID queries or mismatched readback fail. |
| Legacy predicates | Separate fixtures for missing/null accounting revision and numeric 0; missing/null/empty claim reference. Cross-test null/0 and null/empty predicates without automatic normalization. Test `$exists:false` separately as observational evidence, never substitute it silently. | Current adapter requires missing and null to match equality-null, empty to match ONLY empty, and 0 to match ONLY 0. Any difference blocks the adapter pending reviewed compatibility changes. Explicit `$set` progression must persist; no `$inc` on null. |
| Acknowledgements | Capture genuine successful and lost-CAS responses. Verify serialized types and retry/batching behavior. | `success === true`, numeric `updated` exactly 0 or 1, `has_more === false`. Missing, stringified, contradictory, >1 or batched results are incompatible; do not infer success from later reads. |
| Candidate IDs | Omit ID in create, capture assigned ID, read back immutable binding/source revision. Create duplicate export-key candidates where allowed. | Nonempty assigned ID and unchanged metadata; one canonical Invoice pointer only. Rejected/uncertain creation grants no authority. Do not assume duplicate-key acceptance or a unique constraint. |
| Tenant/RLS | Probe A as adminA/memberA, then A as userB/anonymous; attempt direct user writes as adminA/memberA/userB. Verify service mutations still carry explicit company scope. | A reads allowed for A members; foreign/anonymous receive 401/403/404 and no record. Direct Invoice user writes denied and leave fixture unchanged. Outages/500s are not proof of denial. |
| Cancellation race | Prepare send and cancel on the SAME Invoice revision/accounting revision. Run both orders plus a barrier race, using fresh fixtures. | Exactly one transition commits: cancelled means no authorization; authorization means cancellation loses. Repeat through the proposed coordinated path, then separately expose the old production cancellation incompatibility using synthetic equivalents. |
| Preparing recovery | Pause worker before authorization CAS, expire preparation, recover, then resume old request; explicitly prepare generation 2. | Old CAS changes 0; old token/generation cannot authorize. Only explicit pre-send resumption may create a new preparer under the permanent original claim/binding. |
| Sending recovery | Authorize once, expire its lease, recover and supply an authoritative empty lookup from a SYNTHETIC evidence supplier. | Marker/reference/binding preserved; state remains unresolved; ZERO replacement permits. No provider request is ever sent. |
| Uncertain acknowledgements | Controller drops response after backend commit; separately lose reply before commit and kill the requesting worker. Do not automatically retry. | Controller grants zero permission when outcome unknown; reads do not recover it; old command cannot recreate permission. Reconcile/recover conservatively rather than clearing metadata. |
| Delayed worker | Independently pause BEFORE dispatch/CAS and AFTER acknowledged authorization but before simulated send; recover while paused. | Before-CAS worker fenced; after-CAS original may resume, but no replacement authorized. A second authorization at any point is failure. Simulated send is an event counter only. |
| Financial integrity | Hash snapshots, lines, VAT summary, totals, number and currency before/after all metadata experiments. | Every hash identical. A changed financial field fails and stops further writes; do not repair real or synthetic financial data merely to pass. |

`evidenceChecks.js` contains executable strict acknowledgement, scalar-race,
permission-matrix and schema-readback checks for future driver observations.
They validate observations; they do not create authenticated provenance or
implement a live transport. Local models run current adapter/protocol fault
experiments and the same acknowledgement/race checks without claiming backend
schema/RLS coverage.

## Required evidence and review outcome

Retain a manifest with approved target/creation identity, run/runtime IDs,
timestamps, identity/profile provenance without secrets, and schema/adapter/SDK/
harness digests. Each check needs its complete raw whitelisted observations,
preconditions, scheduling/barrier trace, per-worker identities, acknowledgements
and resulting scoped record metadata/digests. Count passed, failed, skipped and
unrun cases separately. Unknown, incomplete or missing evidence blocks a pass.

For an eventual attestation report require `mode: disposable-backend`, matching
scope/version digests, `syntheticOnly: true`, `backendChecksExecuted: 12`, exactly
twelve unique passed checks, and SHA-256 digests of embedded case evidence. A
trusted reviewer signs the canonical payload including the report digest. No
automatic signer or real attestation is included. Retain rejected/failed results;
do not cherry-pick a successful round or suppress earlier duplicate winners.

## Duplicate-authorization risks and unresolved assumptions

- A backend could preselect matching records and fail to recheck predicates at
  write time; SDK documentation's scalar-ID guarantee must be independently
  observed. A broad-query test cannot establish the scalar-ID guarantee.
- A response could claim an update while schema serialization strips state,
  binding or authorization fields. Persisted-field readback is essential.
- Wrong missing/null/empty semantics could admit or block the wrong legacy
  claim. The current compatibility convention remains UNVERIFIED.
- SDK/proxy retries or replayed/cached success responses could duplicate grants
  if an orchestrator fails to consume command/worker capabilities. Capture actual
  behavior; do not add retries to make an uncertain experiment succeed.
- Service-role code can bypass RLS. Schemas do not establish field immutability;
  all writers must use the same protocol. Existing production cancellation is
  NOT coordinated with the shared accounting gate and remains a rollout blocker.
- Connection/membership reads and Invoice updates are separate records. Immediate
  revocation/draining guarantees, projection repair and durable audit remain
  unimplemented/unverified. Platform probe success cannot resolve those alone.
- Most critically, a paused authorized worker can still resume after lease
  expiry. Neither a lease nor a negative lookup proves quiescence. Replacement
  sends remain prohibited regardless of any positive platform evidence.

Local tests prove harness controls, model behavior, observation validation and
signature/scope handling only. Real Base44 semantics, real identity provisioning,
schema acceptance and genuine platform attestations remain unresolved.
