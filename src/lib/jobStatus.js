// Job status rules: one source of truth for the server functions that enforce them and for the
// screens that offer the moves. Pure data and pure functions — no server-only imports — so the
// server and the UI cannot drift apart.
//
// These rules deliberately keep every move the app already allowed: status editing keeps
// working exactly as before. What the paused status adds is that any state can be paused, a
// paused job can return to the status it was paused from, and a closed job can be reopened.
// A status never lists itself, so writing the status a job already has changes nothing.

export const JOB_STATUS_VALUES = ["scheduled", "in_progress", "paused", "completed", "cancelled"];

export const JOB_STATUS_TRANSITIONS = {
  scheduled: ["in_progress", "paused", "completed", "cancelled"],
  in_progress: ["scheduled", "paused", "completed", "cancelled"],
  paused: ["scheduled", "in_progress", "completed", "cancelled"],
  completed: ["scheduled", "in_progress", "cancelled"],
  cancelled: ["scheduled", "in_progress", "completed"],
};

export const PAUSE_REASONS = ["materials", "customer", "weather", "other"];

export function nextStatuses(status) {
  return JOB_STATUS_TRANSITIONS[status] || [];
}

export function canTransition(from, to) {
  return nextStatuses(from).includes(to);
}

// Where resuming takes the job: back to the status it was paused from when that is known,
// otherwise In progress. Never straight to completed or cancelled.
export function resumeTarget(job) {
  const previous = job?.paused_from_status;
  return previous === "scheduled" || previous === "in_progress" ? previous : "in_progress";
}

export function pauseReasonKey(reason) {
  return PAUSE_REASONS.includes(reason) ? `jobs.pause_reason_${reason}` : "jobs.pause_reason_none";
}

// The exact fields a status change writes. Nothing else on the job is touched: client, quotation
// link, scheduled date, assignment, price and currency all stay as they were.
export function statusPatch(current, target, { reason = "", note = "", today } = {}) {
  const patch = { status: target };

  if (target === "paused") {
    patch.paused_from_status = current;
    patch.paused_at = new Date().toISOString();
    patch.pause_reason = PAUSE_REASONS.includes(reason) ? reason : "";
    patch.pause_note = String(note || "").trim();
    return patch;
  }

  if (current === "paused") {
    patch.paused_from_status = "";
    patch.paused_at = "";
    patch.pause_reason = "";
    patch.pause_note = "";
  }
  if (target === "completed") {
    patch.completed_date = today || new Date().toISOString().slice(0, 10);
  } else if (current === "completed") {
    // A reopened job is no longer completed, so a stale completion date would mislead.
    patch.completed_date = "";
  }
  return patch;
}