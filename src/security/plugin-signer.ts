/**
 * Ed25519 plugin manifest signing and verification.
 *
 * Reuses patterns from device-identity.ts for key generation and signing.
 */

import crypto from "node:crypto";

export type PluginSigningKey = {
  publicKeyPem: string;
  privateKeyPem: string;
  keyId: string;
};

export type PluginSignature = {
  sig: string;
  keyId: string;
  signedAt: number;
};

export type PluginSignatureVerifyResult = {
  valid: boolean;
  reason?: string;
};

const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

function derivePublicKeyRaw(publicKeyPem: string): Buffer {
  const key = crypto.createPublicKey(publicKeyPem);
  const spki = key.export({ type: "spki", format: "der" }) as Buffer;
  if (
    spki.length === ED25519_SPKI_PREFIX.length + 32 &&
    spki.subarray(0, ED25519_SPKI_PREFIX.length).equals(ED25519_SPKI_PREFIX)
  ) {
    return spki.subarray(ED25519_SPKI_PREFIX.length);
  }
  return spki;
}

export function computeKeyId(publicKeyPem: string): string {
  const raw = derivePublicKeyRaw(publicKeyPem);
  return crypto.createHash("sha256").update(raw).digest("hex");
}

export function generateSigningKey(): PluginSigningKey {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  const publicKeyPem = publicKey.export({ type: "spki", format: "pem" }).toString();
  const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const keyId = computeKeyId(publicKeyPem);
  return { publicKeyPem, privateKeyPem, keyId };
}

export function canonicalizeManifest(manifest: Record<string, unknown>): string {
  const copy = { ...manifest };
  delete copy.signature;
  const sortedKeys = Object.keys(copy).sort();
  const sorted: Record<string, unknown> = {};
  for (const key of sortedKeys) {
    sorted[key] = copy[key];
  }
  return JSON.stringify(sorted);
}

export function signPluginManifest(params: {
  manifest: Record<string, unknown>;
  privateKeyPem: string;
  keyId: string;
}): PluginSignature {
  const canonical = canonicalizeManifest(params.manifest);
  const key = crypto.createPrivateKey(params.privateKeyPem);
  const sig = crypto.sign(null, Buffer.from(canonical, "utf8"), key);
  return {
    sig: sig.toString("base64"),
    keyId: params.keyId,
    signedAt: Date.now(),
  };
}

export function verifyPluginManifest(params: {
  manifest: Record<string, unknown>;
  signature: PluginSignature;
  publicKeyPem: string;
}): PluginSignatureVerifyResult {
  try {
    const expectedKeyId = computeKeyId(params.publicKeyPem);
    if (expectedKeyId !== params.signature.keyId) {
      return { valid: false, reason: "key ID mismatch" };
    }

    const canonical = canonicalizeManifest(params.manifest);
    const key = crypto.createPublicKey(params.publicKeyPem);
    const sig = Buffer.from(params.signature.sig, "base64");
    const valid = crypto.verify(null, Buffer.from(canonical, "utf8"), key, sig);
    if (!valid) {
      return { valid: false, reason: "signature verification failed" };
    }
    return { valid: true };
  } catch (err) {
    return { valid: false, reason: `verification error: ${String(err)}` };
  }
}
