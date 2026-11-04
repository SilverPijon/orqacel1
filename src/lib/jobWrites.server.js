// Conditional job writes. Server-only.
//
// Base44 locks no records and runs no transactions, so a job is never changed with a plain update:
// every change is written as one conditional update that applies only while the job still reads
// exactly as the caller saw it ("compare and set"). Base44 rechecks those conditions at the moment
// of the write, so of two racing callers at most one succeeds and the other is told the job moved.
// Reading the job first only decides what to write and whether the change is allowed; the condition
// is what makes the write safe.
//
// The revision is written with $set to an exact number rather than incremented: a job created
// before the counter existed stores null there, and the platform refuses $inc on a null field.
// Setting it is just as safe, because the write only lands while the stored revision is still the
// one read here — so exactly one of two racing writers can ever move it forward.
//
// The write is not a substitute for authorization: callers still resolve the company and the role
// first, and the company id stays in the condition as well.

function revisionOf(job) {
  return Number.isInteger(job?.revision) ? job.revision : null;
}

// A job that predates the counter carries no number; it is matched as null, which the platform
// treats as "no value here". Its first write therefore still fails if another write got there
// first, and no record has to be rewritten just to start using the counter.
function revisionCondition(job) {
  return { revision: revisionOf(job) };
}

// The revision as the screens see it: a job without one counts as 0, so nothing has to migrate.
export function currentRevision(job) {
  return revisionOf(job) ?? 0;
}

export function nextRevision(job) {
  return currentRevision(job) + 1;
}

// Writes exactly one job, only while it is still the version `job` describes — and, when
// `expectedStatus` is given, still in that status. Returns 1 when this caller won and 0 when the
// job had already moved on and nothing was written.
export async function writeJobConditionally(service, job, { companyId, expectedStatus } = {}, patch) {
  const filter = { id: job.id, company_id: companyId, ...revisionCondition(job) };
  if (expectedStatus) filter.status = expectedStatus;
  const result = await service.entities.Job.updateMany(filter, {
    $set: { ...patch, revision: nextRevision(job) },
  });
  return Number(result?.updated || 0);
}