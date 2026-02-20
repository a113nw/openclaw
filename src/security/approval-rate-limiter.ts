/**
 * Per-session sliding-window rate limiter for exec approval requests.
 *
 * Prevents a runaway or malicious agent from flooding the user with
 * rapid-fire approval prompts. When the rate limit is exceeded, the
 * gateway auto-resolves the approval as `null` (timeout) without
 * broadcasting to the user, letting the existing `askFallback` policy
 * handle the security decision.
 *
 * Design follows the same pattern as `auth-rate-limit.ts`:
 * - Pure in-memory Map, no external dependencies
 * - Periodic prune to avoid unbounded growth
 * - Side-effect-free: callers create an instance via
 *   {@link createApprovalRateLimiter} and pass it where needed
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ApprovalRateLimitConfig {
  /** Maximum approval requests per session within the window.  @default 5 */
  maxRequests?: number;
  /** Sliding window duration in milliseconds.  @default 60_000 (1 min) */
  windowMs?: number;
  /** Cooldown duration in milliseconds after the limit is exceeded.  @default 60_000 (1 min) */
  cooldownMs?: number;
}

export interface ApprovalRateLimitResult {
  /** Whether the approval request is allowed to proceed. */
  allowed: boolean;
  /** Number of remaining requests before the limit is reached. */
  remaining: number;
  /** Milliseconds until the cooldown expires (0 when not in cooldown). */
  retryAfterMs: number;
}

export interface ApprovalRateLimiter {
  /** Check whether `sessionKey` is currently allowed to make an approval request. */
  check(sessionKey: string): ApprovalRateLimitResult;
  /** Record an approval request for `sessionKey`. */
  record(sessionKey: string): void;
  /** Reset the rate-limit state for `sessionKey`. */
  reset(sessionKey: string): void;
  /** Return the current number of tracked session keys. */
  size(): number;
  /** Remove expired entries and release memory. */
  prune(): void;
  /** Dispose the limiter and cancel periodic cleanup timers. */
  dispose(): void;
}

// ---------------------------------------------------------------------------
// Internal entry type
// ---------------------------------------------------------------------------

interface RateLimitEntry {
  /** Timestamps (epoch ms) of recent approval requests inside the window. */
  requests: number[];
  /** If set, requests from this session are blocked until this epoch-ms instant. */
  cooldownUntil?: number;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_MAX_REQUESTS = 5;
const DEFAULT_WINDOW_MS = 60_000; // 1 minute
const DEFAULT_COOLDOWN_MS = 60_000; // 1 minute
const PRUNE_INTERVAL_MS = 60_000; // prune stale entries every minute

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

export function createApprovalRateLimiter(
  config?: ApprovalRateLimitConfig,
): ApprovalRateLimiter {
  const maxRequests = config?.maxRequests ?? DEFAULT_MAX_REQUESTS;
  const windowMs = config?.windowMs ?? DEFAULT_WINDOW_MS;
  const cooldownMs = config?.cooldownMs ?? DEFAULT_COOLDOWN_MS;

  const entries = new Map<string, RateLimitEntry>();

  // Periodic cleanup to avoid unbounded map growth.
  const pruneTimer = setInterval(() => prune(), PRUNE_INTERVAL_MS);
  // Allow the Node.js process to exit even if the timer is still active.
  if (pruneTimer.unref) {
    pruneTimer.unref();
  }

  function slideWindow(entry: RateLimitEntry, now: number): void {
    const cutoff = now - windowMs;
    entry.requests = entry.requests.filter((ts) => ts > cutoff);
  }

  function check(sessionKey: string): ApprovalRateLimitResult {
    const now = Date.now();
    const entry = entries.get(sessionKey);

    if (!entry) {
      return { allowed: true, remaining: maxRequests, retryAfterMs: 0 };
    }

    // Still in cooldown?
    if (entry.cooldownUntil && now < entry.cooldownUntil) {
      return {
        allowed: false,
        remaining: 0,
        retryAfterMs: entry.cooldownUntil - now,
      };
    }

    // Cooldown expired — clear it.
    if (entry.cooldownUntil && now >= entry.cooldownUntil) {
      entry.cooldownUntil = undefined;
      entry.requests = [];
    }

    slideWindow(entry, now);
    const remaining = Math.max(0, maxRequests - entry.requests.length);
    return { allowed: remaining > 0, remaining, retryAfterMs: 0 };
  }

  function record(sessionKey: string): void {
    const now = Date.now();
    let entry = entries.get(sessionKey);

    if (!entry) {
      entry = { requests: [] };
      entries.set(sessionKey, entry);
    }

    // If currently in cooldown, do nothing (already blocked).
    if (entry.cooldownUntil && now < entry.cooldownUntil) {
      return;
    }

    slideWindow(entry, now);
    entry.requests.push(now);

    if (entry.requests.length >= maxRequests) {
      entry.cooldownUntil = now + cooldownMs;
    }
  }

  function reset(sessionKey: string): void {
    entries.delete(sessionKey);
  }

  function prune(): void {
    const now = Date.now();
    for (const [key, entry] of entries) {
      // If in cooldown, keep the entry until it expires.
      if (entry.cooldownUntil && now < entry.cooldownUntil) {
        continue;
      }
      // Clear expired cooldown
      if (entry.cooldownUntil && now >= entry.cooldownUntil) {
        entry.cooldownUntil = undefined;
        entry.requests = [];
      }
      slideWindow(entry, now);
      if (entry.requests.length === 0) {
        entries.delete(key);
      }
    }
  }

  function size(): number {
    return entries.size;
  }

  function dispose(): void {
    clearInterval(pruneTimer);
    entries.clear();
  }

  return { check, record, reset, size, prune, dispose };
}
