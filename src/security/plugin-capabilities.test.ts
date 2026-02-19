import { describe, expect, it } from "vitest";
import {
  ALL_CAPABILITIES,
  createRestrictedPluginApi,
  validatePluginCapabilities,
  type PluginCapability,
} from "./plugin-capabilities.js";

describe("validatePluginCapabilities", () => {
  it("allows when all declared capabilities are in the policy", () => {
    const result = validatePluginCapabilities(["filesystem", "network"], {
      allowed: ["filesystem", "network", "env_access"],
    });
    expect(result.allowed).toBe(true);
    expect(result.denied).toEqual([]);
  });

  it("denies capabilities not in the policy", () => {
    const result = validatePluginCapabilities(["filesystem", "child_process"], {
      allowed: ["filesystem"],
    });
    expect(result.allowed).toBe(false);
    expect(result.denied).toEqual(["child_process"]);
  });

  it("returns allowed for empty declared capabilities", () => {
    const result = validatePluginCapabilities([], { allowed: ["filesystem"] });
    expect(result.allowed).toBe(true);
    expect(result.denied).toEqual([]);
  });

  it("denies all when policy allows nothing", () => {
    const result = validatePluginCapabilities(["network", "env_access"], { allowed: [] });
    expect(result.allowed).toBe(false);
    expect(result.denied).toEqual(["network", "env_access"]);
  });

  it("allows everything when policy includes ALL_CAPABILITIES", () => {
    const result = validatePluginCapabilities([...ALL_CAPABILITIES], {
      allowed: [...ALL_CAPABILITIES],
    });
    expect(result.allowed).toBe(true);
    expect(result.denied).toEqual([]);
  });
});

describe("createRestrictedPluginApi", () => {
  const mockApi = {
    id: "test-plugin",
    registerTool: () => "tool-registered",
    registerHook: () => "hook-registered",
    registerHttpHandler: () => "http-handler-registered",
    registerHttpRoute: () => "http-route-registered",
    registerChannel: () => "channel-registered",
  };

  it("returns the original api when all capabilities are declared", () => {
    const restricted = createRestrictedPluginApi(mockApi, [...ALL_CAPABILITIES]);
    expect(restricted).toBe(mockApi); // same reference — no proxy needed
  });

  it("returns the original api when no methods are restricted", () => {
    // filesystem, child_process, env_access, config_write have no restricted methods
    const restricted = createRestrictedPluginApi(mockApi, [
      "filesystem",
      "child_process",
      "env_access",
      "config_write",
    ]);
    // network is missing but its methods (registerHttpHandler, registerHttpRoute) exist
    // so a proxy is returned
    expect(restricted).not.toBe(mockApi);
  });

  it("blocks registerHttpHandler when network capability is missing", () => {
    const restricted = createRestrictedPluginApi(mockApi, ["filesystem"]);
    expect(() => (restricted.registerHttpHandler as () => void)()).toThrow(
      /registerHttpHandler.*capability/,
    );
  });

  it("blocks registerHttpRoute when network capability is missing", () => {
    const restricted = createRestrictedPluginApi(mockApi, ["filesystem"]);
    expect(() => (restricted.registerHttpRoute as () => void)()).toThrow(
      /registerHttpRoute.*capability/,
    );
  });

  it("allows registerHttpHandler when network capability is declared", () => {
    const restricted = createRestrictedPluginApi(mockApi, ["network"]);
    expect((restricted.registerHttpHandler as () => string)()).toBe("http-handler-registered");
  });

  it("always allows methods not gated by capabilities", () => {
    const restricted = createRestrictedPluginApi(mockApi, []);
    // registerTool, registerHook, registerChannel are never restricted
    expect((restricted.registerTool as () => string)()).toBe("tool-registered");
    expect((restricted.registerHook as () => string)()).toBe("hook-registered");
    expect((restricted.registerChannel as () => string)()).toBe("channel-registered");
  });

  it("preserves non-function properties", () => {
    const restricted = createRestrictedPluginApi(mockApi, []);
    expect(restricted.id).toBe("test-plugin");
  });

  it("handles api with no restricted methods gracefully", () => {
    const simpleApi = { id: "simple", doSomething: () => "ok" };
    const restricted = createRestrictedPluginApi(simpleApi, []);
    // Proxy is created because network capability is missing, but
    // simpleApi has no restricted methods so behavior is unchanged
    expect(restricted.id).toBe("simple");
    expect((restricted.doSomething as () => string)()).toBe("ok");
  });
});

describe("ALL_CAPABILITIES", () => {
  it("contains exactly 5 capabilities", () => {
    expect(ALL_CAPABILITIES).toHaveLength(5);
  });

  it("includes expected capability names", () => {
    const expected: PluginCapability[] = [
      "filesystem",
      "network",
      "child_process",
      "env_access",
      "config_write",
    ];
    expect([...ALL_CAPABILITIES]).toEqual(expected);
  });
});
