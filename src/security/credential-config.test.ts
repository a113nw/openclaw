import { afterEach, describe, expect, it } from "vitest";
import {
  isCredentialEncryptionEnabled,
  resolveCredentialEncryptionConfig,
  resetCredentialEncryptionConfigForTest,
} from "./credential-config.js";

describe("credential-config", () => {
  afterEach(() => {
    resetCredentialEncryptionConfigForTest();
  });

  describe("resolveCredentialEncryptionConfig", () => {
    it("returns false when env var is unset", () => {
      expect(resolveCredentialEncryptionConfig({})).toBe(false);
    });

    it("returns false for empty string", () => {
      expect(resolveCredentialEncryptionConfig({ OPENCLAW_ENCRYPT_CREDENTIALS: "" })).toBe(false);
    });

    it('returns true for "1"', () => {
      expect(resolveCredentialEncryptionConfig({ OPENCLAW_ENCRYPT_CREDENTIALS: "1" })).toBe(true);
    });

    it('returns true for "true"', () => {
      expect(resolveCredentialEncryptionConfig({ OPENCLAW_ENCRYPT_CREDENTIALS: "true" })).toBe(
        true,
      );
    });

    it('returns true for "TRUE" (case-insensitive)', () => {
      expect(resolveCredentialEncryptionConfig({ OPENCLAW_ENCRYPT_CREDENTIALS: "TRUE" })).toBe(
        true,
      );
    });

    it('returns false for "0"', () => {
      expect(resolveCredentialEncryptionConfig({ OPENCLAW_ENCRYPT_CREDENTIALS: "0" })).toBe(false);
    });

    it('returns false for "false"', () => {
      expect(resolveCredentialEncryptionConfig({ OPENCLAW_ENCRYPT_CREDENTIALS: "false" })).toBe(
        false,
      );
    });

    it("handles whitespace around value", () => {
      expect(resolveCredentialEncryptionConfig({ OPENCLAW_ENCRYPT_CREDENTIALS: " 1 " })).toBe(
        true,
      );
    });
  });

  describe("isCredentialEncryptionEnabled", () => {
    it("caches the result across calls", () => {
      const env = { OPENCLAW_ENCRYPT_CREDENTIALS: "1" };
      expect(isCredentialEncryptionEnabled(env)).toBe(true);
      // Even with a different env, cached result persists
      expect(isCredentialEncryptionEnabled({})).toBe(true);
    });

    it("reset clears the cache", () => {
      expect(isCredentialEncryptionEnabled({ OPENCLAW_ENCRYPT_CREDENTIALS: "1" })).toBe(true);
      resetCredentialEncryptionConfigForTest();
      expect(isCredentialEncryptionEnabled({})).toBe(false);
    });
  });
});
