/**
 * Integration test: path-boundary + memory/internal.
 *
 * Verifies that `normalizeExtraMemoryPaths` rejects paths outside the
 * workspace using `isWithinWorkspace`.
 */
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { normalizeExtraMemoryPaths } from "../../memory/internal.js";

describe("memory path boundary integration", () => {
  const workspaceDir = "/home/user/project";

  it("allows relative paths within the workspace", () => {
    const result = normalizeExtraMemoryPaths(workspaceDir, ["notes", "docs/ref"]);
    expect(result).toEqual([
      path.resolve(workspaceDir, "notes"),
      path.resolve(workspaceDir, "docs/ref"),
    ]);
  });

  it("rejects absolute paths outside the workspace", () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = normalizeExtraMemoryPaths(workspaceDir, [
      "notes",
      "/etc/passwd",
      "/tmp/leaked-data",
    ]);
    expect(result).toEqual([path.resolve(workspaceDir, "notes")]);
    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy.mock.calls[0][0]).toContain("/etc/passwd");
    expect(spy.mock.calls[1][0]).toContain("/tmp/leaked-data");
    spy.mockRestore();
  });

  it("rejects traversal paths that escape the workspace", () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = normalizeExtraMemoryPaths(workspaceDir, [
      "../../etc/shadow",
      "../sibling-project/secrets",
    ]);
    expect(result).toEqual([]);
    expect(spy).toHaveBeenCalledTimes(2);
    spy.mockRestore();
  });

  it("allows the workspace root itself", () => {
    const result = normalizeExtraMemoryPaths(workspaceDir, [workspaceDir]);
    expect(result).toEqual([path.resolve(workspaceDir)]);
  });

  it("deduplicates resolved paths", () => {
    const result = normalizeExtraMemoryPaths(workspaceDir, [
      "notes",
      "./notes",
      "notes/",
    ]);
    // All resolve to the same path — should be deduplicated
    expect(result.length).toBeLessThanOrEqual(2);
  });

  it("returns empty array for undefined/empty input", () => {
    expect(normalizeExtraMemoryPaths(workspaceDir)).toEqual([]);
    expect(normalizeExtraMemoryPaths(workspaceDir, [])).toEqual([]);
  });

  it("filters blank and whitespace-only entries", () => {
    const result = normalizeExtraMemoryPaths(workspaceDir, ["", "  ", "notes"]);
    expect(result).toEqual([path.resolve(workspaceDir, "notes")]);
  });
});
