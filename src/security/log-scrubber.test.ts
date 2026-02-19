import { describe, expect, it } from "vitest";
import { scrubSecrets } from "./log-scrubber.js";

describe("scrubSecrets", () => {
  it("redacts sk- prefixed API keys", () => {
    const msg = "Config error: token is sk-abcdefghijklmnopqrst1234567890";
    expect(scrubSecrets(msg)).toContain("sk-***");
    expect(scrubSecrets(msg)).not.toContain("abcdefghijklmnopqrst");
  });

  it("redacts GitHub personal access tokens", () => {
    const token = "ghp_" + "A".repeat(36);
    const msg = `Auth failed with token ${token}`;
    expect(scrubSecrets(msg)).toContain("ghp_***");
    expect(scrubSecrets(msg)).not.toContain(token);
  });

  it("redacts GitHub OAuth tokens (gho_)", () => {
    const token = "gho_" + "B".repeat(36);
    const msg = `token: ${token}`;
    expect(scrubSecrets(msg)).toContain("gho_***");
  });

  it("redacts GitHub server tokens (ghs_)", () => {
    const token = "ghs_" + "C".repeat(36);
    expect(scrubSecrets(`value=${token}`)).toContain("ghs_***");
  });

  it("redacts GitHub user tokens (ghu_)", () => {
    const token = "ghu_" + "D".repeat(36);
    expect(scrubSecrets(`key: ${token}`)).toContain("ghu_***");
  });

  it("redacts GitLab personal access tokens", () => {
    const token = "glpat-" + "x".repeat(20);
    expect(scrubSecrets(`token=${token}`)).toContain("glpat-***");
  });

  it("redacts Slack bot tokens", () => {
    const token = "xoxb-" + "1234567890-" + "a".repeat(20);
    expect(scrubSecrets(`slack: ${token}`)).toContain("xoxb-***");
  });

  it("redacts Slack user tokens", () => {
    const token = "xoxp-" + "9876543210-" + "b".repeat(20);
    expect(scrubSecrets(`slack: ${token}`)).toContain("xoxp-***");
  });

  it("redacts Bearer tokens", () => {
    const bearer = "Bearer " + "A".repeat(40);
    expect(scrubSecrets(`Authorization: ${bearer}`)).toContain("Bearer ***");
    expect(scrubSecrets(`Authorization: ${bearer}`)).not.toContain("A".repeat(40));
  });

  it("redacts long hex strings", () => {
    const hex = "a1b2c3d4e5f6".repeat(4); // 48 hex chars
    const msg = `hash: ${hex}`;
    expect(scrubSecrets(msg)).toContain("[REDACTED]");
    expect(scrubSecrets(msg)).not.toContain(hex);
  });

  it("preserves short non-secret strings", () => {
    const msg = "Config key 'model' has value 'gpt-4'";
    expect(scrubSecrets(msg)).toBe(msg);
  });

  it("preserves normal error messages without secrets", () => {
    const msg = "Invalid config at /home/user/.openclaw/config.json:\n- gateway.port: must be a number";
    expect(scrubSecrets(msg)).toBe(msg);
  });

  it("handles empty string", () => {
    expect(scrubSecrets("")).toBe("");
  });

  it("handles multiple secrets in one message", () => {
    const sk = "sk-" + "a".repeat(40);
    const ghp = "ghp_" + "B".repeat(36);
    const msg = `Keys: ${sk} and ${ghp}`;
    const scrubbed = scrubSecrets(msg);
    expect(scrubbed).toContain("sk-***");
    expect(scrubbed).toContain("ghp_***");
    expect(scrubbed).not.toContain(sk);
    expect(scrubbed).not.toContain(ghp);
  });

  it("is idempotent — scrubbing twice gives the same result", () => {
    const msg = "token: sk-" + "x".repeat(30);
    const once = scrubSecrets(msg);
    const twice = scrubSecrets(once);
    expect(twice).toBe(once);
  });

  it("does not redact short sk- values", () => {
    const msg = "sk-short";
    expect(scrubSecrets(msg)).toBe(msg);
  });
});
