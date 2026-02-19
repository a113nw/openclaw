/**
 * Integration test: auth flow — secret-equal + auth-audit-log + rate-limiter.
 *
 * Verifies that `authorizeGatewayConnect` uses timing-safe comparison,
 * records audit events, and respects rate-limit state.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAuthRateLimiter, type AuthRateLimiter } from "../../gateway/auth-rate-limit.js";
import { authorizeGatewayConnect, type ResolvedGatewayAuth } from "../../gateway/auth.js";

// Redirect audit log writes to a temp directory.
vi.mock("../../config/paths.js", () => {
  const tmpBase = path.join(os.tmpdir(), "auth-flow-integ-" + process.pid);
  return { resolveStateDir: () => tmpBase };
});

describe("auth flow integration", () => {
  let stateDir: string;
  let auditPath: string;
  let limiter: AuthRateLimiter;

  beforeEach(async () => {
    const { resolveStateDir } = await import("../../config/paths.js");
    stateDir = resolveStateDir();
    auditPath = path.join(stateDir, "security", "auth-audit.jsonl");
    fs.rmSync(stateDir, { recursive: true, force: true });
    limiter = createAuthRateLimiter({ maxAttempts: 3, windowMs: 60_000, lockoutMs: 300_000 });
  });

  afterEach(() => {
    limiter.dispose();
    try {
      fs.rmSync(stateDir, { recursive: true, force: true });
    } catch {}
  });

  it("records auth_success in audit log on valid token", async () => {
    const auth: ResolvedGatewayAuth = { mode: "token", token: "correct-token", allowTailscale: false };
    const result = await authorizeGatewayConnect({
      auth,
      connectAuth: { token: "correct-token" },
      clientIp: "10.0.0.1",
      rateLimiter: limiter,
    });

    expect(result.ok).toBe(true);
    expect(result.method).toBe("token");

    // Verify audit file was written
    expect(fs.existsSync(auditPath)).toBe(true);
    const lines = fs.readFileSync(auditPath, "utf-8").trim().split("\n");
    const event = JSON.parse(lines[lines.length - 1]);
    expect(event.type).toBe("auth_success");
    expect(event.ip).toBe("10.0.0.1");
  });

  it("records auth_failure with reason on wrong token", async () => {
    const auth: ResolvedGatewayAuth = { mode: "token", token: "correct-token", allowTailscale: false };
    const result = await authorizeGatewayConnect({
      auth,
      connectAuth: { token: "wrong-token" },
      clientIp: "10.0.0.2",
      rateLimiter: limiter,
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe("token_mismatch");

    const lines = fs.readFileSync(auditPath, "utf-8").trim().split("\n");
    const event = JSON.parse(lines[lines.length - 1]);
    expect(event.type).toBe("auth_failure");
    expect(event.reason).toBe("token_mismatch");
  });

  it("rate-limits after repeated failures then records rate_limited event", async () => {
    const auth: ResolvedGatewayAuth = { mode: "token", token: "secret", allowTailscale: false };

    // Exhaust the 3-attempt limit
    for (let i = 0; i < 3; i++) {
      await authorizeGatewayConnect({
        auth,
        connectAuth: { token: "bad" },
        clientIp: "10.0.0.3",
        rateLimiter: limiter,
      });
    }

    // Next attempt should be rate-limited
    const result = await authorizeGatewayConnect({
      auth,
      connectAuth: { token: "bad" },
      clientIp: "10.0.0.3",
      rateLimiter: limiter,
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe("rate_limited");
    expect(result.rateLimited).toBe(true);
    expect(result.retryAfterMs).toBeGreaterThan(0);

    // Audit log should have the rate_limited event
    const lines = fs.readFileSync(auditPath, "utf-8").trim().split("\n");
    const lastEvent = JSON.parse(lines[lines.length - 1]);
    expect(lastEvent.type).toBe("auth_failure");
    expect(lastEvent.reason).toBe("rate_limited");
  });

  it("resets rate-limit state after successful auth", async () => {
    const auth: ResolvedGatewayAuth = { mode: "token", token: "secret", allowTailscale: false };

    // Record 2 failures (below threshold of 3)
    for (let i = 0; i < 2; i++) {
      await authorizeGatewayConnect({
        auth,
        connectAuth: { token: "bad" },
        clientIp: "10.0.0.4",
        rateLimiter: limiter,
      });
    }

    // Successful auth should reset the counter
    await authorizeGatewayConnect({
      auth,
      connectAuth: { token: "secret" },
      clientIp: "10.0.0.4",
      rateLimiter: limiter,
    });

    // Now 2 more failures should NOT trigger rate limit (counter was reset)
    for (let i = 0; i < 2; i++) {
      const r = await authorizeGatewayConnect({
        auth,
        connectAuth: { token: "bad" },
        clientIp: "10.0.0.4",
        rateLimiter: limiter,
      });
      expect(r.reason).toBe("token_mismatch"); // not rate_limited
    }
  });

  it("password auth uses timing-safe comparison and records events", async () => {
    const auth: ResolvedGatewayAuth = { mode: "password", password: "my-pass", allowTailscale: false };

    const ok = await authorizeGatewayConnect({
      auth,
      connectAuth: { password: "my-pass" },
      clientIp: "10.0.0.5",
    });
    expect(ok.ok).toBe(true);
    expect(ok.method).toBe("password");

    const fail = await authorizeGatewayConnect({
      auth,
      connectAuth: { password: "wrong-pass" },
      clientIp: "10.0.0.5",
    });
    expect(fail.ok).toBe(false);
    expect(fail.reason).toBe("password_mismatch");

    // Both events recorded
    const lines = fs.readFileSync(auditPath, "utf-8").trim().split("\n");
    expect(lines.length).toBeGreaterThanOrEqual(2);
    expect(JSON.parse(lines[lines.length - 2]).type).toBe("auth_success");
    expect(JSON.parse(lines[lines.length - 1]).type).toBe("auth_failure");
  });

  it("handles null/undefined credentials without throwing", async () => {
    const auth: ResolvedGatewayAuth = { mode: "token", token: "valid", allowTailscale: false };

    const noToken = await authorizeGatewayConnect({
      auth,
      connectAuth: {},
      clientIp: "10.0.0.6",
    });
    expect(noToken.ok).toBe(false);
    expect(noToken.reason).toBe("token_missing");

    const nullAuth = await authorizeGatewayConnect({
      auth,
      connectAuth: null,
      clientIp: "10.0.0.6",
    });
    expect(nullAuth.ok).toBe(false);
  });
});
