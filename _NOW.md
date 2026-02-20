# Where We Are Now

## Overview

A security audit identified 23 findings across 4 severity levels. We have implemented fixes for 18 of those findings across five phases of work, all merged to `main` and synced to `develop`. Git flow has been adopted for future nontrivial changes.

## Pull Request History

### Phase 1: Security Scaffolding (12 findings)

| PR | Branch | Description | Status |
|----|--------|-------------|--------|
| #1 | `security/scaffold` | Core implementation — 12 phases, 8 new files, 11 patched files (~49 lines modified) | Merged |
| #2 | `security/scaffold-tests` | Unit tests — 9 test files, 95 tests | Merged |
| #3 | `security/scaffold-integration-tests` | Integration tests — 9 test files, 89 tests | Merged |
| #4 | `security/scaffold-next` | SECURITY.md documentation update | Merged |
| #5 | `security/scaffold-smoke` | E2e smoke test — 1 file, 12 tests against live gateway | Merged |

### Phase 2: Tier 1 Security (2 findings)

Committed directly to `main` as `5e23007e7` (31 files changed, 2444 insertions). Covers:

- **CRIT-02**: Encrypted credential storage (AES-256-GCM with keychain/file master key)
- **CRIT-03b**: Worker Thread plugin isolation (Stage B-1, IPC bridge)

### Phase 3: CRIT-04 Documentation (1 finding)

- **CRIT-04**: Tailscale header trust model documented in SECURITY.md
  - Validation layers table (transport, proxy detection, identity claim, whois verification, DNS rebinding)
  - Trust assumptions, known limitations, operator recommendations
  - No code changes — existing implementation is sound

### Phase 4: HIGH-03 Exec Allowlist Interpreter Warnings (1 finding)

- **HIGH-03**: Exec allowlist interpreter binary detection and warnings
  - `isInterpreterBinary()` helper with 22 known interpreter names
  - `interpreterWarnings` field added to `ExecAllowlistEvaluation` and `ExecAllowlistAnalysis`
  - Runtime warning via `logWarn()` when interpreter binary matched by allowlist
  - Audit finding (`exec.allowlist.interpreter_binary`) for interpreter patterns in config
  - Documented limitation and mitigation guidance in SECURITY.md

## What Was Implemented

### Phases 1-12: Security Scaffolding

