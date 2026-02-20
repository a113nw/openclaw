import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  generateSigningKey,
  canonicalizeManifest,
  signPluginManifest,
  verifyPluginManifest,
  computeKeyId,
} from "../plugin-signer.js";
import {
  addTrustedKey,
  findTrustedKey,
  loadOrCreateSigningKey,
  loadTrustedKeys,
  removeTrustedKey,
} from "../plugin-trust-store.js";

describe("plugin signing integration", () => {
  let tmpDir: string;
  let storeDir: string;
  let keyPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "plugin-signing-int-"));
    storeDir = path.join(tmpDir, "trusted-keys");
    keyPath = path.join(tmpDir, "signing-key.json");
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("full sign → trust → verify flow", () => {
    // 1. Generate or load signing key
    const signingKey = loadOrCreateSigningKey(keyPath);

    // 2. Sign a manifest
    const manifest = {
      id: "my-plugin",
      version: "1.0.0",
      configSchema: { token: { type: "string" } },
    };
    const signature = signPluginManifest({
      manifest,
      privateKeyPem: signingKey.privateKeyPem,
      keyId: signingKey.keyId,
    });

    // 3. Add signing key to trust store
    addTrustedKey(
      {
        keyId: signingKey.keyId,
        publicKeyPem: signingKey.publicKeyPem,
        addedAt: Date.now(),
        label: "test publisher",
      },
      storeDir,
    );

    // 4. Verify: look up trusted key and verify signature
    const trusted = findTrustedKey(signingKey.keyId, storeDir);
    expect(trusted).not.toBeNull();

    const result = verifyPluginManifest({
      manifest: { ...manifest, signature },
      signature,
      publicKeyPem: trusted!.publicKeyPem,
    });
    expect(result.valid).toBe(true);
  });

  it("rejects tampered manifest after signing", () => {
    const signingKey = loadOrCreateSigningKey(keyPath);
    const manifest = { id: "safe-plugin", configSchema: {} };
    const signature = signPluginManifest({
      manifest,
      privateKeyPem: signingKey.privateKeyPem,
      keyId: signingKey.keyId,
    });

    addTrustedKey(
      {
        keyId: signingKey.keyId,
        publicKeyPem: signingKey.publicKeyPem,
        addedAt: Date.now(),
      },
      storeDir,
    );

    // Tamper: change the plugin id
    const tampered = { id: "evil-plugin", configSchema: {} };
    const result = verifyPluginManifest({
      manifest: tampered,
      signature,
      publicKeyPem: signingKey.publicKeyPem,
    });
    expect(result.valid).toBe(false);
  });

  it("reports untrusted key when key not in store", () => {
    const signingKey = generateSigningKey();
    const manifest = { id: "unknown-publisher", configSchema: {} };
    const signature = signPluginManifest({
      manifest,
      privateKeyPem: signingKey.privateKeyPem,
      keyId: signingKey.keyId,
    });

    // Don't add key to trust store
    const trusted = findTrustedKey(signingKey.keyId, storeDir);
    expect(trusted).toBeNull();

    // Verification still works if you have the public key directly
    const result = verifyPluginManifest({
      manifest,
      signature,
      publicKeyPem: signingKey.publicKeyPem,
    });
    expect(result.valid).toBe(true);
  });

  it("trust store CRUD lifecycle", () => {
    const key1 = generateSigningKey();
    const key2 = generateSigningKey();

    addTrustedKey(
      { keyId: key1.keyId, publicKeyPem: key1.publicKeyPem, addedAt: Date.now() },
      storeDir,
    );
    addTrustedKey(
      { keyId: key2.keyId, publicKeyPem: key2.publicKeyPem, addedAt: Date.now() },
      storeDir,
    );

    expect(loadTrustedKeys(storeDir)).toHaveLength(2);

    removeTrustedKey(key1.keyId, storeDir);
    expect(loadTrustedKeys(storeDir)).toHaveLength(1);
    expect(findTrustedKey(key1.keyId, storeDir)).toBeNull();
    expect(findTrustedKey(key2.keyId, storeDir)).not.toBeNull();
  });

  it("signing key persists across loads", () => {
    const key1 = loadOrCreateSigningKey(keyPath);
    const key2 = loadOrCreateSigningKey(keyPath);
    expect(key1.keyId).toBe(key2.keyId);
    expect(key1.publicKeyPem).toBe(key2.publicKeyPem);
    expect(key1.privateKeyPem).toBe(key2.privateKeyPem);
  });
});
