/**
 * Sanitized audit events.
 *
 * Events are built from an explicit whitelist, never by spreading a caller's object. That is the
 * structural guarantee that a credential, a payload or a provider response can never reach the
 * audit log, regardless of what the caller passes in.
 */

export const AUDIT_ACTIONS = Object.freeze({
  CONNECT: "connect",
  DISCONNECT: "disconnect",
  MODE_CHANGED: "mode_changed",
  EXPORT_VALIDATION_FAILED: "export_validation_failed",
  EXPORT_SENT: "export_sent",
  EXPORT_CONFIRMED: "export_confirmed",
  EXPORT_FAILED: "export_failed",
  EXPORT_AMBIGUOUS: "export_ambiguous",
  EXPORT_RECOVERY_REQUIRED: "export_recovery_required",
  RECONCILE_FOUND: "reconcile_found",
  RECONCILE_ABSENT: "reconcile_absent",
  RECONCILE_CONFLICT: "reconcile_conflict",
});

const SENSITIVE_KEY = /(api_?key|apikey|api_?id|apii|signature|token|secret|password|cipher|credential|authorization|iv)$/i;

export const REDACTED = "[redacted]";
export const MAX_STRING = 200;

/** Defensive scrub, used only for free-text diagnostics — never for the event body itself. */
export function sanitize(value, depth = 0) {
  if (depth > 4) return REDACTED;
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}…` : value;
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => sanitize(item, depth + 1));
  if (typeof value === "object") {
    const clean = {};
    for (const [key, item] of Object.entries(value)) {
      clean[key] = SENSITIVE_KEY.test(key) ? REDACTED : sanitize(item, depth + 1);
    }
    return clean;
  }
  return REDACTED;
}

/**
 * Build one audit event.
 *
 * Fields are listed one by one on purpose: an unexpected input key is simply not copied, so no
 * credential, no request payload and no provider document body can leak into the log.
 */
export function createAuditEvent({
  action,
  actor = {},
  companyId = null,
  exportKey = null,
  invoiceId = null,
  kind = "invoice",
  fromState = null,
  toState = null,
  attempt = null,
  errorCode = null,
  providerDocumentId = null,
  providerDocumentNo = null,
  at = Date.now(),
} = {}) {
  return {
    action: action ?? null,
    actor_user_id: actor.userId ?? null,
    actor_role: actor.role ?? null,
    company_id: companyId ?? null,
    export_key: exportKey ?? null,
    invoice_id: invoiceId ?? null,
    kind,
    from_state: fromState ?? null,
    to_state: toState ?? null,
    attempt: attempt ?? null,
    error_code: errorCode ?? null,
    provider_document_id: providerDocumentId ?? null,
    provider_document_no: providerDocumentNo ?? null,
    created_at: at,
  };
}

/** Convenience for tests and diagnostics: does this value contain any of the given secrets? */
export function containsSecret(value, secrets = []) {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return secrets.filter(Boolean).some((secret) => text.includes(String(secret)));
}