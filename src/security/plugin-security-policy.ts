/**
 * Plugin security policy store.
 *
 * Stores per-plugin trust-level policies in
 * ~/.openclaw/security/plugin-policies/.
 * Directory permissions: 0o700. File permissions: 0o600.
 * Follows the same pattern as plugin-trust-store.ts.
 */

import fs from "node:fs";
import path from "node:path";
import { resolveStateDir } from "../config/paths.js";

export type PluginTrustLevel = "trusted" | "restricted" | "disabled";

export type PluginSecurityPolicy = {
  pluginId: string;
  trustLevel: PluginTrustLevel;
  setAt: number;
  setBy?: string;
  capabilities?: string[];
};

function resolveDefaultStoreDir(): string {
  return path.join(resolveStateDir(), "security", "plugin-policies");
}

function ensureDir(dirPath: string): void {
  fs.mkdirSync(dirPath, { recursive: true, mode: 0o700 });
  try {
    fs.chmodSync(dirPath, 0o700);
  } catch {
    // best-effort
  }
}

function isValidPluginId(pluginId: string): boolean {
  if (!pluginId || typeof pluginId !== "string") {
    return false;
  }
  if (pluginId.includes("/") || pluginId.includes("..") || pluginId.includes("\0")) {
    return false;
  }
  return true;
}

export function loadPolicy(pluginId: string, storeDir?: string): PluginSecurityPolicy | null {
  if (!isValidPluginId(pluginId)) {
    return null;
  }
  const dir = storeDir ?? resolveDefaultStoreDir();
  const filePath = path.join(dir, `${pluginId}.json`);
  if (!fs.existsSync(filePath)) {
    return null;
  }
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, "utf8")) as PluginSecurityPolicy;
    if (
      raw.pluginId === pluginId &&
      typeof raw.trustLevel === "string" &&
      ["trusted", "restricted", "disabled"].includes(raw.trustLevel)
    ) {
      return raw;
    }
  } catch {
    // corrupted file
  }
  return null;
}

export function savePolicy(policy: PluginSecurityPolicy, storeDir?: string): void {
  if (!isValidPluginId(policy.pluginId)) {
    throw new Error(`Invalid pluginId: ${policy.pluginId}`);
  }
  const dir = storeDir ?? resolveDefaultStoreDir();
  ensureDir(dir);
  const filePath = path.join(dir, `${policy.pluginId}.json`);
  fs.writeFileSync(filePath, `${JSON.stringify(policy, null, 2)}\n`, { mode: 0o600 });
  try {
    fs.chmodSync(filePath, 0o600);
  } catch {
    // best-effort
  }
}

export function listPolicies(storeDir?: string): PluginSecurityPolicy[] {
  const dir = storeDir ?? resolveDefaultStoreDir();
  if (!fs.existsSync(dir)) {
    return [];
  }

  const entries = fs.readdirSync(dir).filter((name) => name.endsWith(".json"));
  const policies: PluginSecurityPolicy[] = [];
  for (const name of entries) {
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(dir, name), "utf8")) as PluginSecurityPolicy;
      if (
        raw.pluginId &&
        typeof raw.trustLevel === "string" &&
        ["trusted", "restricted", "disabled"].includes(raw.trustLevel)
      ) {
        policies.push(raw);
      }
    } catch {
      // skip invalid files
    }
  }
  return policies;
}

export function deletePolicy(pluginId: string, storeDir?: string): boolean {
  if (!isValidPluginId(pluginId)) {
    return false;
  }
  const dir = storeDir ?? resolveDefaultStoreDir();
  const filePath = path.join(dir, `${pluginId}.json`);
  if (!fs.existsSync(filePath)) {
    return false;
  }
  fs.unlinkSync(filePath);
  return true;
}
