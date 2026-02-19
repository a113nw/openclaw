/**
 * Policy gate for plugin installation based on security scan results.
 *
 * Critical findings (e.g., eval, child_process require) block installation
 * unless the caller explicitly forces the install.
 */

export type ScanSummary = {
  critical: number;
  warn: number;
  findings: Array<{ severity: string; message: string; file: string; line: number }>;
};

export function shouldBlockPluginInstall(
  scanSummary: ScanSummary,
  force: boolean,
): { block: boolean; reason?: string } {
  if (scanSummary.critical === 0) {
    return { block: false };
  }
  if (force) {
    return { block: false };
  }
  const details = scanSummary.findings
    .filter((f) => f.severity === "critical")
    .map((f) => `${f.message} (${f.file}:${f.line})`)
    .join("; ");
  return {
    block: true,
    reason: `Plugin contains ${scanSummary.critical} critical finding(s): ${details}. Use --force to install anyway.`,
  };
}
