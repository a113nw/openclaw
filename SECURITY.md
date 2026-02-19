# Security Policy

If you believe you've found a security issue in OpenClaw, please report it privately.

## Reporting

Report vulnerabilities directly to the repository where the issue lives:

- **Core CLI and gateway** — [openclaw/openclaw](https://github.com/openclaw/openclaw)
- **macOS desktop app** — [openclaw/openclaw](https://github.com/openclaw/openclaw) (apps/macos)
- **iOS app** — [openclaw/openclaw](https://github.com/openclaw/openclaw) (apps/ios)
- **Android app** — [openclaw/openclaw](https://github.com/openclaw/openclaw) (apps/android)
- **ClawHub** — [openclaw/clawhub](https://github.com/openclaw/clawhub)
- **Trust and threat model** — [openclaw/trust](https://github.com/openclaw/trust)

For issues that don't fit a specific repo, or if you're unsure, email **security@openclaw.ai** and we'll route it.

For full reporting instructions see our [Trust page](https://trust.openclaw.ai).

### Required in Reports

1. **Title**
2. **Severity Assessment**
3. **Impact**
4. **Affected Component**
5. **Technical Reproduction**
6. **Demonstrated Impact**
7. **Environment**
8. **Remediation Advice**

Reports without reproduction steps, demonstrated impact, and remediation advice will be deprioritized. Given the volume of AI-generated scanner findings, we must ensure we're receiving vetted reports from researchers who understand the issues.

## Security & Trust

**Jamieson O'Reilly** ([@theonejvo](https://twitter.com/theonejvo)) is Security & Trust at OpenClaw. Jamieson is the founder of [Dvuln](https://dvuln.com) and brings extensive experience in offensive security, penetration testing, and security program development.

## Bug Bounties

OpenClaw is a labor of love. There is no bug bounty program and no budget for paid reports. Please still disclose responsibly so we can fix issues quickly.
The best way to help the project right now is by sending PRs.

## Maintainers: GHSA Updates via CLI

When patching a GHSA via `gh api`, include `X-GitHub-Api-Version: 2022-11-28` (or newer). Without it, some fields (notably CVSS) may not persist even if the request returns 200.

## Out of Scope

- Public Internet Exposure
- Using OpenClaw in ways that the docs recommend not to
- Prompt injection attacks

## Operational Guidance

For threat model + hardening guidance (including `openclaw security audit --deep` and `--fix`), see:

- `https://docs.openclaw.ai/gateway/security`

### Tool filesystem hardening

- `tools.exec.applyPatch.workspaceOnly: true` (recommended): keeps `apply_patch` writes/deletes within the configured workspace directory.
- `tools.fs.workspaceOnly: true` (optional): restricts `read`/`write`/`edit`/`apply_patch` paths to the workspace directory.
- Avoid setting `tools.exec.applyPatch.workspaceOnly: false` unless you fully trust who can trigger tool execution.

### Web Interface Safety

OpenClaw's web interface (Gateway Control UI + HTTP endpoints) is intended for **local use only**.

- Recommended: keep the Gateway **loopback-only** (`127.0.0.1` / `::1`).
  - Config: `gateway.bind="loopback"` (default).
  - CLI: `openclaw gateway run --bind loopback`.
- Do **not** expose it to the public internet (no direct bind to `0.0.0.0`, no public reverse proxy). It is not hardened for public exposure.
- If you need remote access, prefer an SSH tunnel or Tailscale serve/funnel (so the Gateway still binds to loopback), plus strong Gateway auth.
- The Gateway HTTP surface includes the canvas host (`/__openclaw__/canvas/`, `/__openclaw__/a2ui/`). Treat canvas content as sensitive/untrusted and avoid exposing it beyond loopback unless you understand the risk.

## Runtime Requirements

### Node.js Version

OpenClaw requires **Node.js 22.12.0 or later** (LTS). This version includes important security patches:

- CVE-2025-59466: async_hooks DoS vulnerability
- CVE-2026-21636: Permission model bypass vulnerability

Verify your Node.js version:

```bash
node --version  # Should be v22.12.0 or later
```

### Docker Security

When running OpenClaw in Docker:

1. The official image runs as a non-root user (`node`) for reduced attack surface
2. Use `--read-only` flag when possible for additional filesystem protection
3. Limit container capabilities with `--cap-drop=ALL`

Example secure Docker run:

```bash
docker run --read-only --cap-drop=ALL \
  -v openclaw-data:/app/data \
  openclaw/openclaw:latest
```

## Security Scanning

This project uses `detect-secrets` for automated secret detection in CI/CD.
See `.detect-secrets.cfg` for configuration and `.secrets.baseline` for the baseline.

Run locally:

```bash
pip install detect-secrets==1.5.0
detect-secrets scan --baseline .secrets.baseline
```

---

## Security Scaffolding

This section documents the security hardening modules introduced in the `security/scaffold` work. These address findings from a security audit (4 Critical, 8 High, 7 Medium, 4 Low severity) through 8 new files in `src/security/` and surgical patches to 11 existing files.

### Architecture

All security utilities live in `src/security/` as standalone modules with minimal coupling. Each module is imported by exactly the consumer that needs it. The design prioritizes:

- **Zero merge conflict**: new files never collide with upstream changes
- **Surgical patches**: existing files are modified by 1-5 lines each (~49 lines total)
- **Clean rebase**: `git rebase origin/main` works without manual resolution
- **Defense in depth**: multiple independent layers rather than a single chokepoint

### Modules

#### Timing-Safe Secret Comparison (`secret-equal.ts`)

**Addresses**: HIGH-01 (gateway token auth timing oracle), HIGH-02 (device pairing timing oracle)

The original `safeEqualSecret()` early-returned on length mismatch, leaking token length via timing. The fix replaces length-check-then-compare with HMAC-SHA256 digest comparison:

1. Both inputs are hashed with a per-process random 32-byte HMAC key
2. The two fixed-length 32-byte digests are compared with `crypto.timingSafeEqual`
3. No length oracle is possible because both digests are always the same size

**Consumers**: `gateway/auth.ts` (token and password auth paths)

#### Host Exec Environment Filtering (`env-allowlist.ts`)

**Addresses**: CRIT-01 (host exec environment leaking secrets)

When the gateway runs commands directly on the host (non-sandbox mode), `process.env` may contain API keys, tokens, and credentials. This module provides allowlist-based filtering:

- **Allowed**: `PATH`, `HOME`, `USER`, `SHELL`, `LANG`, `LC_*`, `TERM`, `TZ`, `NODE_ENV`, `EDITOR`, `VISUAL`, `PAGER`, `TMPDIR`, `XDG_*`, and other safe host vars
- **Blocked**: `*_TOKEN`, `*_SECRET`, `*_KEY`, `*_PASSWORD`, `AWS_*`, `OPENAI_*`, `ANTHROPIC_*`, `GITHUB_TOKEN`, and other credential patterns

Uses `sanitizeEnvVars` from `agents/sandbox/sanitize-env-vars.ts` in strict mode for consistency with the Docker sandbox filtering.

**Consumer**: `agents/bash-tools.exec.ts` (line 388, non-sandbox exec path)

#### Plugin Install Blocking (`plugin-install-policy.ts`)

**Addresses**: HIGH-05 (plugin scanner warn-only, never blocks)

The plugin security scanner previously only warned about dangerous code patterns (eval, child_process). Critical findings now block installation unless `--force` is passed:

```
shouldBlockPluginInstall(scanSummary, force) → { block: boolean; reason?: string }
```

The error message includes specific finding details and instructions to use `--force` to override.

**Consumer**: `plugins/install.ts` (line 205, after scan completes)

#### Workspace Path Boundary (`path-boundary.ts`)

**Addresses**: HIGH-08 (unrestricted memory indexing paths)

`normalizeExtraMemoryPaths()` previously accepted arbitrary absolute paths for memory indexing. This module filters paths to the workspace boundary:

```
isWithinWorkspace(workspaceDir, candidatePath) → boolean
```

Rejected paths are logged with a warning. Delegates to `isPathInside` from `security/scan-paths.ts`.

**Consumer**: `memory/internal.ts` (line 46, extra memory path filtering)

#### Log Secret Scrubbing (`log-scrubber.ts`)

**Addresses**: HIGH-07 (config error logs may contain credential values)

Config validation errors may echo back secret values in Zod error messages. This module redacts known credential patterns before they reach log output:

| Pattern | Replacement |
|---------|-------------|
| `sk-[A-Za-z0-9]{20,}` | `sk-***` |
| `ghp_`, `gho_`, `ghs_`, `ghu_` tokens | `ghp_***`, etc. |
| `glpat-` (GitLab) | `glpat-***` |
| `xoxb-`, `xoxp-` (Slack) | `xoxb-***`, etc. |
| `Bearer [token]` | `Bearer ***` |
| Long base64 strings (40+ chars) | `[REDACTED]` |
| Long hex strings (40+ chars) | `[REDACTED]` |

**Consumer**: `config/io.ts` (lines 582, 593, 638 — config error/warning log paths)

#### Nonce Replay Cache (`nonce-cache.ts`)

**Addresses**: MED-02 (device signature 10-minute replay window)

Device signatures have a 10-minute validity window but previously had no replay tracking. The `NonceCache` class provides TTL-based deduplication:

- `add(nonce, ttlMs)` returns `false` if the nonce was already seen within its TTL
- Memory-bounded at 10,000 entries with periodic pruning (every 60s)
- Oldest entries are evicted when capacity is reached

In the message handler, a SHA-256 hash of each device signature is used as the nonce key with a 20-minute TTL (2x the signature skew window).

**Consumer**: `gateway/server/ws-connection/message-handler.ts` (line 570, after signature verification)

#### DNS Rebinding Protection (`host-validation.ts`)

**Addresses**: MED-03 (loopback origin always allowed, DNS rebinding possible)

When origin and request host are both loopback addresses, an additional Host header check prevents DNS rebinding attacks where a public domain resolves to a private IP:

```
isAllowedHostHeader(host, isLoopbackBind, allowlist?) → boolean
```

**Default allowed hosts** (loopback mode): `localhost`, `127.0.0.1`, `::1`, `[::1]`, `*.ts.net` (Tailscale)

A custom allowlist can extend the defaults for non-standard setups.

**Consumer**: `gateway/origin-check.ts` (line 50, loopback origin path)

#### Auth Audit Log (`auth-audit-log.ts`)

**Addresses**: LOW-03 (no centralized auth event logging)

All authentication attempts (success and failure) are recorded as structured JSONL:

```json
{"type":"auth_failure","ip":"10.0.0.1","method":"token","reason":"token_mismatch","timestamp":1708300000000}
```

- Writes to `~/.openclaw/security/auth-audit.jsonl`
- Auto-rotates when file exceeds 5MB (renames to `.1`)
- Directory created with mode `0o700`, files with mode `0o600`
- Best-effort: never throws, disk errors do not affect auth flow

**Consumer**: `gateway/auth.ts` (line 302, wrapping `authorizeGatewayConnectInternal`)

#### Plugin Capability Declarations (`plugin-capabilities.ts`)

**Addresses**: CRIT-03 Stage A (plugins run in-process with full Node.js access)

Plugins can declare required capabilities in their definition export. When present, the plugin API is wrapped in a proxy that blocks undeclared capability usage:

| Capability | Gated Methods |
|-----------|---------------|
| `network` | `registerHttpHandler`, `registerHttpRoute` |
| `filesystem` | *(future expansion)* |
| `child_process` | *(future expansion)* |
| `env_access` | *(future expansion)* |
| `config_write` | *(future expansion)* |

Plugins without a `capabilities` declaration get unrestricted access (backward compatible).

**Consumer**: `plugins/loader.ts` (line 441, plugin API creation)

### Other Patches

#### Default Auth Rate Limiting (HIGH-06)

The auth rate limiter (`auth-rate-limit.ts`) existed but was only created when explicitly configured. Non-loopback gateways now get a default rate limiter automatically:

```typescript
const authRateLimiter = rateLimitConfig
  ? createAuthRateLimiter(rateLimitConfig)
  : !isLoopbackHost(bindHost) ? createAuthRateLimiter() : undefined;
```

Defaults: 10 attempts, 1-minute window, 5-minute lockout, loopback exempt.

**Location**: `gateway/server.impl.ts` (line 290)

#### Expanded Sensitive Field Patterns (MED-01)

The `SENSITIVE_PATTERNS` array in `config/schema.hints.ts` was expanded to catch additional field names that may contain credentials in config UI snapshots:

**Added patterns**: `bearer`, `credential`, `access_key`, `private_key`, `signing_key`, `client_secret`

**Added whitelist entries** (false positives): `publickey`, `credentialhelper`, `preferredcredentials`

**Location**: `config/schema.hints.ts` (line 113)

#### Config File Permission Enforcement (LOW-04)

Config files previously only got `0o600` permissions on initial write. Now, after reading an existing config file, permissions are checked and corrected if too open.

**Location**: `config/io.ts` (after successful config file read)

### Deferred Items

These findings were assessed but deferred from this scaffolding due to architectural scope:

| Finding | Severity | Why Deferred |
|---------|----------|-------------|
| CRIT-02 (plaintext credential storage) | Critical | Requires migration path for all stored tokens; design behind feature flag |
| CRIT-03 Stage B (Worker Thread isolation) | Critical | Large architectural change; Stage A capability declarations provide interim protection |
| CRIT-04 (Tailscale header trust) | Critical | Already validates via whois lookup; localhost-only risk |
| HIGH-03 (exec allowlist arg bypass) | High | Complex argument pattern matching; document limitation |
| HIGH-04 (`$include` path traversal) | High | Already fixed upstream (`isPathInside` with symlink resolution) |
| MED-04 (plugin code signing) | Medium | Requires PKI infrastructure |
| MED-05 (session encryption) | Medium | Requires key management design |
| MED-06 (embedding content filtering) | Medium | Best implemented as optional security plugin hook |
| MED-07 (approval request flooding) | Medium | Needs UX design for per-session rate limiting |
| LOW-01 (device key encryption at rest) | Low | Requires passphrase/keychain integration |
| LOW-02 (WebSocket payload limits) | Low | Existing limits are reasonable; tighten if needed |

### Test Coverage

The security modules have comprehensive test coverage:

**Unit tests** (`src/security/*.test.ts`): 95 tests across 9 files
- One test file per security module
- Covers edge cases, error handling, and boundary conditions

**Integration tests** (`src/security/__integration__/*.test.ts`): 89 tests across 9 files
- Auth flow composition (secret-equal + audit-log + rate-limiter)
- DNS rebinding protection (host-validation + origin-check)
- Environment filtering (env-allowlist in host exec context)
- Memory path boundary enforcement
- Log scrubbing in config error paths
- Plugin security pipeline (install blocking + capability enforcement)
- Nonce replay protection (nonce-cache + SHA-256 hashing pattern)
- Sensitive config field detection (expanded patterns + whitelist)
- Rate limiter lifecycle (sliding window, lockout, loopback exemption)

Run all security tests:

```bash
npx vitest run src/security/
```
