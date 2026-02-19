import path from "node:path";
import { describe, expect, it } from "vitest";
import { isWithinWorkspace } from "./path-boundary.js";

describe("isWithinWorkspace", () => {
  const workspace = "/home/user/project";

  it("returns true for a path inside the workspace", () => {
    expect(isWithinWorkspace(workspace, "/home/user/project/src/index.ts")).toBe(true);
  });

  it("returns true for the workspace root itself", () => {
    expect(isWithinWorkspace(workspace, workspace)).toBe(true);
  });

  it("returns true for a nested subdirectory", () => {
    expect(isWithinWorkspace(workspace, "/home/user/project/a/b/c")).toBe(true);
  });

  it("returns false for a path outside the workspace", () => {
    expect(isWithinWorkspace(workspace, "/home/user/other-project/file.ts")).toBe(false);
  });

  it("returns false for a parent directory", () => {
    expect(isWithinWorkspace(workspace, "/home/user")).toBe(false);
  });

  it("returns false for a path traversal attempt", () => {
    expect(isWithinWorkspace(workspace, "/home/user/project/../other/secret")).toBe(false);
  });

  it("returns false for an unrelated absolute path", () => {
    expect(isWithinWorkspace(workspace, "/etc/passwd")).toBe(false);
  });

  it("handles relative candidate paths resolved against cwd", () => {
    // A relative path gets resolved against cwd, which is unlikely to be
    // inside the workspace, so this should typically return false.
    const result = isWithinWorkspace(workspace, "relative/path");
    // We just verify it doesn't throw; result depends on cwd.
    expect(typeof result).toBe("boolean");
  });

  it("returns true for paths with trailing separators", () => {
    expect(isWithinWorkspace(workspace, workspace + path.sep)).toBe(true);
  });
});
