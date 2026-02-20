import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import { decrypt, encrypt, isEncryptedPayload, type EncryptedPayload } from "./credential-cipher.js";

describe("credential-cipher", () => {
  const key = crypto.randomBytes(32);

  describe("round-trip", () => {
    it("encrypts and decrypts simple string", () => {
      const plaintext = "hello world";
      const payload = encrypt(plaintext, key);
      expect(decrypt(payload, key)).toBe(plaintext);
    });

    it("encrypts and decrypts JSON content", () => {
      const data = JSON.stringify({ apiKey: "sk-secret-123", token: "abc" });
      const payload = encrypt(data, key);
      expect(decrypt(payload, key)).toBe(data);
    });

    it("encrypts and decrypts empty string", () => {
      const payload = encrypt("", key);
      expect(decrypt(payload, key)).toBe("");
    });

    it("encrypts and decrypts unicode content", () => {
      const plaintext = "Héllo Wörld 🔐";
      const payload = encrypt(plaintext, key);
      expect(decrypt(payload, key)).toBe(plaintext);
    });
  });

  describe("random IV", () => {
    it("produces different ciphertext for same plaintext", () => {
      const a = encrypt("same input", key);
      const b = encrypt("same input", key);
      expect(a.iv).not.toBe(b.iv);
      expect(a.ct).not.toBe(b.ct);
    });
  });

  describe("tamper detection", () => {
    it("fails with tampered ciphertext", () => {
      const payload = encrypt("secret", key);
      const ctBuf = Buffer.from(payload.ct, "base64");
      ctBuf[0] ^= 0xff;
      const tampered: EncryptedPayload = { ...payload, ct: ctBuf.toString("base64") };
      expect(() => decrypt(tampered, key)).toThrow();
    });

    it("fails with tampered auth tag", () => {
      const payload = encrypt("secret", key);
      const tagBuf = Buffer.from(payload.tag, "base64");
      tagBuf[0] ^= 0xff;
      const tampered: EncryptedPayload = { ...payload, tag: tagBuf.toString("base64") };
      expect(() => decrypt(tampered, key)).toThrow();
    });

    it("fails with tampered IV", () => {
      const payload = encrypt("secret", key);
      const ivBuf = Buffer.from(payload.iv, "base64");
      ivBuf[0] ^= 0xff;
      const tampered: EncryptedPayload = { ...payload, iv: ivBuf.toString("base64") };
      expect(() => decrypt(tampered, key)).toThrow();
    });
  });

  describe("wrong key", () => {
    it("fails to decrypt with different key", () => {
      const payload = encrypt("secret", key);
      const wrongKey = crypto.randomBytes(32);
      expect(() => decrypt(payload, wrongKey)).toThrow();
    });
  });

  describe("version check", () => {
    it("rejects unsupported version", () => {
      const payload = encrypt("secret", key);
      const bad: EncryptedPayload = { ...payload, v: 99 };
      expect(() => decrypt(bad, key)).toThrow(/unsupported credential cipher version/);
    });
  });

  describe("isEncryptedPayload", () => {
    it("returns true for valid encrypted envelope", () => {
      const payload = encrypt("test", key);
      expect(isEncryptedPayload({ _encrypted: true, payload })).toBe(true);
    });

    it("returns false for null", () => {
      expect(isEncryptedPayload(null)).toBe(false);
    });

    it("returns false for plaintext object", () => {
      expect(isEncryptedPayload({ version: 1, profiles: {} })).toBe(false);
    });

    it("returns false when _encrypted is not true", () => {
      expect(isEncryptedPayload({ _encrypted: false, payload: {} })).toBe(false);
    });

    it("returns false when payload is missing fields", () => {
      expect(isEncryptedPayload({ _encrypted: true, payload: { v: 1 } })).toBe(false);
    });

    it("returns false for non-object", () => {
      expect(isEncryptedPayload("string")).toBe(false);
    });
  });
});
