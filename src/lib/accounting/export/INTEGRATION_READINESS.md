# FIX-2E: offline integration readiness

Status: PREPARATION ONLY. No Base44 app was contacted. Platform semantics below
are **UNVERIFIED**. No production handler, schema, RLS or existing adapter changes.
The bridge has no SDK driver or activation switch. Its `offline-model` tag is an
accident-prevention convention, not trusted platform attestation.

## Writer compatibility matrix

This inventory covers repository Invoice persistence calls, callers of the shared
helper, pure proposals and injected ports. Paths below are relative to `src/lib/`.
Line references describe the FIX-2D base. Confirmed means source inspection, not
observed backend execution. Every active writer must participate before activation.

| Writer/path | Confirmed source behavior | Compatibility / required change before activation |
| --- | --- | --- |
| `invoices-fns.js:254,281` createInvoice | Server company/admin check, number allocation, draft revision 1, snapshots/totals; no accounting revision/outbox | Incompatible. Establish pre-create operation identity, ambiguous-create recovery and atomic initial audit; never replay create/number allocation blindly |
| `invoices-fns.js:304,365` updateInvoice | Draft + financial revision CAS, mutable draft snapshots/totals | Incompatible. Both revisions, empty valid outbox, no claim/authorization, explicit financial allowlist, atomic audit required |
| `invoices-fns.js:375,394,423` issue | Draft check, freezes financial snapshots, financial revision CAS | Incompatible. Fence both revisions and outbox; freeze snapshots and status with audit in one operation |
| `invoices-fns.js:416,423` cancel | Financial revision/status only; timestamp | **Critical activation blocker**: authorization does not change financial revision or issued status, so existing cancel can still win after send authorization. Replace only after coordinated protocol and platform proof |
| `invoices-fns.js:435,451` deletion claim | Draft -> cancelled, status gate only | Incompatible. No claim gate, accounting fence or owned tombstone. Do not use this as deletion ownership |
| `invoices-fns.js:459` physical delete | Delete by ID after separate claim | Incompatible. Can destroy permanent claim/audit evidence. Disable until separately reviewed retention and fenced-delete protocol |
| `invoices-fns.js:464` compensation | Cancelled -> draft, clears cancelled_at; status gate only | Incompatible. ABA/restoration race; requires exact server-owned delete identity/generation, both fences and no claim/authorization. Never restore financial history or an authorized invoice |
| `invoiceWrites.server.js:19` helper | Scalar id/company/status then spreads conditions; coerces `Number(result?.updated || 0)` | Incompatible. Caller conditions can override protected predicates. Coercion ignores success/has_more; replace with protected exact query and strict acknowledgement contract |
| `invoices-fns.js:145` revisionCondition | Missing revision uses `$exists:false` | Unverified compatibility with null equality in Stage A/B. No broad predicate fallback or automatic backfill |
| `accounting/export/base44ClaimStore.server.js:202` | Dormant Stage-B scalar-ID `$set`, explicit accounting revision, strict raw ack, private commands | Accounting foundation only. Cannot accept Stage-D commands or clear outbox. Boolean platformProof is insufficient; Stage-C trusted gate remains a prerequisite |
| `accounting/export/claimProtocol.js`, `claimPort.js` | Pure claim/recovery/reconcile decisions; normalized acknowledgement port | Reused through Stage D. Never directly dispatch or reconstruct a permit from Invoice state |
| `accounting/export/lifecycleCoordinator.server.js` | Unwired claim/cancel/recovery/reconcile + atomic pending event; verified projection clearing | Compatible only with new private offline bridge/model; not current Stage-B implementation |
| `accounting/export/auditOutbox.js` | Pure attach and clear proposals; housekeeping bumps accounting revision | Requires whole-field unset, shared writers and immutable readback proof; no direct persistence |
| `accounting/export/exportService.js` | FIX-1 mock export-row CAS/reconcile and separate audit append | Does not coordinate Invoice lifecycle/outbox. Do not wire it as a production bypass |
| `accounting/export/audit.js` | Audit payload builder, no Invoice write | Legacy audit shape is not delivery proof; do not synthesize pending history from projector identity |
| `accounting/testing/*`, `accounting/verification/localHarness.js:58,83` | Synthetic stores and fake SDK conditional-write probes | Offline model only; cannot establish backend atomicity or permissions |
| `invoiceNumber.server.js`, `numberSequence.server.js`, dashboard readers | Invoice queries; numbering writes Company counter, not Invoice | Not Invoice writers. Separate numbering idempotency/creation risk remains |
| Snapshot/totals builders; Client/company/bank writers | Build values or update other entities; do not backfill Invoice snapshots | Preserve this separation; historical issued snapshots must never be rewritten |
| External Base44 admin/import/automation/SDK writers | Not observable from repository | **UNVERIFIED**. Inventory and fence/disable all before activation; RLS source alone does not prove enforcement |

