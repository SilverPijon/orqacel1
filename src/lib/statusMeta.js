export const QUOTATION_STATUS = {
  draft: { key: "quotations.status_draft", tone: "muted" },
  sent: { key: "quotations.status_sent", tone: "primary" },
  accepted: { key: "quotations.status_accepted", tone: "success" },
  declined: { key: "quotations.status_declined", tone: "danger" },
  expired: { key: "quotations.status_expired", tone: "warning" },
};

export const JOB_STATUS = {
  scheduled: { key: "jobs.status_scheduled", tone: "primary" },
  in_progress: { key: "jobs.status_in_progress", tone: "warning" },
  completed: { key: "jobs.status_completed", tone: "success" },
  cancelled: { key: "jobs.status_cancelled", tone: "muted" },
};

export const JOB_PRIORITY = {
  low: { key: "jobs.priority_low", tone: "muted" },
  medium: { key: "jobs.priority_medium", tone: "primary" },
  high: { key: "jobs.priority_high", tone: "warning" },
  urgent: { key: "jobs.priority_urgent", tone: "danger" },
};

export const CLIENT_STATUS = {
  active: { key: "clients.active", tone: "success" },
  archived: { key: "clients.archived", tone: "muted" },
};

export const ROLE = {
  owner: { key: "settings.role_owner", tone: "primary" },
  admin: { key: "settings.role_admin", tone: "primary" },
  member: { key: "settings.role_member", tone: "muted" },
};

export const MEMBERSHIP_STATUS = {
  active: { key: "clients.active", tone: "success" },
  pending: { key: "settings.pending", tone: "warning" },
  declined: { key: "settings.declined", tone: "muted" },
  expired: { key: "settings.expired", tone: "danger" },
  revoked: { key: "settings.revoked", tone: "danger" },
  invited: { key: "settings.invited", tone: "warning" },
};

export const PLAN = {
  free: { key: "settings.plan_free", desc: "settings.plan_free_desc", price: "€0" },
  pro: { key: "settings.plan_pro", desc: "settings.plan_pro_desc", price: "€7.90" },
  team: { key: "settings.plan_team", desc: "settings.plan_team_desc", price: "€14.90" },
};