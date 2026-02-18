/**
 * Secret scrubbing for log messages.
 *
 * Redacts strings that look like credentials so that config parsing
 * errors don't accidentally leak secrets into log output.
 */

/** Patterns that match common credential value shapes. */
const CREDENTIAL_VALUE_PATTERNS: ReadonlyArray<{
  pattern: RegExp;
  label: string;
}> = [
  // Common API key prefixes
  { pattern: /\bsk-[A-Za-z0-9]{20,}\b/g, label: "sk-***" },
  { pattern: /\bghp_[A-Za-z0-9]{36,}\b/g, label: "ghp_***" },
  { pattern: /\bgho_[A-Za-z0-9]{36,}\b/g, label: "gho_***" },
  { pattern: /\bghs_[A-Za-z0-9]{36,}\b/g, label: "ghs_***" },
  { pattern: /\bghu_[A-Za-z0-9]{36,}\b/g, label: "ghu_***" },
  { pattern: /\bglpat-[A-Za-z0-9_-]{20,}\b/g, label: "glpat-***" },
  { pattern: /\bxoxb-[A-Za-z0-9-]{20,}\b/g, label: "xoxb-***" },
  { pattern: /\bxoxp-[A-Za-z0-9-]{20,}\b/g, label: "xoxp-***" },
  // Bearer tokens in quoted strings
  { pattern: /Bearer\s+[A-Za-z0-9._~+/=-]{20,}/gi, label: "Bearer ***" },
  // Long base64-ish strings (>40 chars) that look like tokens
  { pattern: /\b[A-Za-z0-9+/]{40,}={0,3}\b/g, label: "[REDACTED]" },
  // Long hex strings (>40 chars) that look like secrets
  { pattern: /\b[0-9a-fA-F]{40,}\b/g, label: "[REDACTED]" },
];

/**
 * Scrub likely secret values from a log message string.
 * Intentionally conservative — only replaces strings matching known
 * credential patterns rather than broad field-name heuristics.
 */
export function scrubSecrets(message: string): string {
  let result = message;
  for (const { pattern, label } of CREDENTIAL_VALUE_PATTERNS) {
    // Reset lastIndex for global regexps reused across calls.
    pattern.lastIndex = 0;
    result = result.replace(pattern, label);
  }
  return result;
}
