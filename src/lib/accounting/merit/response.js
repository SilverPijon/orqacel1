/**
 * Merit response classification.
 *
 * The critical rule from the P0 audit: a 200 response is NOT proof of success. Merit can answer
 * 200 with a stacktrace body, and a 5xx or a timeout can arrive after the document was created.
 * Anything that is not an unambiguous success becomes either a rejection (nothing was created)
 * or an ambiguous outcome that must be reconciled — never a retry.
 */

export const OUTCOMES = Object.freeze({
  CONFIRMED: "confirmed",
  REJECTED: "rejected",
  RETRYABLE: "retryable",
  AMBIGUOUS: "ambiguous",
});

export const RESPONSE_CODES = Object.freeze({
  CONFIRMED: "confirmed",
  LICENCE_REQUIRED: "licence_required",
  AUTH_FAILED: "auth_failed",
  PAYLOAD_REJECTED: "payload_rejected",
  RATE_LIMITED: "rate_limited",
  STACKTRACE_BODY: "stacktrace_body",
  INVALID_BODY: "invalid_body",
  EMPTY_BODY: "empty_body",
  SERVER_ERROR: "server_error",
  TIMEOUT_UNKNOWN_COMMIT: "timeout_unknown_commit",
  NETWORK_ERROR: "network_error",
});

function result(outcome, code, extra = {}) {
  return { outcome, code, document: null, retryAfterMs: null, detail: null, ...extra };
}

function parseJson(text) {
  if (typeof text !== "string" || !text.trim()) return { ok: false, reason: "empty" };
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false, reason: "unparsable" };
  }
}

function retryAfterMs(headers) {
  const header = headers?.["retry-after"] ?? headers?.["Retry-After"];
  if (!header) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  return null;
}

/**
 * Classify an HTTP response from Merit.
 *
 * @param {{status: number, bodyText?: string, headers?: object}} response
 */
export function classifyMeritResponse(response = {}) {
  const status = Number(response.status);
  const bodyText = response.bodyText ?? response.body ?? "";

  if (status >= 200 && status < 300) {
    const parsed = parseJson(bodyText);

    if (!parsed.ok) {
      // 200 with something that is not a JSON document: Merit's documented stacktrace case.
      // The request may or may not have committed — treat as ambiguous, never as success.
      return result(OUTCOMES.AMBIGUOUS, parsed.reason === "empty" ? RESPONSE_CODES.EMPTY_BODY : RESPONSE_CODES.STACKTRACE_BODY, {
        detail: "the provider returned a success status without a valid JSON document",
      });
    }

    const value = parsed.value;
    if (value && typeof value === "object" && !Array.isArray(value) && (value.InvoiceId || value.SIHId)) {
      return result(OUTCOMES.CONFIRMED, RESPONSE_CODES.CONFIRMED, {
        document: {
          id: value.InvoiceId || value.SIHId,
          number: value.InvoiceNo ?? null,
          customer_id: value.CustomerId ?? null,
          ref_no: value.RefNo ?? null,
        },
      });
    }

    return result(OUTCOMES.AMBIGUOUS, RESPONSE_CODES.INVALID_BODY, {
      detail: "the provider returned a success status without an invoice identifier",
    });
  }

  if (status === 400) {
    // Documented as a payload problem: nothing was created.
    return result(OUTCOMES.REJECTED, RESPONSE_CODES.PAYLOAD_REJECTED, { detail: String(bodyText).slice(0, 300) });
  }

  if (status === 401 || status === 403) {
    const body = String(bodyText).toLowerCase();
    const licence = body.includes("wronglicense");
    return result(OUTCOMES.REJECTED, licence ? RESPONSE_CODES.LICENCE_REQUIRED : RESPONSE_CODES.AUTH_FAILED, {
      detail: licence
        ? "the provider company does not have the licence required for API access"
        : "the provider rejected the credentials",
    });
  }

  if (status === 404) {
    return result(OUTCOMES.REJECTED, RESPONSE_CODES.PAYLOAD_REJECTED, { detail: "the provider endpoint was not found" });
  }

  if (status === 408) {
    return result(OUTCOMES.AMBIGUOUS, RESPONSE_CODES.TIMEOUT_UNKNOWN_COMMIT, {
      detail: "the provider timed out; the document may exist",
    });
  }

  if (status === 429) {
    return result(OUTCOMES.RETRYABLE, RESPONSE_CODES.RATE_LIMITED, { retryAfterMs: retryAfterMs(response.headers) });
  }

  if (status >= 500) {
    // Could have committed before failing. Never retried blindly.
    return result(OUTCOMES.AMBIGUOUS, RESPONSE_CODES.SERVER_ERROR, {
      detail: `the provider returned ${status}; the document may exist`,
    });
  }

  return result(OUTCOMES.AMBIGUOUS, RESPONSE_CODES.INVALID_BODY, { detail: `unexpected status ${status}` });
}

/** A transport failure (no HTTP response at all). */
export function classifyTransportError(error = {}) {
  const name = String(error.name || "");
  const code = String(error.code || "").toUpperCase();

  if (name === "TimeoutError" || name === "AbortError" || code === "ETIMEDOUT" || code === "UND_ERR_CONNECT_TIMEOUT") {
    return result(OUTCOMES.AMBIGUOUS, RESPONSE_CODES.TIMEOUT_UNKNOWN_COMMIT, {
      detail: "the request timed out; the document may have been created",
    });
  }

  return result(OUTCOMES.AMBIGUOUS, RESPONSE_CODES.NETWORK_ERROR, {
    detail: "the request failed before a response was received; the document may have been created",
  });
}