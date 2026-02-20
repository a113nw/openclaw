import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadOrCreateMasterKey, resetMasterKeyForTest } from "./master-key.js";

vi.mock("node:child_process", () => ({
  execFileSync: vi.fn(() => {
    throw new Error("keychain not available");
  }),
}));

vi.mock("../config/paths.js", () => ({
  resolveStateDir: (env?: NodeJS.ProcessEnv) => {
    return (env as Record<string, string>)?.__TEST_STATE_DIR ?? os.tmpdir();
  },
}));

describe("master-key", () => {
  let tmpDir: string;

  beforeEach(() => {
    resetMasterKeyForTest();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "master-key-test-"));
  });

  afterEach(() => {
    resetMasterKeyForTest();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("generates a new key when none exists", () => {
    const env = { __TEST_STATE_DIR: tmpDir } as unknown as NodeJS.ProcessEnv;
    const result = loadOrCreateMasterKey(env);
    expect(result.key).toBeInstanceOf(Buffer);
    expect(result.key.length).toBe(32);
    expect(result.source).toBe("file");
  });

  it("persists key to file", () => {
    const env = { __TEST_STATE_DIR: tmpDir } as unknown as NodeJS.ProcessEnv;
    const result = loadOrCreateMasterKey(env);
    const keyPath = path.join(tmpDir, "security", "master.key");
    expect(fs.existsSync(keyPath)).toBe(true);
    const hex = fs.readFileSync(keyPath, "utf8").trim();
    expect(Buffer.from(hex, "hex").equals(result.key)).toBe(true);
  });

  it("reads existing key from file", () => {
    const env = { __TEST_STATE_DIR: tmpDir } as unknown as NodeJS.ProcessEnv;
    const existing = crypto.randomBytes(32);
    const keyDir = path.join(tmpDir, "security");
    fs.mkdirSync(keyDir, { recursive: true });
    fs.writeFileSync(path.join(keyDir, "master.key"), existing.toString("hex") + "\n", {
      mode: 0o600,
    });

    const result = loadOrCreateMasterKey(env);
    expect(result.key.equals(existing)).toBe(true);
    expect(result.source).toBe("file");
  });

  it("caches key in memory", () => {
    const env = { __TEST_STATE_DIR: tmpDir } as unknown as NodeJS.ProcessEnv;
    const first = loadOrCreateMasterKey(env);
    const second = loadOrCreateMasterKey(env);
    expect(first.key.equals(second.key)).toBe(true);
  });

  it("sets file permissions to 0o600", () => {
    const env = { __TEST_STATE_DIR: tmpDir } as unknown as NodeJS.ProcessEnv;
    loadOrCreateMasterKey(env);
    const keyPath = path.join(tmpDir, "security", "master.key");
    const stat = fs.statSync(keyPath);
    expect(stat.mode & 0o777).toBe(0o600);
  });

  it("ignores invalid key file (wrong length)", () => {
    const env = { __TEST_STATE_DIR: tmpDir } as unknown as NodeJS.ProcessEnv;
    const keyDir = path.join(tmpDir, "security");
    fs.mkdirSync(keyDir, { recursive: true });
    fs.writeFileSync(path.join(keyDir, "master.key"), "short\n", { mode: 0o600 });

    const result = loadOrCreateMasterKey(env);
    expect(result.key.length).toBe(32);
    // Should have overwritten with a proper key
    const hex = fs.readFileSync(path.join(keyDir, "master.key"), "utf8").trim();
    expect(Buffer.from(hex, "hex").length).toBe(32);
  });

  it("resetMasterKeyForTest clears cache", () => {
    const env = { __TEST_STATE_DIR: tmpDir } as unknown as NodeJS.ProcessEnv;
    const first = loadOrCreateMasterKey(env);
    resetMasterKeyForTest();
    // Delete the key file to prove cache was cleared
    const keyPath = path.join(tmpDir, "security", "master.key");
    fs.unlinkSync(keyPath);
    const second = loadOrCreateMasterKey(env);
    expect(first.key.equals(second.key)).toBe(false);
  });
});
