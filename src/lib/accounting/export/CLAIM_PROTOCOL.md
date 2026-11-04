# Invoice claim protocol — FIX-2 stage A

This is an isolated pure model and fault-injectable in-memory persistence port.
It imports no Base44 SDK, starts no server, and performs no accounting calls.
The proposed Invoice metadata fields have NOT been added to entity schemas.

## Authority and identity

Invoice is the only authority for claim and cancellation decisions. The permanent
reference `claim_merit_sendinvoice_ref` points at one canonical export candidate.
Its identity is `company:invoice:provider:invoice`, independent of reconnects,
environments or connection selection. Duplicate candidate rows with the same
export key are legal; row existence never grants authority. An orphan cannot
authorize, recover, or reconcile a send.

Only Merit is registered. Unknown nonempty provider-claim fields block operations
until that provider participates in the same cancellation protocol.

The immutable non-secret destination binding includes company, provider,
connection ID and revision, environment, region, ledger ID and binding ID. Every
field must match, not just the binding ID. Stage A uses synthetic identities;
they are not independently verified provider ledger identities. Tokens, candidate
IDs, clock values and lease durations are explicit inputs; future trusted callers
must generate IDs/tokens and load authorization/binding facts server-side.

## Single-record decisions

`claimProtocol.js` returns frozen decisions with exact scalar-ID predicates and
an allowlisted Invoice patch. No decision mutates its input or writes snapshots.
Every transition advances shared `accounting_revision` with `$set` semantics.
Cancellation also checks and advances the existing financial revision.

| Operation | Predicate / result |
| --- | --- |
| Acquire | Issued, no permanent claim or inconsistent metadata; install candidate reference, binding, preparation token/generation and lease |
| Authorize send | Canonical row, same binding, live preparation lease, matching token/generation, no prior authorization; set irreversible authorization marker |
| Cancel | No claim or provably pre-send preparation; atomically cancel and abort the preparation |
| Recover preparation | Expired, no authorization; fence the attempt into `preparation_failed` |
| Resume preparation | Explicit approval, new token/generation, same permanent reference/binding, never authorized |
| Recover sending | Expired, authorization present; retain it and move to `needs_reconciliation` |
| Reconcile found | Original binding and strict FIX-1 document/financial evidence; settle to `exported` |
| Reconcile absent/uncertain | No send authorization is created; remain unresolved |

The claim reference, first-claim timestamp and original destination never change.
The first recovery timestamp is retained across repeated pre-send recovery.
An attempt generation prevents a stale token from regaining ownership even if
the token string is later reused. Cancellation and send authorization compete on
the same Invoice accounting revision; their stale decisions cannot both commit.

## Conservative send policy

The port helper returns a diagnostic send permit ONLY after an acknowledged
`authorize_send` transition reporting exactly one changed Invoice with matching
metadata. Acquisition, readback, rejection, thrown errors, uncertain writes, and
replayed stale decisions never produce a permit. Permits carry the original
destination binding. They are not a transport implementation or durable reusable
credentials; a future dispatcher must issue at most one call for an acknowledged
authorization and must not automatically retry provider calls.

A worker paused BEFORE its authorization CAS is fenced by preparation recovery.
A worker paused AFTER its successful authorization CAS may still resume and send.
Lease expiry cannot revoke that external capability. Recovery, cancellation, a
new connection, or even a complete authoritative empty lookup must not create a
replacement authorization. Stage A has NO sender-quiescence override. Exported
invoices require a correcting-document workflow, which is not implemented here.

The standalone FIX-1 exporter and its memory store are unchanged so its regression
suite remains intact. They are NOT wired through this Invoice authority. Future
integration must route every sender/cancellation path through this protocol;
calling the old exporter directly is not a persistent-safety implementation.

## Persistence port and faults

`claimPort.js` documents the JS port interface and normalizes acknowledgements:

- `getInvoice({id, companyId})` and `getCandidate({id, companyId})` return detached,
  tenant-scoped data; candidates cannot be selected as authority by export key.
- `createCandidate(row)` may create an orphan. No unique constraint is assumed.
- `compareAndSet({where, patch})` changes one existing Invoice or none. It must not
  upsert, make broad updates, replay cached success acknowledgements to new
  invocations, or reconstruct permission from a subsequent read.
- Results distinguish `applied` (`updated: 1`), `conflict` (`updated: 0`) and
  `unknown`. Thrown errors and malformed acknowledgements normalize to unknown.

The mock supports per-operation rejection, unknown-before/after-commit,
throw-before/after-commit, and deterministic pauses before comparison or after
commit. No await occurs between comparison and the modeled one-record write.
Snapshots and returned records are deeply detached. Financial-field writes,
broad selectors, permanent-binding changes and authorization-marker clearing are
rejected. Faults describe known test histories, not evidence available to callers.

The mock treats missing fields as null for exact predicates, and handles empty
claim strings separately. This is explicitly a MODEL convention, not proof of
Base44 null/legacy behavior. It uses no `$inc`, transactions, uniqueness or SDK.
Its permit and revision tests prove only this single-process application model.

## Remaining stages

1. Review this protocol, port, faults and regressions.
2. Obtain separate approval for schema additions and production lifecycle wiring.
3. Implement a Base44 adapter using plain scalar `id` conditional updates. Verify
   null/missing/empty semantics, update counts, exact `$set` writes and concurrent
   exclusion in a separately authorized disposable Base44 app using synthetic data.
4. Integrate export/cancellation authority, connection admission/disconnect policy,
   immutable destination verification, projection repair and durable audit/outbox
   behavior. Preserve historical issued financial snapshots.
5. Independently verify real-provider response, idempotency and reconciliation
   contracts before considering an actual transport. No such verification or
   production readiness is claimed by stage A.

Run all accounting tests directly (each file reports its individual test count):

```bash
for test_file in src/lib/accounting/__tests__/*.test.js; do
  node "$test_file" || exit
done
```
