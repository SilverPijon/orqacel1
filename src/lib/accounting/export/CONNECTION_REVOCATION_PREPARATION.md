# FIX-2F — connection lifecycle and authorization fencing

**Local preparation: PASS. Runtime activation: BLOCKED.** No Base44 backend,
credentials, customer data or provider API was accessed. No schema, RLS, active
handler, existing adapter or earlier protocol was changed. All fields described
as fence envelopes below exist only in the pure/synthetic proposal.

## Repository assessment and trust boundaries

| Inspected source | Confirmed repository behavior | Risk / preparation boundary |
| --- | --- | --- |
| `base44/entities/AccountingConnection.jsonc` | Status enum active/disabled/error; immutable destination_binding, configuration_revision, verification timestamp; server-only write sentinel; company-list read RLS | No draining/revoked state or authorization generation. Description of one active connection is not an enforced unique constraint. Backend enforcement is UNVERIFIED |
| `src/lib/tenant.server.js:19,99,141` | Active memberships, earliest duplicate policy, cached company list, minimum role check | No shared membership/Invoice fence; pagination/completeness and external writer behavior must be verified; cached company list does not grant send permission |
| `src/lib/tenant-fns.js:86,146,176` | Active-company switch updates User; role change updates CompanyMembership; removal deletes membership and syncs User companies | These writes do not serialize with export authorization. Existing owner/self/admin management restrictions remain intact; synthetic revocations do not implement replacement membership endpoints |
| `claimProtocol.js`, `claimPort.js` (Stage A) | Invoice permanent claim reference, attempt ownership, both revisions, one irreversible send marker, original destination; strict normalized acknowledgement | Preserves Invoice authority and no-replacement policy. Actor/binding arguments are trusted inputs, not a connection/membership atomic fence |
| `base44ClaimStore.server.js` (Stage B) | Re-reads authenticated User/membership and connection, validates binding, scalar-ID Invoice CAS; dormant default gate and private capabilities | Separate reads cannot fence revocation. Boolean platformProof is not trusted evidence. No outbox clear support |
| `lifecycleCoordinator.server.js`, `auditOutbox.js` (Stage D) | Private plans/workers, audit backpressure, independent projection readback, explicit recovery/reconcile | Port must actually enforce authority at commit; re-reading before CAS still leaves a race |
| `offlinePersistenceBridge.server.js` (Stage E) | Server-derived complete membership, pinned principal/company, original binding, active status check before preparing/sending write | Correct boundary checks but not immediate revocation: connection/membership can change between the last read and Invoice CAS. It remains unwired and is not upgraded to a live driver here |
| `invoices-fns.js`, `invoiceWrites.server.js` | Lifecycle financial-revision CAS; cancellation and delete/restore bypass accounting gate; permissive helper acknowledgement coercion | Existing activation blockers remain. See `INTEGRATION_READINESS.md` for complete writer matrix; no handler is safe to switch yet |
| `reconciliation.js`, Stage-A recovery | Strict mock HTTP/identity/financial evidence; expired sending -> needs_reconciliation; no rearm even on authoritative absence | Preserve original provider/connection/binding; real lookup contract and availability after credential revocation remain UNVERIFIED |

No request may supply authority, membership/connection generation, binding,
provider response or delivery confirmation. `forUser`, synthetic seed records,
test controls, clock, token factory and evidence callback are trusted test-driver
dependencies, **not** HTTP parameters or proof of a caller's identity. There is no
route or active application import of this model. Non-secret destination identity
is distinct from credential references. Any future provider switch creates a new
connection identity; it must not retarget an existing permanent Invoice claim.

## Connection state machine

Only a freshly authorized same-company Owner/Admin can change lifecycle state.
Exact expected generation is required; every allowed change increments it and
appends a synthetic connection audit fact in the same modeled critical section.
No same-state/no-op mutation, generation reset, replacement binding or coercion.

| State | Allowed next states | New admission / send / preparation resume | Recovery, reconciliation, projection |
| --- | --- | --- | --- |
| active | draining, disabled, revoked | Allowed only with current authority/fences and Stage-A/D checks | Allowed with current authority and original identity |
| draining | active, disabled, revoked | Blocked (conservatively includes new send authorization) | Preserved; does not imply old senders stopped |
| disabled | active, revoked | Blocked | Preserved; provider access may be unavailable |
| revoked | none | Permanently blocked for this connection | Preserved as internal state operations; never grants new send permission |

Re-enable from draining/disabled increments generation without changing the
destination's configuration_revision. Old plans/workers stay invalid. A previously
un-authorized preparation must expire, recover, project audit and explicitly resume
under a fresh generation before it can authorize; the permanent reference remains.
Previously authorized/ambiguous sends can NEVER resume, regardless of re-enable.
Revoked connections cannot be re-enabled; reconnect with a new identity and do not
transfer old claims. Legacy `error`, missing generations or unverified destinations
fail closed; there is no automatic migration/mapping or default generation in a
live record. Proposed generation fields require later schema approval.

