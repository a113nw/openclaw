import { describe, expect, it, vi, beforeEach } from "vitest";
import { filterSensitiveContent, registerEmbeddingContentFilter } from "./embedding-content-filter.js";
import type { PluginRegistry } from "../plugins/registry.js";

// ==========================================================================
// filterSensitiveContent
// ==========================================================================

describe("filterSensitiveContent", () => {
  // ---- API key prefixes --------------------------------------------------

  it("redacts sk- prefixed keys", () => {
    const input = "My key is sk-abcdefghij1234567890xx and more";
    const result = filterSensitiveContent(input);
    expect(result).toContain("sk-[REDACTED]");
    expect(result).not.toContain("abcdefghij1234567890xx");
  });

  it("redacts ghp_ prefixed tokens", () => {
    const input = "ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijkl";
    const result = filterSensitiveContent(input);
    expect(result).toContain("ghp_[REDACTED]");
    expect(result).not.toContain("ABCDEFGHIJKLMNOP");
  });

  it("redacts gho_ prefixed tokens", () => {
    const input = "token=gho_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijkl";
    const result = filterSensitiveContent(input);
    expect(result).toContain("gho_[REDACTED]");
  });

  it("redacts ghs_ prefixed tokens", () => {
    const input = "ghs_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijkl";
    const result = filterSensitiveContent(input);
    expect(result).toContain("ghs_[REDACTED]");
  });

  it("redacts ghu_ prefixed tokens", () => {
    const input = "ghu_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijkl";
    const result = filterSensitiveContent(input);
    expect(result).toContain("ghu_[REDACTED]");
  });

  it("redacts glpat- prefixed tokens", () => {
    const input = "token: glpat-abcdefghij1234567890";
    const result = filterSensitiveContent(input);
    expect(result).toContain("glpat-[REDACTED]");
  });

  it("redacts xoxb- prefixed tokens", () => {
    const input = "The token is xoxb-12345678901-abcdefgh for Slack";
    const result = filterSensitiveContent(input);
    expect(result).toContain("xoxb-[REDACTED]");
    expect(result).not.toContain("12345678901-abcdefgh");
  });

  it("redacts xoxp- prefixed tokens", () => {
    const input = "xoxp-12345678901-abcdefgh";
    const result = filterSensitiveContent(input);
    expect(result).toContain("xoxp-[REDACTED]");
  });

  it("redacts AKIA prefixed AWS keys", () => {
    const input = "aws_key = AKIAIOSFODNN7EXAMPLE";
    const result = filterSensitiveContent(input);
    expect(result).toContain("AKIA[REDACTED]");
    expect(result).not.toContain("IOSFODNN7EXAMPLE");
  });

  // ---- Bearer tokens -----------------------------------------------------

  it("redacts Bearer tokens", () => {
    const input = 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0';
    const result = filterSensitiveContent(input);
    expect(result).toContain("Bearer [REDACTED]");
    expect(result).not.toContain("eyJhbGciOiJIUzI1NiIs");
  });

  // ---- PEM private key blocks --------------------------------------------

  it("redacts PEM private key blocks", () => {
    const input = `Here is a key:
-----BEGIN RSA PRIVATE KEY-----
MIIEowIBAAKCAQEA7l0n+KjRpFdGbY+qjDTV1t0UFFK
base64data
-----END RSA PRIVATE KEY-----
and more text.`;
    const result = filterSensitiveContent(input);
    expect(result).toContain("[REDACTED_PRIVATE_KEY]");
    expect(result).not.toContain("MIIEowIBAAKCAQEA7l0n");
    expect(result).toContain("and more text.");
  });

  it("redacts EC private key blocks", () => {
    const input = `-----BEGIN EC PRIVATE KEY-----
MHQCAQEEIBkg
-----END EC PRIVATE KEY-----`;
    const result = filterSensitiveContent(input);
    expect(result).toContain("[REDACTED_PRIVATE_KEY]");
  });

  it("redacts OPENSSH private key blocks", () => {
    const input = `-----BEGIN OPENSSH PRIVATE KEY-----
b3BlbnNzaC1rZXktdjEAAAAABG5vbmU
-----END OPENSSH PRIVATE KEY-----`;
    const result = filterSensitiveContent(input);
    expect(result).toContain("[REDACTED_PRIVATE_KEY]");
  });

  // ---- .env credential lines ---------------------------------------------

  it("redacts .env credential assignments", () => {
    const input = `# Database config
DB_HOST=localhost
SECRET_TOKEN=abc123def456
API_KEY="my-super-secret-key"
PORT=3000`;
    const result = filterSensitiveContent(input);
    expect(result).toContain("[REDACTED_ENV_CREDENTIAL]");
    expect(result).toContain("DB_HOST=localhost");
    expect(result).toContain("PORT=3000");
    expect(result).not.toContain("abc123def456");
    expect(result).not.toContain("my-super-secret-key");
  });

  it("redacts exported env credentials", () => {
    const input = "export AUTH_TOKEN=somevalue123";
    const result = filterSensitiveContent(input);
    expect(result).toContain("[REDACTED_ENV_CREDENTIAL]");
    expect(result).not.toContain("somevalue123");
  });

  it("preserves non-sensitive env lines", () => {
    const input = `NODE_ENV=production
PORT=8080
DEBUG=true`;
    const result = filterSensitiveContent(input);
    expect(result).toBe(input);
  });

  // ---- Code credential assignments --------------------------------------

  it("redacts password assignments in code", () => {
    const input = 'const dbConfig = { password: "mysecretpassword123" };';
    const result = filterSensitiveContent(input);
    expect(result).toContain("[REDACTED_CREDENTIAL_ASSIGNMENT]");
    expect(result).not.toContain("mysecretpassword123");
  });

  it("redacts secret assignments in code", () => {
    const input = "secret = 'very-long-secret-value'";
    const result = filterSensitiveContent(input);
    expect(result).toContain("[REDACTED_CREDENTIAL_ASSIGNMENT]");
  });

  it("redacts api_key assignments in code", () => {
    const input = 'api_key: "abcdefghijklmnop"';
    const result = filterSensitiveContent(input);
    expect(result).toContain("[REDACTED_CREDENTIAL_ASSIGNMENT]");
  });

  // ---- Connection strings ------------------------------------------------

  it("redacts postgres connection strings", () => {
    const input = "DATABASE_URL=postgres://admin:s3cretpass@db.example.com:5432/mydb";
    const result = filterSensitiveContent(input);
    expect(result).toContain("[REDACTED_CONNECTION_STRING]");
    expect(result).not.toContain("s3cretpass");
  });

  it("redacts mysql connection strings", () => {
    const input = "mysql://root:password@localhost/db";
    const result = filterSensitiveContent(input);
    expect(result).toContain("[REDACTED_CONNECTION_STRING]");
  });

  it("redacts mongodb connection strings", () => {
    const input = "mongodb://user:pass@mongo.example.com:27017/app";
    const result = filterSensitiveContent(input);
    expect(result).toContain("[REDACTED_CONNECTION_STRING]");
  });

  it("redacts redis connection strings", () => {
    const input = "redis://default:secretpw@redis.example.com:6379";
    const result = filterSensitiveContent(input);
    expect(result).toContain("[REDACTED_CONNECTION_STRING]");
  });

  // ---- Long base64/hex strings -------------------------------------------

  it("redacts long base64-like strings", () => {
    const longBase64 = "A".repeat(50);
    const input = `token: ${longBase64}`;
    const result = filterSensitiveContent(input);
    expect(result).toContain("[REDACTED]");
    expect(result).not.toContain(longBase64);
  });

  it("redacts long hex strings", () => {
    const longHex = "a1b2c3d4e5".repeat(9);
    const input = `hash: ${longHex}`;
    const result = filterSensitiveContent(input);
    expect(result).toContain("[REDACTED]");
    expect(result).not.toContain(longHex);
  });

  // ---- Passthrough -------------------------------------------------------

  it("passes normal markdown through unchanged", () => {
    const input = `# My Document

This is a regular markdown document with some code:

\`\`\`javascript
const x = 42;
console.log("hello world");
\`\`\`

- Item 1
- Item 2
`;
    expect(filterSensitiveContent(input)).toBe(input);
  });

  it("returns empty string for empty input", () => {
    expect(filterSensitiveContent("")).toBe("");
  });

  it("is idempotent (double-filter produces same result)", () => {
    const input = `sk-abcdefghij1234567890xx and password: "mysecret123456"
postgres://admin:secret@host/db
-----BEGIN PRIVATE KEY-----
data
-----END PRIVATE KEY-----`;
    const once = filterSensitiveContent(input);
    const twice = filterSensitiveContent(once);
    expect(twice).toBe(once);
  });
});

