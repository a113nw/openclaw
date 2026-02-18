/**
 * Memory-bounded nonce cache for replay protection.
 *
 * Tracks recently-seen nonce values with TTL-based expiry so that
 * replayed device authentication signatures are rejected within
 * the allowed clock-skew window.
 */

const DEFAULT_MAX_ENTRIES = 10_000;
const PRUNE_THRESHOLD_RATIO = 0.9; // prune when 90% full

export class NonceCache {
  private readonly entries = new Map<string, number>();
  private readonly maxEntries: number;
  private pruneTimer: ReturnType<typeof setInterval> | null = null;

  constructor(maxEntries = DEFAULT_MAX_ENTRIES) {
    this.maxEntries = maxEntries;
    // Periodic pruning every 60s to reclaim memory from expired entries.
    this.pruneTimer = setInterval(() => this.prune(), 60_000);
    if (this.pruneTimer.unref) {
      this.pruneTimer.unref();
    }
  }

  /**
   * Attempt to add a nonce. Returns `true` if the nonce is fresh
   * (not seen before or expired). Returns `false` if it was already
   * recorded (replay detected).
   */
  add(nonce: string, ttlMs: number): boolean {
    this.pruneIfNeeded();
    const now = Date.now();
    const existing = this.entries.get(nonce);
    if (existing !== undefined && existing > now) {
      // Still within TTL — replay.
      return false;
    }
    this.entries.set(nonce, now + ttlMs);
    return true;
  }

  /** Remove expired entries. */
  prune(): void {
    const now = Date.now();
    for (const [key, expiresAt] of this.entries) {
      if (expiresAt <= now) {
        this.entries.delete(key);
      }
    }
  }

  /** Number of tracked nonces. */
  get size(): number {
    return this.entries.size;
  }

  /** Dispose the cache and cancel the periodic pruning timer. */
  dispose(): void {
    if (this.pruneTimer) {
      clearInterval(this.pruneTimer);
      this.pruneTimer = null;
    }
    this.entries.clear();
  }

  private pruneIfNeeded(): void {
    if (this.entries.size >= this.maxEntries * PRUNE_THRESHOLD_RATIO) {
      this.prune();
    }
    // If still at capacity after pruning, evict oldest entries.
    if (this.entries.size >= this.maxEntries) {
      const toRemove = this.entries.size - this.maxEntries + 1;
      let removed = 0;
      for (const key of this.entries.keys()) {
        if (removed >= toRemove) break;
        this.entries.delete(key);
        removed++;
      }
    }
  }
}
