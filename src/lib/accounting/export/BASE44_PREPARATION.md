# FIX-2B: schema and Base44 adapter preparation

Status: local preparation, NOT activated or deployed. No production data, real
credentials, accounting transport, migration, worker, endpoint or scheduling is
introduced. `base44ClaimStore.server.js` is not imported by application routes or
production invoice lifecycle functions. Its factory has no import-time or
construction-time SDK effects; all writes are disabled by default.

## Additive schema report

The four JSONC schemas preserve every original property definition, description,
required field and RLS rule from FIX-2A. Existing enums are extended by appending
values. New properties are optional and have no backfill defaults. Static tests
verify the original schema documents by hashing the structure after removing
only the explicitly listed additions. This is not Base44 schema validation.

| Schema | Prepared additions |
| --- | --- |
| Invoice | Nullable shared `accounting_revision`; Merit binding, state, attempt token/generation, current phase lease, irreversible send authorization, provider document ID and error code; reserved bounded `accounting_pending_event` |
| AccountingExport | Immutable binding and source financial revision; canonical claim reference, mirrored accounting revision/attempt/send metadata; informative projection status; preparation-failed and pre-send-aborted states |
| AccountingConnection | Configuration revision, immutable destination binding and independent destination-verification timestamp |
| AccountingExportEvent | Logical event key, claim/connection/binding/revision/attempt metadata; claim, authorization, preparation recovery/resume and pre-send cancellation actions |

The existing `claim_merit_sendinvoice_ref`, `_at`, `_connection_id` and
`_recovered_at` definitions remain unchanged. The new lease field describes the
current phase: its state distinguishes preparation from sending. Send expiry
never grants permission to send again. The authorization marker is irreversible
in the protocol; a schema description alone does not enforce immutability.

Bindings use the Stage-A company/provider/connection/revision/environment/region/
ledger/binding identity shape, with no credential fields or additional keys.
Only Merit bindings are supported; other providers remain unimplemented.

Projection/audit fields and the reserved Invoice outbox prepare later consistency
work. This adapter does not update projections or append audit events after
claim transitions. An export row remains an informative candidate until future
repair/integration code mirrors the canonical Invoice. Row status never grants
send authority. No transactional, complete-audit or exactly-once-event guarantee
is claimed. Existing FIX-1 audit timestamp behavior is unchanged.

## Legacy compatibility and migration report

No migration is included or executed. Historical snapshots, totals, line items,
numbers and currency are never regenerated or backfilled.

| Existing data | Handling |
| --- | --- |
| Missing accounting metadata | Reads remain untouched. A future approved first claim uses exact predicates and writes only claim metadata/accounting revision. No startup sweep or default backfill. |
| Missing/null accounting revision | Preserved on reads. A permitted first mutation predicates on null and explicitly `$set`s revision 1. Missing-as-null matching is unverified on Base44 and requires isolated proof before writes are enabled. |
| Empty claim reference `""` | Matched as that exact value, separately from missing/null. It is eligible only if no other claim metadata indicates historical work. |
| Nonempty old Merit claim without new state/binding/canonical row | Retained and blocked. Never clear, reinterpret as an export row ID, adopt, rebind, or retry automatically. Requires separately reviewed historical recovery evidence. |
| Partial/inconsistent claim metadata | Fail closed, without normalization or repairing financial records. |
| Historical issued snapshots | Remain the export source. No profile lookup rewrites them. Tests compare frozen financial fields before/after synthetic metadata changes. |
| Old export rows without source revision/binding | Not automatically upgraded into authoritative candidates. Their existence/export key cannot authorize sending. |
| Old connections without a verified binding/revision | Ineligible for new bound candidates. Credential presence or an old active status is not destination verification. |

Nullable new fields use JSON Schema union types. Base44 acceptance, explicit
null storage, and legacy-field validation must be verified separately. If the
backend rejects these constructs, stop and revise the reviewed schema/adapter
contract; do not silently substitute missing/null/empty conditions or rewrite
historical data.

## Server-only adapter contract

`createBase44ClaimStore` accepts a trusted request context, clock/token source,
optional server-only evidence supplier, and optional platform-proof metadata.
There is no environment variable, UI flag or endpoint that activates it. The
default proof is null, and candidate/Invoice writes return an unknown/disabled
result without touching the SDK.

Tests supply `SYNTHETIC_PROOF`, explicitly labeled SDK-FAKE-ONLY. It is not real
backend evidence. The proof switch is a trusted configuration gate, not an
automated verifier. Only independently reviewed evidence could justify supplying
real proof later, and lifecycle/export integration requires separate review.

For each operation, authorization comes from `auth.me`, the server-managed User
active company and active CompanyMembership records. Truncated or indeterminate
membership results fail closed; the earliest membership determines role. The
adapter never calls `requireCompanyContext`'s user-cache synchronization, so these
authorization reads do not implicitly update User records. Authorization and
ownership are rechecked before writes. Service-role access is scoped explicitly.