Existing helper comments claim Base44 rechecks atomically. That is a repository
assertion, not evidence; FIX-2C isolated experiments are still required.

## Prepared bridge and trust boundary

`offlinePersistenceBridge.server.js` composes the Stage-D coordinator, Stage-A
decisions and pure `safePersistenceContracts.js` compiler. Lifecycle create/edit/
issue/delete/restore are advisory specifications only. Cancellation is modeled,
never wired into the active handler. A factory is scoped to one server principal
and company; every operation re-reads trusted authentication, User active company
and a complete membership result. Earliest active membership determines privilege;
incomplete pagination, mismatched user, foreign company and revoked membership fail.
No caller role, selected company or cached actor can confer authority.

The injected repository contract is:

| Method | Contract |
| --- | --- |
| `readInvoice({id,companyId})` | Detached exact ID/company record or null |
| `readExport({id,companyId})` | Original candidate/permanent reference, exact tenant/invoice/provider/binding |
| `readConnection({id,companyId})` | Original destination binding with provider/environment/configuration revision and verification timestamp; never selected/replacement destination |
| `conditionalInvoiceWrite({query,update})` | One raw SDK-shaped conditional write; scalar ID + company + financial revision + accounting revision + status/claim fences; `$set` explicit next revision, optional whole-field `$unset`; raw acknowledgement |
| `findAuditProjections(scope)` | Bounded complete `{items,complete:true,nextCursor:null}`; no truncation treated as absence |
| `createAuditProjection(payload)` | Append canonical server-derived payload; return created row; no update/delete operation |
| `readAuditProjection(scope)` | Independent persisted exact-ID read; immutable canonical row or null |

Private port accepts only coordinator-issued transitions. Compiler rejects extra
financial fields, broad predicates, stale heads and changed permanent identity,
binding, recovery timestamp or send marker. Applied result is derived from the
acknowledged preimage plus patch, never a later permission read. Only exact raw
`{success:true, updated:1, has_more:false}` applies; numeric zero with the same
flags conflicts; everything else, exception or lost response is unknown. No retry.
An uncertain authorization consumes its worker and never yields a replacement.
No later read can reconstruct the original permit.

Original connection identity is checked for every operation; preparing/sending
also require active status at the bridge write boundary. Disabled unchanged
connections may still support recovery/projection. Missing or changed binding
blocks even projection until investigated. Connection/membership reads and Invoice
CAS are separate: immediate revocation is NOT guaranteed. A stronger revocation
design requires a reviewed generation fence/immutable connection policy.

Client intents allow only invoiceId, exportId, opaque worker and explicit
preparation retry approval (subject to server checks). Accounting revisions,
ownership, tokens, authorization markers, provider responses, reconciliation
evidence, delivery receipts and actor/company membership are rejected. Reconciliation
evidence comes only from a trusted injected server dependency, still subject to
FIX-1 validation. There is no provider transport. JSON clones of plans/workers are
not capabilities. Only an independent matching projection read can mint a private
clear receipt; append acknowledgement and client-supplied delivery facts cannot.

Stage B is not directly reusable: its private command registry rejects Stage-D
commands and it only emits `$set`. This bridge models the required lower-level
repository boundary rather than bypassing that registry or weakening Stage B.
A future real driver needs independent review, signed server-side evidence gating
and explicit integration approval. Do not pass a request-supplied repository,
session reader, clock, evidence source or platformProof object.

## Outbox compatibility assessment

Logical transition atomically writes claim/cancel state, next accounting revision
and the bounded pending event. Occupied or malformed slots block new transitions.
Projection copies only recorded facts; no financial data, credentials or invented
historical actor. Identical physical duplicates are allowed and deduplicated by
event_key; conflicting rows, incomplete search and missing readback block clear.
Append-only enforcement and search completeness are UNVERIFIED on Base44.

Clear uses exact Invoice head/revision plus independent immutable read receipt,
sets only next accounting revision and **unsets the entire pending field**. It
does not create another logical event. Every writer must increment the shared
revision; a bypass writer invalidates this protocol. Missing/null equality,
whole-field unset, atomic combined update and strict raw acknowledgements are
UNVERIFIED. No nested object-equality guarantee is assumed.

| Alternative | Assessment; no alternative implemented |
| --- | --- |
| Whole-field `$unset` (established protocol) | Preserve; requires isolated schema/atomicity/ack proof and new Stage-B support |
| `$set:null` | Current object schema is not nullable. Changes deployed schema semantics; cannot silently substitute |
| Empty object/string | Invalid pending event, deliberately blocks; not a vacancy representation |
| Delivered marker/tombstone | Requires schema/state-machine/size/revision redesign, receipt protection and migration; not a drop-in clear |
| Ring buffer / separate durable queue | Requires capacity, ordering, multi-record handoff/idempotency and garbage collection design; no assumed transactions/unique constraints |

