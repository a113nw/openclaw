# OpenClaw Architecture Analysis

> Comprehensive architectural review of the upstream OpenClaw codebase.
> Last updated: 2026-03-13

## Table of Contents

- [System Overview](#system-overview)
- [Gateway](#gateway)
- [Agent / LLM Orchestration](#agent--llm-orchestration)
- [Plugin System](#plugin-system)
- [Channels and Routing](#channels-and-routing)
- [Memory System](#memory-system)
- [Configuration and Infrastructure](#configuration-and-infrastructure)
- [Security Posture](#security-posture)
- [Architectural Strengths](#architectural-strengths)
- [Architectural Gaps](#architectural-gaps)
- [Fork Additions (entmoot-openclaw)](#fork-additions-entmoot-openclaw)

---

## System Overview

OpenClaw is a self-hosted AI assistant platform. Users interact through messaging channels (Telegram, Discord, Slack, Signal, iMessage, WhatsApp, etc.) and a web UI. A central gateway coordinates connections, routing, and agent orchestration.

```
CLI (Commander.js)
  |
  v
Gateway (WebSocket server, single-process)
  |
  +-- Auth (token / password / device-token / tailscale / trusted-proxy)
  +-- Channels (20+ adapters: Telegram, Discord, Slack, Signal, etc.)
  +-- Routing (binding-priority matcher -> agent + session key)
  +-- Agent Runner (PI framework, multi-provider LLM, tool invocation)
  |     +-- Context Window Management + Auto-Compaction
  |     +-- Failover (auth profile rotation, backoff, cooldown)
  |     +-- Tools (bash, read, write, message, cron, memory, plugins)
  +-- Memory (BM25 + vector similarity via sqlite-vec)
  +-- Plugins (24 lifecycle hooks, tool/channel/service/CLI registration)
  +-- Delivery Queue (file-persisted, exponential backoff, 5 retries)
```

**Scale:** ~1,500+ TypeScript files in `src/`, 37 extensions under `extensions/`, 55+ skills, native apps (macOS, iOS, Android).

**Runtime:** Node 22+, TypeScript ESM, pnpm monorepo. Bun supported for dev/test. Build via tsdown (131 entry points).

---

## Gateway

### Structure

The gateway is a single-process WebSocket server built on Node.js `ws`. It binds to one or more HTTP server instances (loopback, LAN, or Tailscale) and handles all client communication through a unified frame protocol.

**Key files:**

- `src/gateway/server.impl.ts` — server startup, HTTP/WS binding
- `src/gateway/server/ws-connection/` — connection lifecycle, message handling
- `src/gateway/auth.ts` — auth mode dispatch
- `src/gateway/server-broadcast.ts` — scope-filtered event broadcast
- `src/gateway/server-chat.ts` — chat run state tracking
- `src/gateway/node-registry.ts` — mobile/node device registry

### Connection Lifecycle

1. Upgrade request received
2. `connect.challenge` event sent with nonce
3. Client responds with `connect` request (handshake) within 10s timeout
4. Validation: protocol version, device identity, auth credentials, role/scopes
5. Authenticated client added to `clients` Set

### Auth Modes

| Mode            | Mechanism                                            |
| --------------- | ---------------------------------------------------- |
| `none`          | No authentication                                    |
| `token`         | Shared secret (env or config)                        |
| `password`      | Shared secret                                        |
| `device-token`  | Per-device ECDSA signature verification              |
| `trusted-proxy` | User extracted from proxy headers                    |
| `tailscale`     | Auto-auth via Tailscale headers (WS control UI only) |

Auth rate limiting: 10 attempts per 60s window, 5-minute lockout. Loopback exempt by default. `UnauthorizedFloodGuard` closes connections after 10 consecutive failures.

### In-Memory State

| Structure                       | Purpose                        | Bounds                         |
| ------------------------------- | ------------------------------ | ------------------------------ |
| `clients: Set<GatewayWsClient>` | Connected clients              | Unbounded; lost on restart     |
| `nodeRegistry`                  | Mobile device sessions         | Map by nodeId; timeout cleanup |
| `chatRunState`                  | Agent run buffers              | Per-agent tracking             |
| `agentRunSeq: Map`              | Dedup sequence numbers         | Pruned at 10,000 (FIFO)        |
| `dedupe: Map`                   | Request deduplication (5m TTL) | Pruned at 1,000 every 30s      |

### Broadcast and Backpressure

Events are broadcast to all clients matching the required scopes. Per-frame backpressure check:

- If `socket.bufferedAmount > 50MB` and `dropIfSlow=true`: skip the slow client
- If `dropIfSlow=false`: close the connection with code 1008 ("slow consumer")

No adaptive backoff; immediate hard close.

### Concurrency

`applyGatewayLaneConcurrency()` sets per-lane limits:

- Cron: 1 concurrent run (default)
- Main agent: configurable via `agents.defaults.maxConcurrent`
- Subagent: configurable via `agents.subagent.maxConcurrent`

### Graceful Shutdown

1. Fire plugin `gateway_stop` hooks (fire-and-forget)
2. Stop bonjour discovery, Tailscale exposure
3. Close canvas host and channel instances
4. Stop cron, heartbeat runner
5. Broadcast `shutdown` to all clients
6. Close all WebSocket connections (1012 "service restart")
7. Close HTTP server(s)

### Payload Limits

| Constant             | Value | Purpose                    |
| -------------------- | ----- | -------------------------- |
| `MAX_PAYLOAD_BYTES`  | 25 MB | Single frame max           |
| `MAX_BUFFERED_BYTES` | 50 MB | Per-connection send buffer |
| `MAX_CHAT_HISTORY`   | 6 MB  | Chat history response      |
| `TICK_INTERVAL_MS`   | 30s   | Keepalive ping             |

---

## Agent / LLM Orchestration

### Core Loop

The agent runner lives in `src/agents/pi-embedded-runner/`. The main loop (`run.ts`, 2000+ LOC) orchestrates a single "run" of the embedded PI agent with built-in retry/failover.

**Execution phases:**

1. **Setup:** Model resolution, auth profile selection, context window validation
2. **Attempt:** Build system prompt, register tools, call `session.steer(prompt)` which streams to LLM
3. **Tool execution:** LLM emits `tool_call` events, handler executes tool, result fed back
4. **Completion:** Emit assistant text, tool metadata, usage stats

**Key files:**

- `src/agents/pi-embedded-runner/run.ts` — main orchestration loop
- `src/agents/pi-embedded-runner/run/attempt.ts` — single attempt execution (1900+ LOC)
- `src/agents/pi-embedded-runner/compact.ts` — compaction pipeline
- `src/agents/pi-embedded-runner/model.ts` — model resolution, registry lookup
- `src/agents/failover-error.ts` — error classification
- `src/agents/pi-tools.ts` — tool creation, policy, schema sanitization (1200+ LOC)
- `src/agents/usage.ts` — token usage normalization across providers

### Multi-Provider Support

Anthropic, OpenAI, Google Gemini, Ollama, Moonshot, XAI, and local models. Each has provider-specific stream wrappers:

- `anthropic-stream-wrappers.ts` — beta headers, tool payload compat, cache retention
- `openai-stream-wrappers.ts` — OpenAI streaming quirks

### Failover Strategy

Three-layer failover:

1. **Auth profile cycling:** Rotate through profiles, skip cooldown-flagged ones (rate_limit, overloaded, billing, auth failures)
2. **Error classification:** HTTP status mapping (401 auth, 402 billing, 429 rate_limit, 503 overloaded, 408 timeout) plus regex on error messages
3. **Overload backoff:** Exponential (250ms to 1500ms, 2x factor, 0.2 jitter)

Retry budget: base 24 iterations + 8 per profile candidate (min 32, max 160). Compaction-triggered retries excluded.

Thinking level fallback: "extended" -> "standard" -> "off" on reasoning failures.

### Context Window Management

Resolution hierarchy:

1. `modelsConfig[provider].models[id].contextWindow`
2. Model discovery (models.json)
3. `agents.defaults.contextTokens` (cap, not default)
4. `DEFAULT_CONTEXT_TOKENS` (131,072)

Hard minimum: 16,000 tokens. Warning below 32,000.

### Compaction

Triggered reactively on context overflow (not proactively at 80%). Process:

1. Load session from disk (with write lock)
2. Rebuild context (tools, system prompt, skills)
3. Validate transcript (repair tool_use/tool_result pairing)
4. Apply history truncation
5. Call session `auto-compact()`
6. Write back to disk

Safety: 2-minute timeout, max 3 overflow compaction attempts. Compaction is **synchronous and blocking** — if the PI framework's compaction is slow, the entire agent run stalls.

### Tool System

Tools are registered via `createOpenClawCodingTools()`, filtered by policy (owner-only, group, subagent, message provider), and wrapped with guards (abort signal, before-tool-call hook, param normalization). Tool results truncated to 8,000 chars.

Categories:

- **Core:** exec, read, write, apply_patch, message, cron
- **PI SDK built-in:** filesystem, code editing
- **Plugin/extension:** dynamically loaded
- **Custom API:** user-defined via MCP

---

## Plugin System

### Architecture

Plugins extend OpenClaw without modifying core. The system supports tools, hooks, channels, services, HTTP routes, CLI commands, and providers.

**Key files:**

- `src/plugins/loader.ts` — discovery, manifest validation, module loading (829 LOC)
- `src/plugins/hooks.ts` — hook runner with priority ordering (763 LOC)
- `src/plugins/registry.ts` — registry and API factory (625 LOC)
- `src/plugins/types.ts` — type definitions (893 LOC)
- `src/plugins/manifest.ts` — manifest loading and validation
- `src/plugins/discovery.ts` — plugin candidate discovery
- `src/plugin-sdk/` — 113+ public SDK files

### Loading Pipeline

1. **Discovery:** Find candidates in bundled, global (`~/.openclaw/extensions/`), workspace, and config-specified paths
2. **Manifest validation:** Load and validate `openclaw.plugin.json`
3. **Filtering:** Apply enable/disable, allowlist/denylist, exclusive slot resolution
4. **Module loading:** Jiti-based lazy TypeScript/JavaScript loading
5. **Registration:** Validate config, call `register()` or `activate()`, track all registrations

### Plugin API

Plugins receive an `OpenClawPluginApi` object with:

```typescript
{
  (id,
    name,
    version,
    description,
    source,
    config, // Full OpenClawConfig
    pluginConfig, // Plugin-specific config
    runtime, // PluginRuntime (lazy-initialized)
    logger,
    // Registration methods
    registerTool(tool | factory, opts));
  registerHook(events, handler, opts);
  registerHttpRoute(params);
  registerChannel(registration);
  registerGatewayMethod(method, handler);
  registerCli(registrar, opts);
  registerService(service);
  registerProvider(provider);
  registerCommand(command);
  registerContextEngine(id, factory);
}
```

### Hook System (24 Hooks)

**Agent:** `before_model_resolve`, `before_prompt_build`, `before_agent_start` (legacy), `llm_input`, `llm_output`, `agent_end`, `before_compaction`, `after_compaction`, `before_reset`

**Message:** `message_received`, `message_sending`, `message_sent`

**Tool:** `before_tool_call`, `after_tool_call`, `tool_result_persist` (sync), `before_message_write` (sync)

**Session:** `session_start`, `session_end`

**Subagent:** `subagent_spawning`, `subagent_delivery_target`, `subagent_spawned`, `subagent_ended`

**Gateway:** `gateway_start`, `gateway_stop`

Execution models:

- **Parallel (fire-and-forget):** `agent_end`, `llm_input`, `llm_output`, `message_received`, `message_sent`, `after_tool_call`, `session_start`, `session_end`, `gateway_start`, `gateway_stop`
- **Sequential (result-merging):** `before_model_resolve`, `before_prompt_build`, `message_sending`, `before_tool_call`, `subagent_spawning`
- **Synchronous:** `tool_result_persist`, `before_message_write`

### Exclusive Slots

Only one plugin can claim `kind: "memory"` or `kind: "context-engine"` at a time. Selection via `plugins.slots.memory = "memory-core"`.

### Plugin Runtime

Lazy-initialized proxy providing:

- Config helpers, model resolution
- Media processing (transcription, TTS, STT)
- Memory search, tool creation factories
- Channel-specific utilities
- Event publishing
- Subagent spawning (request-scoped only)

---

## Channels and Routing

### Message Flow

```
Channel Monitor (platform-specific)
  |
  v
Inbound Debounce -> Security (allow-from, mention gating)
  |
  v
Route Resolution (binding match -> agent + session key)
  |
  v
Message Context Finalization (MsgContext -> FinalizedMsgContext)
  |
  v
Agent Invocation -> LLM -> Tool Calls -> Response
  |
  v
Outbound Delivery (chunking, adapter dispatch, retry, queue)
```

### Routing Priority

Deterministic binding match in priority order:

1. Binding peer match (exact channel + peer kind + peer ID)
2. Parent peer match (thread inheritance)
3. Discord guild + roles
4. Guild match
5. Slack team match
6. Account match
7. Channel match (any account)
8. Default agent

Each match yields a `ResolvedAgentRoute` with `sessionKey`, `lastRoutePolicy`, and `matchedBy` debug label.

**Key files:**

- `src/routing/resolve-route.ts` — binding matching
- `src/routing/session-key.ts` — session key generation and normalization

### Channel Dock Pattern

`src/channels/dock.ts` provides lightweight metadata without importing heavy channel monitors:

```typescript
type ChannelDock = {
  id: ChannelId;
  capabilities: ChannelCapabilities; // chatTypes, media, reactions, threads
  commands?: ChannelCommandAdapter;
  config?: ChannelConfigAdapter;
  groups?: ChannelGroupAdapter;
  mentions?: ChannelMentionAdapter;
  threading?: ChannelThreadingAdapter;
  outbound?: { textChunkLimit? }; // 2000 (Discord), 4000 (Telegram), 350 (IRC)
};
```

### Per-Channel Text Limits

| Channel  | Chunk Limit  |
| -------- | ------------ |
| Telegram | 4,000 chars  |
| Discord  | 2,000 chars  |
| Slack    | (via plugin) |
| IRC      | 350 chars    |

### Outbound Delivery

Unified orchestration in `src/infra/outbound/deliver.ts`:

1. Target resolution via `resolveTarget()` adapter
2. Payload chunking per channel limits
3. Adapter dispatch (text / media / payload)
4. Per-channel retry (Telegram: regex-based; Discord: `RateLimitError`)
5. Fallback (e.g., Telegram HTML parse error -> plain text)
6. Queue persistence if delivery fails

**Delivery queue:** File-persisted at `~/.openclaw/delivery-queue/`. Max 5 retries with exponential backoff (5s, 25s, 2m, 10m). Failed entries moved to `failed/` subdirectory. Recovery runs on startup.

### Media Handling

`src/media/fetch.ts` provides SSRF-guarded remote media fetching with per-channel limits:

| Channel  | Max Size |
| -------- | -------- |
| Telegram | 20 MB    |
| Discord  | 25 MB    |
| Slack    | 1 GB     |
| Signal   | 30 MB    |

### Delivery Guarantees

- **Inbound:** At-least-once to agent (duplicate possible on retry)
- **Outbound:** At-least-once send attempt (queued delivery may re-send on crash)
- **Session state:** Optimistic writes; JSONL transcript for recovery
- **No distributed consensus:** File-based state; multi-instance requires sharding by session key

---

## Memory System

### Architecture

Hybrid search combining BM25 keyword matching and vector similarity via sqlite-vec (SQLite extension).

**Key files:**

- `src/memory/manager.ts` — vector store init, embedding provider selection
- `src/memory/manager-embedding-ops.ts` — batch embedding uploads
- `src/memory/manager-sync-ops.ts` — file watching, delta sync, session tracking
- `src/memory/qmd-manager.ts` — query expansion, metadata filtering
- `src/memory/internal.ts` — internal memory indexing

### Embedding Providers

OpenAI, Gemini, Voyage, Mistral, Ollama, and local models. Batch processing normalized across providers.

### Retrieval

Not tightly coupled to agent run. Uses `resolveContextEngine()` for retrieval. Memory citations optionally appended to system prompt. Falls back to keyword-only search if vector DB unavailable.

### Limitations

- Session memory sync is eventual-consistent (can miss recent context)
- No alerting if vector DB corrupted
- Embedding provider failures silently fall back to keyword search

---

## Configuration and Infrastructure

### Config Loading Pipeline

**Entry:** `src/config/io.ts::createConfigIO()` (1000+ LOC)

12-stage normalization:

1. Raw read (JSON5 parse)
2. `$include` directive resolution
3. Environment variable substitution (`${VAR}` references)
4. Zod validation (fail-closed)
5. Duplicate agent directory detection
6. Default application (8 nested stages in strict order):
   - `applyMessageDefaults()`
   - `applyLoggingDefaults()`
   - `applySessionDefaults()`
   - `applyAgentDefaults()`
   - `applyContextPruningDefaults()`
   - `applyCompactionDefaults()`
   - `applyModelDefaults()`
   - `applyTalkConfigNormalization()`
7. Path normalization
8. Exec safe bin setup
9. Post-normalization duplicate detection
10. Env var application (`env.vars`)
11. Shell env fallback (login shell exec, 15s timeout)
12. Runtime overrides (CLI patches)

### Config Schema

33 type modules, 20+ Zod validator modules (5,282 LOC). Root type: `OpenClawConfig` (~100 properties).

**Key files:**

- `src/config/types.ts` — re-export hub
- `src/config/types.openclaw.ts` — root config type
- `src/config/zod-schema.ts` — main schema builder
- `src/config/validation.ts` — issue mapping, custom validators

### CLI Structure

**Entry:** `src/cli/run-main.ts`

Startup sequence:

1. `loadDotEnv()`, `normalizeEnv()`, `assertSupportedRuntime()` (Node 22+)
2. `tryRouteCli()` — early exit for certain commands
3. `buildProgram()` — Commander.js program with lazy command registration
4. `program.parseAsync(argv)`

Commands registered lazily via `registerCoreCliByName()` and `registerSubCliByName()` to avoid loading unused modules.

### Dependency Injection

CLI dependencies (`src/cli/deps.ts`) use deferred module loading — 6 channel sender runtimes imported on first use via memoized `import()`. Config I/O accepts injectable `fs`, `json5`, `logger`, `env`, `homedir`, `configPath` for testing.

### Global State

169+ module-level mutable state references across the codebase:

| State                   | Location               | Risk                                              |
| ----------------------- | ---------------------- | ------------------------------------------------- |
| `runtimeConfigSnapshot` | `io.ts`                | Dual snapshot (normalized + source), no locking   |
| `configCache`           | `io.ts`                | Time-expiry, requires manual `clearConfigCache()` |
| `loggingState`          | `logging/state.ts`     | Mutable after init                                |
| `subagentRuns`          | `subagent-registry.ts` | Unbounded Map, no eviction                        |
| `externalTransports`    | `logging/logger.ts`    | Set of custom log handlers                        |

### Logging

Resolution priority: `ENV > override settings > config.logging > defaults`. File logging with daily rotation, 500 MB max, 24-hour max age. Redaction applied before config validation error output.

### Build System

tsdown bundles 131 entry points: main, CLI daemon, 54 plugin SDK subpaths, hook handlers. Test framework: Vitest with vmForks pool (16 local workers, 2-3 CI), V8 coverage at 70% threshold.

---

## Security Posture

### Upstream (What Exists)

- **Auth rate limiting:** Per-scope sliding window, loopback exempt
- **Device identity:** ECDSA signature verification, platform/device-family pinning
- **Scope-based access control:** Broadcast events filtered by client scopes
- **Unauthorized flood guard:** Close after 10 consecutive failures
- **SSRF guard:** Media fetch validates URLs
- **Provenance tracking:** Warns about untracked plugin origins
- **Hook field constraints:** `allowPromptInjection=false` strips dangerous hook fields
- **Plugin allowlist/denylist:** Config-controlled plugin loading

### Upstream Gaps

- No plugin process isolation (plugins share the main Node.js process)
- Credentials stored in plaintext files
- No credential encryption at rest
- No plugin code signing or verification
- No embedding content filtering (secrets can enter vector DB)
- No log scrubbing (secrets can appear in log output)
- No env allowlist for host exec (all env vars exposed)
- No auth audit logging
- No nonce replay protection

---

## Architectural Strengths

### Gateway

- Clear separation of auth, protocol, and request handling
- Comprehensive device identity and pairing flow
- Scope-based access control on broadcast events
- Graceful shutdown with hook integration
- Dedupe and health snapshot optimization

### Agent Orchestration

- Multi-layer failover with profile rotation, backoff, and cooldown
- Flexible policy-based tool filtering with hook wrappers
- Comprehensive error classification (regex + HTTP status + error codes)
- Multi-provider support with provider-specific stream wrappers
- Thinking level fallback (extended -> standard -> off)

### Plugin System

- 24 lifecycle hooks covering every major phase
- Comprehensive registration API (tools, hooks, channels, services, etc.)
- Type-safe SDK with domain-scoped exports
- Exclusive slots prevent conflicting plugins
- Lazy runtime avoids unnecessary imports

### Channels

- Deterministic priority-based routing
- Lightweight dock pattern for metadata
- Resilient file-persisted delivery queue
- Per-channel capability declarations
- Graceful text fallback (e.g., HTML parse error -> plain text)

### Config

- 12-stage normalization with fail-closed validation
- Includes, env substitution, shell env fallback
- Lazy command registration avoids loading unused modules
- Injectable deps for test isolation

---

## Architectural Gaps

### Scalability

| Issue                                                          | Impact                                               | Severity |
| -------------------------------------------------------------- | ---------------------------------------------------- | -------- |
| All state in-memory (clients, sessions, dedupe, rate limiters) | No horizontal scaling; restart loses all connections | High     |
| No connection limits (per-IP or total)                         | Single misbehaving client can DOS the gateway        | High     |
| Broadcast iterates all clients O(n)                            | Slow clients block or get disconnected               | Medium   |
| Rate limiter per-gateway only                                  | No shared state across load-balanced instances       | Medium   |

### Reliability

| Issue                                                    | Impact                                    | Severity |
| -------------------------------------------------------- | ----------------------------------------- | -------- |
| No request timeout envelope for async handlers           | Hanging tool/LLM call blocks indefinitely | High     |
| No circuit breaker for failing channels                  | Errors propagate without isolation        | High     |
| Compaction is synchronous and blocking                   | Slow compaction stalls entire agent run   | Medium   |
| Session file corruption: best-effort repair, no rollback | Potential data loss                       | Medium   |
| Subagent registry grows unbounded                        | Memory leak in long-running gateways      | Medium   |
| Delivery queue assumes hooks are pure                    | Side effects duplicated on replay         | Low      |

### Missing Abstractions

| Abstraction                                | Why It Matters                                                        |
| ------------------------------------------ | --------------------------------------------------------------------- |
| Unified `ChannelSendError`                 | Each channel has its own error types with no shared recovery contract |
| Thread vs reply-to separation              | `ChannelThreadingAdapter` conflates distinct concepts per channel     |
| Account normalization contract             | Channels reimplement or skip `normalizeAccountId()`                   |
| LLM request/response lifecycle             | Payload construction and streaming events ad-hoc per provider         |
| Plugin versioning / compatibility          | No semver checks; breaking API changes silently break plugins         |
| Plugin `deactivate()` / `destroy()`        | No cleanup hooks; long-running plugins can leak resources             |
| Request-scoped context (AsyncLocalStorage) | No tracing or per-request isolation                                   |

### Code Quality

| Issue                              | Location                   | Detail                                                                 |
| ---------------------------------- | -------------------------- | ---------------------------------------------------------------------- |
| Monolithic orchestration loop      | `run.ts` (2000+ LOC)       | Error recovery embedded in loop; no state machine                      |
| God object                         | `config/io.ts` (1000+ LOC) | Handles read/write/validate/normalize/cache                            |
| Validation order sensitivity       | Config normalization       | 8 nested `applyDefaults()` where order matters but isn't type-enforced |
| 169+ global state references       | Throughout codebase        | Module-level mutable state with no locking                             |
| PI framework black box             | Session management         | No abstraction layer for swapping implementations                      |
| Provider-specific quirks scattered | Agent code                 | `isXaiProvider`, `isOllamaCompatProvider` conditionals inline          |

### Observability

| Gap                           | Detail                                                      |
| ----------------------------- | ----------------------------------------------------------- |
| No per-connection metrics     | Latency, buffer usage, frame sizes not tracked              |
| No runtime plugin diagnostics | Load-time diagnostics only                                  |
| No request tracing            | No AsyncLocalStorage or correlation IDs                     |
| Token counting unreliable     | Depends on provider-reported usage; fallback estimates poor |
| Compaction not observable     | PI framework's compaction is opaque                         |

---

## Fork Additions (entmoot-openclaw)

Our fork adds a comprehensive security layer in `src/security/` (58 files, ~8,700 lines) addressing gaps in the upstream codebase.

### Implemented Security Features

| ID         | Feature                                      | File(s)                                                                                   |
| ---------- | -------------------------------------------- | ----------------------------------------------------------------------------------------- |
| CRIT-01    | Env allowlist for host exec                  | `env-allowlist.ts`                                                                        |
| CRIT-02    | Credential encryption (AES-256-GCM)          | `credential-cipher.ts`, `credential-envelope.ts`, `credential-config.ts`, `master-key.ts` |
| CRIT-03A   | Plugin capability declaration                | `plugin-capabilities.ts`                                                                  |
| CRIT-03B   | Worker thread isolation                      | `worker-bridge/` (5 files)                                                                |
| CRIT-03C   | User consent and trust levels                | `plugin-security-policy.ts`, `plugin-security-advisory.ts`                                |
| HIGH-01/02 | Timing-safe secret comparison                | `secret-equal.ts`                                                                         |
| HIGH-05    | Plugin install blocking (dangerous patterns) | `plugin-install-policy.ts`                                                                |
| HIGH-07    | Log secret scrubbing                         | `log-scrubber.ts`                                                                         |
| HIGH-08    | Workspace path boundary                      | `path-boundary.ts`                                                                        |
| MED-02     | Nonce replay cache                           | `nonce-cache.ts`                                                                          |
| MED-03     | DNS rebinding protection                     | `host-validation.ts`                                                                      |
| MED-04     | Plugin code signing (Ed25519, TOFU)          | `plugin-signer.ts`, `plugin-trust-store.ts`                                               |
| MED-05     | Transport security runtime warning           | Patch to `server-startup-log.ts`                                                          |
| MED-06     | Embedding content filtering                  | `embedding-content-filter.ts`                                                             |
| MED-07     | Approval request rate limiting               | `approval-rate-limiter.ts`                                                                |
| LOW-03     | Auth audit log (JSONL)                       | `auth-audit-log.ts`                                                                       |

### Integration Points

Our security modules integrate via surgical patches to existing files:

- `src/gateway/auth.ts` — timing-safe comparison, audit logging
- `src/gateway/origin-check.ts` — DNS rebinding protection
- `src/gateway/server-methods/exec-approval.ts` — approval rate limiting
- `src/gateway/server/ws-connection/message-handler.ts` — nonce replay cache
- `src/agents/bash-tools.exec.ts` — env allowlist
- `src/config/io.ts` — log scrubbing
- `src/memory/internal.ts` — path boundary, embedding content filtering
- `src/plugins/loader.ts` — capability enforcement, security policy, signing verification
- `src/plugins/hooks.ts` — `before_memory_index` hook for content filtering
- `src/plugins/install.ts` — install policy, code signing

### Test Coverage

- 17 unit test files in `src/security/`
- 13 integration test files in `src/security/__integration__/`
- ~443 tests total

### Remaining Items

| ID          | Item                                                                                 | Status                                       |
| ----------- | ------------------------------------------------------------------------------------ | -------------------------------------------- |
| LOW-01      | Device key encryption at rest                                                        | Deferred (requires passphrase/keychain)      |
| LOW-02      | WebSocket payload limits                                                             | Deferred (existing limits deemed reasonable) |
| Future      | Plugin capability gates: `filesystem`, `child_process`, `env_access`, `config_write` | Declared but not yet enforced                |
| Integration | Wire worker bridge into upstream plugin loader                                       | Highest-impact next step                     |
