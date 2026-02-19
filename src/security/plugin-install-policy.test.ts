import { describe, expect, it } from "vitest";
import { shouldBlockPluginInstall, type ScanSummary } from "./plugin-install-policy.js";

describe("shouldBlockPluginInstall", () => {
  it("does not block when there are no critical findings", () => {
    const summary: ScanSummary = {
      critical: 0,
      warn: 3,
      findings: [
        { severity: "warn", message: "suspicious pattern", file: "index.ts", line: 10 },
      ],
    };
    expect(shouldBlockPluginInstall(summary, false)).toEqual({ block: false });
  });

  it("blocks when there are critical findings and force is false", () => {
    const summary: ScanSummary = {
      critical: 2,
      warn: 0,
      findings: [
        { severity: "critical", message: "uses eval()", file: "main.ts", line: 5 },
        { severity: "critical", message: "requires child_process", file: "main.ts", line: 12 },
      ],
    };
    const result = shouldBlockPluginInstall(summary, false);
    expect(result.block).toBe(true);
    expect(result.reason).toContain("2 critical finding(s)");
    expect(result.reason).toContain("uses eval()");
    expect(result.reason).toContain("requires child_process");
    expect(result.reason).toContain("main.ts:5");
    expect(result.reason).toContain("main.ts:12");
    expect(result.reason).toContain("--force");
  });

  it("does not block when force is true even with critical findings", () => {
    const summary: ScanSummary = {
      critical: 1,
      warn: 0,
      findings: [
        { severity: "critical", message: "uses eval()", file: "index.ts", line: 1 },
      ],
    };
    expect(shouldBlockPluginInstall(summary, true)).toEqual({ block: false });
  });

  it("only includes critical findings in the reason details", () => {
    const summary: ScanSummary = {
      critical: 1,
      warn: 1,
      findings: [
        { severity: "critical", message: "uses eval()", file: "a.ts", line: 1 },
        { severity: "warn", message: "large file", file: "b.ts", line: 100 },
      ],
    };
    const result = shouldBlockPluginInstall(summary, false);
    expect(result.block).toBe(true);
    expect(result.reason).toContain("uses eval()");
    expect(result.reason).not.toContain("large file");
  });

  it("handles zero findings with zero critical count", () => {
    const summary: ScanSummary = { critical: 0, warn: 0, findings: [] };
    expect(shouldBlockPluginInstall(summary, false)).toEqual({ block: false });
  });
});
