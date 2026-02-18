/**
 * Workspace path boundary enforcement.
 *
 * Ensures candidate paths for memory indexing / embedding stay within
 * the workspace directory, preventing arbitrary filesystem traversal.
 */

import { isPathInside } from "./scan-paths.js";

/**
 * Returns true when `candidatePath` is within `workspaceDir`.
 * Both paths are resolved to absolute form before comparison.
 */
export function isWithinWorkspace(workspaceDir: string, candidatePath: string): boolean {
  return isPathInside(workspaceDir, candidatePath);
}
