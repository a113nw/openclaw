/**
 * Integration test: plugin security pipeline — install-policy + capabilities.
 *
 * Tests the two stages of plugin security:
 * 1. Install-time: shouldBlockPluginInstall blocks critical scan findings
 * 2. Load-time: createRestrictedPluginApi enforces capability declarations
 */
import { describe, expect, it } from "vitest";
import {
  createRestrictedPluginApi,
  validatePluginCapabilities,
  type PluginCapability,
} from "../plugin-capabilities.js";
import { shouldBlockPluginInstall } from "../plugin-install-policy.js";

describe("plugin security pipeline integration", () => {
  describe("install-time blocking + load-time restriction flow", () => {
    it("blocks install when critical findings exist, no force", () => {
      const scanSummary = {
        critical: 2,
        warn: 1,
        findings: [
          { severity: "critical" as const, message: "eval() usage", file: "index.js", line: 5 },
          { severity: "critical" as const, message: "child_process spawn", file: "utils.js", line: 10 },
          { severity: "warn" as const, message: "dynamic require", file: "lib.js", line: 3 },
        ],
      };

      const policy = shouldBlockPluginInstall(scanSummary, false);
      expect(policy.block).toBe(true);
      expect(policy.reason).toContain("critical");
      expect(policy.reason).toContain("--force");
    });

    it("allows force-install with critical findings, then capabilities restrict API", () => {
      const scanSummary = {
        critical: 1,
        warn: 0,
        findings: [
          { severity: "critical" as const, message: "eval() usage", file: "index.js", line: 5 },
        ],
      };

      // Stage 1: force-install passes
      const policy = shouldBlockPluginInstall(scanSummary, true);
      expect(policy.block).toBe(false);

      // Stage 2: plugin declares only filesystem capability, no network
      const mockApi = {
        id: "dangerous-plugin",
        registerTool: () => "ok",
        registerHook: () => "ok",
        registerHttpHandler: () => "should-not-reach",
        registerHttpRoute: () => "should-not-reach",
      };

      const restricted = createRestrictedPluginApi(mockApi, ["filesystem"]);

      // Ungated methods still work
      expect((restricted.registerTool as () => string)()).toBe("ok");
      expect((restricted.registerHook as () => string)()).toBe("ok");

      // Network-gated methods are blocked
      expect(() => (restricted.registerHttpHandler as () => void)()).toThrow(/capability/);
      expect(() => (restricted.registerHttpRoute as () => void)()).toThrow(/capability/);
    });

    it("clean install + full capabilities = unrestricted API", () => {
      const scanSummary = { critical: 0, warn: 0, findings: [] };
      const policy = shouldBlockPluginInstall(scanSummary, false);
      expect(policy.block).toBe(false);

      const mockApi = {
        id: "good-plugin",
        registerTool: () => "tool-ok",
        registerHttpHandler: () => "http-ok",
        registerHttpRoute: () => "route-ok",
      };

      const allCaps: PluginCapability[] = [
        "filesystem", "network", "child_process", "env_access", "config_write",
      ];
      const api = createRestrictedPluginApi(mockApi, allCaps);

      // With all capabilities, original reference is returned
      expect(api).toBe(mockApi);
      expect((api.registerHttpHandler as () => string)()).toBe("http-ok");
    });
  });

  describe("capability validation against policy", () => {
    it("validates declared vs allowed capabilities", () => {
      // Plugin wants network + filesystem, policy only allows filesystem
      const result = validatePluginCapabilities(
        ["filesystem", "network"],
        { allowed: ["filesystem"] },
      );
      expect(result.allowed).toBe(false);
      expect(result.denied).toEqual(["network"]);
    });

    it("passes when all declared capabilities are in the policy", () => {
      const result = validatePluginCapabilities(
        ["filesystem", "network"],
        { allowed: ["filesystem", "network", "env_access"] },
      );
      expect(result.allowed).toBe(true);
      expect(result.denied).toEqual([]);
    });

    it("backward compatible: no capabilities declared = no restrictions", () => {
      const mockApi = {
        id: "legacy-plugin",
        registerTool: () => "ok",
        registerHttpHandler: () => "ok",
      };

      // Simulates loader.ts behavior: undefined capabilities = rawApi used directly
      const declaredCapabilities: PluginCapability[] | undefined = undefined;
      const api = declaredCapabilities
        ? createRestrictedPluginApi(mockApi, declaredCapabilities)
        : mockApi;

      expect(api).toBe(mockApi);
      expect((api.registerHttpHandler as () => string)()).toBe("ok");
    });
  });
});
