/**
 * Integration test: log-scrubber in config error paths.
 *
 * Verifies that `scrubSecrets` is applied when config validation errors
 * include credential-like strings, matching the pattern used in io.ts.
 */
import { describe, expect, it } from "vitest";
import { scrubSecrets } from "../log-scrubber.js";

describe("log scrubbing integration", () => {
  it("scrubs API keys from config validation error messages", () => {
    // Simulate the template string format used in io.ts line 582
    const configPath = "/home/user/.openclaw/config.json";
    const apiKey = "sk-" + "a".repeat(40);
    const details = `- gateway.auth.token: expected string, received ${apiKey}`;
    const logMessage = `Invalid config at ${configPath}:\n${details}`;

    const scrubbed = scrubSecrets(logMessage);
    expect(scrubbed).toContain("Invalid config at");
    expect(scrubbed).toContain("sk-***");
    expect(scrubbed).not.toContain(apiKey);
  });

  it("scrubs GitHub tokens from config error details", () => {
    const ghpToken = "ghp_" + "A".repeat(36);
    const message = `Config warnings:\n- plugins.github.token: value ${ghpToken} is not valid`;

    const scrubbed = scrubSecrets(message);
    expect(scrubbed).toContain("ghp_***");
    expect(scrubbed).not.toContain(ghpToken);
  });

  it("scrubs Bearer tokens from error messages", () => {
    const bearer = "Bearer " + "x".repeat(50);
    const message = `Failed to read config at /config.json: Authorization: ${bearer}`;

    const scrubbed = scrubSecrets(message);
    expect(scrubbed).toContain("Bearer ***");
    expect(scrubbed).not.toContain("x".repeat(50));
  });

  it("scrubs multiple different token types in one message", () => {
    const sk = "sk-" + "b".repeat(30);
    const slack = "xoxb-" + "1234567890-" + "c".repeat(20);
    const message = `Tokens found: ${sk}, ${slack}`;

    const scrubbed = scrubSecrets(message);
    expect(scrubbed).toContain("sk-***");
    expect(scrubbed).toContain("xoxb-***");
    expect(scrubbed).not.toContain(sk);
    expect(scrubbed).not.toContain(slack);
  });

  it("preserves normal config paths and error messages", () => {
    const message = `Invalid config at /home/user/.openclaw/config.json:\n- gateway.port: must be a number\n- agents.list: must be an array`;
    expect(scrubSecrets(message)).toBe(message);
  });

  it("scrubs long hex strings that might be leaked secret hashes", () => {
    const hexSecret = "a1b2c3d4e5f6".repeat(5); // 60 hex chars
    const message = `Failed to read config at /config.json: hash=${hexSecret}`;

    const scrubbed = scrubSecrets(message);
    expect(scrubbed).toContain("[REDACTED]");
    expect(scrubbed).not.toContain(hexSecret);
  });

  it("handles repeated calls without lastIndex drift (global regex safety)", () => {
    const key = "sk-" + "z".repeat(40);
    const msg = `token: ${key}`;

    // Call multiple times — global regex lastIndex must be reset between calls
    for (let i = 0; i < 5; i++) {
      const result = scrubSecrets(msg);
      expect(result).toContain("sk-***");
      expect(result).not.toContain(key);
    }
  });
});
