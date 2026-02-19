import { describe, expect, it } from "vitest";
import { safeEqualSecret } from "./secret-equal.js";

describe("safeEqualSecret", () => {
  it("returns true for identical strings", () => {
    expect(safeEqualSecret("abc123", "abc123")).toBe(true);
  });

  it("returns false for different strings", () => {
    expect(safeEqualSecret("abc123", "xyz789")).toBe(false);
  });

  it("returns false when provided is undefined", () => {
    expect(safeEqualSecret(undefined, "token")).toBe(false);
  });

  it("returns false when expected is undefined", () => {
    expect(safeEqualSecret("token", undefined)).toBe(false);
  });

  it("returns false when provided is null", () => {
    expect(safeEqualSecret(null, "token")).toBe(false);
  });

  it("returns false when expected is null", () => {
    expect(safeEqualSecret("token", null)).toBe(false);
  });

  it("returns false when both are null", () => {
    expect(safeEqualSecret(null, null)).toBe(false);
  });

  it("returns false when both are undefined", () => {
    expect(safeEqualSecret(undefined, undefined)).toBe(false);
  });

  it("returns true for empty strings", () => {
    expect(safeEqualSecret("", "")).toBe(true);
  });

  it("returns false for different-length strings without leaking length", () => {
    // The HMAC approach means different lengths still produce 32-byte digests
    expect(safeEqualSecret("short", "a-much-longer-token-value")).toBe(false);
  });

  it("handles long tokens correctly", () => {
    const long = "sk-" + "a".repeat(200);
    expect(safeEqualSecret(long, long)).toBe(true);
    expect(safeEqualSecret(long, long + "x")).toBe(false);
  });

  it("is consistent across multiple calls", () => {
    // The lazy HMAC key is stable within a process
    expect(safeEqualSecret("token-a", "token-a")).toBe(true);
    expect(safeEqualSecret("token-a", "token-a")).toBe(true);
    expect(safeEqualSecret("token-a", "token-b")).toBe(false);
    expect(safeEqualSecret("token-a", "token-b")).toBe(false);
  });
});
