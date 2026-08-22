import crypto from "crypto";

/**
 * HMAC verification for the BBPS CRM outbox dispatcher.
 *
 * Mirrors the scheme described in SYSTEM_INTEGRATION_SPEC.md §4:
 *   signature = "v1=" + hex(HMAC_SHA256(secret, `${timestamp}.${rawBody}`))
 * checked against the request's X-Timestamp / X-Signature headers, on the
 * exact raw request body bytes (not the re-serialized JSON).
 */

export const MAX_CLOCK_SKEW_SECONDS = 300;

/**
 * key id -> secret. Only "k1" exists today; new entries here are how a
 * future secret rotation gets supported without touching the route or the
 * signature-checking logic itself.
 */
const KEY_SECRETS: Record<string, string | undefined> = {
  k1: process.env.BBPS_WEBHOOK_SECRET_K1,
};

export function getSecretForKeyId(keyId: string): string | undefined {
  const secret = KEY_SECRETS[keyId];
  return secret && secret.length > 0 ? secret : undefined;
}

export type VerifyFailureReason =
  | "invalid_timestamp"
  | "timestamp_out_of_range"
  | "invalid_signature_format"
  | "signature_mismatch";

export type VerifyResult = { ok: true } | { ok: false; reason: VerifyFailureReason };

/**
 * @param secret    the resolved secret for the request's X-Signature-Key-Id
 * @param timestamp the raw X-Timestamp header value (unix seconds, as string)
 * @param rawBody   the exact request body bytes as received (pre-JSON.parse)
 * @param received  the raw X-Signature header value, e.g. "v1=<hex>"
 */
export function verifyPayload(
  secret: string,
  timestamp: string,
  rawBody: string,
  received: string
): VerifyResult {
  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) {
    return { ok: false, reason: "invalid_timestamp" };
  }

  // Two-way skew check: catches both a stale/replayed request and a
  // clock that is wrong in the future direction.
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSeconds - ts) > MAX_CLOCK_SKEW_SECONDS) {
    return { ok: false, reason: "timestamp_out_of_range" };
  }

  if (!received.startsWith("v1=")) {
    return { ok: false, reason: "invalid_signature_format" };
  }
  const providedHex = received.slice("v1=".length);

  const expectedHex = crypto
    .createHmac("sha256", secret)
    .update(`${timestamp}.${rawBody}`)
    .digest("hex");

  let providedBuf: Buffer;
  let expectedBuf: Buffer;
  try {
    providedBuf = Buffer.from(providedHex, "hex");
    expectedBuf = Buffer.from(expectedHex, "hex");
  } catch {
    return { ok: false, reason: "invalid_signature_format" };
  }

  // timingSafeEqual throws on mismatched lengths rather than returning
  // false, and it is the ONLY comparison allowed here -- never `===` on
  // the hex strings, which would leak timing information byte by byte.
  if (providedBuf.length !== expectedBuf.length) {
    return { ok: false, reason: "signature_mismatch" };
  }
  if (!crypto.timingSafeEqual(providedBuf, expectedBuf)) {
    return { ok: false, reason: "signature_mismatch" };
  }

  return { ok: true };
}