## Race analysis and alternatives

Unsafe timeline: worker reads active connection/current admin -> another operation
commits disable/revocation/demotion -> worker's Invoice CAS still matches and writes
send_authorized_at. The CAS has no atomic dependency on the other record. Rechecking
immediately before dispatch merely moves this race. A copied generation predicate
on Invoice does not help unless the revocation writer synchronizes that generation
with the same authoritative authorization operation.

| Alternative | What it provides | Remaining problem |
| --- | --- | --- |
| Shared generation counters | ABA/stale-handle detection and revocation epochs | A read of one record plus CAS of another is still racy. Atomic validation/fan-out or an equivalent protocol is required |
| Connection-authoritative CAS | Can order reservations with connection revoke on one record | Moving send permission off Invoice violates current authority; second Invoice commit/handoff, bounded reservations, crash recovery and duplicate delivery need a reviewed protocol |
| Per-connection admission gate | Can stop new entrants and order participating workers | Process-local locks do not cover independent workers, crashes, external membership writes or late remote writes; durable gate ownership requires platform primitives |
| Durable send reservations | Records which operation was admitted, enabling explicit quiescence barriers | Reservation is not Invoice send permission; uncertain reservations cannot be timed out into a replacement sender. Requires new schema, permanent identities, storage bounds and recovery proof |
| Explicit draining barrier | Can refuse final revoke until every pre-fence reservation is resolved | May block indefinitely on an uncertain worker; expiry does not prove quiescence. Still must coordinate every admission/authority writer |

### Selected conservative contract: one authoritative atomic fence domain

Require an atomic operation that validates current connection lifecycle/generation,
current principal/active-company epoch, current authoritative membership/epoch,
immutable original binding, and exact Invoice claim/head before committing the
Invoice transition and pending audit event. Connection and authority changes must
linearize in that SAME domain. Invoice remains the sole send-marker/claim authority;
there is no permission minted by a connection reservation. Generations reject stale
plans and workers even after state returns to active/admin.

This is a **required abstract contract**, not a claim that Base44 has transactions,
cross-record conditional updates or locks. Repository evidence establishes none of
these. The implementation uses a single synthetic serialization queue to explore
the contract, not to solve distributed persistence. A real transaction, atomic
multi-record predicate or separately reviewed durable reservation/barrier protocol
would be needed. Without one, activation remains blocked and new live sends are
not permitted. Do not approximate the contract with an optimistic status check.

Model linearization points:

1. Connection fence: state+generation change and synthetic audit append in the
   exclusive section. Membership/principal fence: epoch mutation in that section.
2. Admission: Invoice preparation CAS plus pending event after current fences match.
3. Send authorization: Invoice CAS from preparing to sending, permanent marker and
   audit slot, while the same connection/membership domain is held.
4. Only the single acknowledged authorization may return the original permit.
   Conflict, malformed/unknown acknowledgement or exception returns none. No later
   read, re-enabled connection, old handle or explicit retry can reconstruct it.

If revoke/demotion wins first, old authorization is rejected. If authorization wins
first, revocation does not retract it: the original sender may still execute after
the fence. A delayed acknowledgement is an acknowledgement of an earlier operation,
not a fresh permission. Even an issued permit does not prove provider delivery.
Immediate prevention of all physical sends after revocation would require provider/
dispatcher cancellation or quiescence guarantees not included or verified here.

The model holds its queue through delayed CAS acknowledgements, so revoke may wait
indefinitely. It must never report a committed revocation while only queued. A real
timeout or process crash cannot release an unproven distributed fence or declare an
outstanding write cancelled. Late remote processing must re-evaluate authoritative
fences atomically on the backend. `unknown_before` in the synthetic store means no
model mutation; it does NOT establish that a timed-out real request cannot arrive
later. Clock/lease checks are modeled at coordinator authorization; backend-time
lease predicate semantics under delayed execution are also unverified. Neither
lease expiry nor a lost acknowledgement permits a replacement sender.

## Membership and operation authority

| Operation | Required authority and fence |
| --- | --- |
| Start export / acquire | Current Owner/Admin, pinned company/principal epoch, membership epoch, active original connection/generation; issued Invoice, vacant outbox and Stage-A claim checks |
| Authorize send | Same current authority plus opaque owned worker from exactly those epochs; live preparation lease, no prior marker, atomic compound fence |
| Complete already-authorized operation | Separate trusted sender/outcome protocol, original immutable identity and permit provenance; never fresh user authorization or a new network send. Not implemented; `complete_authorized` is blocked |
| Recovery | Any current same-company Owner/Admin with original claim/connection, expired lease and vacant audit; disabled/revoked connection is allowed; no fresh permit |
| Reconciliation | Current Owner/Admin, original destination, trusted server evidence and FIX-1 strict matching; no response accepted from client; absent/ambiguous outcome never rearms |
| Audit projection / clear | Current Owner/Admin and exact tenant/original identity; independent immutable persisted readback and Invoice CAS; no old user's session, delivery flag or invented historical actor |
| Cancellation | Current Owner/Admin and shared Invoice/outbox gate; no possible authorized send; connection status need not be active. Existing production cancellation still bypasses this protocol |

