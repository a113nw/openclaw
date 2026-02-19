import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { recordAuthEvent, type AuthAuditEvent } from "./auth-audit-log.js";

// We need to mock resolveStateDir to point at a temp directory
// so we don't write to the real ~/.openclaw path during tests.
vi.mock("../config/paths.js", () => {
  const tmpBase = path.join(os.tmpdir(), "auth-audit-test-" + process.pid);
  return { resolveStateDir: () => tmpBase };
});

describe("recordAuthEvent", () => {
  let stateDir: string;
  let auditDir: string;
  let auditPath: string;

  beforeEach(async () => {
    // Dynamically import to get the mocked resolveStateDir value
    const { resolveStateDir } = await import("../config/paths.js");
    stateDir = resolveStateDir();
    auditDir = path.join(stateDir, "security");
    auditPath = path.join(auditDir, "auth-audit.jsonl");
    // Ensure clean state
    fs.rmSync(stateDir, { recursive: true, force: true });
  });

  afterEach(() => {
    try {
      fs.rmSync(stateDir, { recursive: true, force: true });
    } catch {}
  });

  it("creates the audit directory and writes an event", () => {
    const event: AuthAuditEvent = {
      type: "auth_success",
      ip: "192.168.1.1",
      method: "token",
      timestamp: Date.now(),
    };
    recordAuthEvent(event);

    expect(fs.existsSync(auditPath)).toBe(true);
    const content = fs.readFileSync(auditPath, "utf-8");
    const parsed = JSON.parse(content.trim());
    expect(parsed.type).toBe("auth_success");
    expect(parsed.ip).toBe("192.168.1.1");
    expect(parsed.method).toBe("token");
  });

  it("appends multiple events as JSONL", () => {
    recordAuthEvent({ type: "auth_success", ip: "1.1.1.1", timestamp: 1000 });
    recordAuthEvent({ type: "auth_failure", ip: "2.2.2.2", reason: "token_mismatch", timestamp: 2000 });

    const lines = fs.readFileSync(auditPath, "utf-8").trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]).type).toBe("auth_success");
    expect(JSON.parse(lines[1]).type).toBe("auth_failure");
    expect(JSON.parse(lines[1]).reason).toBe("token_mismatch");
  });

  it("does not throw even if the directory cannot be created", () => {
    // Mock mkdirSync to throw
    const mkdirSpy = vi.spyOn(fs, "mkdirSync").mockImplementation(() => {
      throw new Error("permission denied");
    });
    // Should not throw
    expect(() =>
      recordAuthEvent({ type: "auth_failure", timestamp: Date.now() }),
    ).not.toThrow();
    mkdirSpy.mockRestore();
  });

  it("records auth_failure events with reason", () => {
    recordAuthEvent({
      type: "auth_failure",
      ip: "10.0.0.1",
      method: "password",
      reason: "password_mismatch",
      timestamp: 12345,
    });

    const content = fs.readFileSync(auditPath, "utf-8");
    const parsed = JSON.parse(content.trim());
    expect(parsed.type).toBe("auth_failure");
    expect(parsed.reason).toBe("password_mismatch");
    expect(parsed.timestamp).toBe(12345);
  });
});
