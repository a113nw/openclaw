import { describe, expect, it } from "vitest";
import {
  generateSigningKey,
  computeKeyId,
  canonicalizeManifest,
  signPluginManifest,
  verifyPluginManifest,
} from "./plugin-signer.js";

describe("plugin-signer", () => {
  describe("generateSigningKey", () => {
    it("generates a valid key with keyId derived from public key", () => {
      const key = generateSigningKey();
      expect(key.publicKeyPem).toContain("BEGIN PUBLIC KEY");
      expect(key.privateKeyPem).toContain("BEGIN PRIVATE KEY");
      expect(key.keyId).toMatch(/^[a-f0-9]{64}$/);
    });

    it("keyId matches computeKeyId from public key", () => {
      const key = generateSigningKey();
      const derivedId = computeKeyId(key.publicKeyPem);
      expect(derivedId).toBe(key.keyId);
    });

    it("generates unique keys each time", () => {
      const key1 = generateSigningKey();
      const key2 = generateSigningKey();
      expect(key1.keyId).not.toBe(key2.keyId);
    });
  });

  describe("canonicalizeManifest", () => {
    it("produces deterministic JSON with sorted keys", () => {
      const m1 = { b: 2, a: 1 };
      const m2 = { a: 1, b: 2 };
      expect(canonicalizeManifest(m1)).toBe(canonicalizeManifest(m2));
    });

    it("strips signature field before canonicalization", () => {
      const withSig = { a: 1, signature: { sig: "abc", keyId: "123", signedAt: 0 }, b: 2 };
      const withoutSig = { a: 1, b: 2 };
      expect(canonicalizeManifest(withSig)).toBe(canonicalizeManifest(withoutSig));
    });

    it("returns valid JSON", () => {
      const result = canonicalizeManifest({ id: "test", version: "1.0" });
      expect(() => JSON.parse(result)).not.toThrow();
    });
  });

  describe("sign and verify round-trip", () => {
    it("verifies a correctly signed manifest", () => {
      const key = generateSigningKey();
      const manifest = { id: "test-plugin", version: "1.0.0", configSchema: {} };
      const sig = signPluginManifest({
        manifest,
        privateKeyPem: key.privateKeyPem,
        keyId: key.keyId,
      });
      expect(sig.sig).toBeTruthy();
      expect(sig.keyId).toBe(key.keyId);
      expect(sig.signedAt).toBeGreaterThan(0);

      const result = verifyPluginManifest({
        manifest,
        signature: sig,
        publicKeyPem: key.publicKeyPem,
      });
      expect(result.valid).toBe(true);
      expect(result.reason).toBeUndefined();
    });

    it("rejects a manifest signed with wrong key", () => {
      const key1 = generateSigningKey();
      const key2 = generateSigningKey();
      const manifest = { id: "test", configSchema: {} };
      const sig = signPluginManifest({
        manifest,
        privateKeyPem: key1.privateKeyPem,
        keyId: key1.keyId,
      });

      const result = verifyPluginManifest({
        manifest,
        signature: sig,
        publicKeyPem: key2.publicKeyPem,
      });
      expect(result.valid).toBe(false);
      expect(result.reason).toBe("key ID mismatch");
    });

    it("detects tampered manifest", () => {
      const key = generateSigningKey();
      const manifest = { id: "test", version: "1.0", configSchema: {} };
      const sig = signPluginManifest({
        manifest,
        privateKeyPem: key.privateKeyPem,
        keyId: key.keyId,
      });

      const tampered = { ...manifest, version: "2.0" };
      const result = verifyPluginManifest({
        manifest: tampered,
        signature: sig,
        publicKeyPem: key.publicKeyPem,
      });
      expect(result.valid).toBe(false);
      expect(result.reason).toBe("signature verification failed");
    });

    it("handles signature field in manifest (stripped during verification)", () => {
      const key = generateSigningKey();
      const manifest = { id: "test", configSchema: {} };
      const sig = signPluginManifest({
        manifest,
        privateKeyPem: key.privateKeyPem,
        keyId: key.keyId,
      });

      // Add signature to manifest (as it would appear in the file)
      const manifestWithSig = { ...manifest, signature: sig };
      const result = verifyPluginManifest({
        manifest: manifestWithSig,
        signature: sig,
        publicKeyPem: key.publicKeyPem,
      });
      expect(result.valid).toBe(true);
    });
  });
});
