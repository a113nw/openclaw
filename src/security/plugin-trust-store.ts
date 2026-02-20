/**
 * Plugin signing key trust store.
 *
 * Stores trusted public keys in ~/.openclaw/security/trusted-plugin-keys/.
 * Directory permissions: 0o700. File permissions: 0o600.
 * Follows the same pattern as auth-audit-log.ts.
 */

import fs from "node:fs";
import path from "node:path";
import { resolveStateDir } from "../config/paths.js";
import { generateSigningKey, computeKeyId, type PluginSigningKey } from "./plugin-signer.js";

export type TrustedKey = {
  keyId: string;
  publicKeyPem: string;
  addedAt: number;
  label?: string;
};

type StoredSigningKey = {
  version: 1;
  publicKeyPem: string;
  privateKeyPem: string;
  keyId: string;
  createdAt: number;
};

function resolveDefaultStoreDir(): string {
  return path.join(resolveStateDir(), "security", "trusted-plugin-keys");
}

function resolveDefaultSigningKeyPath(): string {
  return path.join(resolveStateDir(), "security", "plugin-signing-key.json");
}

function ensureDir(dirPath: string): void {
  fs.mkdirSync(dirPath, { recursive: true, mode: 0o700 });
  try {
    fs.chmodSync(dirPath, 0o700);
  } catch {
    // best-effort
  }
}

export function loadTrustedKeys(storeDir?: string): TrustedKey[] {
  const dir = storeDir ?? resolveDefaultStoreDir();
  if (!fs.existsSync(dir)) {
    return [];
  }

  const entries = fs.readdirSync(dir).filter((name) => name.endsWith(".json"));
  const keys: TrustedKey[] = [];
  for (const name of entries) {
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(dir, name), "utf8")) as TrustedKey;
      if (raw.keyId && raw.publicKeyPem) {
        keys.push(raw);
      }
    } catch {
      // skip invalid files
    }
  }
  return keys;
}

export function findTrustedKey(keyId: string, storeDir?: string): TrustedKey | null {
  const dir = storeDir ?? resolveDefaultStoreDir();
  const filePath = path.join(dir, `${keyId}.json`);
  if (!fs.existsSync(filePath)) {
    return null;
  }
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, "utf8")) as TrustedKey;
    if (raw.keyId === keyId && raw.publicKeyPem) {
      return raw;
    }
  } catch {
    // invalid
  }
  return null;
}

export function addTrustedKey(key: TrustedKey, storeDir?: string): void {
  const dir = storeDir ?? resolveDefaultStoreDir();
  ensureDir(dir);
  const filePath = path.join(dir, `${key.keyId}.json`);
  fs.writeFileSync(filePath, `${JSON.stringify(key, null, 2)}\n`, { mode: 0o600 });
  try {
    fs.chmodSync(filePath, 0o600);
  } catch {
    // best-effort
  }
}

export function removeTrustedKey(keyId: string, storeDir?: string): boolean {
  const dir = storeDir ?? resolveDefaultStoreDir();
  const filePath = path.join(dir, `${keyId}.json`);
  if (!fs.existsSync(filePath)) {
    return false;
  }
  fs.unlinkSync(filePath);
  return true;
}

export function loadOrCreateSigningKey(keyPath?: string): PluginSigningKey {
  const filePath = keyPath ?? resolveDefaultSigningKeyPath();

  try {
    if (fs.existsSync(filePath)) {
      const raw = JSON.parse(fs.readFileSync(filePath, "utf8")) as StoredSigningKey;
      if (
        raw.version === 1 &&
        typeof raw.publicKeyPem === "string" &&
        typeof raw.privateKeyPem === "string" &&
        typeof raw.keyId === "string"
      ) {
        // Re-derive keyId to verify integrity
        const derivedId = computeKeyId(raw.publicKeyPem);
        return {
          publicKeyPem: raw.publicKeyPem,
          privateKeyPem: raw.privateKeyPem,
          keyId: derivedId,
        };
      }
    }
  } catch {
    // fall through to regenerate
  }

  const key = generateSigningKey();
  ensureDir(path.dirname(filePath));
  const stored: StoredSigningKey = {
    version: 1,
    publicKeyPem: key.publicKeyPem,
    privateKeyPem: key.privateKeyPem,
    keyId: key.keyId,
    createdAt: Date.now(),
  };
  fs.writeFileSync(filePath, `${JSON.stringify(stored, null, 2)}\n`, { mode: 0o600 });
  try {
    fs.chmodSync(filePath, 0o600);
  } catch {
    // best-effort
  }
  return key;
}
