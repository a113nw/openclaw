import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createApprovalRateLimiter,
  type ApprovalRateLimiter,
} from "./approval-rate-limiter.js";

describe("createApprovalRateLimiter", () => {
  let limiter: ApprovalRateLimiter;

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    limiter?.dispose();
    vi.useRealTimers();
  });

  // -----------------------------------------------------------------------
  // Basic allow / block behavior
  // -----------------------------------------------------------------------

  it("allows requests under the limit", () => {
    limiter = createApprovalRateLimiter({ maxRequests: 3, windowMs: 60_000, cooldownMs: 60_000 });
    for (let i = 0; i < 3; i++) {
      const result = limiter.check("session-1");
      expect(result.allowed).toBe(true);
      limiter.record("session-1");
    }
  });

  it("blocks after maxRequests in window", () => {
    limiter = createApprovalRateLimiter({ maxRequests: 3, windowMs: 60_000, cooldownMs: 60_000 });
    for (let i = 0; i < 3; i++) {
      limiter.record("session-1");
    }
    const result = limiter.check("session-1");
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
    expect(result.retryAfterMs).toBeGreaterThan(0);
  });

  it("remaining count decrements correctly", () => {
    limiter = createApprovalRateLimiter({ maxRequests: 5, windowMs: 60_000, cooldownMs: 60_000 });
    expect(limiter.check("s").remaining).toBe(5);
    limiter.record("s");
    expect(limiter.check("s").remaining).toBe(4);
    limiter.record("s");
    expect(limiter.check("s").remaining).toBe(3);
  });

  // -----------------------------------------------------------------------
  // Cooldown behavior
  // -----------------------------------------------------------------------

  it("cooldown period enforced after limit exceeded", () => {
    limiter = createApprovalRateLimiter({ maxRequests: 2, windowMs: 60_000, cooldownMs: 30_000 });
    limiter.record("s");
    limiter.record("s");
    // Now in cooldown
    expect(limiter.check("s").allowed).toBe(false);
    // Advance partway through cooldown
    vi.advanceTimersByTime(15_000);
    expect(limiter.check("s").allowed).toBe(false);
    expect(limiter.check("s").retryAfterMs).toBeGreaterThan(0);
    expect(limiter.check("s").retryAfterMs).toBeLessThanOrEqual(15_000);
  });

  it("allows requests after cooldown expires", () => {
    limiter = createApprovalRateLimiter({ maxRequests: 2, windowMs: 60_000, cooldownMs: 30_000 });
    limiter.record("s");
    limiter.record("s");
    expect(limiter.check("s").allowed).toBe(false);
    // Advance past cooldown
    vi.advanceTimersByTime(30_001);
    const result = limiter.check("s");
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(2);
    expect(result.retryAfterMs).toBe(0);
  });

  // -----------------------------------------------------------------------
  // Sliding window
  // -----------------------------------------------------------------------

  it("sliding window: old requests expire, new ones allowed", () => {
    limiter = createApprovalRateLimiter({ maxRequests: 2, windowMs: 10_000, cooldownMs: 5_000 });
    limiter.record("s");
    // Advance so first request is still in window
    vi.advanceTimersByTime(4_000);
    limiter.record("s");
    // Now at limit, enters cooldown
    expect(limiter.check("s").allowed).toBe(false);
    // Advance past cooldown
    vi.advanceTimersByTime(5_001);
    // After cooldown, state is cleared — should be allowed again
    const result = limiter.check("s");
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(2);
  });

  // -----------------------------------------------------------------------
  // Session isolation
  // -----------------------------------------------------------------------

  it("different session keys are independent", () => {
    limiter = createApprovalRateLimiter({ maxRequests: 2, windowMs: 60_000, cooldownMs: 60_000 });
    limiter.record("session-a");
    limiter.record("session-a");
    expect(limiter.check("session-a").allowed).toBe(false);
    // session-b should be unaffected
    expect(limiter.check("session-b").allowed).toBe(true);
    expect(limiter.check("session-b").remaining).toBe(2);
  });

  // -----------------------------------------------------------------------
  // reset()
  // -----------------------------------------------------------------------

  it("reset() clears state for a session", () => {
    limiter = createApprovalRateLimiter({ maxRequests: 2, windowMs: 60_000, cooldownMs: 60_000 });
    limiter.record("s");
    limiter.record("s");
    expect(limiter.check("s").allowed).toBe(false);
    limiter.reset("s");
    const result = limiter.check("s");
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(2);
  });

  it("reset() does not affect other sessions", () => {
    limiter = createApprovalRateLimiter({ maxRequests: 2, windowMs: 60_000, cooldownMs: 60_000 });
    limiter.record("a");
    limiter.record("b");
    limiter.reset("a");
    expect(limiter.check("a").remaining).toBe(2);
    expect(limiter.check("b").remaining).toBe(1);
  });

  // -----------------------------------------------------------------------
  // prune()
  // -----------------------------------------------------------------------

  it("prune() removes expired entries", () => {
    limiter = createApprovalRateLimiter({ maxRequests: 5, windowMs: 10_000, cooldownMs: 10_000 });
    limiter.record("old-session");
    limiter.record("new-session");
    // Advance past the window for "old-session"
    vi.advanceTimersByTime(11_000);
    // Record again for new-session to keep it alive
    limiter.record("new-session");
    limiter.prune();
    expect(limiter.size()).toBe(1);
  });

  it("prune() keeps entries in cooldown", () => {
    limiter = createApprovalRateLimiter({ maxRequests: 1, windowMs: 10_000, cooldownMs: 30_000 });
    limiter.record("s");
    // Now in cooldown
    expect(limiter.check("s").allowed).toBe(false);
    vi.advanceTimersByTime(15_000);
    limiter.prune();
    // Still in cooldown — entry should be kept
    expect(limiter.size()).toBe(1);
  });

  it("prune() removes entries after cooldown expires", () => {
    limiter = createApprovalRateLimiter({ maxRequests: 1, windowMs: 10_000, cooldownMs: 5_000 });
    limiter.record("s");
    // Advance past cooldown
    vi.advanceTimersByTime(5_001);
    limiter.prune();
    expect(limiter.size()).toBe(0);
  });

  // -----------------------------------------------------------------------
  // size()
  // -----------------------------------------------------------------------

  it("size() returns correct count", () => {
    limiter = createApprovalRateLimiter();
    expect(limiter.size()).toBe(0);
    limiter.record("a");
    expect(limiter.size()).toBe(1);
    limiter.record("b");
    expect(limiter.size()).toBe(2);
    limiter.record("a"); // same key, no new entry
    expect(limiter.size()).toBe(2);
  });

  // -----------------------------------------------------------------------
  // dispose()
  // -----------------------------------------------------------------------

  it("dispose() clears all entries", () => {
    limiter = createApprovalRateLimiter();
    limiter.record("a");
    limiter.record("b");
    limiter.dispose();
    expect(limiter.size()).toBe(0);
  });

  // -----------------------------------------------------------------------
  // Default config values
  // -----------------------------------------------------------------------

  it("default config values work", () => {
    limiter = createApprovalRateLimiter();
    // Default: 5 requests in 60s window
    for (let i = 0; i < 5; i++) {
      expect(limiter.check("s").allowed).toBe(true);
      limiter.record("s");
    }
    // 6th request should be blocked
    expect(limiter.check("s").allowed).toBe(false);
  });

  // -----------------------------------------------------------------------
  // Edge cases
  // -----------------------------------------------------------------------

  it("record during cooldown is a no-op", () => {
    limiter = createApprovalRateLimiter({ maxRequests: 1, windowMs: 60_000, cooldownMs: 60_000 });
    limiter.record("s");
    expect(limiter.check("s").allowed).toBe(false);
    // Recording again during cooldown should not extend it
    limiter.record("s");
    expect(limiter.check("s").allowed).toBe(false);
  });

  it("check on unknown session returns full allowance", () => {
    limiter = createApprovalRateLimiter({ maxRequests: 5 });
    const result = limiter.check("never-seen");
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(5);
    expect(result.retryAfterMs).toBe(0);
  });

  // -----------------------------------------------------------------------
  // Integration-style: rapid-fire pattern
  // -----------------------------------------------------------------------

  it("simulates rapid-fire approval pattern", () => {
    limiter = createApprovalRateLimiter({ maxRequests: 3, windowMs: 10_000, cooldownMs: 5_000 });
    const results: boolean[] = [];
    // Fire 10 rapid requests
    for (let i = 0; i < 10; i++) {
      const check = limiter.check("flood-session");
      results.push(check.allowed);
      if (check.allowed) {
        limiter.record("flood-session");
      }
    }
    // First 3 should be allowed, rest blocked
    expect(results.filter(Boolean).length).toBe(3);
    expect(results.filter((r) => !r).length).toBe(7);
  });

  it("allows requests again after cooldown in rapid-fire scenario", () => {
    limiter = createApprovalRateLimiter({ maxRequests: 2, windowMs: 10_000, cooldownMs: 5_000 });
    // Exhaust limit
    limiter.record("s");
    limiter.record("s");
    expect(limiter.check("s").allowed).toBe(false);
    // Wait for cooldown
    vi.advanceTimersByTime(5_001);
    // Should be allowed again
    expect(limiter.check("s").allowed).toBe(true);
    limiter.record("s");
    expect(limiter.check("s").allowed).toBe(true);
    limiter.record("s");
    // Exhausted again
    expect(limiter.check("s").allowed).toBe(false);
  });
});
