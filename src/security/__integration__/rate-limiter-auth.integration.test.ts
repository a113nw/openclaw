/**
 * Integration test: auth rate limiter lifecycle.
 *
 * Verifies that `createAuthRateLimiter` works correctly with the auth
 * flow — tracking failures per IP, locking out after threshold, resetting
 * on success, and exempting loopback addresses.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAuthRateLimiter, type AuthRateLimiter } from "../../gateway/auth-rate-limit.js";

describe("rate limiter auth integration", () => {
  let limiter: AuthRateLimiter;

  beforeEach(() => {
    vi.useFakeTimers();
    limiter = createAuthRateLimiter({
      maxAttempts: 3,
      windowMs: 60_000,
      lockoutMs: 120_000,
      exemptLoopback: true,
    });
  });

  afterEach(() => {
    limiter.dispose();
    vi.useRealTimers();
  });

  it("allows requests under the failure threshold", () => {
    limiter.recordFailure("192.168.1.100");
    limiter.recordFailure("192.168.1.100");

    const check = limiter.check("192.168.1.100");
    expect(check.allowed).toBe(true);
    expect(check.remaining).toBe(1);
  });

  it("blocks after exceeding the threshold", () => {
    for (let i = 0; i < 3; i++) {
      limiter.recordFailure("192.168.1.200");
    }

    const check = limiter.check("192.168.1.200");
    expect(check.allowed).toBe(false);
    expect(check.retryAfterMs).toBeGreaterThan(0);
  });

  it("unblocks after the lockout period expires", () => {
    for (let i = 0; i < 3; i++) {
      limiter.recordFailure("192.168.1.201");
    }

    expect(limiter.check("192.168.1.201").allowed).toBe(false);

    // Advance past lockout
    vi.advanceTimersByTime(120_001);

    expect(limiter.check("192.168.1.201").allowed).toBe(true);
  });

  it("resets state for an IP on successful auth", () => {
    limiter.recordFailure("10.0.0.1");
    limiter.recordFailure("10.0.0.1");
    limiter.reset("10.0.0.1");

    // After reset, all 3 attempts should be available
    const check = limiter.check("10.0.0.1");
    expect(check.allowed).toBe(true);
    expect(check.remaining).toBe(3);
  });

  it("exempts loopback addresses from rate limiting", () => {
    for (let i = 0; i < 10; i++) {
      limiter.recordFailure("127.0.0.1");
    }

    // Loopback should never be blocked
    const check = limiter.check("127.0.0.1");
    expect(check.allowed).toBe(true);
  });

  it("exempts IPv6 loopback (::1)", () => {
    for (let i = 0; i < 10; i++) {
      limiter.recordFailure("::1");
    }
    expect(limiter.check("::1").allowed).toBe(true);
  });

  it("tracks different IPs independently", () => {
    for (let i = 0; i < 3; i++) {
      limiter.recordFailure("10.0.0.1");
    }

    expect(limiter.check("10.0.0.1").allowed).toBe(false);
    expect(limiter.check("10.0.0.2").allowed).toBe(true);
  });

  it("tracks different scopes independently for the same IP", () => {
    for (let i = 0; i < 3; i++) {
      limiter.recordFailure("10.0.0.3", "shared-secret");
    }

    expect(limiter.check("10.0.0.3", "shared-secret").allowed).toBe(false);
    expect(limiter.check("10.0.0.3", "device-token").allowed).toBe(true);
  });

  it("sliding window drops old attempts outside the window", () => {
    limiter.recordFailure("10.0.0.4");
    limiter.recordFailure("10.0.0.4");

    // Advance past the window so these 2 attempts expire
    vi.advanceTimersByTime(61_000);

    // Now only 1 failure in the current window
    limiter.recordFailure("10.0.0.4");
    const check = limiter.check("10.0.0.4");
    expect(check.allowed).toBe(true);
    expect(check.remaining).toBe(2);
  });

  it("prune removes stale entries from memory", () => {
    limiter.recordFailure("10.0.0.5");
    vi.advanceTimersByTime(61_000);
    limiter.prune();

    // After prune, the expired entry should be cleared
    expect(limiter.size()).toBe(0);
  });

  it("handles undefined IP gracefully", () => {
    // undefined IP should not throw
    limiter.recordFailure(undefined);
    const check = limiter.check(undefined);
    expect(check.allowed).toBe(true);
  });
});
