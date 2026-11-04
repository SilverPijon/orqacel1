# FIX-2D — lifecycle coordination and durable audit preparation

## Outbox design decision (recorded before implementation)

Use the existing, bounded single-slot `accounting_pending_event` schema with
STRICT BACKPRESSURE. Every coordinated logical transition writes its event in
the same Invoice conditional update. No next transition, including recovery,
may overwrite an occupied slot. Project and independently verify the current
event, then clear the slot through another Invoice CAS before proceeding.

This safely represents every transition admitted by this coordinator without an
unbounded queue, a new schema, uniqueness or cross-record transactions. The
trade-off is availability: a projection outage can stall preparation, cancellation
and recovery. A sender already authorized before the outage remains potentially
active; stalling does not permit a replacement. Do not bypass a pending slot to
improve availability. A bounded multi-slot queue would need reviewed schema and
append/ack/ordering semantics; it is NOT implemented in this stage.

The outbox uses exactly the fields already prepared in FIX-2B. Actor, original
binding and full attempt snapshots do not fit that restricted schema, so do not
invent historical attribution from the current projector/session or mutable
profiles. Future richer audit requirements need a separately reviewed version.
Minimal durable facts are logical action, permanent claim reference when present,
provider category, source/target accounting revision, occurrence time and a
deterministic identity scoped to the Invoice and company.

## Scope and writer inventory

This inventory covers tracked repository code at FIX-2C commit `2a10ce7` and the
new offline preparation modules. No remote Base44 app, administrative automation,
import job, hidden builder code or external service-role writer was inspected.
Those remain an explicit rollout inventory gate. No production handler, schema,
RLS rule, earlier adapter/protocol, or existing test was modified in FIX-2D.

| Writer/path | Current behavior and required future coordination |
| --- | --- |
| `src/lib/invoices-fns.js:createInvoice` (254; create at 281) | Owner/Admin server function creates draft, revision 1, number, computed totals and seller/buyer/payment snapshots. No accounting revision/outbox initialization. Future creation audit needs a pre-create stable operation identity: Base44-assigned Invoice ID cannot be assumed available before atomic creation. Do not invent caller-assigned ID support. |
| `invoices-fns.js:updateInvoice` (304; CAS at 365) | Draft-only edit refreshes selected buyer/payment facts and recomputes totals when lines change; increments financial revision. Future CAS must also gate shared accounting revision/empty outbox and audit its logical write. No edits to issued/cancelled finance. |
| `invoices-fns.js:setInvoiceStatus` issue branch (394; shared CAS 423) | Draft-to-issued freezes current seller/buyer/payment facts, issue timestamp and revision in one write. Future accounting/outbox checks must join that write; never retroactively refresh historical snapshots. |
| `invoices-fns.js:setInvoiceStatus` cancel branch (416; shared CAS 423) | Currently writes cancelled status/timestamp/revision with old status+financial revision only. Does NOT check accounting revision, claim, authorization marker or pending outbox. Must be rewired only in a later approved stage. |
| `invoices-fns.js:deleteInvoice` claim (451) | Changes a draft to cancelled before physical deletion, with status/company/ID predicate but no revision/accounting/outbox gate. A future delete needs dedicated fenced ownership/tombstone semantics and no accounting claim/pending evidence. |
| `deleteInvoice` physical delete (459) | Deletes by ID after the draft claim. Must never delete an issued financial record, permanent claim or unprojected outbox. Audit-before-delete and source-authority retention need separate design. |
| `deleteInvoice` compensation (464) | On deletion failure restores cancelled to draft and unsets cancellation time, without expected revision/ownership. Future rollback must be fenced and cannot resurrect a genuinely cancelled record or overwrite later accounting work. |
| `src/lib/invoiceWrites.server.js:writeInvoiceIfStatus` (19) | Shared raw scalar-ID `Invoice.updateMany` helper for edit/issue/cancel/delete claim/restore. Conditions are caller-supplied and spread into the predicate. Future adapter must protect required predicate fields and validate unambiguous acknowledgements; no ambiguous automatic retry. |
| `src/lib/accounting/export/base44ClaimStore.server.js:compareAndSet` (202 write) | Prepared, default-disabled service-role Invoice CAS for Stage-A claim/cancel/recovery/reconciliation. It does NOT attach or understand this outbox/unset protocol. Its private commands cannot simply be reused as this stage's port. Keep unwired until an approved integrated adapter exists. |
| `claimProtocol.js:acquireClaim/authorizeSend/recoverClaim/resumePreparation/cancelInvoice/reconcileClaim` | Pure proposals, no persistence. They check shared accounting revision/claim scope but are not independently outbox-aware. Future callers must not bypass the audited coordinator. |
| `exportService.js:runExport/reconcileExport` | Legacy mock-only export-store CAS and independent `appendAudit` calls. No authoritative Invoice claim or atomic outbox. Preserve tests, but never treat this direct path as a production-safe integration. |
| `audit.js:createAuditEvent` | Pure whitelist builder, not durable storage; uses legacy `created_at`. New projection uses schema-compatible `occurred_at` from captured facts. Neither helper alone proves event persistence. |
| New `lifecycleCoordinator.server.js:commit` | Unwired port call for audited acquisition, send authorization, cancellation, recovery, resumption and found reconciliation. Same Invoice CAS contains pending audit event. |
| New `lifecycleCoordinator.server.js:projectAudit` | Unwired append/read/clear orchestration. Clear is accounting-fence housekeeping, not a second financial/logical transition and never a send grant. |
| `testing/invoiceClaimStore.js`, `testing/base44ClaimSdkFake.js`, new `testing/lifecycleAuditStore.js` | Synthetic in-process mutation models only, no backend. Their writes do not prove Base44 guarantees. |
| `verification/localHarness.js` direct `Invoice.updateMany` calls | Deliberately synthetic SDK-fake predicate/race probes. No live driver or accounting request. |

