import { describe, expect, it } from "vitest";
import { filterHostExecEnv } from "./env-allowlist.js";

describe("filterHostExecEnv", () => {
  it("passes through safe env vars", () => {
    const env: NodeJS.ProcessEnv = {
      PATH: "/usr/bin",
      HOME: "/home/user",
      USER: "testuser",
      SHELL: "/bin/zsh",
      LANG: "en_US.UTF-8",
      TERM: "xterm-256color",
      TZ: "UTC",
      NODE_ENV: "production",
    };
    const result = filterHostExecEnv(env);
    expect(result.PATH).toBe("/usr/bin");
    expect(result.HOME).toBe("/home/user");
    expect(result.USER).toBe("testuser");
    expect(result.SHELL).toBe("/bin/zsh");
    expect(result.LANG).toBe("en_US.UTF-8");
    expect(result.TERM).toBe("xterm-256color");
    expect(result.TZ).toBe("UTC");
    expect(result.NODE_ENV).toBe("production");
  });

  it("blocks API key env vars", () => {
    const env: NodeJS.ProcessEnv = {
      PATH: "/usr/bin",
      ANTHROPIC_API_KEY: "sk-ant-secret",
      OPENAI_API_KEY: "sk-openai-secret",
      GITHUB_TOKEN: "ghp_1234567890",
    };
    const result = filterHostExecEnv(env);
    expect(result.PATH).toBe("/usr/bin");
    expect(result.ANTHROPIC_API_KEY).toBeUndefined();
    expect(result.OPENAI_API_KEY).toBeUndefined();
    expect(result.GITHUB_TOKEN).toBeUndefined();
  });

  it("blocks secret/token/password suffixed vars", () => {
    const env: NodeJS.ProcessEnv = {
      HOME: "/home/user",
      MY_SECRET: "supersecret",
      DB_PASSWORD: "dbpass",
      CUSTOM_TOKEN: "tok123",
      SSH_PRIVATE_KEY: "keydata",
    };
    const result = filterHostExecEnv(env);
    expect(result.HOME).toBe("/home/user");
    expect(result.MY_SECRET).toBeUndefined();
    expect(result.DB_PASSWORD).toBeUndefined();
    expect(result.CUSTOM_TOKEN).toBeUndefined();
    expect(result.SSH_PRIVATE_KEY).toBeUndefined();
  });

  it("passes through host-specific allowed vars", () => {
    const env: NodeJS.ProcessEnv = {
      EDITOR: "vim",
      VISUAL: "code",
      PAGER: "less",
      TMPDIR: "/tmp",
      XDG_CONFIG_HOME: "/home/user/.config",
      COLORTERM: "truecolor",
      SSH_AUTH_SOCK: "/tmp/ssh-agent.sock",
      HOSTNAME: "myhost",
      LOGNAME: "testuser",
    };
    const result = filterHostExecEnv(env);
    expect(result.EDITOR).toBe("vim");
    expect(result.VISUAL).toBe("code");
    expect(result.PAGER).toBe("less");
    expect(result.TMPDIR).toBe("/tmp");
    expect(result.XDG_CONFIG_HOME).toBe("/home/user/.config");
    expect(result.COLORTERM).toBe("truecolor");
    expect(result.SSH_AUTH_SOCK).toBe("/tmp/ssh-agent.sock");
    expect(result.HOSTNAME).toBe("myhost");
    expect(result.LOGNAME).toBe("testuser");
  });

  it("blocks unknown env vars in strict mode", () => {
    const env: NodeJS.ProcessEnv = {
      PATH: "/usr/bin",
      SOME_RANDOM_VAR: "value",
      ANOTHER_UNKNOWN: "data",
    };
    const result = filterHostExecEnv(env);
    expect(result.PATH).toBe("/usr/bin");
    expect(result.SOME_RANDOM_VAR).toBeUndefined();
    expect(result.ANOTHER_UNKNOWN).toBeUndefined();
  });

  it("skips undefined values in process.env", () => {
    const env: NodeJS.ProcessEnv = {
      PATH: "/usr/bin",
      MISSING: undefined,
    };
    const result = filterHostExecEnv(env);
    expect(result.PATH).toBe("/usr/bin");
    expect("MISSING" in result).toBe(false);
  });

  it("passes through LC_ prefixed vars", () => {
    const env: NodeJS.ProcessEnv = {
      LC_ALL: "en_US.UTF-8",
      LC_CTYPE: "UTF-8",
    };
    const result = filterHostExecEnv(env);
    expect(result.LC_ALL).toBe("en_US.UTF-8");
    expect(result.LC_CTYPE).toBe("UTF-8");
  });

  it("blocks AWS credential vars", () => {
    const env: NodeJS.ProcessEnv = {
      PATH: "/usr/bin",
      AWS_SECRET_ACCESS_KEY: "aws-secret",
      AWS_SESSION_TOKEN: "aws-session",
    };
    const result = filterHostExecEnv(env);
    expect(result.PATH).toBe("/usr/bin");
    expect(result.AWS_SECRET_ACCESS_KEY).toBeUndefined();
    expect(result.AWS_SESSION_TOKEN).toBeUndefined();
  });
});
