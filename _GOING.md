# Roadmap

## Next Up

### Wire Worker Bridge into Plugin Loader

The worker bridge (`src/security/worker-bridge/`) exists but is not yet integrated into the upstream plugin loader (`src/plugins/loader.ts`). Plugins with trust level `restricted` should be loaded into worker threads instead of the main process. This is the highest-impact remaining security work.

### Remaining Security Items

| ID     | Item                                                                                 | Notes                                                                            |
| ------ | ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------- |
| LOW-01 | Device key encryption at rest                                                        | Requires passphrase or keychain integration                                      |
| LOW-02 | WebSocket payload limits                                                             | Existing limits (25 MB frame, 50 MB buffer) deemed reasonable; revisit if needed |
| Future | Plugin capability gates: `filesystem`, `child_process`, `env_access`, `config_write` | Declared in `plugin-capabilities.ts` but not yet enforced                        |

## Upstream Gaps Worth Addressing

Identified in `ARCHITECTURE.md`. Prioritized by impact:

### High Priority

- **Connection limits** — no `maxConnections` or per-IP limits; single client can DOS the gateway
- **Request timeout envelope** — no timeout for async handlers; hanging tool/LLM calls block indefinitely
- **Circuit breaker for channels** — no isolation when a channel is down; errors propagate

### Medium Priority

- **Unified error classification** — each channel has its own error types; no shared `ChannelSendError` contract
- **Config I/O refactor** — `io.ts` is a 1000+ LOC god object (read/write/validate/normalize/cache)
- **Agent run state machine** — `run.ts` (2000+ LOC) has error recovery embedded in the loop; needs extraction
- **Subagent registry eviction** — grows unbounded in long-running gateways
- **Proactive compaction** — currently reactive only (on overflow); should trigger at ~80% context

### Lower Priority

- Thread vs reply-to abstraction split
- Account normalization contract across channels
- Plugin versioning / compatibility checks
- Plugin `deactivate()` / `destroy()` lifecycle hooks
- AsyncLocalStorage for request-scoped tracing

## Upstream Sync Strategy

- `upstream-latest` branch tracks `upstream/main`
- Periodically `git fetch upstream` + compare for relevant changes
- Our changes are additive (new files + surgical patches) so merge conflicts should be minimal
- Monitor upstream security-related changes that overlap with our work
