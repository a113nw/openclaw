/**
 * Integration test: sensitive config field detection — schema.hints.ts.
 *
 * Verifies the expanded SENSITIVE_PATTERNS and whitelist work correctly
 * through the public `isSensitiveConfigPath` and `applySensitiveHints` APIs.
 */
import { describe, expect, it } from "vitest";
import {
  applySensitiveHints,
  isSensitiveConfigPath,
  type ConfigUiHints,
} from "../../config/schema.hints.js";

describe("sensitive config hints integration", () => {
  describe("isSensitiveConfigPath", () => {
    it.each([
      "gateway.auth.token",
      "gateway.auth.password",
      "plugins.slack.botToken",
      "providers.openai.apiKey",
      "providers.custom.apikey",
      "channels.webhook.secret",
      "gateway.auth.bearer",
      "plugins.custom.credential",
      "providers.aws.accessKey",
      "tls.privateKey",
      "plugins.jwt.signingKey",
      "oauth.clientSecret",
    ])("detects %s as sensitive", (path) => {
      expect(isSensitiveConfigPath(path)).toBe(true);
    });

    it.each([
      "agents.list[].tools.maxTokens",
      "agents.list[].maxOutputTokens",
      "agents.list[].maxInputTokens",
      "agents.list[].maxCompletionTokens",
      "agents.list[].contextTokens",
      "agents.list[].totalTokens",
      "agents.list[].tokenCount",
      "agents.list[].tokenLimit",
      "agents.list[].tokenBudget",
      "gateway.auth.passwordFile",
      "git.publickey",
      "git.credentialhelper",
      "auth.preferredcredentials",
    ])("whitelists %s as non-sensitive", (path) => {
      expect(isSensitiveConfigPath(path)).toBe(false);
    });

    it("detects non-obvious sensitive fields", () => {
      // These are new patterns added in the security scaffolding
      expect(isSensitiveConfigPath("custom.bearer")).toBe(true);
      expect(isSensitiveConfigPath("proxy.accessKey")).toBe(true);
      expect(isSensitiveConfigPath("webhook.signingKey")).toBe(true);
      expect(isSensitiveConfigPath("oauth.clientSecret")).toBe(true);
    });

    it("returns false for completely unrelated paths", () => {
      expect(isSensitiveConfigPath("gateway.port")).toBe(false);
      expect(isSensitiveConfigPath("agents.list[].name")).toBe(false);
      expect(isSensitiveConfigPath("logging.level")).toBe(false);
    });
  });

  describe("applySensitiveHints", () => {
    it("marks sensitive paths in the hints object", () => {
      const hints: ConfigUiHints = {
        "gateway.auth.token": { label: "Auth Token" },
        "gateway.port": { label: "Port" },
        "plugins.slack.botToken": { label: "Bot Token" },
      };

      const result = applySensitiveHints(hints);

      expect(result["gateway.auth.token"]?.sensitive).toBe(true);
      expect(result["gateway.port"]?.sensitive).toBeUndefined();
      expect(result["plugins.slack.botToken"]?.sensitive).toBe(true);
    });

    it("does not overwrite existing sensitive hints", () => {
      const hints: ConfigUiHints = {
        "gateway.auth.token": { label: "Token", sensitive: false },
      };

      const result = applySensitiveHints(hints);

      // Existing explicit sensitive=false should not be overwritten
      expect(result["gateway.auth.token"]?.sensitive).toBe(false);
    });

    it("respects the allowedKeys filter", () => {
      const hints: ConfigUiHints = {
        "gateway.auth.token": { label: "Token" },
        "gateway.auth.password": { label: "Password" },
      };

      const result = applySensitiveHints(hints, new Set(["gateway.auth.token"]));

      expect(result["gateway.auth.token"]?.sensitive).toBe(true);
      // password key was not in allowedKeys, so not processed
      expect(result["gateway.auth.password"]?.sensitive).toBeUndefined();
    });

    it("does not mark whitelisted keys as sensitive", () => {
      const hints: ConfigUiHints = {
        "agents.list[].tools.maxTokens": { label: "Max Tokens" },
        "gateway.auth.passwordFile": { label: "Password File Path" },
      };

      const result = applySensitiveHints(hints);

      expect(result["agents.list[].tools.maxTokens"]?.sensitive).toBeUndefined();
      expect(result["gateway.auth.passwordFile"]?.sensitive).toBeUndefined();
    });
  });
});
