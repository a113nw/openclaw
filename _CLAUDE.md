# OpenClaw

Multi-channel AI gateway with extensible messaging integrations.

## Quick Reference

- **Language**: TypeScript (ESM, strict typing, no `any`)
- **Runtime**: Node.js 22+ (managed via asdf: `ASDF_NODEJS_VERSION=20.19.4`)
- **Package manager**: pnpm (also supports bun)
- **Test framework**: Vitest
- **Lint/format**: Oxlint + Oxfmt (`pnpm check`, `pnpm format:fix`)
- **Build**: `pnpm build`
- **Binary**: `openclaw` (entry: `openclaw.mjs` → `dist/entry.js`)

## Project Structure

```
src/                    # Core source
  cli/                  # CLI commands and wiring
  gateway/              # Gateway server, auth, WebSocket, HTTP
  config/               # Config loading, validation, schema hints
  agents/               # Agent runtime, bash tools, sandbox
  plugins/              # Plugin loader, installer, scanner
  memory/               # Memory indexing, embedding, search
  security/             # Security hardening modules (see below)
  infra/                # Device identity, Tailscale, heartbeat
  routing/              # Session routing, message channels
extensions/             # Channel plugins (workspace packages)
apps/                   # macOS, iOS, Android apps
ui/                     # Control UI frontend
docs/                   # Mintlify documentation
scripts/                # Build, test, release scripts
```

## Commands

```bash
pnpm install            # Install dependencies
pnpm build              # Type-check and build
pnpm test               # Run tests (vitest)
pnpm test:e2e           # Run e2e tests (vitest.e2e.config.ts)
pnpm test:coverage      # Run with V8 coverage
pnpm check              # Lint + format check
pnpm format:fix         # Auto-fix formatting
```

## Testing

- Tests are colocated: `*.test.ts` next to source files
- E2e tests: `*.e2e.test.ts` (excluded from default `vitest run`, use `pnpm test:e2e`)
- Live tests: `*.live.test.ts` (require `CLAWDBOT_LIVE_TEST=1`)
- Gateway tests use `installGatewayTestHooks()` and `startServerWithClient()` from `gateway/test-helpers.server.ts`
- Coverage thresholds: 70% lines/branches/functions/statements

## Gateway

- Default port: **18789**
- Start: `openclaw gateway run --port 18789 --bind loopback --allow-unconfigured`
- Auth modes: `none` (loopback default), `token`, `password`, `trusted-proxy`
- Token via env: `OPENCLAW_GATEWAY_TOKEN`
- HTTP auth: `Authorization: Bearer <token>`
- WebSocket auth: `connect` RPC with `auth.token` param
- No HTTP health endpoint; use WS `health` RPC or `GET /__openclaw/control-ui-config.json`

## Security Modules (`src/security/`)

Hardening modules addressing 19 of 23 audit findings. Full docs in `SECURITY.md`.

| Module | Purpose | Consumer |
|--------|---------|----------|
| `secret-equal.ts` | HMAC-SHA256 timing-safe comparison | `gateway/auth.ts` |
| `env-allowlist.ts` | Host exec env filtering | `agents/bash-tools.exec.ts` |
| `plugin-install-policy.ts` | Block install on critical findings | `plugins/install.ts` |
| `path-boundary.ts` | Workspace path restriction | `memory/internal.ts` |
| `log-scrubber.ts` | Credential redaction in logs | `config/io.ts` |
| `nonce-cache.ts` | Replay protection | `gateway/server/ws-connection/message-handler.ts` |
| `host-validation.ts` | DNS rebinding protection | `gateway/origin-check.ts` |
| `auth-audit-log.ts` | Auth event JSONL logging | `gateway/auth.ts` |
| `plugin-capabilities.ts` | Plugin API restriction | `plugins/loader.ts` |
| `credential-config.ts` | Encryption feature flag (`OPENCLAW_ENCRYPT_CREDENTIALS`) | `credential-envelope.ts` |
| `credential-cipher.ts` | AES-256-GCM encrypt/decrypt | `credential-envelope.ts` |
| `master-key.ts` | Master key management (keychain/file) | `credential-envelope.ts` |
| `credential-envelope.ts` | Transparent seal/open for JSON credential files | `json-file.ts`, `device-identity.ts`, `device-auth-store.ts`, `pairing-store.ts` |
| `plugin-signer.ts` | Ed25519 plugin manifest signing/verification | `plugins/install.ts`, `audit-extra.async.ts` |
| `plugin-trust-store.ts` | Trusted plugin key CRUD + signing key management | `plugins/install.ts`, `audit-extra.async.ts` |
| `plugin-security-policy.ts` | Per-plugin trust-level policy store (trusted/restricted/disabled) | `plugins/loader.ts`, `agents/tools/plugin-security-tool.ts` |
| `plugin-security-advisory.ts` | Advisory hook for unconfigured plugins | `plugins/loader.ts` |

### Worker Thread Plugin Isolation (`src/security/worker-bridge/`)

| Module | Purpose |
|--------|---------|
| `protocol.ts` | IPC message type definitions (main↔worker) |
| `rpc.ts` | Request/response correlation with timeouts |
| `serialization.ts` | Tool descriptor extraction and validation |
| `worker-entry.ts` | Worker Thread entry point (bridge API, plugin loading) |
| `main-host.ts` | Main-thread Worker host (spawn, IPC, lifecycle) |

Plugins opt in via `"isolation": "worker"` in `openclaw.plugin.json`. Unsupported APIs throw clear errors.

```bash
npx vitest run src/security/    # ~443 tests (unit + integration + smoke)
```

Key conventions:
- Each module is imported by exactly one consumer
- Patches to existing files are 1-5 lines; preserve security call sites when modifying
- `auth-audit-log.ts` is best-effort (never throws)
- `nonce-cache.ts` is a process-global singleton — don't create duplicates
- Plugin capabilities: `undefined` = unrestricted (backward compatible)
- Credential encryption: opt-in via `OPENCLAW_ENCRYPT_CREDENTIALS=1`; read path always decrypts, write path only encrypts when enabled
- Worker isolation: `terminated` flag prevents double-terminate; all invocation methods check before proceeding

## Config

- Config file: `~/.openclaw/openclaw.json`
- Config permissions enforced to `0o600` on read
- Sensitive fields auto-detected via `SENSITIVE_PATTERNS` in `config/schema.hints.ts`
- Config errors scrubbed through `scrubSecrets()` before logging

## Plugins

- Install: `openclaw plugin install <path>` (`--force` to override security blocking)
- Critical scan findings block install by default
- Capabilities declared in plugin definition restrict API surface at load time
- Plugin deps go in extension `package.json`, not root

## Branching

Git flow model. Production: `main`. Integration: `develop`. Prefixes: `feature/`, `release/`, `hotfix/`.

Nontrivial changes go through feature branches off `develop`, not directly on `main`.

## Conventions

- Commits: concise, action-oriented (e.g. `security(gateway): add auth audit logging`)
- Use `scripts/committer "<msg>" <file...>` for commits when available
- Files under ~500-700 LOC; split when it improves clarity
- Brief comments for tricky logic only
- No `@ts-nocheck`, no disabled `no-explicit-any`