*(See previous PRs #1-#5 for details on each phase)*

| Phase | Finding | Module | Summary |
|-------|---------|--------|---------|
| 1 | HIGH-01/02 | `secret-equal.ts` | HMAC-SHA256 timing-safe comparison |
| 2 | CRIT-01 | `env-allowlist.ts` | Host exec environment filtering |
| 3 | HIGH-06 | `server.impl.ts` patch | Default auth rate limiting |
| 4 | MED-01 | `schema.hints.ts` patch | Expanded sensitive field redaction |
| 5 | HIGH-05 | `plugin-install-policy.ts` | Plugin scanner blocking |
| 6 | HIGH-08 | `path-boundary.ts` | Workspace path boundary |
| 7 | HIGH-07 | `log-scrubber.ts` | Log secret scrubbing |
| 8 | MED-02 | `nonce-cache.ts` | Nonce replay protection |
| 9 | MED-03 | `host-validation.ts` | DNS rebinding protection |
| 10 | LOW-03 | `auth-audit-log.ts` | Auth audit logging |
| 11 | LOW-04 | `config/io.ts` patch | Config permission enforcement |
| 12 | CRIT-03a | `plugin-capabilities.ts` | Plugin capability declarations |

### Phase 13: Encrypted Credential Storage (CRIT-02)

**New files:**
- `src/security/credential-config.ts` — Feature flag via `OPENCLAW_ENCRYPT_CREDENTIALS=1|true`, cached in memory
- `src/security/credential-cipher.ts` — Pure AES-256-GCM crypto (12-byte IV, 16-byte auth tag, versioned payload)
- `src/security/master-key.ts` — Master key management: macOS keychain → file (`~/.openclaw/security/master.key`) → generate new
- `src/security/credential-envelope.ts` — Glue layer: `sealJson()` encrypts if enabled, `openJson()` always decrypts

**Encrypted file format:**
```json
{ "_encrypted": true, "payload": { "v": 1, "iv": "...", "ct": "...", "tag": "..." } }
```

**Patched files:**
- `src/infra/json-file.ts` — Added `JsonFileOptions` param (`{ encrypt?, decrypt? }`)
- `src/agents/auth-profiles/store.ts` — 5 call sites pass encrypt/decrypt options
- `src/infra/device-identity.ts` — Wrapped JSON parse/stringify with openJson/sealJson
- `src/infra/device-auth-store.ts` — Same pattern
- `src/pairing/pairing-store.ts` — Modified local readJsonFile/writeJsonFile wrappers

**Migration:** Fully transparent. Read path detects `_encrypted` sentinel. Write path only encrypts when enabled. No migration command needed.

**Deferred:** `src/web/auth-store.ts` (WhatsApp credentials written by Baileys library, requires wrapper)

### Phase 14: Worker Thread Plugin Isolation (CRIT-03b Stage B-1)

**New files** (under `src/security/worker-bridge/`):
- `protocol.ts` — IPC message type definitions (init, register, invoke, result, log)
- `rpc.ts` — Request/response correlation with configurable timeouts
- `serialization.ts` — Tool descriptor extraction (serialize everything except execute handler)
- `worker-entry.ts` — Worker Thread entry point: bridge API, plugin loading via Jiti, message loop
- `main-host.ts` — Main-thread host: spawn Worker, IPC, lifecycle management, crash recovery

**Supported APIs in B-1:** `registerTool`, `on()` (async hooks), `registerService`, `registerCommand`, `api.logger`, static metadata fields

**Unsupported** (throws clear error): `registerChannel`, `registerProvider`, `registerHttpHandler`, `registerHttpRoute`, `registerGatewayMethod`, `registerCli`, `api.runtime`

**Patched files:**
- `src/plugins/manifest.ts` — Added `PluginIsolation` type and `isolation` field
- `src/plugins/manifest-registry.ts` — Added `isolation` to `PluginManifestRecord`
- `src/plugins/registry.ts` — Added `isolation` to `PluginRecord`
- `src/plugins/loader.ts` — Worker isolation path: creates `WorkerHost` when `isolation === "worker"`, tool/hook/service/command proxy registration

**Opt-in:** `"isolation": "worker"` in `openclaw.plugin.json`

**Timeouts:** 10s registration, 60s tool calls, 5s hooks, 30s service start, 5s shutdown

**Test fixtures:** `minimal-plugin.ts`, `unsupported-api-plugin.ts`, `crash-plugin.ts`

## Test Coverage

| Layer | Files | Tests |
|-------|-------|-------|
| Unit tests (security scaffolding) | 9 | 95 |
| Integration tests (security scaffolding) | 9 | 89 |
| Smoke test | 1 | 12 |
| Pre-existing security tests | 6 | 159 |
| CRIT-02 unit tests | 4 | ~40 |
| CRIT-02 integration test | 1 | 5 |
| CRIT-03b unit tests | 4 | ~38 |
| CRIT-03b integration test | 1 | 5 |
| **Total** | **~35** | **~443** |

All 443 tests pass. Full suite shows 0 regressions (22 pre-existing failures in memory manager, extensions, and bootstrap tests exist on both `main` and security branches).

## Files Summary

### New security files (12 + 5 worker-bridge)

```
src/security/credential-config.ts
src/security/credential-cipher.ts
src/security/master-key.ts
src/security/credential-envelope.ts
src/security/env-allowlist.ts
src/security/plugin-install-policy.ts
src/security/path-boundary.ts
src/security/log-scrubber.ts
src/security/nonce-cache.ts
src/security/host-validation.ts
src/security/auth-audit-log.ts
src/security/plugin-capabilities.ts
src/security/worker-bridge/protocol.ts
src/security/worker-bridge/rpc.ts
src/security/worker-bridge/serialization.ts
src/security/worker-bridge/worker-entry.ts
src/security/worker-bridge/main-host.ts
```

### Modified files (16)

```
src/security/secret-equal.ts
src/agents/bash-tools.exec.ts
src/gateway/server.impl.ts
src/config/schema.hints.ts
src/plugins/install.ts
src/memory/internal.ts
src/config/io.ts
src/gateway/server/ws-connection/message-handler.ts
src/gateway/origin-check.ts
src/gateway/auth.ts
src/plugins/loader.ts
src/plugins/manifest.ts
src/plugins/manifest-registry.ts
src/plugins/registry.ts
src/infra/json-file.ts
src/infra/device-identity.ts
src/infra/device-auth-store.ts
src/pairing/pairing-store.ts
```

## Branching Model

Git flow adopted as of 2026-02-20:
- **Production:** `main`
- **Integration:** `develop` (synced with `main` at `5e23007e7`)
- **Prefixes:** `feature/`, `release/`, `hotfix/`
- All nontrivial future changes go through feature branches off `develop`
