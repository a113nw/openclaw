import { describe, expect, it } from "vitest";
import { isAllowedHostHeader } from "./host-validation.js";

describe("isAllowedHostHeader", () => {
  describe("loopback bind", () => {
    it("allows localhost", () => {
      expect(isAllowedHostHeader("localhost", true)).toBe(true);
    });

    it("allows 127.0.0.1", () => {
      expect(isAllowedHostHeader("127.0.0.1", true)).toBe(true);
    });

    it("allows ::1", () => {
      expect(isAllowedHostHeader("::1", true)).toBe(true);
    });

    it("allows [::1]", () => {
      expect(isAllowedHostHeader("[::1]", true)).toBe(true);
    });

    it("allows .ts.net hostnames (Tailscale)", () => {
      expect(isAllowedHostHeader("myhost.tail1234.ts.net", true)).toBe(true);
    });

    it("rejects a public domain (DNS rebinding)", () => {
      expect(isAllowedHostHeader("evil.com", true)).toBe(false);
    });

    it("rejects an IP that is not loopback", () => {
      expect(isAllowedHostHeader("192.168.1.1", true)).toBe(false);
    });

    it("rejects undefined host", () => {
      expect(isAllowedHostHeader(undefined, true)).toBe(false);
    });

    it("rejects empty string host", () => {
      expect(isAllowedHostHeader("", true)).toBe(false);
    });

    it("is case-insensitive", () => {
      expect(isAllowedHostHeader("LOCALHOST", true)).toBe(true);
      expect(isAllowedHostHeader("Localhost", true)).toBe(true);
    });

    it("trims whitespace", () => {
      expect(isAllowedHostHeader(" localhost ", true)).toBe(true);
    });

    it("allows hosts in the custom allowlist", () => {
      expect(isAllowedHostHeader("custom.local", true, ["custom.local"])).toBe(true);
    });

    it("rejects hosts not in allowlist when provided", () => {
      expect(isAllowedHostHeader("other.local", true, ["custom.local"])).toBe(false);
    });

    it("allowlist matching is case-insensitive", () => {
      expect(isAllowedHostHeader("Custom.Local", true, ["custom.local"])).toBe(true);
    });
  });

  describe("non-loopback bind", () => {
    it("allows any host header", () => {
      expect(isAllowedHostHeader("anything.com", false)).toBe(true);
    });

    it("allows undefined host", () => {
      expect(isAllowedHostHeader(undefined, false)).toBe(true);
    });

    it("allows empty host", () => {
      expect(isAllowedHostHeader("", false)).toBe(true);
    });
  });
});
