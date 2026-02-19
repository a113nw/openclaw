import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Lazy-initialized per-process HMAC key.
 * Using HMAC ensures both inputs produce fixed-length (32-byte) digests,
 * eliminating the length oracle from the previous implementation.
 */
let hmacKey: Buffer | null = null;
function getHmacKey(): Buffer {
  if (!hmacKey) {
    hmacKey = randomBytes(32);
  }
  return hmacKey;
}

function hmacDigest(value: string): Buffer {
  return createHmac("sha256", getHmacKey()).update(value).digest();
}

export function safeEqualSecret(
  provided: string | undefined | null,
  expected: string | undefined | null,
): boolean {
  if (typeof provided !== "string" || typeof expected !== "string") {
    return false;
  }
  // HMAC both inputs to fixed-length 32-byte digests — no length oracle.
  const providedDigest = hmacDigest(provided);
  const expectedDigest = hmacDigest(expected);
  return timingSafeEqual(providedDigest, expectedDigest);
}