Removal, demotion and active-company changes increment separate monotonic synthetic
epochs. An old process-local handle cannot survive revoke/regrant or company
away/back (ABA). Authority is reconstructed from model-owned server records; no
client actor overrides. Another authorized admin may project/recover after the
original actor is removed. Model membership controls represent an authoritative
IAM change, not a new permission for users to remove an Owner or themselves.
Production owner/self/admin protections in `tenant-fns.js` remain unchanged.

Actual membership duplicate resolution, pagination, invitation acceptance,
company-cache synchronization, platform-admin/IAM changes, and any external writers
must participate or block activation. The synthetic model explicitly rejects
duplicate membership envelopes instead of assuming a database unique constraint.
Owner loss is tested as an authoritative external revocation, not an application
UI action that current production governance allows.

## Recovery, audit and unknown results

Stages A/D remain unchanged: expired preparing without marker -> preparation_failed;
expired sending with marker -> needs_reconciliation; preserve permanent reference,
binding and irreversible marker. Recovery/resume/reconcile must not overwrite a
pending event. Projection interruption therefore stalls logical transitions even
after revoke. Missing credentials or unavailable original connection/provider do
not justify a switch: retain needs_reconciliation and investigate. Records referenced
by claims must be retained with immutable non-secret bindings.

Connection/member fence audit uses a separate synthetic append-only log. It never
overwrites Invoice's existing bounded slot, contains no credentials/provider bodies
and has no production projection/schema implementation. Durable fence audit and
unknown-outcome recovery require future schema/storage review. Connection CAS faults
return unknown without claiming revocation committed; explicit investigation can
read current state, but never reconstruct send permission. No automatic retries.

## Local tests and separate Base44 evidence

New `connectionRevocation.test.js` covers all 16 lifecycle transition pairs, role/
tenant restrictions, exact generations, disable/admit and revoke/send in both
orders, delayed CAS/acknowledgement, demotion/revocation/company changes, old handles,
re-enable ABA, unknown writes, expiry, audit interruption, recovery on non-active
connections, authoritative absent/found reconciliation and immutable identity.
Local verification: **550 accounting tests passed (480 existing + 70 new), zero
failed, skipped or cancelled**. Lint, local build and staged whitespace checks
passed. Build retained missing-app-ID, bundle-size and plugin-timing warnings;
no app ID or credentials were supplied. These are single-process synthetic results,
not independent Base44 concurrency, durability, permissions or atomicity evidence.

Before any real verification, separately approve a newly created disposable app
with synthetic data only. In addition to FIX-2C's isolated plan, require:

* Evidence of an atomic connection+membership+principal+Invoice fence, not just
  scalar-ID Invoice CAS. Capture raw predicates/acknowledgements and independent
  persisted order from genuinely independent processes.
* Both orderings of revoke/send, disable/admit and member demotion/send, including
  backend execution delayed after the last client read and after caller timeout.
  Any new authorization linearized after a committed applicable fence is failure.
* Durable generation/schema acceptance, exhaustion/no-reset behavior, duplicate
  memberships/active connections, re-enable and principal ABA, restart/crash tests.
* Proof that all active lifecycle, membership, User, connection and external admin/
  automation writers participate; company isolation and forged input tests with
  distinct non-service principals and verified RLS enforcement.
* Pending audit preservation, append-only projection and fence audit, whole-field
  unset, missing/null semantics, interrupted readback/clear, candidate ID generation,
  exact success/updated/has_more responses and no post-read permit reconstruction.
* Unknown or delayed authorization must never spawn a replacement; expired leases
  and authoritative absence must not stand in for sender quiescence. Original
  authorized sends may remain potentially active after revocation; never report
  physical cancellation without separate evidence.

Bind evidence to app, runtime/schema/adapter/SDK hashes, worker/request IDs and
reviewed server trust policy without credentials. Existing Stage-C attestation
checks do not prove this additional compound-fence contract; they cannot activate
it. `connectionFenceReadiness()` is unconditionally BLOCKED, even with supplied
flags or synthetic proof. No new backend test was executed in FIX-2F.

## Deliverables and assessment

Exact changed files (four new files):

* `src/lib/accounting/export/connectionLifecycle.js`
* `src/lib/accounting/testing/connectionFenceModel.js`
* `src/lib/accounting/__tests__/connectionRevocation.test.js`
* `src/lib/accounting/export/CONNECTION_REVOCATION_PREPARATION.md`

**PASS**: offline contract/model preparation and synthetic safety regressions.
**BLOCKED**: live integration, immediate backend revocation, physical sender
cancellation, new lifecycle/generation schema, durable fence audit, completion
transport, trusted production activation and all deployment. No unsupported
Base44 primitive or optimistic status check is substituted for these blockers.
Review this branch against FIX-2E; do not merge, deploy or activate it.
