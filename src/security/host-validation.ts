/**
 * Host header validation for DNS rebinding protection.
 *
 * When the gateway binds to a loopback address, browsers should only
 * reach it via localhost / 127.0.0.1 / [::1].  A DNS rebinding attack
 * resolves a public domain to a private IP, causing the browser to
 * send requests with a non-local Host header to the loopback gateway.
 * This module rejects such requests.
 */

const DEFAULT_LOOPBACK_HOSTS = new Set([
  "localhost",
  "127.0.0.1",
  "::1",
  "[::1]",
]);

/**
 * Check whether the Host header is acceptable given the bind mode.
 *
 * @param host - The Host header value (hostname only, port stripped).
 * @param isLoopbackBind - Whether the gateway is bound to a loopback address.
 * @param allowlist - Additional hostnames to accept (e.g., from configuration).
 */
export function isAllowedHostHeader(
  host: string | undefined,
  isLoopbackBind: boolean,
  allowlist?: string[],
): boolean {
  if (!host) {
    // Missing Host header — reject in loopback mode.
    return !isLoopbackBind;
  }
  const normalized = host.toLowerCase().trim();
  if (!isLoopbackBind) {
    // Non-loopback: no additional restriction from this check.
    return true;
  }
  if (DEFAULT_LOOPBACK_HOSTS.has(normalized)) {
    return true;
  }
  // Allow .ts.net for Tailscale serve (Tailscale forwards through loopback).
  if (normalized.endsWith(".ts.net")) {
    return true;
  }
  if (allowlist) {
    return allowlist.some((entry) => entry.toLowerCase().trim() === normalized);
  }
  return false;
}
