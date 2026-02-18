/**
 * Environment variable filtering for host-mode exec commands.
 *
 * When the gateway runs commands directly on the host (non-sandbox),
 * `process.env` may contain API keys, tokens, and other secrets that
 * should not be exposed to agent-initiated commands.  This module
 * provides allowlist-based filtering aligned with the sandbox
 * sanitisation patterns in `agents/sandbox/sanitize-env-vars.ts`.
 */

import { sanitizeEnvVars } from "../agents/sandbox/sanitize-env-vars.js";

/**
 * Additional allowlist entries beyond the base set in sanitize-env-vars.
 * These cover common host-specific env vars that are safe for commands.
 */
const HOST_EXTRA_ALLOWED: ReadonlyArray<RegExp> = [
  /^EDITOR$/i,
  /^VISUAL$/i,
  /^PAGER$/i,
  /^TMPDIR$/i,
  /^XDG_\w+$/i,
  /^COLORTERM$/i,
  /^FORCE_COLOR$/i,
  /^NO_COLOR$/i,
  /^COLUMNS$/i,
  /^LINES$/i,
  /^HOSTNAME$/i,
  /^LOGNAME$/i,
  /^SSH_AUTH_SOCK$/i,
];

/**
 * Filter `process.env` for host-mode exec, blocking secrets while
 * preserving the env vars commands typically need.
 *
 * Uses `sanitizeEnvVars` in strict mode so only explicitly allowed
 * env vars pass through, then also blocks any known-dangerous keys.
 */
export function filterHostExecEnv(
  env: NodeJS.ProcessEnv,
): Record<string, string> {
  const coerced: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (typeof value === "string") {
      coerced[key] = value;
    }
  }
  const result = sanitizeEnvVars(coerced, {
    strictMode: true,
    customAllowedPatterns: HOST_EXTRA_ALLOWED,
  });
  return result.allowed;
}
