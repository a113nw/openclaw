import { describe, expect, it } from "vitest";
import {
  isWorkerToMainMessage,
  isMainToWorkerMessage,
  type WorkerInitMessage,
  type RegisterToolMessage,
  type InvokeToolMessage,
  type InvokeResultMessage,
  type LogMessage,
  type RegistrationCompleteMessage,
  type RegistrationErrorMessage,
} from "./protocol.js";

describe("protocol", () => {
  describe("isWorkerToMainMessage", () => {
    it("returns true for register:tool message", () => {
      const msg: RegisterToolMessage = {
        type: "register:tool",
        descriptor: { name: "test-tool", description: "A test tool" },
      };
      expect(isWorkerToMainMessage(msg)).toBe(true);
    });

    it("returns true for invoke:result message", () => {
      const msg: InvokeResultMessage = {
        type: "invoke:result",
        reqId: "abc-123",
        ok: true,
        value: { result: "data" },
      };
      expect(isWorkerToMainMessage(msg)).toBe(true);
    });

    it("returns true for log message", () => {
      const msg: LogMessage = {
        type: "log",
        level: "info",
        message: "hello",
      };
      expect(isWorkerToMainMessage(msg)).toBe(true);
    });

    it("returns true for registration:complete", () => {
      const msg: RegistrationCompleteMessage = { type: "registration:complete" };
      expect(isWorkerToMainMessage(msg)).toBe(true);
    });

    it("returns true for registration:error", () => {
      const msg: RegistrationErrorMessage = {
        type: "registration:error",
        error: "something went wrong",
      };
      expect(isWorkerToMainMessage(msg)).toBe(true);
    });

    it("returns false for null", () => {
      expect(isWorkerToMainMessage(null)).toBe(false);
    });

    it("returns false for non-object", () => {
      expect(isWorkerToMainMessage("string")).toBe(false);
    });

    it("returns false for object without type", () => {
      expect(isWorkerToMainMessage({ foo: "bar" })).toBe(false);
    });
  });

  describe("isMainToWorkerMessage", () => {
    it("returns true for init message", () => {
      const msg: WorkerInitMessage = {
        type: "init",
        pluginId: "test",
        pluginSource: "/path/to/plugin.ts",
        metadata: { id: "test", name: "Test Plugin" },
      };
      expect(isMainToWorkerMessage(msg)).toBe(true);
    });

    it("returns true for invoke:tool message", () => {
      const msg: InvokeToolMessage = {
        type: "invoke:tool",
        reqId: "abc-123",
        toolName: "test-tool",
        args: { message: "hello" },
      };
      expect(isMainToWorkerMessage(msg)).toBe(true);
    });

    it("returns false for null", () => {
      expect(isMainToWorkerMessage(null)).toBe(false);
    });
  });

  describe("message shapes", () => {
    it("WorkerInitMessage has required fields", () => {
      const msg: WorkerInitMessage = {
        type: "init",
        pluginId: "my-plugin",
        pluginSource: "/path/to/src.ts",
        metadata: {
          id: "my-plugin",
          name: "My Plugin",
          version: "1.0.0",
          description: "A plugin",
        },
        pluginConfig: { key: "value" },
        jitiAlias: { "openclaw/plugin-sdk": "/path/to/sdk" },
      };
      expect(msg.type).toBe("init");
      expect(msg.pluginId).toBe("my-plugin");
      expect(msg.metadata.name).toBe("My Plugin");
    });

    it("InvokeResultMessage supports error response", () => {
      const msg: InvokeResultMessage = {
        type: "invoke:result",
        reqId: "req-1",
        ok: false,
        error: "tool execution failed",
      };
      expect(msg.ok).toBe(false);
      expect(msg.error).toBe("tool execution failed");
    });
  });
});
