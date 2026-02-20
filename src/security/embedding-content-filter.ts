/**
 * Embedding content filter.
 *
 * Redacts sensitive content (API keys, tokens, passwords, private keys,
 * connection strings) before text reaches the embedding pipeline.
 *
 * Addresses MED-06: memory indexer processes all file content without
 * sanitization before embedding.
 */

import type { PluginRegistry } from "../plugins/registry.js";
import type {
  PluginHookRegistration as TypedPluginHookRegistration,
  PluginHookBeforeMemoryIndexEvent,
  PluginHookBeforeMemoryIndexResult,
  PluginHookMemoryIndexContext,
} from "../plugins/types.js";

// ---------------------------------------------------------------------------
// Credential patterns
// ---------------------------------------------------------------------------

/** Patterns that match sensitive content to redact before embedding. */
const SENSITIVE_PATTERNS: ReadonlyArray<{
  pattern: RegExp;
  replacement: string;
}> = [
  // API key prefixes
  { pattern: /\bsk-[A-Za-z0-9]{20,}\b/g, replacement: "sk-[REDACTED]" },
  { pattern: /\bghp_[A-Za-z0-9]{36,}\b/g, replacement: "ghp_[REDACTED]" },
  { pattern: /\bgho_[A-Za-z0-9]{36,}\b/g, replacement: "gho_[REDACTED]" },
  { pattern: /\bghs_[A-Za-z0-9]{36,}\b/g, replacement: "ghs_[REDACTED]" },
  { pattern: /\bghu_[A-Za-z0-9]{36,}\b/g, replacement: "ghu_[REDACTED]" },
  { pattern: /\bglpat-[A-Za-z0-9_-]{20,}\b/g, replacement: "glpat-[REDACTED]" },
  { pattern: /\bxoxb-[A-Za-z0-9-]{20,}\b/g, replacement: "xoxb-[REDACTED]" },
  { pattern: /\bxoxp-[A-Za-z0-9-]{20,}\b/g, replacement: "xoxp-[REDACTED]" },
  { pattern: /\bAKIA[A-Z0-9]{16,}\b/g, replacement: "AKIA[REDACTED]" },

  // Bearer tokens
  { pattern: /Bearer\s+[A-Za-z0-9._~+/=-]{20,}/gi, replacement: "Bearer [REDACTED]" },

  // PEM private key blocks
  {
    pattern: /-----BEGIN\s+(?:RSA\s+|EC\s+|DSA\s+|OPENSSH\s+)?PRIVATE KEY-----[\s\S]*?-----END\s+(?:RSA\s+|EC\s+|DSA\s+|OPENSSH\s+)?PRIVATE KEY-----/g,
    replacement: "[REDACTED_PRIVATE_KEY]",
  },

  // .env credential assignments (KEY=value or KEY="value" or KEY='value')
  {
    pattern: /^[ \t]*(?:export\s+)?(?:[A-Z_]*(?:SECRET|TOKEN|PASSWORD|CREDENTIAL|API_KEY|PRIVATE_KEY|ACCESS_KEY|AUTH)[A-Z_]*)=.*$/gm,
    replacement: "[REDACTED_ENV_CREDENTIAL]",
  },

  // Code credential assignments: password = "...", secret: "...", etc.
  {
    pattern: /(?:password|passwd|secret|api_key|apikey|access_token|auth_token|private_key)\s*[:=]\s*["'][^"']{8,}["']/gi,
    replacement: "[REDACTED_CREDENTIAL_ASSIGNMENT]",
  },

  // Connection strings with embedded credentials (postgres://user:pass@host, mysql://, mongodb://, etc.)
  {
    pattern: /(?:postgres|postgresql|mysql|mongodb|redis|amqp|mssql):\/\/[^\s:]+:[^\s@]+@[^\s]+/gi,
    replacement: "[REDACTED_CONNECTION_STRING]",
  },

  // Long base64-ish strings (>40 chars) that look like tokens
  { pattern: /\b[A-Za-z0-9+/]{40,}={0,3}\b/g, replacement: "[REDACTED]" },
  // Long hex strings (>40 chars) that look like secrets
  { pattern: /\b[0-9a-fA-F]{40,}\b/g, replacement: "[REDACTED]" },
];

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Redact sensitive content from text before embedding.
 *
 * Pure function — does not modify state. Idempotent: applying the filter
 * twice produces the same result as applying it once.
 */
export function filterSensitiveContent(content: string): string {
  if (!content) {
    return content;
  }

  let result = content;
  for (const { pattern, replacement } of SENSITIVE_PATTERNS) {
    // Reset lastIndex for global regexps reused across calls.
    pattern.lastIndex = 0;
    result = result.replace(pattern, replacement);
  }
  return result;
}

/**
 * Register the default embedding content filter as an internal
 * `before_memory_index` plugin hook.
 */
export function registerEmbeddingContentFilter(registry: PluginRegistry): void {
  const handler = (
    event: PluginHookBeforeMemoryIndexEvent,
    _ctx: PluginHookMemoryIndexContext,
  ): PluginHookBeforeMemoryIndexResult => {
    const filtered = filterSensitiveContent(event.content);
    if (filtered !== event.content) {
      return { content: filtered };
    }
    return {};
  };

  registry.typedHooks.push({
    pluginId: "__embedding_content_filter",
    hookName: "before_memory_index",
    handler,
    priority: 500,
    source: "security/embedding-content-filter",
  } as TypedPluginHookRegistration);
}
