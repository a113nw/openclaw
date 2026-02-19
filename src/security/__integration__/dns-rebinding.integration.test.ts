/**
 * Integration test: DNS rebinding protection — host-validation + origin-check.
 *
 * Verifies that `checkBrowserOrigin` uses `isAllowedHostHeader` to reject
 * DNS rebinding attacks when origin and host are both loopback addresses.
 */
import { describe, expect, it } from "vitest";
import { checkBrowserOrigin } from "../../gateway/origin-check.js";

describe("DNS rebinding protection integration", () => {
  describe("loopback origin checks", () => {
    it("allows localhost Host with loopback origin", () => {
      const result = checkBrowserOrigin({
        requestHost: "localhost:18789",
        origin: "http://localhost:18789",
      });
      expect(result.ok).toBe(true);
    });

    it("allows 127.0.0.1 Host with 127.0.0.1 origin", () => {
      const result = checkBrowserOrigin({
        requestHost: "127.0.0.1:18789",
        origin: "http://127.0.0.1:18789",
      });
      expect(result.ok).toBe(true);
    });

    it("allows [::1] Host with ::1 origin", () => {
      const result = checkBrowserOrigin({
        requestHost: "[::1]:18789",
        origin: "http://[::1]:18789",
      });
      expect(result.ok).toBe(true);
    });

    it("rejects a public domain Host as DNS rebinding even when origin is loopback", () => {
      // Attacker makes DNS resolve evil.com -> 127.0.0.1. Browser sends
      // Origin: http://127.0.0.1 but Host: evil.com. The host validation
      // rejects the non-loopback Host header.
      const result = checkBrowserOrigin({
        requestHost: "evil.com:18789",
        origin: "http://127.0.0.1:18789",
      });
      // Either origin mismatch or host-not-allowed — should not be ok
      expect(result.ok).toBe(false);
    });

    it("rejects when origin hostname is not loopback even if host is", () => {
      const result = checkBrowserOrigin({
        requestHost: "localhost:18789",
        origin: "http://attacker.com:18789",
      });
      expect(result.ok).toBe(false);
    });
  });

  describe("non-loopback origin checks", () => {
    it("rejects origin when it does not match host and is not in allowlist", () => {
      const result = checkBrowserOrigin({
        requestHost: "myapp.example.com:18789",
        origin: "http://evil.com",
      });
      expect(result.ok).toBe(false);
    });

    it("allows origin when explicitly in allowedOrigins", () => {
      const result = checkBrowserOrigin({
        requestHost: "myapp.example.com",
        origin: "http://dashboard.example.com",
        allowedOrigins: ["http://dashboard.example.com"],
      });
      expect(result.ok).toBe(true);
    });
  });

  describe("missing/invalid origin", () => {
    it("rejects missing origin", () => {
      const result = checkBrowserOrigin({
        requestHost: "localhost:18789",
      });
      expect(result.ok).toBe(false);
    });

    it("rejects 'null' origin string", () => {
      const result = checkBrowserOrigin({
        requestHost: "localhost:18789",
        origin: "null",
      });
      expect(result.ok).toBe(false);
    });
  });
});
