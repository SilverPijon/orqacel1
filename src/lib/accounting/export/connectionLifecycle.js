/** Pure OFFLINE proposal. These envelopes are not deployed entity fields. */
import { sameBinding, validBinding } from "./claimProtocol.js";
import { freezeCopy } from "./auditOutbox.js";

export const CONNECTION_TRANSITIONS = freezeCopy({
  active: ["draining", "disabled", "revoked"],
  draining: ["active", "disabled", "revoked"],
  disabled: ["active", "revoked"],
  revoked: [],
});
const text = (v) => typeof v === "string" && v.trim() === v && v.length > 0 && v.length <= 200;
const generation = (v) => Number.isSafeInteger(v) && v >= 0;
const deny = (code) => freezeCopy({ ok: false, code });

export function validConnectionFence(c) {
  return Boolean(c && text(c.id) && text(c.companyId) && Object.hasOwn(CONNECTION_TRANSITIONS, c.state) &&
    generation(c.generation) && validBinding(c.binding) && c.binding.companyId === c.companyId &&
    c.binding.connectionId === c.id && typeof c.verifiedAt === "string" && Number.isFinite(Date.parse(c.verifiedAt)));
}

export function connectionTransition({ connection, actor, nextState, expectedGeneration, now }) {
  if (!text(actor?.userId) || !["owner", "admin"].includes(actor.role)) return deny("forbidden_role");
  if (!validConnectionFence(connection)) return deny("invalid_connection_fence");
  if (actor.companyId !== connection.companyId) return deny("forbidden_company");
  if (expectedGeneration !== connection.generation) return deny("stale_connection_generation");
  if (connection.generation === Number.MAX_SAFE_INTEGER) return deny("generation_exhausted");
  if (!CONNECTION_TRANSITIONS[connection.state].includes(nextState)) return deny("invalid_connection_transition");
  if (!Number.isSafeInteger(now) || now <= 0 || now > 8640000000000000) return deny("invalid_time");
  return freezeCopy({ ok: true, next: { ...connection, state: nextState, generation: connection.generation + 1 },
    event: { companyId: connection.companyId, connectionId: connection.id, actorId: actor.userId,
      from: connection.state, to: nextState, generation: connection.generation + 1, occurredAt: now } });
}

/** All mutable authority facts must be checked in the SAME atomic fence domain. */
export function captureAuthorizationFence({ actor, principalGeneration, membershipGeneration, connection }) {
  if (!text(actor?.userId) || !text(actor.companyId) || !["owner", "admin"].includes(actor.role) ||
      !generation(principalGeneration) || !generation(membershipGeneration) ||
      (connection && (!validConnectionFence(connection) || connection.companyId !== actor.companyId))) return deny("authority_unverified");
  return freezeCopy({ ok: true, stamp: { userId: actor.userId, companyId: actor.companyId,
    principalGeneration, membershipGeneration, connectionId: connection?.id ?? null,
    connectionGeneration: connection?.generation ?? null, binding: connection?.binding ?? null } });
}

export function evaluateAuthorizationFence({ operation, captured, current }) {
  if (!["acquire", "authorize_send", "resume_preparation", "cancel", "recover", "reconcile", "project_audit", "complete_authorized"].includes(operation)) return deny("unsupported_operation");
  if (operation === "complete_authorized") return deny("trusted_completion_protocol_unimplemented");
  const validStamp = s => s && text(s.userId) && text(s.companyId) && generation(s.principalGeneration) && generation(s.membershipGeneration) &&
    (s.connectionId === null ? s.connectionGeneration === null && s.binding === null
      : text(s.connectionId) && generation(s.connectionGeneration) && validBinding(s.binding) &&
        s.binding.connectionId === s.connectionId && s.binding.companyId === s.companyId);
  if (!validStamp(captured) || !validStamp(current) ||
      (current.connectionId !== null && !Object.hasOwn(CONNECTION_TRANSITIONS, current.connectionState))) return deny("authority_unverified");
  if (captured.userId !== current.userId || captured.companyId !== current.companyId ||
      captured.principalGeneration !== current.principalGeneration || captured.membershipGeneration !== current.membershipGeneration) return deny("stale_membership_fence");
  if (captured.connectionId !== current.connectionId || captured.connectionGeneration !== current.connectionGeneration ||
      (captured.binding !== null && !sameBinding(captured.binding, current.binding))) return deny("stale_connection_fence");
  if (["acquire", "authorize_send", "resume_preparation"].includes(operation) &&
      (current.connectionId === null || current.connectionState !== "active")) return deny("connection_not_active");
  if (["acquire", "authorize_send", "resume_preparation"].includes(operation) &&
      [current.connectionGeneration, current.membershipGeneration, current.principalGeneration].includes(Number.MAX_SAFE_INTEGER)) return deny("generation_exhausted");
  return freezeCopy({ ok: true });
}

/** No evidence flag or synthetic test result can switch this preparation on. */
export function connectionFenceReadiness() {
  return freezeCopy({ activationAllowed: false, status: "BLOCKED", platform: "UNVERIFIED",
    requires: ["atomic_connection_membership_invoice_fence", "all_authority_and_invoice_writers_participate",
      "durable_generation_and_audit_schema_review", "independent_backend_concurrency_evidence",
      "trusted_server_activation_review", "separate_deployment_approval"] });
}