Read-only/dependency paths are not omitted writers: `dashboard-fns.js` aliases
Invoice for counts; `numberSequence.server.js` scans Invoice numbers and writes
COMPANY counters; `invoiceNumber.server.js` delegates to that counter; Company
creation initializes counters. Snapshot/totals builders are pure. Client/profile
and bank-account writers do not backfill issued Invoice data. `requireCompanyContext`
may synchronize User caches, not Invoice. Browser Invoice writes are declared
closed by existing RLS, whose real enforcement remains unverified. No active
accounting export endpoint/provider transport is present in this foundation.

The tests include a direct predicate demonstration: the existing production
cancel filter still matches after send authorization because financial revision
and issued status remain unchanged. The coordinated accounting predicate loses.
This is source/model evidence, NOT execution of the production handler/backend.
Existing Invoice revision handling uses `$exists:false` for an absent revision;
the job helper uses null equality instead. Neither pattern proves the actual
legacy semantics. The new model's null convention must not be substituted into
production without independently establishing the backend behavior.

## Prepared coordination contract

`createLifecycleCoordinator` is a server-only, dependency-injected, UNWIRED
module. It imports no Base44 SDK and creates no endpoint, background process or
transport. Only intents containing Invoice/candidate IDs, explicit retry intent
and process-local opaque worker handles are accepted. Actor, ownership, binding,
revision/patch and reconciliation response inputs are rejected.

Its trusted port must independently authenticate and authorize Owner/Admin active
membership and company scope on EVERY read/write/projection operation. A future
Base44 bridge must derive these facts from `auth.me`, server-managed company and
memberships, never request JSON. The offline port simulates these facts only; it
is not an implementation or proof of real authentication, RLS or membership CAS.
Reconciliation evidence can originate only from the constructor's trusted server
dependency and is reused as captured evidence at commit, not accepted from a
client or silently redirected to another provider/destination.

Transitions retain Stage-A status/financial revision/accounting revision, claim,
attempt token/generation, immutable destination and irreversible authorization
checks. The same Invoice conditional write also expects a vacant outbox and
stores the bounded pending event. A lost/rejected/unknown result grants no
cancellation success, active worker or send permit. No automatic CAS retry or
readback-based permission reconstruction occurs.
An applied result describes the acknowledged transition image, not a guaranteed
fresh head: a delayed acknowledgement may arrive after another worker has
projected its event or advanced recovery. It never overwrites those later facts.

Pending audit backpressure applies to recovery/reconciliation as well as cancel
and send. A failed audit service may leave a lease expired but safe; project and
acknowledge first, then explicitly recover. Preparation recovery fences stale
generations and only explicit never-sent resumption can create a new preparer.
Once authorized, neither cancellation, expiry, reconnection, nor authoritative
empty lookup can issue a replacement send. A late original worker may still
resume; that is why replacement is prohibited.

## Projection, retry and acknowledgement protocol

1. Read an authorized Invoice and validate its pending slot, exact key allowlist,
   size (at most 1024 UTF-8 bytes), version relationship, scope and deterministic
   identity. Missing/null means empty; strings, partial legacy objects or extra
   keys are blocked without normalization or overwrite.
2. Derive projection fields ONLY from captured pending facts plus immutable
   Invoice/company scope. No credentials, arbitrary text, payload, provider body,
   tokens or current projector attribution are stored. Unclaimed cancellation
   is not falsely attributed to Merit; its projection omits provider/claim fields.
3. Search projections within company+Invoice+logical event key, with an explicit
   bounded-complete result. A truncated/failed search or conflicting copy keeps
   the pending slot. The model bounds duplicate inspection to 16 rows by default;
   exhaustion requires investigation, never automatic deletion or evidence loss.
