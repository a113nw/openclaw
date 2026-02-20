import { describe, expect, it } from "vitest";
import {
  isInterpreterBinary,
  evaluateExecAllowlist,
  evaluateShellAllowlist,
} from "./exec-approvals-allowlist.js";
import type { ExecCommandAnalysis, ExecCommandSegment } from "./exec-approvals-analysis.js";

describe("isInterpreterBinary", () => {
  it("returns true for known interpreters", () => {
    expect(isInterpreterBinary("python3")).toBe(true);
    expect(isInterpreterBinary("Python3")).toBe(true);
    expect(isInterpreterBinary("BASH")).toBe(true);
    expect(isInterpreterBinary("node")).toBe(true);
    expect(isInterpreterBinary("ruby")).toBe(true);
    expect(isInterpreterBinary("perl")).toBe(true);
    expect(isInterpreterBinary("php")).toBe(true);
    expect(isInterpreterBinary("deno")).toBe(true);
    expect(isInterpreterBinary("bun")).toBe(true);
    expect(isInterpreterBinary("lua")).toBe(true);
    expect(isInterpreterBinary("sh")).toBe(true);
    expect(isInterpreterBinary("zsh")).toBe(true);
    expect(isInterpreterBinary("fish")).toBe(true);
    expect(isInterpreterBinary("dash")).toBe(true);
    expect(isInterpreterBinary("ksh")).toBe(true);
    expect(isInterpreterBinary("pwsh")).toBe(true);
  });

  it("returns false for non-interpreter binaries", () => {
    expect(isInterpreterBinary("grep")).toBe(false);
    expect(isInterpreterBinary("jq")).toBe(false);
    expect(isInterpreterBinary("curl")).toBe(false);
    expect(isInterpreterBinary("cat")).toBe(false);
    expect(isInterpreterBinary("ls")).toBe(false);
    expect(isInterpreterBinary("git")).toBe(false);
    expect(isInterpreterBinary("docker")).toBe(false);
    expect(isInterpreterBinary("")).toBe(false);
  });
});

describe("evaluateExecAllowlist interpreter warnings", () => {
  function makeSegment(executableName: string, resolvedPath: string): ExecCommandSegment {
    return {
      argv: [executableName],
      resolution: {
        executableName,
        resolvedPath,
      },
    };
  }

  function makeAnalysis(segments: ExecCommandSegment[]): ExecCommandAnalysis {
    return { ok: true, segments };
  }

  it("populates interpreterWarnings for python3", () => {
    const result = evaluateExecAllowlist({
      analysis: makeAnalysis([makeSegment("python3", "/usr/bin/python3")]),
      allowlist: [{ pattern: "/usr/bin/python3" }],
      safeBins: new Set(),
    });
    expect(result.allowlistSatisfied).toBe(true);
    expect(result.interpreterWarnings).toEqual(["python3"]);
  });

  it("does not populate interpreterWarnings for grep", () => {
    const result = evaluateExecAllowlist({
      analysis: makeAnalysis([makeSegment("grep", "/usr/bin/grep")]),
      allowlist: [{ pattern: "/usr/bin/grep" }],
      safeBins: new Set(),
    });
    expect(result.allowlistSatisfied).toBe(true);
    expect(result.interpreterWarnings).toEqual([]);
  });

  it("returns empty interpreterWarnings when analysis fails", () => {
    const result = evaluateExecAllowlist({
      analysis: { ok: false, segments: [] },
      allowlist: [{ pattern: "/usr/bin/python3" }],
      safeBins: new Set(),
    });
    expect(result.allowlistSatisfied).toBe(false);
    expect(result.interpreterWarnings).toEqual([]);
  });

  it("returns empty interpreterWarnings when satisfied by safeBins (not allowlist)", () => {
    const result = evaluateExecAllowlist({
      analysis: makeAnalysis([
        {
          argv: ["python3"],
          resolution: {
            executableName: "python3",
            resolvedPath: "/usr/bin/python3",
          },
        },
      ]),
      allowlist: [],
      safeBins: new Set(["python3"]),
    });
    // safeBins won't match here because isSafeBinUsage has strict requirements,
    // but the key point is: interpreterWarnings only populate for allowlist matches
    expect(result.interpreterWarnings).toEqual([]);
  });
});

describe("evaluateShellAllowlist interpreter warnings", () => {
  it("propagates interpreterWarnings through shell evaluation", () => {
    // This test verifies the type contract — interpreterWarnings field exists
    const result = evaluateShellAllowlist({
      command: "python3 script.py",
      allowlist: [],
      safeBins: new Set(),
    });
    expect(result).toHaveProperty("interpreterWarnings");
    expect(Array.isArray(result.interpreterWarnings)).toBe(true);
  });

  it("returns empty interpreterWarnings on analysis failure", () => {
    const result = evaluateShellAllowlist({
      command: "",
      allowlist: [],
      safeBins: new Set(),
    });
    expect(result.interpreterWarnings).toEqual([]);
  });
});
