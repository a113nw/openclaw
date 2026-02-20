import crypto from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openJson, sealJson } from "./credential-envelope.js";
import { resetCredentialEncryptionConfigForTest } from "./credential-config.js";
import { resetMasterKeyForTest } from "./master-key.js";

// Mock master-key to avoid keychain and file system access
const testKey = crypto.randomBytes(32);
vi.mock("./master-key.js", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    loadOrCreateMasterKey: () => ({ key: testKey, source: "file" as const }),
  };
});

// Mock credential-config to control encryption flag
let _encryptionEnabled = false;
vi.mock("./credential-config.js", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    isCredentialEncryptionEnabled: () => _encryptionEnabled,
    resetCredentialEncryptionConfigForTest: () => {
      _encryptionEnabled = false;
    },
  };
});

describe("credential-envelope", () => {
  beforeEach(() => {
    _encryptionEnabled = false;
  });

  afterEach(() => {
    _encryptionEnabled = false;
    resetCredentialEncryptionConfigForTest();
    resetMasterKeyForTest();
  });

  describe("sealJson", () => {
    it("passes through when encryption is disabled", () => {
      const data = { version: 1, profiles: { foo: "bar" } };
      const result = sealJson(data);
      expect(result).toEqual(data);
    });

    it("returns encrypted envelope when encryption is enabled", () => {
      _encryptionEnabled = true;
      const data = { version: 1, profiles: { foo: "bar" } };
      const result = sealJson(data) as Record<string, unknown>;
      expect(result._encrypted).toBe(true);
      expect(result.payload).toBeDefined();
      const payload = result.payload as Record<string, unknown>;
      expect(payload.v).toBe(1);
      expect(typeof payload.iv).toBe("string");
      expect(typeof payload.ct).toBe("string");
      expect(typeof payload.tag).toBe("string");
    });
  });

  describe("openJson", () => {
    it("returns plaintext data as-is", () => {
      const data = { version: 1, profiles: { foo: "bar" } };
      expect(openJson(data)).toEqual(data);
    });

    it("decrypts encrypted envelope", () => {
      _encryptionEnabled = true;
      const data = { version: 1, profiles: { secret: "value" } };
      const sealed = sealJson(data);
      const opened = openJson(sealed);
      expect(opened).toEqual(data);
    });

    it("decrypts even when encryption flag is off (read always works)", () => {
      // Encrypt with flag on
      _encryptionEnabled = true;
      const data = { key: "api-key-123" };
      const sealed = sealJson(data);

      // Disable flag
      _encryptionEnabled = false;
      // Should still decrypt
      const opened = openJson(sealed);
      expect(opened).toEqual(data);
    });
  });

  describe("round-trip", () => {
    it("seal then open returns original data", () => {
      _encryptionEnabled = true;
      const original = {
        version: 1,
        profiles: {
          "openai:default": { type: "api_key", provider: "openai", key: "sk-xxx" },
        },
        order: { openai: ["openai:default"] },
      };
      const sealed = sealJson(original);
      const opened = openJson(sealed);
      expect(opened).toEqual(original);
    });

    it("handles nested complex objects", () => {
      _encryptionEnabled = true;
      const original = {
        tokens: {
          admin: { token: "jwt-xxx", role: "admin", scopes: ["read", "write"] },
        },
      };
      const sealed = sealJson(original);
      const opened = openJson(sealed);
      expect(opened).toEqual(original);
    });
  });
});
