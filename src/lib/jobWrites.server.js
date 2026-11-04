// Conditional job writes. Server-only.
//
// Base44 locks no records and runs no transactions, so a job is never changed with a plain
// update: every change is written as one conditional update that applies only while the job still
// reads exactly as the caller saw it ("compare and set"). Base44 rechecks those conditions at the
// moment of the write, so of two racing callers at most one succeeds and the other is told the job
// moved. Reading the job first is not enough on its own — the read only decides what to write and
// whether the change is allowed; the condition is what makes the write safe.
//
// The write is not a substitute for authorization: callers still resolve the company and the role
// first, and the company id stays in the condition as well.

function revisionOf(job) {
  return Number.isInteger(job?.revision) ? job.revision : null;
}

// Jobs created before the revision counter existed have no value; they are matched by its absence
// so the first write on them still fails when another write got there first.
function revisionCondition(job) {
  const revision = revisionOf(job);
  return revision === null ? { revision: { $exists: false } } : { revision };
}

// Writes exactly one job, and only while it is still the version `job` describes — and, when
// `expectedStatus` is given, still in that status. Returns 1 when this caller won and 0 when the
// job had already moved on and nothing was written.
export async function writeJobConditionally(service, job, { companyId, expectedStatus } = {}, update) {
  const filter = { id: job.id, company_id: companyId, ...revisionCondition(job) };
  if (expectedStatus) filter.status = expectedStatus;
  const result = await service.entities.Job.updateMany(filter, update);
  return Number(result?.updated || 0);
}

// The revision the caller read, normalised for comparison against what it sent back.
export function currentRevision(job) {
  return revisionOf(job) ?? 0;
}