Crash before projection leaves pending; crash/lost acknowledgement after append
allows explicit complete search and immutable readback on next invocation. Crash
before clear preserves the slot. Unknown clear may have removed it: return unknown,
never delivery success or send permission; next explicit invocation inspects state.
No automatic replay or replacement authorization. This is at-least-once physical
projection, one stable logical identity, not exactly-once database insertion.

## Lifecycle activation specifications

All specifications return activationReady=false. Before switching **any** handler:
prove isolated CAS/schema/ack/null/unset/permissions behavior, inventory all writers,
review trusted evidence gate, implement a real reviewed driver, retain audit data,
and obtain explicit deployment/integration approval. Current handlers stay unchanged.

* Create: server-derived company, numbering and snapshots; durable pre-create
  operation identity and ambiguous-create recovery. Creation ID and initial audit
  must be proven; no blind repeat after unknown create acknowledgement.
* Edit: draft only, no claim/authorization, valid vacant outbox; exact both-revision
  fences, server financial allowlist, increment both revisions and record audit
  atomically. Never allow accounting metadata through ordinary edit payloads.
* Issue: same gates, atomically freeze snapshots/totals/status and audit; both
  revisions advance. No historical snapshot migration or recomputation.
* Cancel: use Stage-A/D gate. Only draft/issued without any possible authorized
  send; claimed preparation must have valid original ownership/destination. Commit
  cancellation and audit together, advance both revisions. Authorized/ambiguous
  exports block; exported invoice requires a separately designed correction flow.
* Delete: no physical deletion while issued, claimed, authorized, pending or
  ambiguous. Even an unclaimed draft requires an owned durable delete identity,
  tombstone generation, audit retention and fenced final deletion; undefined today.
* Compensation: never restore by status alone. Require exact owned tombstone,
  matching both revisions, no claim/pending event and retained audit. Unknown
  delete outcome is an investigation state, not permission to restore.

## Legacy compatibility and blockers

Missing/null revisions model zero but predicates preserve the observed null head;
Base44 equivalence with missing must be proven. Empty/nonnumeric/negative revisions
are invalid, not coerced. Empty claim references are legacy vacancy only when all
other claim metadata is compatible with Stage A; partial existing Merit claims
cannot acquire a new identity or be silently repaired. Missing/null pending slot
is locally vacant, empty string is invalid. Historical snapshots and totals are
read-only. No bulk backfill or financial migration is included.

High-priority blockers: active cancellation/deletion bypasses; helper coercion and
overridable predicates; all-writer adoption; no approved disposable backend; no
trusted activation evidence; no real bridge driver; unsupported Stage-B clear;
creation/deletion ownership unresolved; external writers unknown. Audit lacks
space for full historical actor/destination facts, so existing minimal recorded
facts are retained rather than invented. Projection immutability and retention
must be enforced and verified before a read receipt is meaningful in production.

## Local verification and required backend evidence

`safePersistenceBridge.test.js` exercises strict acknowledgement combinations,
legacy revision representations, rejected client evidence, full membership and
tenant checks, claims/cancel/send races, unknown writes, stale workers and leases,
immutable destinations/snapshots, readback/clear failures, conflicting and duplicate
logical events, and lifecycle/delete readiness. The 418 existing tests are retained.
Local verification: **480 tests passed (418 existing + 62 new), zero failed,
cancelled or skipped**. `npm run lint`, `npm run build` and staged whitespace
checks passed. Build reports the existing missing VITE_BASE44_APP_ID and bundle
size warnings; no app ID or credentials were supplied and no backend was used.
These tests use a single-process synthetic store; they prove neither Base44 atomicity,
RLS, schema acceptance nor independent backend worker concurrency.

Follow `../verification/ISOLATED_VERIFICATION.md` only after separate explicit
approval of a new disposable app. Require independent backend workers; scalar-ID
CAS with both revisions; missing/null/empty predicates; combined `$set`/whole-field
`$unset`; raw success/updated/has_more response captures; schema acceptance and
generated candidate IDs; permissions and tenant isolation with distinct principals;
stopped/delayed workers and dropped acknowledgements before/after actual writes;
append/readback immutability, duplicate search and clear race experiments. Evidence
must identify app/build/schema/SDK hashes, timestamps, request/response shapes and
independent persisted outcomes, with no credentials. Any two send authorizations,
partial patch/outbox write, ambiguous success, foreign mutation, mutable projection
or incompatible predicate fails activation. All these platform results remain
UNVERIFIED; no real test is executed in this phase.

Exact changed files: this report, `safePersistenceContracts.js`,
`offlinePersistenceBridge.server.js`, and `../__tests__/safePersistenceBridge.test.js`.
