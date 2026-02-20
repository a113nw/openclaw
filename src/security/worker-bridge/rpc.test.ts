import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RpcCorrelator } from "./rpc.js";

describe("RpcCorrelator", () => {
  let rpc: RpcCorrelator;

  beforeEach(() => {
    vi.useFakeTimers();
    rpc = new RpcCorrelator();
  });

  afterEach(() => {
    rpc.rejectAll(new Error("cleanup"));
    vi.useRealTimers();
  });

  it("creates request with unique reqId", () => {
    const req1 = rpc.createRequest(5000);
    const req2 = rpc.createRequest(5000);
    // Swallow rejections from cleanup
    req1.promise.catch(() => {});
    req2.promise.catch(() => {});
    expect(req1.reqId).not.toBe(req2.reqId);
    expect(rpc.size).toBe(2);
  });

  it("resolves request with value", async () => {
    const { reqId, promise } = rpc.createRequest(5000);
    rpc.resolve(reqId, { result: "ok" });
    const value = await promise;
    expect(value).toEqual({ result: "ok" });
    expect(rpc.size).toBe(0);
  });

  it("rejects request with error", async () => {
    const { reqId, promise } = rpc.createRequest(5000);
    rpc.reject(reqId, new Error("test error"));
    await expect(promise).rejects.toThrow("test error");
    expect(rpc.size).toBe(0);
  });

  it("times out after configured ms", async () => {
    const { promise } = rpc.createRequest(1000);
    vi.advanceTimersByTime(1001);
    await expect(promise).rejects.toThrow(/RPC timeout/);
    expect(rpc.size).toBe(0);
  });

  it("rejectAll rejects all pending requests", async () => {
    const { promise: p1 } = rpc.createRequest(5000);
    const { promise: p2 } = rpc.createRequest(5000);
    rpc.rejectAll(new Error("shutdown"));
    await expect(p1).rejects.toThrow("shutdown");
    await expect(p2).rejects.toThrow("shutdown");
    expect(rpc.size).toBe(0);
  });

  it("resolve returns false for unknown reqId", () => {
    expect(rpc.resolve("unknown", {})).toBe(false);
  });

  it("reject returns false for unknown reqId", () => {
    expect(rpc.reject("unknown", new Error("test"))).toBe(false);
  });

  it("resolve clears the timeout", async () => {
    const { reqId, promise } = rpc.createRequest(1000);
    rpc.resolve(reqId, "early");
    vi.advanceTimersByTime(2000);
    // Should have resolved without timeout error
    const value = await promise;
    expect(value).toBe("early");
  });
});