4. If no copy is found, attempt one append. Its acknowledgement alone is NOT
   confirmation. Unknown/failed creates keep pending evidence; an explicit later
   retry first searches again, allowing an earlier committed copy to be found.
5. Independently read the persisted projection by ID and verify every captured
   field and scope. Additional credential/body-shaped fields or a mismatched copy
   fail closed. Identical physical duplicates are allowed without uniqueness;
   consumers deduplicate by logical `event_key`, not database row ID.
6. Reauthorize and reread the Invoice. Clear only if the entire same pending event
   is still present at the same accounting revision. The clear CAS checks scalar
   ID/company/status/financial revision/accounting revision/relevant claim fields,
   increments ONLY accounting revision and unsets the whole pending field. It
   preserves financial data, authorization marker and permanent binding/reference.
7. A clear conflict/unknown result is not a successful response. A later empty
   slot is idle/diagnostic, not a replayed logical transition or send permission.
   No automatic transition retry follows projection completion.

The logical identity is a deterministic SHA-256 over company, Invoice, action,
provider category, claim reference and from/to accounting revisions. Occurrence
time is captured once; projection retries never replace it with worker time.
Accounting revisions also advance for slot-clear fencing, so logical event
revision pairs may contain gaps. A clear does not generate another pending event:
that would recurse forever. The confirmed projection represents delivery of the
already committed transition; clear is delivery housekeeping only.

No nested-field CAS/unique constraint/transaction is assumed. The clear's exact
pending-object comparison is a trusted-port precondition, not a claim that Base44
supports object equality queries. A future bridge must revalidate it from the
authorized source then use shared scalar revision fencing. This relies on EVERY
writer participating; a rogue writer changing the slot without advancing the
revision breaks the contract. The new offline port models this atomically but
does not establish backend behavior. Whole-field `$unset` and vacancy-null
semantics require isolated verification before real integration.

## Durability limits, legacy behavior and approval gates

The Invoice pending event is the authority for the committed logical transition.
`AccountingExportEvent` is a readback-verified historical projection and is NEVER
consulted to grant export/cancellation authority. After delivery, ongoing authority
remains on Invoice. Projection rows must be append-only/immutable under all trusted
service writers; external deletion or mutation between readback and clear cannot
be prevented without additional storage guarantees. No exactly-once physical
append or cross-record atomicity is claimed.

Legacy missing/null accounting revision and missing/null/empty references remain
model-compatible only under the explicitly unverified null convention. Partial
old claims and malformed outboxes block without reset, rebind or financial repair.
Already-issued financial snapshots are never refreshed. Creation/edit/issue/delete
handlers are NOT integrated or newly audited by this stage. New audit facts omit
historical actor/binding/attempt detail that the current bounded schema cannot
capture; richer compliance history needs a reviewed versioned schema extension.

Before any actual integration:

1. Review this writer inventory and enumerate external/admin/import writers.
2. Approve changes to ALL active lifecycle handlers, including deletion and its
   compensation, and to the default-disabled Stage-B port. Protect required
   predicates, make audit vacancy/transition writes mandatory, and implement the
   unset/verified-projection port contract without broad queries or retries.
3. Separately resolve creation-event identity before Base44 assigns an Invoice ID,
   append-only projection enforcement, full actor attribution if required, and
   safe physical-delete audit/source retention. No hidden implementation is assumed.
4. Independently verify actual Base44 scalar-ID CAS, legacy null/empty semantics,
   atomic metadata+outbox writes, whole-field unset, acknowledgement/readback and
   user-level permission behavior. Stage C's disposable-app plan remains optional
   future work requiring separate approval; no paid app is needed for this stage.
5. Review connection admission/revocation/draining, durable projection operations,
   trusted evidence provenance and deployment capabilities. Existing Stage-C
   attestations/prototypes do not automatically activate this integration.
6. Obtain separate rollout approval. No production cancellation rewiring, schema
   publication, credentials, provider calls, migrations, deployment or PR merge
   is part of FIX-2D.

## Offline validation

The new lifecycle/audit tests cover competing orderings and simultaneous calls,
unknown/rejected CAS before/after commit, legacy data, expired preparation,
irreversible authorization, stale generations, bound destinations, projection
interruptions/restarts, identical/conflicting duplicates, source-slot preservation,
late acknowledgement/projector races, membership revocation, client-data rejection,
financial snapshots and the existing lifecycle table/integration boundary.

All previous 345 accounting tests remain unchanged. The additional store is a
single-process local model, with fault hooks and synthetic context only. Existing
SDK-fake tests and the Stage-C process harness remain SDK-fake/local results.
No real Base44 backend, real audit persistence, real membership/RLS enforcement or
database-level concurrency guarantee has been established by these tests.
