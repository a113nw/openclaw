import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { resolveStateDir } from "../config/paths.js";

const KEY_BYTES = 32;
const KEYCHAIN_SERVICE = "OpenClaw Credential Encryption";
const KEYCHAIN_ACCOUNT = "master-key";

let _cached: { key: Buffer; source: "keychain" | "file" } | undefined;

export type MasterKeyResult = { key: Buffer; source: "keychain" | "file" };

function resolveKeyFilePath(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(resolveStateDir(env), "security", "master.key");
}

function tryReadKeychain(): Buffer | null {
  if (process.platform !== "darwin") return null;
  try {
    const hex = execFileSync(
      "security",
      ["find-generic-password", "-s", KEYCHAIN_SERVICE, "-a", KEYCHAIN_ACCOUNT, "-w"],
      { encoding: "utf8", timeout: 5000, stdio: ["pipe", "pipe", "pipe"] },
    ).trim();
    const buf = Buffer.from(hex, "hex");
    if (buf.length === KEY_BYTES) return buf;
    return null;
  } catch {
    return null;
  }
}

function tryWriteKeychain(key: Buffer): boolean {
  if (process.platform !== "darwin") return false;
  try {
    execFileSync(
      "security",
      [
        "add-generic-password",
        "-U",
        "-s",
        KEYCHAIN_SERVICE,
        "-a",
        KEYCHAIN_ACCOUNT,
        "-w",
        key.toString("hex"),
      ],
      { timeout: 5000, stdio: ["pipe", "pipe", "pipe"] },
    );
    return true;
  } catch {
    return false;
  }
}

function readKeyFile(filePath: string): Buffer | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    const hex = fs.readFileSync(filePath, "utf8").trim();
    const buf = Buffer.from(hex, "hex");
    if (buf.length === KEY_BYTES) return buf;
    return null;
  } catch {
    return null;
  }
}

function writeKeyFile(filePath: string, key: Buffer): void {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  fs.writeFileSync(filePath, key.toString("hex") + "\n", { mode: 0o600 });
  try {
    fs.chmodSync(filePath, 0o600);
  } catch {
    // best-effort
  }
}

export function loadOrCreateMasterKey(
  env: NodeJS.ProcessEnv = process.env,
): MasterKeyResult {
  if (_cached) return _cached;

  // 1. Try keychain
  const keychainKey = tryReadKeychain();
  if (keychainKey) {
    _cached = { key: keychainKey, source: "keychain" };
    return _cached;
  }

  // 2. Try file
  const filePath = resolveKeyFilePath(env);
  const fileKey = readKeyFile(filePath);
  if (fileKey) {
    // Opportunistic keychain migration on macOS
    if (process.platform === "darwin") {
      tryWriteKeychain(fileKey);
    }
    _cached = { key: fileKey, source: "file" };
    return _cached;
  }

  // 3. Generate new
  const newKey = crypto.randomBytes(KEY_BYTES);
  // Try keychain first, then file as fallback
  const wrote = tryWriteKeychain(newKey);
  writeKeyFile(filePath, newKey);
  _cached = { key: newKey, source: wrote ? "keychain" : "file" };
  return _cached;
}

export function resetMasterKeyForTest(): void {
  _cached = undefined;
}
