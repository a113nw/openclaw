import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { createWorkerHost, type WorkerHost } from "./main-host.js";
import type { SerializedToolDescriptor } from "./protocol.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = path.join(__dirname, "__fixtures__");

const noopLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
};

describe("main-host", () => {
  const hosts: WorkerHost[] = [];

  afterEach(async () => {
    for (const host of hosts) {
      try {
        await host.terminate();
      } catch {
        // ignore
      }
    }
    hosts.length = 0;
  });

  it("loads minimal plugin and registers tool", async () => {
    const registeredTools: SerializedToolDescriptor[] = [];
    const registeredHooks: string[] = [];
    const registeredServices: string[] = [];
    const registeredCommands: string[] = [];

    const host = createWorkerHost({
      pluginId: "test-minimal",
      pluginSource: path.join(FIXTURE_DIR, "minimal-plugin.ts"),
      metadata: { id: "test-minimal", name: "Test Minimal" },
      logger: noopLogger,
      onRegisterTool: (desc) => registeredTools.push(desc),
      onRegisterHook: (hookName) => registeredHooks.push(hookName),
      onRegisterService: (id) => registeredServices.push(id),
      onRegisterCommand: (name) => registeredCommands.push(name),
    });
    hosts.push(host);

    await host.ready;

    expect(registeredTools.length).toBe(1);
    expect(registeredTools[0]?.name).toBe("test-echo");
    expect(registeredHooks).toContain("session_start");
    expect(registeredServices).toContain("test-service");
    expect(registeredCommands).toContain("test-cmd");
  });

  it("invokes tool via IPC and returns result", async () => {
    const host = createWorkerHost({
      pluginId: "test-invoke",
      pluginSource: path.join(FIXTURE_DIR, "minimal-plugin.ts"),
      metadata: { id: "test-invoke", name: "Test Invoke" },
      logger: noopLogger,
      onRegisterTool: () => {},
    });
    hosts.push(host);

    await host.ready;

    const result = await host.invokeTool("test-echo", { message: "hello" });
    expect(result).toEqual({ echo: "hello" });
  });

  it("handles crash plugin — registration fails cleanly", async () => {
    const host = createWorkerHost({
      pluginId: "test-crash",
      pluginSource: path.join(FIXTURE_DIR, "crash-plugin.ts"),
      metadata: { id: "test-crash", name: "Test Crash" },
      logger: noopLogger,
    });
    hosts.push(host);

    await expect(host.ready).rejects.toThrow(/registration failed/);
  });

  it("handles unsupported API plugin — registration fails", async () => {
    const host = createWorkerHost({
      pluginId: "test-unsupported",
      pluginSource: path.join(FIXTURE_DIR, "unsupported-api-plugin.ts"),
      metadata: { id: "test-unsupported", name: "Test Unsupported" },
      logger: noopLogger,
    });
    hosts.push(host);

    await expect(host.ready).rejects.toThrow(/registration failed/);
  });

  it("returns error for non-existent tool invocation", async () => {
    const host = createWorkerHost({
      pluginId: "test-notool",
      pluginSource: path.join(FIXTURE_DIR, "minimal-plugin.ts"),
      metadata: { id: "test-notool", name: "Test NoTool" },
      logger: noopLogger,
      onRegisterTool: () => {},
    });
    hosts.push(host);

    await host.ready;

    await expect(host.invokeTool("nonexistent", {})).rejects.toThrow(/tool not found/);
  });
});
