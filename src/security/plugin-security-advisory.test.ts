import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PluginRegistry } from "../plugins/registry.js";
import { createEmptyPluginRegistry } from "../plugins/registry.js";
import { registerSecurityAdvisoryHook, resetAdvisedSessions } from "./plugin-security-advisory.js";

// Mock loadPolicy to control which plugins appear "configured"
const policyMap = new Map<string, unknown>();

vi.mock("./plugin-security-policy.js", () => ({
  loadPolicy: (pluginId: string) => policyMap.get(pluginId) ?? null,
}));

function makePlugin(id: string, overrides?: Partial<PluginRegistry["plugins"][0]>) {
  return {
    id,
    name: id,
    origin: "local" as const,
    status: "loaded" as const,
    enabled: true,
    source: `/plugins/${id}/index.ts`,
    toolNames: [],
    hookNames: [],
    channelIds: [],
    providerIds: [],
    gatewayMethods: [],
    cliCommands: [],
    services: [],
    commands: [],
    httpHandlers: 0,
    hookCount: 0,
    configSchema: true,
    ...overrides,
  };
}

describe("plugin-security-advisory", () => {
  beforeEach(() => {
    policyMap.clear();
    resetAdvisedSessions();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("pushes hook when unconfigured plugins exist", () => {
    const registry = createEmptyPluginRegistry();
    registry.plugins.push(makePlugin("unconfigured-plugin"));

    const hooksBefore = registry.typedHooks.length;
    registerSecurityAdvisoryHook(registry);
    expect(registry.typedHooks.length).toBe(hooksBefore + 1);

    const hook = registry.typedHooks[registry.typedHooks.length - 1]!;
    expect(hook.hookName).toBe("before_prompt_build");
    expect(hook.pluginId).toBe("__security_advisory");
    expect(hook.priority).toBe(1000);
  });

  it("does not push hook when all plugins have policies", () => {
    policyMap.set("configured-plugin", { pluginId: "configured-plugin", trustLevel: "trusted" });
    const registry = createEmptyPluginRegistry();
    registry.plugins.push(makePlugin("configured-plugin"));

    const hooksBefore = registry.typedHooks.length;
    registerSecurityAdvisoryHook(registry);
    expect(registry.typedHooks.length).toBe(hooksBefore);
  });

  it("does not push hook for disabled plugins (non-loaded)", () => {
    const registry = createEmptyPluginRegistry();
    registry.plugins.push(makePlugin("disabled-plugin", { status: "disabled" }));

    const hooksBefore = registry.typedHooks.length;
    registerSecurityAdvisoryHook(registry);
    expect(registry.typedHooks.length).toBe(hooksBefore);
  });

  it("advisory text includes plugin IDs and registrations", () => {
    const registry = createEmptyPluginRegistry();
    registry.plugins.push(
      makePlugin("test-plugin", {
        origin: "npm",
        toolNames: ["my-tool"],
        channelIds: ["my-channel"],
        hookCount: 3,
      }),
    );

    registerSecurityAdvisoryHook(registry);
    const hook = registry.typedHooks[registry.typedHooks.length - 1]!;

    const result = (hook.handler as Function)(
      { prompt: "test", messages: [] },
      { sessionKey: "session-1" },
    );
    expect(result).toBeDefined();
    expect(result.prependContext).toContain("test-plugin");
    expect(result.prependContext).toContain("npm");
    expect(result.prependContext).toContain("tools[my-tool]");
    expect(result.prependContext).toContain("channels[my-channel]");
    expect(result.prependContext).toContain("hooks[3]");
    expect(result.prependContext).toContain("PLUGIN SECURITY ADVISORY");
  });

  it("fires once per session (dedup)", () => {
    const registry = createEmptyPluginRegistry();
    registry.plugins.push(makePlugin("test-plugin"));

    registerSecurityAdvisoryHook(registry);
    const hook = registry.typedHooks[registry.typedHooks.length - 1]!;
    const handler = hook.handler as Function;

    const ctx = { sessionKey: "session-1" };
    const event = { prompt: "test", messages: [] };

    const first = handler(event, ctx);
    expect(first).toBeDefined();
    expect(first.prependContext).toBeTruthy();

    const second = handler(event, ctx);
    expect(second).toBeUndefined();
  });

  it("fires separately for different sessions", () => {
    const registry = createEmptyPluginRegistry();
    registry.plugins.push(makePlugin("test-plugin"));

    registerSecurityAdvisoryHook(registry);
    const hook = registry.typedHooks[registry.typedHooks.length - 1]!;
    const handler = hook.handler as Function;

    const event = { prompt: "test", messages: [] };

    const first = handler(event, { sessionKey: "session-A" });
    expect(first).toBeDefined();

    const second = handler(event, { sessionKey: "session-B" });
    expect(second).toBeDefined();
  });

  it("uses 'default' session key when ctx.sessionKey is absent", () => {
    const registry = createEmptyPluginRegistry();
    registry.plugins.push(makePlugin("test-plugin"));

    registerSecurityAdvisoryHook(registry);
    const hook = registry.typedHooks[registry.typedHooks.length - 1]!;
    const handler = hook.handler as Function;

    const event = { prompt: "test", messages: [] };

    const first = handler(event, {});
    expect(first).toBeDefined();

    const second = handler(event, {});
    expect(second).toBeUndefined();
  });
});
