import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NonceCache } from "./nonce-cache.js";

describe("NonceCache", () => {
  let cache: NonceCache;

  beforeEach(() => {
    vi.useFakeTimers();
    cache = new NonceCache(100);
  });

  afterEach(() => {
    cache.dispose();
    vi.useRealTimers();
  });

  it("accepts a fresh nonce", () => {
    expect(cache.add("nonce-1", 60_000)).toBe(true);
    expect(cache.size).toBe(1);
  });

  it("rejects a duplicate nonce within TTL", () => {
    expect(cache.add("nonce-1", 60_000)).toBe(true);
    expect(cache.add("nonce-1", 60_000)).toBe(false);
  });

  it("accepts a nonce again after TTL expires", () => {
    expect(cache.add("nonce-1", 1_000)).toBe(true);
    expect(cache.add("nonce-1", 1_000)).toBe(false);
    vi.advanceTimersByTime(1_001);
    expect(cache.add("nonce-1", 1_000)).toBe(true);
  });

  it("tracks multiple distinct nonces", () => {
    expect(cache.add("a", 60_000)).toBe(true);
    expect(cache.add("b", 60_000)).toBe(true);
    expect(cache.add("c", 60_000)).toBe(true);
    expect(cache.size).toBe(3);
    expect(cache.add("a", 60_000)).toBe(false);
    expect(cache.add("b", 60_000)).toBe(false);
  });

  it("prune removes expired entries", () => {
    cache.add("old", 1_000);
    cache.add("fresh", 60_000);
    vi.advanceTimersByTime(2_000);
    cache.prune();
    expect(cache.size).toBe(1);
    // "old" expired, "fresh" still alive
    expect(cache.add("old", 1_000)).toBe(true);
    expect(cache.add("fresh", 60_000)).toBe(false);
  });

  it("evicts oldest entries when at capacity", () => {
    const small = new NonceCache(5);
    for (let i = 0; i < 5; i++) {
      expect(small.add(`n-${i}`, 60_000)).toBe(true);
    }
    expect(small.size).toBe(5);
    // Adding one more should trigger eviction
    expect(small.add("overflow", 60_000)).toBe(true);
    expect(small.size).toBeLessThanOrEqual(5);
    small.dispose();
  });

  it("dispose clears all entries and stops timer", () => {
    cache.add("x", 60_000);
    cache.dispose();
    expect(cache.size).toBe(0);
  });

  it("handles empty nonce strings", () => {
    expect(cache.add("", 60_000)).toBe(true);
    expect(cache.add("", 60_000)).toBe(false);
  });

  it("handles very short TTL", () => {
    expect(cache.add("instant", 0)).toBe(true);
    // TTL of 0 means expires at now+0, which is <= now on next check
    vi.advanceTimersByTime(1);
    expect(cache.add("instant", 0)).toBe(true);
  });
});
