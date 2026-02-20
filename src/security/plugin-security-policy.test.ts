import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  loadPolicy,
  savePolicy,
  listPolicies,
  deletePolicy,
  type PluginSecurityPolicy,
} from "./plugin-security-policy.js";

describe("plugin-security-policy", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "policy-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("savePolicy + loadPolicy", () => {
    it("round-trips a trusted policy", () => {
      const policy: PluginSecurityPolicy = {
        pluginId: "my-plugin",
        trustLevel: "trusted",
        setAt: 1000,
        setBy: "user",
      };
      savePolicy(policy, tmpDir);
      const loaded = loadPolicy("my-plugin", tmpDir);
      expect(loaded).toEqual(policy);
    });

    it("round-trips a restricted policy with capabilities", () => {
      const policy: PluginSecurityPolicy = {
        pluginId: "restricted-plugin",
        trustLevel: "restricted",
        setAt: 2000,
        setBy: "brain",
        capabilities: ["network", "messaging"],
      };
      savePolicy(policy, tmpDir);
      const loaded = loadPolicy("restricted-plugin", tmpDir);
      expect(loaded).toEqual(policy);
    });

    it("round-trips a disabled policy", () => {
      const policy: PluginSecurityPolicy = {
        pluginId: "bad-plugin",
        trustLevel: "disabled",
        setAt: 3000,
      };
      savePolicy(policy, tmpDir);
      const loaded = loadPolicy("bad-plugin", tmpDir);
      expect(loaded).toEqual(policy);
    });
  });

  describe("loadPolicy", () => {
    it("returns null for missing store", () => {
      const result = loadPolicy("nonexistent", path.join(tmpDir, "missing"));
      expect(result).toBeNull();
    });

    it("returns null for missing policy file", () => {
      fs.mkdirSync(tmpDir, { recursive: true });
      const result = loadPolicy("nonexistent", tmpDir);
      expect(result).toBeNull();
    });

    it("returns null for corrupted file", () => {
      fs.mkdirSync(tmpDir, { recursive: true });
      fs.writeFileSync(path.join(tmpDir, "corrupt.json"), "not-json{{{");
      const result = loadPolicy("corrupt", tmpDir);
      expect(result).toBeNull();
    });

    it("returns null for file with wrong pluginId", () => {
      const policy: PluginSecurityPolicy = {
        pluginId: "wrong-id",
        trustLevel: "trusted",
        setAt: 1000,
      };
      fs.mkdirSync(tmpDir, { recursive: true });
      fs.writeFileSync(
        path.join(tmpDir, "test-plugin.json"),
        JSON.stringify(policy),
      );
      const result = loadPolicy("test-plugin", tmpDir);
      expect(result).toBeNull();
    });

    it("returns null for file with invalid trustLevel", () => {
      const bad = {
        pluginId: "test-plugin",
        trustLevel: "banana",
        setAt: 1000,
      };
      fs.mkdirSync(tmpDir, { recursive: true });
      fs.writeFileSync(
        path.join(tmpDir, "test-plugin.json"),
        JSON.stringify(bad),
      );
      const result = loadPolicy("test-plugin", tmpDir);
      expect(result).toBeNull();
    });
  });

  describe("path traversal rejection", () => {
    it("rejects pluginId with /", () => {
      const result = loadPolicy("../etc/passwd", tmpDir);
      expect(result).toBeNull();
    });

    it("rejects pluginId with ..", () => {
      const result = loadPolicy("foo..bar", tmpDir);
      expect(result).toBeNull();
    });

    it("rejects pluginId with null byte", () => {
      const result = loadPolicy("foo\0bar", tmpDir);
      expect(result).toBeNull();
    });

    it("savePolicy throws for invalid pluginId", () => {
      expect(() =>
        savePolicy({ pluginId: "../bad", trustLevel: "trusted", setAt: 0 }, tmpDir),
      ).toThrow("Invalid pluginId");
    });

    it("deletePolicy returns false for invalid pluginId", () => {
      expect(deletePolicy("../bad", tmpDir)).toBe(false);
    });
  });

  describe("file permissions", () => {
    it("creates directory with 0o700", () => {
      const subDir = path.join(tmpDir, "sub");
      savePolicy(
        { pluginId: "test", trustLevel: "trusted", setAt: 0 },
        subDir,
      );
      const stat = fs.statSync(subDir);
      expect(stat.mode & 0o777).toBe(0o700);
    });

    it("creates files with 0o600", () => {
      savePolicy(
        { pluginId: "test", trustLevel: "trusted", setAt: 0 },
        tmpDir,
      );
      const stat = fs.statSync(path.join(tmpDir, "test.json"));
      expect(stat.mode & 0o777).toBe(0o600);
    });
  });

  describe("listPolicies", () => {
    it("returns empty array for missing store", () => {
      const result = listPolicies(path.join(tmpDir, "missing"));
      expect(result).toEqual([]);
    });

    it("returns all valid policies", () => {
      savePolicy({ pluginId: "a", trustLevel: "trusted", setAt: 1 }, tmpDir);
      savePolicy({ pluginId: "b", trustLevel: "restricted", setAt: 2 }, tmpDir);
      savePolicy({ pluginId: "c", trustLevel: "disabled", setAt: 3 }, tmpDir);
      const result = listPolicies(tmpDir);
      expect(result).toHaveLength(3);
      const ids = result.map((p) => p.pluginId).sort();
      expect(ids).toEqual(["a", "b", "c"]);
    });

    it("skips corrupted files", () => {
      savePolicy({ pluginId: "good", trustLevel: "trusted", setAt: 1 }, tmpDir);
      fs.writeFileSync(path.join(tmpDir, "bad.json"), "not json{{{");
      const result = listPolicies(tmpDir);
      expect(result).toHaveLength(1);
      expect(result[0]!.pluginId).toBe("good");
    });
  });

  describe("deletePolicy", () => {
    it("deletes an existing policy", () => {
      savePolicy({ pluginId: "del-me", trustLevel: "trusted", setAt: 1 }, tmpDir);
      expect(loadPolicy("del-me", tmpDir)).not.toBeNull();
      const result = deletePolicy("del-me", tmpDir);
      expect(result).toBe(true);
      expect(loadPolicy("del-me", tmpDir)).toBeNull();
    });

    it("returns false for non-existing policy", () => {
      const result = deletePolicy("nonexistent", tmpDir);
      expect(result).toBe(false);
    });
  });
});
