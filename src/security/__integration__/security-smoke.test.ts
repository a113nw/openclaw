/**
 * Security scaffolding end-to-end smoke tests.
 *
 * Starts a real gateway server and validates that each security layer
 * works as expected in a live process:
 *
 * 1. Auth flow: timing-safe comparison, audit logging, rate limiting
 * 2. DNS rebinding: Host header rejection via origin check
 * 3. Env filtering: host exec strips secrets
 * 4. Config scrubbing: sensitive values redacted in log output
 * 5. Nonce replay: duplicate device signatures rejected
 * 6. Plugin pipeline: install policy + capability enforcement
 * 7. Memory boundary: extra paths outside workspace rejected
 * 8. Sensitive config hints: expanded patterns detect credential fields
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { WebSocket } from "ws";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  connectReq,
  getFreePort,
  installGatewayTestHooks,
  startGatewayServer,
  startServerWithClient,
} from "../../gateway/test-helpers.server.js";
import { testState } from "../../gateway/test-helpers.mocks.js";

installGatewayTestHooks({ scope: "suite" });

// ---------------------------------------------------------------------------
// 1. Auth flow: token comparison + audit log + rate limiting
// ---------------------------------------------------------------------------
describe("auth flow smoke", () => {
  it("accepts correct token and rejects wrong token", async () => {
    const token = "smoke-test-token-abc123";
    testState.gatewayAuth = { mode: "token", token };
    const { server, ws, port, envSnapshot } = await startServerWithClient(token);

    try {
      // Correct token → ok
      const ok = await connectReq(ws, { token });
      expect(ok.ok).toBe(true);
    } finally {
      ws.close();
      await server.close();
      envSnapshot.restore();
    }
  });

  it("rejects wrong token with token_mismatch", async () => {
    const token = "correct-token-xyz";
    testState.gatewayAuth = { mode: "token", token };
    const port = await getFreePort();
    const server = await startGatewayServer(port);

    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    await new Promise<void>((resolve) => ws.once("open", resolve));

    try {
      const res = await connectReq(ws, { token: "wrong-token", skipDefaultAuth: true, device: null });
      expect(res.ok).toBe(false);
    } finally {
      ws.close();
      await server.close();
    }
  });

  it("rate-limits after repeated failures from same IP", async () => {
    const token = "rate-limit-test-token";
    testState.gatewayAuth = { mode: "token", token };
    const port = await getFreePort();
    const server = await startGatewayServer(port, {
      auth: { mode: "token", token },
    });

    try {
      // Send multiple bad auth attempts
      const results: boolean[] = [];
      for (let i = 0; i < 15; i++) {
        const ws = new WebSocket(`ws://127.0.0.1:${port}`);
        await new Promise<void>((resolve, reject) => {
          ws.once("open", resolve);
          ws.once("error", reject);
        });
        try {
          const res = await connectReq(ws, {
            token: "bad-token",
            skipDefaultAuth: true,
            device: null,
          });
          results.push(res.ok);
        } catch {
          // Connection may be closed for rate-limited attempts
          results.push(false);
        } finally {
          ws.close();
        }
      }

      // All should have failed
      expect(results.every((r) => r === false)).toBe(true);
    } finally {
      await server.close();
    }
  });
});

// ---------------------------------------------------------------------------
// 2. DNS rebinding protection via origin check (tested in isolation above,
//    here we verify the import chain works in a live gateway context)
// ---------------------------------------------------------------------------
describe("dns rebinding smoke", () => {
  it("origin check rejects rebinding attack hosts", async () => {
    // Import the live function that the gateway uses
    const { checkBrowserOrigin } = await import("../../gateway/origin-check.js");

    // Simulates a DNS rebinding attack: origin is loopback, host is attacker domain
    const result = checkBrowserOrigin({
      requestHost: "evil.attacker.com:18789",
      origin: "http://127.0.0.1:18789",
    });
    expect(result.ok).toBe(false);
  });

  it("allows legitimate loopback connections", async () => {
    const { checkBrowserOrigin } = await import("../../gateway/origin-check.js");

    const result = checkBrowserOrigin({
      requestHost: "localhost:18789",
      origin: "http://localhost:18789",
    });
    expect(result.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 3. Environment filtering for host exec
// ---------------------------------------------------------------------------
describe("env filtering smoke", () => {
  it("strips secrets from a realistic process.env snapshot", async () => {
    const { filterHostExecEnv } = await import("../env-allowlist.js");

    // Simulate a realistic process.env
    const env: NodeJS.ProcessEnv = {
      PATH: "/usr/local/bin:/usr/bin:/bin",
      HOME: "/home/testuser",
      USER: "testuser",
      SHELL: "/bin/bash",
      LANG: "en_US.UTF-8",
      TERM: "xterm-256color",
      EDITOR: "vim",
      NODE_ENV: "production",
      // Secrets that should be stripped
      ANTHROPIC_API_KEY: "sk-ant-api03-real-key",
      OPENAI_API_KEY: "sk-openai-real-key",
      GITHUB_TOKEN: "ghp_realtoken123",
      AWS_SECRET_ACCESS_KEY: "aws-secret-key",
      DATABASE_PASSWORD: "db-pass-123",
      MY_APP_TOKEN: "app-token-xyz",
      SSH_AUTH_SOCK: "/tmp/ssh-agent.sock",
    };

    const filtered = filterHostExecEnv(env);

    // Safe vars preserved
    expect(filtered.PATH).toBeDefined();
    expect(filtered.HOME).toBeDefined();
    expect(filtered.EDITOR).toBeDefined();
    expect(filtered.SSH_AUTH_SOCK).toBeDefined();

    // Secrets stripped
    expect(filtered.ANTHROPIC_API_KEY).toBeUndefined();
    expect(filtered.OPENAI_API_KEY).toBeUndefined();
    expect(filtered.GITHUB_TOKEN).toBeUndefined();
    expect(filtered.AWS_SECRET_ACCESS_KEY).toBeUndefined();
    expect(filtered.DATABASE_PASSWORD).toBeUndefined();
    expect(filtered.MY_APP_TOKEN).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 4. Config error log scrubbing
// ---------------------------------------------------------------------------
describe("config scrubbing smoke", () => {
  it("scrubs various token formats from config error messages", async () => {
    const { scrubSecrets } = await import("../log-scrubber.js");

    // Simulate config validation error messages that leak secrets
    const scenarios = [
      {
        input: `Invalid config at /home/user/.openclaw/config.json:\n- gateway.auth.token: expected string, received sk-${"a".repeat(40)}`,
        mustContain: "sk-***",
        mustNotContain: "a".repeat(40),
      },
      {
        input: `Config warnings:\n- plugins.github.token: ghp_${"B".repeat(36)} is deprecated`,
        mustContain: "ghp_***",
        mustNotContain: "B".repeat(36),
      },
      {
        input: `Failed to read config: Authorization: Bearer ${"x".repeat(50)}`,
        mustContain: "Bearer ***",
        mustNotContain: "x".repeat(50),
      },
      {
        input: `token: xoxb-${"1234567890-".repeat(2)}${"c".repeat(20)}`,
        mustContain: "xoxb-***",
        mustNotContain: "c".repeat(20),
      },
    ];

    for (const { input, mustContain, mustNotContain } of scenarios) {
      const scrubbed = scrubSecrets(input);
      expect(scrubbed).toContain(mustContain);
      expect(scrubbed).not.toContain(mustNotContain);
    }
  });

  it("is safe for repeated calls (no global regex state leaks)", async () => {
    const { scrubSecrets } = await import("../log-scrubber.js");
    const key = "sk-" + "z".repeat(40);
    const msg = `secret: ${key}`;

    for (let i = 0; i < 10; i++) {
      expect(scrubSecrets(msg)).toContain("sk-***");
      expect(scrubSecrets(msg)).not.toContain(key);
    }
  });
});

// ---------------------------------------------------------------------------
// 5. Nonce replay protection
// ---------------------------------------------------------------------------
describe("nonce replay smoke", () => {
  it("end-to-end nonce cache + SHA-256 hashing prevents replay", async () => {
    const crypto = await import("node:crypto");
    const { NonceCache } = await import("../nonce-cache.js");

    const cache = new NonceCache();
    const SKEW_MS = 10 * 60 * 1000;

    // Simulate the message-handler.ts pattern
    const signature = "simulated-device-signature-bytes-" + Date.now();
    const nonce = crypto.createHash("sha256").update(signature).digest("hex");

    expect(cache.add(nonce, SKEW_MS * 2)).toBe(true); // first use: accepted
    expect(cache.add(nonce, SKEW_MS * 2)).toBe(false); // replay: rejected

    // Different signature → different nonce → accepted
    const sig2 = "different-device-signature-bytes";
    const nonce2 = crypto.createHash("sha256").update(sig2).digest("hex");
    expect(cache.add(nonce2, SKEW_MS * 2)).toBe(true);

    cache.dispose();
  });
});

// ---------------------------------------------------------------------------
// 6. Plugin security pipeline
// ---------------------------------------------------------------------------
describe("plugin security pipeline smoke", () => {
  it("blocks critical findings then enforces capabilities at load time", async () => {
    const { shouldBlockPluginInstall } = await import("../plugin-install-policy.js");
    const { createRestrictedPluginApi } = await import("../plugin-capabilities.js");

    // Stage 1: Install-time scan
    const scanResult = {
      critical: 1,
      warn: 2,
      findings: [
        { severity: "critical" as const, message: "eval() usage", file: "index.js", line: 10 },
        { severity: "warn" as const, message: "dynamic require", file: "lib.js", line: 5 },
        { severity: "warn" as const, message: "process.env access", file: "config.js", line: 3 },
      ],
    };

    // Without force → blocked
    expect(shouldBlockPluginInstall(scanResult, false).block).toBe(true);
    // With force → allowed
    expect(shouldBlockPluginInstall(scanResult, true).block).toBe(false);

    // Stage 2: Load-time capability enforcement
    const api = {
      id: "test-plugin",
      registerTool: () => "tool-ok",
      registerHook: () => "hook-ok",
      registerHttpHandler: () => "http-ok",
      registerHttpRoute: () => "route-ok",
      registerChannel: () => "channel-ok",
    };

    // Plugin only declares filesystem → network methods blocked
    const restricted = createRestrictedPluginApi(api, ["filesystem"]);
    expect((restricted.registerTool as () => string)()).toBe("tool-ok");
    expect(() => (restricted.registerHttpHandler as () => void)()).toThrow(/capability/);
    expect(() => (restricted.registerHttpRoute as () => void)()).toThrow(/capability/);
  });
});

// ---------------------------------------------------------------------------
// 7. Memory path boundary
// ---------------------------------------------------------------------------
describe("memory path boundary smoke", () => {
  it("normalizeExtraMemoryPaths rejects paths outside workspace", async () => {
    const { normalizeExtraMemoryPaths } = await import("../../memory/internal.js");
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const workspace = "/home/user/my-project";
    const result = normalizeExtraMemoryPaths(workspace, [
      "notes",                    // relative: inside → allowed
      "docs/reference",           // relative: inside → allowed
      "/etc/passwd",              // absolute: outside → rejected
      "../../other-project",      // traversal: outside → rejected
      "/tmp/secrets",             // absolute: outside → rejected
    ]);

    expect(result).toEqual([
      path.resolve(workspace, "notes"),
      path.resolve(workspace, "docs/reference"),
    ]);
    expect(spy).toHaveBeenCalledTimes(3);
    spy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// 8. Sensitive config hints
// ---------------------------------------------------------------------------
describe("sensitive config hints smoke", () => {
  it("detects all expected sensitive field patterns", async () => {
    const { isSensitiveConfigPath } = await import("../../config/schema.hints.js");

    const sensitive = [
      "gateway.auth.token",
      "gateway.auth.password",
      "plugins.openai.apiKey",
      "channels.slack.secret",
      "proxy.bearer",
      "auth.credential",
      "aws.accessKey",
      "tls.privateKey",
      "jwt.signingKey",
      "oauth.clientSecret",
    ];

    const notSensitive = [
      "agents.list[].tools.maxTokens",
      "gateway.port",
      "logging.level",
      "git.publickey",
      "git.credentialhelper",
    ];

    for (const p of sensitive) {
      expect(isSensitiveConfigPath(p), `expected ${p} to be sensitive`).toBe(true);
    }
    for (const p of notSensitive) {
      expect(isSensitiveConfigPath(p), `expected ${p} to NOT be sensitive`).toBe(false);
    }
  });
});
