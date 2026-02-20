/**
 * Integration test: Worker Thread plugin isolation.
 *
 * Verifies end-to-end: load plugin in Worker, register tools/hooks/services/commands,
 * invoke tool, verify result; test unsupported API; test crash recovery.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { createWorkerHost, type WorkerHost } from "../worker-bridge/main-host.js";
import type { SerializedToolDescriptor } from "../worker-bridge/protocol.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = path.join(__dirname, "..", "worker-bridge", "__fixtures__");

const noopLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
};

describe("worker isolation integration", () => {
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

  it("full lifecycle: load plugin, register, invoke tool, verify", async () => {
    const tools: SerializedToolDescriptor[] = [];
    const hooks: string[] = [];
    const services: string[] = [];
    const commands: string[] = [];

    const host = createWorkerHost({
      pluginId: "integration-minimal",
      pluginSource: path.join(FIXTURE_DIR, "minimal-plugin.ts"),
      metadata: { id: "integration-minimal", name: "Integration Minimal" },
      logger: noopLogger,
      onRegisterTool: (desc) => tools.push(desc),
      onRegisterHook: (hookName) => hooks.push(hookName),
      onRegisterService: (id) => services.push(id),
      onRegisterCommand: (name) => commands.push(name),
    });
    hosts.push(host);

    // Wait for registration
    await host.ready;

    // Verify registrations
    expect(tools).toHaveLength(1);
    expect(tools[0]?.name).toBe("test-echo");
    expect(tools[0]?.description).toBe("Echoes the input");
    expect(hooks).toContain("session_start");
    expect(services).toContain("test-service");
    expect(commands).toContain("test-cmd");

    // Invoke the tool
    const result = await host.invokeTool("test-echo", { message: "integration test" });
    expect(result).toEqual({ echo: "integration test" });
  });

  it("unsupported API call causes registration failure", async () => {
    const host = createWorkerHost({
      pluginId: "integration-unsupported",
      pluginSource: path.join(FIXTURE_DIR, "unsupported-api-plugin.ts"),
      metadata: { id: "integration-unsupported", name: "Unsupported" },
      logger: noopLogger,
    });
    hosts.push(host);

    await expect(host.ready).rejects.toThrow(/registration failed/);
  });

  it("crash during registration is handled cleanly", async () => {
    const host = createWorkerHost({
      pluginId: "integration-crash",
      pluginSource: path.join(FIXTURE_DIR, "crash-plugin.ts"),
      metadata: { id: "integration-crash", name: "Crash" },
      logger: noopLogger,
    });
    hosts.push(host);

    await expect(host.ready).rejects.toThrow(/registration failed/);
  });

  it("tool invocation with missing tool returns error", async () => {
    const host = createWorkerHost({
      pluginId: "integration-missing-tool",
      pluginSource: path.join(FIXTURE_DIR, "minimal-plugin.ts"),
      metadata: { id: "integration-missing-tool", name: "Missing Tool" },
      logger: noopLogger,
      onRegisterTool: () => {},
    });
    hosts.push(host);

    await host.ready;
    await expect(host.invokeTool("does-not-exist", {})).rejects.toThrow(/tool not found/);
  });

  it("terminate cleans up worker", async () => {
    const host = createWorkerHost({
      pluginId: "integration-terminate",
      pluginSource: path.join(FIXTURE_DIR, "minimal-plugin.ts"),
      metadata: { id: "integration-terminate", name: "Terminate" },
      logger: noopLogger,
      onRegisterTool: () => {},
    });
    hosts.push(host);

    await host.ready;
    await host.terminate();

    // Further invocations should fail
    await expect(host.invokeTool("test-echo", { message: "after terminate" })).rejects.toThrow();
  });
});
