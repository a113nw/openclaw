/**
 * Request/response correlation helper for Worker IPC.
 */
import crypto from "node:crypto";

export type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

export class RpcCorrelator {
  private pending = new Map<string, PendingRequest>();

  createRequest(timeoutMs: number): { reqId: string; promise: Promise<unknown> } {
    const reqId = crypto.randomUUID();
    const promise = new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(reqId);
        reject(new Error(`RPC timeout after ${timeoutMs}ms (reqId: ${reqId})`));
      }, timeoutMs);
      this.pending.set(reqId, { resolve, reject, timer });
    });
    return { reqId, promise };
  }

  resolve(reqId: string, value: unknown): boolean {
    const entry = this.pending.get(reqId);
    if (!entry) return false;
    clearTimeout(entry.timer);
    this.pending.delete(reqId);
    entry.resolve(value);
    return true;
  }

  reject(reqId: string, error: Error): boolean {
    const entry = this.pending.get(reqId);
    if (!entry) return false;
    clearTimeout(entry.timer);
    this.pending.delete(reqId);
    entry.reject(error);
    return true;
  }

  rejectAll(error: Error): void {
    for (const [reqId, entry] of this.pending) {
      clearTimeout(entry.timer);
      entry.reject(error);
    }
    this.pending.clear();
  }

  get size(): number {
    return this.pending.size;
  }
}
