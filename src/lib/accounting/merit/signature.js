/**
 * Merit request signing.
 *
 * Documented scheme: base64(HMAC-SHA256(key = ApiKey, data = ApiId + timestamp + rawBody)),
 * passed as query parameters together with a UTC timestamp in yyyyMMddHHmmss.
 *
 * This module only builds values. It performs no network access and holds no credentials.
 */

import { createHmac } from "node:crypto";

/** Merit expects UTC timestamps in yyyyMMddHHmmss. */
export function meritTimestamp(date = new Date()) {
  const pad = (value) => String(value).padStart(2, "0");
  return [
    date.getUTCFullYear(),
    pad(date.getUTCMonth() + 1),
    pad(date.getUTCDate()),
    pad(date.getUTCHours()),
    pad(date.getUTCMinutes()),
    pad(date.getUTCSeconds()),
  ].join("");
}

/**
 * @param {{apiId: string, apiKey: string, timestamp: string, body?: string}} input
 * @returns {string} base64 signature
 */
export function signMeritRequest({ apiId, apiKey, timestamp, body = "" }) {
  if (!apiId || !apiKey || !timestamp) {
    throw new Error("apiId, apiKey and timestamp are required to sign a Merit request");
  }
  return createHmac("sha256", apiKey).update(`${apiId}${timestamp}${body}`, "utf8").digest("base64");
}

/**
 * Build the signed parameter set for a call. The signature is over the exact body string that
 * will be sent, so the body must be serialized once and reused.
 */
export function buildSignedRequest({ apiId, apiKey, body = "", date = new Date(), endpoint = "" }) {
  const timestamp = meritTimestamp(date);
  const signature = signMeritRequest({ apiId, apiKey, timestamp, body });

  return {
    endpoint,
    body,
    params: { apiId, timestamp, signature },
    query: `apiId=${encodeURIComponent(apiId)}&timestamp=${encodeURIComponent(timestamp)}&signature=${encodeURIComponent(signature)}`,
  };
}