Read APIs are `getInvoice({id, companyId})` and `getCandidate({id, companyId})`.
Preparation adds two server-orchestration APIs:

- `prepareCandidate({invoiceId, connectionId})` loads trusted facts and mints an
  internal candidate. `createCandidate(row)` accepts only that object. It omits
  the placeholder ID from SDK creation and returns Base44's actual assigned ID.
  Unknown creates are not retried; duplicate/orphan candidates are harmless.
- `prepareTransition(operation, intent)` reloads Invoice, candidate, membership
  and original connection facts, then calls the pure Stage-A protocol. Extra
  client metadata, bindings, revisions, tokens, raw commands and provider response
  objects are rejected. Reconciliation evidence can only come from the trusted
  server dependency; no real accounting evidence supplier is provided here.

Commands and worker handles are process-local opaque objects. Only acknowledged
acquisition/resumption activates a preparer. Reading persisted tokens, copying
JSON, switching adapter instances, or losing a write acknowledgement cannot
reconstruct its capability. A crashed preparer must use recovery and explicit
pre-send resumption. Future distributed-worker handoff is not implemented.

`compareAndSet` consumes a privately prepared command once, reauthorizes, rebuilds
its predicates/patch from fresh server facts and checks expiry. Its only Invoice
write is `updateMany({id: scalarId, ...exactPredicates}, {$set: explicitValues})`.
It uses no `$inc`, broad update, upsert, unique key, transaction or retry. A send
attempt consumes its worker handle even on an uncertain result.

Only `{success: true, updated: 1, has_more: false}` is an unambiguous write
acknowledgement. The returned port image is derived from the known preimage and
acknowledged patch, with no post-write read. Exceptions, malformed counts and lost
acknowledgements remain unknown and grant no send permit. A later read is solely
diagnostic. There is no transport to consume a permit in this preparation stage.

## Remaining risks and gates

- SDK documentation specifies write-time predicate rechecking only with a plain
  single `id`. This is documented behavior, not executed backend proof.
- Missing/null/empty matching, nullable schema acceptance, response semantics and
  schema validation/serialization remain unverified on a real Base44 instance.
- Candidate IDs are server-assigned. Duplicate creation and projection/event
  storage have no assumed uniqueness or cross-record atomicity.
- Connection/membership checks and Invoice CAS are separate records. Revocation
  or disconnection can race after the last check. No instantaneous revocation
  guarantee is claimed; admission/draining semantics remain later-stage work.
- Existing production cancellation functions do not participate in this shared
  revision gate. Do not wire or enable this adapter before coordinated lifecycle
  integration and review. This change does not make production exports safe.
- Destination verification timestamps/identities must be independently trusted;
  the adapter checks consistency, not remote ledger identity. No credential or
  real provider contract has been verified.
- A worker paused after acknowledged authorization may still send. No lease,
  empty lookup, reconnect or recovery creates replacement authorization.

## Disposable Base44 test-app verification plan — NOT executed

1. Obtain separate authorization for a disposable app, its synthetic entities and
   test-record lifecycle. Use a distinct app ID and test-only identity with no
   production permissions. No accounting provider credentials or API access.
2. Apply the prepared schemas only in that disposable app. Verify union/null
   acceptance, required children, rejection of additional binding keys, and
   existing historical-shaped records without new metadata. Stop on mismatch.
3. Create synthetic company/member/connection/invoice records with predetermined
   non-secret destination identities and financial snapshots. Include missing,
   explicit null and empty-string representations. Record before/after hashes.
4. Execute the exact scalar-ID `$set` predicates from independent requests and
   processes. Race two initial claims, send/cancel in both orders, preparation
   recovery/send, and competing reconciliations. Verify one conditional winner
   and exact success/count/has_more responses. Never invoke an accounting sender.
5. Inject delayed/lost SDK acknowledgements and server interruption before/after
   updates. Verify unknown results never mint permission, reads cannot recover
   permits, stale workers cannot overwrite state, and sending never rearms.
6. Verify Base44-generated candidate IDs and echoed fields, duplicate export-key
   candidates, canonical-pointer enforcement and tenant/role RLS using user-level
   as well as service-role contexts. Test unsupported legacy values explicitly.
7. Confirm snapshots, totals and numbers are unchanged. Retain non-secret proof
   artifacts identifying app/runtime/SDK versions, exact predicates, counts and
   race results. In-memory/SDK-fake results cannot substitute for this evidence.
8. Review evidence before any adapter integration or enablement. Remove only
   synthetic test records/app according to the separately authorized disposal
   plan. No production deployment, data migration, provider calls or PR merge is
   part of this verification plan.
