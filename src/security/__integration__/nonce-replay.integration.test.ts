/**
 * Integration test: nonce replay protection.
 *
 * Verifies the nonce-cache + SHA-256 hashing pattern used in
 * message-handler.ts to prevent device signature replay attacks.
 */
import crypto from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NonceCache } from "../nonce-cache.js";

// Mirrors the pattern in message-handler.ts lines 570-589
function computeSignatureNonce(signature: string): string {
  return crypto.createHash("sha256").update(signature).digest("hex");
}

describe("nonce replay protection integration", () => {
  const DEVICE_SIGNATURE_SKEW_MS = 10 * 60 * 1000; // 10 minutes
  let cache: NonceCache;

  beforeEach(() => {
    vi.useFakeTimers();
    cache = new NonceCache();
  });

  afterEach(() => {
    cache.dispose();
    vi.useRealTimers();
  });

  it("accepts a fresh device signature", () => {
    const signature = "device-sig-payload-" + Date.now();
    const nonce = computeSignatureNonce(signature);
    expect(cache.add(nonce, DEVICE_SIGNATURE_SKEW_MS * 2)).toBe(true);
  });

  it("rejects a replayed device signature within the TTL window", () => {
    const signature = "device-sig-payload-abc123";
    const nonce = computeSignatureNonce(signature);

    // First use accepted
    expect(cache.add(nonce, DEVICE_SIGNATURE_SKEW_MS * 2)).toBe(true);
    // Replay within the 20-minute window rejected
    vi.advanceTimersByTime(5 * 60 * 1000); // 5 minutes later
    expect(cache.add(nonce, DEVICE_SIGNATURE_SKEW_MS * 2)).toBe(false);
  });

  it("accepts the same signature after the TTL window expires", () => {
    const signature = "device-sig-payload-xyz";
    const nonce = computeSignatureNonce(signature);

    expect(cache.add(nonce, DEVICE_SIGNATURE_SKEW_MS * 2)).toBe(true);
    // Advance past the 20-minute TTL
    vi.advanceTimersByTime(DEVICE_SIGNATURE_SKEW_MS * 2 + 1);
    expect(cache.add(nonce, DEVICE_SIGNATURE_SKEW_MS * 2)).toBe(true);
  });

  it("independently tracks multiple different signatures", () => {
    const sig1 = computeSignatureNonce("device-A-signature");
    const sig2 = computeSignatureNonce("device-B-signature");

    expect(cache.add(sig1, DEVICE_SIGNATURE_SKEW_MS * 2)).toBe(true);
    expect(cache.add(sig2, DEVICE_SIGNATURE_SKEW_MS * 2)).toBe(true);

    // Both are now tracked
    expect(cache.add(sig1, DEVICE_SIGNATURE_SKEW_MS * 2)).toBe(false);
    expect(cache.add(sig2, DEVICE_SIGNATURE_SKEW_MS * 2)).toBe(false);
  });

  it("different signatures produce different nonces (SHA-256 collision resistance)", () => {
    const nonce1 = computeSignatureNonce("payload-1");
    const nonce2 = computeSignatureNonce("payload-2");
    expect(nonce1).not.toBe(nonce2);
    expect(nonce1).toHaveLength(64); // hex-encoded SHA-256
  });

  it("handles high volume without exceeding cache capacity", () => {
    // Default NonceCache max is 10,000
    for (let i = 0; i < 10_000; i++) {
      const nonce = computeSignatureNonce(`sig-${i}`);
      expect(cache.add(nonce, DEVICE_SIGNATURE_SKEW_MS * 2)).toBe(true);
    }
    expect(cache.size).toBeLessThanOrEqual(10_000);

    // Adding one more triggers eviction, not an error
    const overflow = computeSignatureNonce("sig-overflow");
    expect(cache.add(overflow, DEVICE_SIGNATURE_SKEW_MS * 2)).toBe(true);
    expect(cache.size).toBeLessThanOrEqual(10_000);
  });

  it("prune clears expired entries while keeping fresh ones", () => {
    const oldSig = computeSignatureNonce("old-signature");
    cache.add(oldSig, 1_000); // 1 second TTL

    const freshSig = computeSignatureNonce("fresh-signature");
    cache.add(freshSig, DEVICE_SIGNATURE_SKEW_MS * 2);

    vi.advanceTimersByTime(2_000);
    cache.prune();

    // Old expired, fresh still tracked
    expect(cache.add(oldSig, 1_000)).toBe(true); // can re-add
    expect(cache.add(freshSig, DEVICE_SIGNATURE_SKEW_MS * 2)).toBe(false); // still tracked
  });
});