// ==========================================================================
// registerEmbeddingContentFilter
// ==========================================================================

describe("registerEmbeddingContentFilter", () => {
  let registry: PluginRegistry;

  beforeEach(() => {
    registry = {
      plugins: [],
      tools: [],
      hooks: [],
      typedHooks: [],
      channels: [],
      providers: [],
      httpHandlers: [],
      httpRoutes: [],
      gatewayMethods: [],
      cliRegistrars: [],
      services: [],
      commands: [],
      diagnostics: [],
    } as unknown as PluginRegistry;
  });

  it("pushes a hook with correct hookName and pluginId", () => {
    registerEmbeddingContentFilter(registry);
    expect(registry.typedHooks).toHaveLength(1);
    const hook = registry.typedHooks[0]!;
    expect(hook.hookName).toBe("before_memory_index");
    expect(hook.pluginId).toBe("__embedding_content_filter");
    expect(hook.priority).toBe(500);
  });

  it("handler filters sensitive content from event", () => {
    registerEmbeddingContentFilter(registry);
    const hook = registry.typedHooks[0]!;
    const event = {
      path: "/test/file.md",
      source: "memory" as const,
      content: "key: sk-abcdefghij1234567890xx",
    };
    const result = (hook.handler as Function)(event, { path: event.path });
    expect(result).toHaveProperty("content");
    expect((result as { content: string }).content).toContain("sk-[REDACTED]");
  });

  it("handler returns empty object when content unchanged", () => {
    registerEmbeddingContentFilter(registry);
    const hook = registry.typedHooks[0]!;
    const event = {
      path: "/test/file.md",
      source: "memory" as const,
      content: "This is plain markdown with no secrets.",
    };
    const result = (hook.handler as Function)(event, { path: event.path });
    expect(result).toEqual({});
  });
});
