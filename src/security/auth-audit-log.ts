/**
 * Centralized authentication audit log.
 *
 * Records auth events (success / failure) as structured JSONL for
 * post-hoc brute-force analysis and compliance reporting.
 *
 * Writes to `~/.openclaw/security/auth-audit.jsonl` with automatic
 * rotation when the file exceeds 5 MB.
 */

import fs from "node:fs";
import path from "node:path";
import { resolveStateDir } from "../config/paths.js";

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB

export type AuthAuditEvent = {
  type: "auth_success" | "auth_failure";
  ip?: string;
  method?: string;
  reason?: string;
  timestamp: number;
};

let auditDir: string | null = null;

function resolveAuditDir(): string {
  if (!auditDir) {
    auditDir = path.join(resolveStateDir(), "security");
  }
  return auditDir;
}

function resolveAuditPath(): string {
  return path.join(resolveAuditDir(), "auth-audit.jsonl");
}

function ensureAuditDir(): void {
  const dir = resolveAuditDir();
  try {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  } catch {
    // ignore — write will fail gracefully
  }
}

function rotateIfNeeded(filePath: string): void {
  try {
    const stat = fs.statSync(filePath);
    if (stat.size >= MAX_FILE_SIZE) {
      const rotated = `${filePath}.1`;
      // Keep only one rotated copy.
      try {
        fs.unlinkSync(rotated);
      } catch {}
      fs.renameSync(filePath, rotated);
    }
  } catch {
    // File doesn't exist yet — nothing to rotate.
  }
}

/**
 * Record an authentication event to the audit log.
 * Failures are intentionally silent — audit logging must not
 * interfere with the auth flow.
 */
export function recordAuthEvent(event: AuthAuditEvent): void {
  try {
    ensureAuditDir();
    const filePath = resolveAuditPath();
    rotateIfNeeded(filePath);
    const line = JSON.stringify(event) + "\n";
    fs.appendFileSync(filePath, line, { mode: 0o600 });
  } catch {
    // Best-effort: never throw from audit logging.
  }
}
