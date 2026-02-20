import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  addTrustedKey,
  findTrustedKey,
  loadOrCreateSigningKey,
  loadTrustedKeys,
  removeTrustedKey,
} from "./plugin-trust-store.js";
import { generateSigningKey } from "./plugin-signer.js";

describe("plugin-trust-store", () => {
  let tmpDir: string;
  let storeDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "trust-store-test-"));
    storeDir = path.join(tmpDir, "trusted-keys");
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("CRUD operations", () => {
    it("returns empty array when store does not exist", () => {
      const keys = loadTrustedKeys(storeDir);
      expect(keys).toEqual([]);
    });

    it("adds and loads a key", () => {
      const key = {
        keyId: "abc123",
        publicKeyPem: "-----BEGIN PUBLIC KEY-----\ntest\n-----END PUBLIC KEY-----",
        addedAt: Date.now(),
        label: "test key",
      };
      addTrustedKey(key, storeDir);
      const keys = loadTrustedKeys(storeDir);
      expect(keys).toHaveLength(1);
      expect(keys[0].keyId).toBe("abc123");
      expect(keys[0].label).toBe("test key");
    });

    it("finds a key by ID", () => {
      const key = {
        keyId: "find-me",
        publicKeyPem: "-----BEGIN PUBLIC KEY-----\nfind\n-----END PUBLIC KEY-----",
        addedAt: Date.now(),
      };
      addTrustedKey(key, storeDir);
      const found = findTrustedKey("find-me", storeDir);
      expect(found).not.toBeNull();
      expect(found?.keyId).toBe("find-me");
    });

    it("returns null for non-existent key", () => {
      const found = findTrustedKey("nonexistent", storeDir);
      expect(found).toBeNull();
    });

    it("removes a key", () => {
      const key = {
        keyId: "remove-me",
        publicKeyPem: "-----BEGIN PUBLIC KEY-----\nremove\n-----END PUBLIC KEY-----",
        addedAt: Date.now(),
      };
      addTrustedKey(key, storeDir);
      expect(findTrustedKey("remove-me", storeDir)).not.toBeNull();
      const removed = removeTrustedKey("remove-me", storeDir);
      expect(removed).toBe(true);
      expect(findTrustedKey("remove-me", storeDir)).toBeNull();
    });

    it("returns false when removing non-existent key", () => {
      const removed = removeTrustedKey("nope", storeDir);
      expect(removed).toBe(false);
    });
  });

  describe("file permissions", () => {
    it("creates store directory with restricted permissions", () => {
      const key = {
        keyId: "perm-test",
        publicKeyPem: "-----BEGIN PUBLIC KEY-----\nperm\n-----END PUBLIC KEY-----",
        addedAt: Date.now(),
      };
      addTrustedKey(key, storeDir);
      const stat = fs.statSync(storeDir);
      // Check at least owner-only permissions (0o700 masked with umask)
      expect(stat.mode & 0o077).toBe(0);
    });

    it("creates key files with 0o600 permissions", () => {
      const key = {
        keyId: "perm-file",
        publicKeyPem: "-----BEGIN PUBLIC KEY-----\nperm\n-----END PUBLIC KEY-----",
        addedAt: Date.now(),
      };
      addTrustedKey(key, storeDir);
      const filePath = path.join(storeDir, "perm-file.json");
      const stat = fs.statSync(filePath);
      expect(stat.mode & 0o777).toBe(0o600);
    });
  });

  describe("loadOrCreateSigningKey", () => {
    it("generates a key on first use", () => {
      const keyPath = path.join(tmpDir, "signing-key.json");
      const key = loadOrCreateSigningKey(keyPath);
      expect(key.publicKeyPem).toContain("BEGIN PUBLIC KEY");
      expect(key.privateKeyPem).toContain("BEGIN PRIVATE KEY");
      expect(key.keyId).toMatch(/^[a-f0-9]{64}$/);
    });

    it("returns the same key on subsequent loads", () => {
      const keyPath = path.join(tmpDir, "signing-key.json");
      const key1 = loadOrCreateSigningKey(keyPath);
      const key2 = loadOrCreateSigningKey(keyPath);
      expect(key1.keyId).toBe(key2.keyId);
      expect(key1.publicKeyPem).toBe(key2.publicKeyPem);
    });

    it("regenerates if file is corrupted", () => {
      const keyPath = path.join(tmpDir, "signing-key.json");
      fs.mkdirSync(path.dirname(keyPath), { recursive: true });
      fs.writeFileSync(keyPath, "not json");
      const key = loadOrCreateSigningKey(keyPath);
      expect(key.keyId).toMatch(/^[a-f0-9]{64}$/);
    });
  });
});
