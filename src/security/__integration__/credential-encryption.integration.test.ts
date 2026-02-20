/**
 * Integration test: credential encryption end-to-end.
 *
 * Verifies the full flow: write encrypted → read back → verify;
 * plaintext → enable → migrate → verify; disable → read encrypted → verify.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// We use the real cipher, but mock master-key and credential-config
// to avoid keychain access and control the encryption flag.

const testKey = crypto.randomBytes(32);

vi.mock("../master-key.js", () => ({
  loadOrCreateMasterKey: () => ({ key: testKey, source: "file" as const }),
  resetMasterKeyForTest: () => {},
}));

let encryptionEnabled = false;
vi.mock("../credential-config.js", () => ({
  isCredentialEncryptionEnabled: () => encryptionEnabled,
  resolveCredentialEncryptionConfig: () => encryptionEnabled,
  resetCredentialEncryptionConfigForTest: () => {
    encryptionEnabled = false;
  },
}));

// Import after mocks are set up
const { encrypt, decrypt, isEncryptedPayload } = await import("../credential-cipher.js");
const { sealJson, openJson } = await import("../credential-envelope.js");

describe("credential encryption integration", () => {
  let tmpDir: string;

  beforeEach(() => {
    encryptionEnabled = false;
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cred-encrypt-int-"));
  });

  afterEach(() => {
    encryptionEnabled = false;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("write encrypted → read back → data matches", () => {
    encryptionEnabled = true;
    const original = {
      version: 1,
      profiles: {
        "openai:default": { type: "api_key", provider: "openai", key: "sk-secret-key" },
        "anthropic:default": { type: "token", provider: "anthropic", token: "ant-token-xxx" },
      },
    };

    // Simulate save
    const sealed = sealJson(original);
    const filePath = path.join(tmpDir, "auth-profiles.json");
    fs.writeFileSync(filePath, JSON.stringify(sealed, null, 2), "utf8");

    // Verify file on disk is encrypted
    const rawOnDisk = JSON.parse(fs.readFileSync(filePath, "utf8"));
    expect(rawOnDisk._encrypted).toBe(true);
    expect(rawOnDisk.payload).toBeDefined();
    expect(rawOnDisk.payload.v).toBe(1);

    // Simulate load
    const loaded = openJson(rawOnDisk);
    expect(loaded).toEqual(original);
  });

  it("plaintext → enable → write → file becomes encrypted", () => {
    const data = { version: 1, tokens: { admin: { token: "plain-token" } } };
    const filePath = path.join(tmpDir, "device-auth.json");

    // Write as plaintext (encryption disabled)
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");

    // Read back - should be plaintext
    const rawPlain = JSON.parse(fs.readFileSync(filePath, "utf8"));
    expect(rawPlain._encrypted).toBeUndefined();
    expect(openJson(rawPlain)).toEqual(data);

    // Enable encryption and re-write
    encryptionEnabled = true;
    const sealed = sealJson(data);
    fs.writeFileSync(filePath, JSON.stringify(sealed, null, 2), "utf8");

    // Verify encrypted on disk
    const rawEncrypted = JSON.parse(fs.readFileSync(filePath, "utf8"));
    expect(rawEncrypted._encrypted).toBe(true);

    // Read back
    const loaded = openJson(rawEncrypted);
    expect(loaded).toEqual(data);
  });

  it("disable → encrypted file still readable", () => {
    encryptionEnabled = true;
    const data = { secret: "classified" };
    const sealed = sealJson(data);

    // Disable encryption
    encryptionEnabled = false;

    // openJson still decrypts
    const opened = openJson(sealed);
    expect(opened).toEqual(data);

    // New write should be plaintext
    const newSealed = sealJson(data);
    expect(newSealed).toEqual(data);
  });

  it("cipher round-trip with raw API", () => {
    const plaintext = JSON.stringify({ key: "value", nested: [1, 2, 3] });
    const payload = encrypt(plaintext, testKey);

    expect(isEncryptedPayload({ _encrypted: true, payload })).toBe(true);
    expect(decrypt(payload, testKey)).toBe(plaintext);
  });

  it("multiple encrypt/decrypt cycles produce consistent results", () => {
    encryptionEnabled = true;
    const data = { credentials: Array.from({ length: 10 }, (_, i) => ({ id: i, key: `key-${i}` })) };

    for (let i = 0; i < 5; i++) {
      const sealed = sealJson(data);
      const opened = openJson(sealed);
      expect(opened).toEqual(data);
    }
  });
});
