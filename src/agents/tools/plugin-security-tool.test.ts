import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPluginSecurityTool } from "./plugin-security-tool.js";

// Mock the policy store to use a temp directory
let tmpDir: string;

vi.mock("../../security/plugin-security-policy.js", async () => {
  const actual = await vi.importActual<typeof import("../../security/plugin-security-policy.js")>(
    "../../security/plugin-security-policy.js",
  );
  return {
    ...actual,
    loadPolicy: (pluginId: string) => actual.loadPolicy(pluginId, tmpDir),
    savePolicy: (policy: import("../../security/plugin-security-policy.js").PluginSecurityPolicy) =>
      actual.savePolicy(policy, tmpDir),
    listPolicies: () => actual.listPolicies(tmpDir),
  };
});

vi.mock("../../plugins/hook-runner-global.js", () => ({
  getGlobalPluginRegistry: () => ({
    plugins: [
      {
        id: "plugin-a",
        name: "Plugin A",
        origin: "local",
        status: "loaded",
        toolNames: ["tool1"],
        channelIds: ["ch1"],
        providerIds: [],
        hookCount: 2,
        services: [],
        commands: [],
        httpHandlers: 0,
        gatewayMethods: [],
        cliCommands: [],
      },
      {
        id: "plugin-b",
        name: "Plugin B",
        origin: "npm",
        status: "loaded",
        toolNames: [],
        channelIds: [],
        providerIds: ["prov1"],
        hookCount: 0,
        services: ["svc1"],
        commands: ["cmd1"],
        httpHandlers: 1,
        gatewayMethods: ["gw1"],
        cliCommands: ["cli1"],
      },
    ],
  }),
}));

describe("plugin-security-tool", () => {
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "plugin-sec-tool-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const tool = createPluginSecurityTool();

  async function execute(params: Record<string, unknown>) {
    return tool.execute("test-call", params);
  }

  describe("list action", () => {
    it("returns all loaded plugins with registrations summary", async () => {
      const result = await execute({ action: "list" });
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.ok).toBe(true);
      expect(parsed.plugins).toHaveLength(2);

      const pluginA = parsed.plugins.find(
        (p: Record<string, unknown>) => p.pluginId === "plugin-a",
      );
      expect(pluginA.trustLevel).toBe("unconfigured");
      expect(pluginA.registrations.tools).toEqual(["tool1"]);
      expect(pluginA.registrations.channels).toEqual(["ch1"]);

      const pluginB = parsed.plugins.find(
        (p: Record<string, unknown>) => p.pluginId === "plugin-b",
      );
      expect(pluginB.origin).toBe("npm");
      expect(pluginB.registrations.providers).toEqual(["prov1"]);
    });

    it("shows trust level when policy exists", async () => {
      const { savePolicy } = await vi.importActual<
        typeof import("../../security/plugin-security-policy.js")
      >("../../security/plugin-security-policy.js");
      savePolicy(
        { pluginId: "plugin-a", trustLevel: "trusted", setAt: 1000 },
        tmpDir,
      );

      const result = await execute({ action: "list" });
      const parsed = JSON.parse(result.content[0].text);
      const pluginA = parsed.plugins.find(
        (p: Record<string, unknown>) => p.pluginId === "plugin-a",
      );
      expect(pluginA.trustLevel).toBe("trusted");
    });
  });

  describe("get action", () => {
    it("returns unconfigured for missing policy", async () => {
      const result = await execute({ action: "get", pluginId: "plugin-a" });
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.ok).toBe(true);
      expect(parsed.policy.trustLevel).toBe("unconfigured");
    });

    it("returns stored policy", async () => {
      const { savePolicy } = await vi.importActual<
        typeof import("../../security/plugin-security-policy.js")
      >("../../security/plugin-security-policy.js");
      savePolicy(
        { pluginId: "plugin-a", trustLevel: "restricted", setAt: 1000, capabilities: ["network"] },
        tmpDir,
      );

      const result = await execute({ action: "get", pluginId: "plugin-a" });
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.policy.trustLevel).toBe("restricted");
      expect(parsed.policy.capabilities).toEqual(["network"]);
    });

    it("throws when pluginId is missing", async () => {
      await expect(execute({ action: "get" })).rejects.toThrow(/pluginId required/);
    });
  });

  describe("set action", () => {
    it("saves a policy and returns confirmation", async () => {
      const result = await execute({
        action: "set",
        pluginId: "plugin-a",
        trustLevel: "restricted",
        capabilities: ["network", "messaging"],
      });
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.ok).toBe(true);
      expect(parsed.policy.trustLevel).toBe("restricted");
      expect(parsed.policy.capabilities).toEqual(["network", "messaging"]);
      expect(parsed.note).toMatch(/restart/i);
    });

    it("throws when pluginId is missing", async () => {
      await expect(
        execute({ action: "set", trustLevel: "trusted" }),
      ).rejects.toThrow(/pluginId required/);
    });

    it("throws when trustLevel is missing", async () => {
      await expect(
        execute({ action: "set", pluginId: "plugin-a" }),
      ).rejects.toThrow(/trustLevel required/);
    });

    it("throws for invalid trustLevel", async () => {
      await expect(
        execute({ action: "set", pluginId: "plugin-a", trustLevel: "banana" }),
      ).rejects.toThrow(/Invalid trustLevel/);
    });
  });

  describe("unknown action", () => {
    it("throws for unknown action", async () => {
      await expect(execute({ action: "unknown" })).rejects.toThrow(/Unknown action/);
    });
  });
});
