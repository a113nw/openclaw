/**
 * Integration test: env-allowlist filtering.
 *
 * Verifies that `filterHostExecEnv` correctly strips dangerous env vars
 * while preserving the standard set needed by commands.
 */
import { describe, expect, it } from "vitest";
import { filterHostExecEnv } from "../env-allowlist.js";

describe("env filtering integration", () => {
  it("blocks common secret-bearing env vars", () => {
    const env: NodeJS.ProcessEnv = {
      PATH: "/usr/bin:/bin",
      HOME: "/home/user",
      ANTHROPIC_API_KEY: "sk-ant-secret",
      OPENAI_API_KEY: "sk-openai-secret",
      GITHUB_TOKEN: "ghp_xxxxxxxxxxxx",
      AWS_SECRET_ACCESS_KEY: "aws-secret",
      EDITOR: "vim",
    };
    const filtered = filterHostExecEnv(env);

    expect(filtered.PATH).toBe("/usr/bin:/bin");
    expect(filtered.HOME).toBe("/home/user");
    expect(filtered.EDITOR).toBe("vim");
    expect(filtered.ANTHROPIC_API_KEY).toBeUndefined();
    expect(filtered.OPENAI_API_KEY).toBeUndefined();
    expect(filtered.GITHUB_TOKEN).toBeUndefined();
    expect(filtered.AWS_SECRET_ACCESS_KEY).toBeUndefined();
  });

  it("preserves standard shell env vars", () => {
    const env: NodeJS.ProcessEnv = {
      PATH: "/usr/local/bin:/usr/bin",
      HOME: "/home/test",
      USER: "test",
      SHELL: "/bin/zsh",
      LANG: "en_US.UTF-8",
      TERM: "xterm-256color",
      TZ: "UTC",
      NODE_ENV: "production",
      VISUAL: "code",
      PAGER: "less",
      TMPDIR: "/tmp",
      XDG_CONFIG_HOME: "/home/test/.config",
    };
    const filtered = filterHostExecEnv(env);

    expect(filtered.PATH).toBeDefined();
    expect(filtered.HOME).toBeDefined();
    expect(filtered.SHELL).toBeDefined();
    expect(filtered.LANG).toBeDefined();
    expect(filtered.TERM).toBeDefined();
    expect(filtered.VISUAL).toBeDefined();
    expect(filtered.PAGER).toBeDefined();
    expect(filtered.TMPDIR).toBeDefined();
    expect(filtered.XDG_CONFIG_HOME).toBeDefined();
  });

  it("blocks vars with _TOKEN, _SECRET, _KEY, _PASSWORD suffixes", () => {
    const env: NodeJS.ProcessEnv = {
      PATH: "/bin",
      MY_APP_TOKEN: "tok123",
      DATABASE_PASSWORD: "dbpass",
      CUSTOM_SECRET: "shhh",
      SIGNING_KEY: "key123",
    };
    const filtered = filterHostExecEnv(env);

    expect(filtered.PATH).toBeDefined();
    expect(filtered.MY_APP_TOKEN).toBeUndefined();
    expect(filtered.DATABASE_PASSWORD).toBeUndefined();
    expect(filtered.CUSTOM_SECRET).toBeUndefined();
    expect(filtered.SIGNING_KEY).toBeUndefined();
  });

  it("skips undefined values in process.env", () => {
    const env: NodeJS.ProcessEnv = {
      PATH: "/bin",
      UNDEF_VAR: undefined,
    };
    const filtered = filterHostExecEnv(env);

    expect(filtered.PATH).toBeDefined();
    expect("UNDEF_VAR" in filtered).toBe(false);
  });

  it("returns a plain object, not the original reference", () => {
    const env: NodeJS.ProcessEnv = { PATH: "/bin" };
    const filtered = filterHostExecEnv(env);
    expect(filtered).not.toBe(env);
  });
});
