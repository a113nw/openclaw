# Where We Are Going

## Security Audit Findings — Master Task List

23 findings from the security audit, organized by severity. Checked items are implemented, tested, and merged to `main`.

---

### Critical (4 findings)

- [x] **CRIT-01** — Host exec environment leaks secrets
  - `filterHostExecEnv()` in `env-allowlist.ts` strips dangerous env vars from host-mode exec
  - Patched `bash-tools.exec.ts` to use filtered env instead of raw `process.env`

- [x] **CRIT-02** — Plaintext credential storage
  - AES-256-GCM encryption with `_encrypted` sentinel envelope format
  - Master key: macOS keychain → file fallback → auto-generate
  - Opt-in via `OPENCLAW_ENCRYPT_CREDENTIALS=1`; transparent migration (read always decrypts)
  - Files: `credential-config.ts`, `credential-cipher.ts`, `master-key.ts`, `credential-envelope.ts`
  - Patched: `json-file.ts`, `auth-profiles/store.ts`, `device-identity.ts`, `device-auth-store.ts`, `pairing-store.ts`

- [x] **CRIT-03a** — Plugin capability declarations (Stage A)
  - `plugin-capabilities.ts` provides capability declaration and API surface restriction
  - Plugins declaring capabilities get a proxy that blocks undeclared operations
  - Backward compatible — no declarations = unrestricted (legacy behavior)

- [x] **CRIT-03b** — Worker Thread plugin isolation (Stage B-1)
  - Worker Thread IPC bridge: `protocol.ts`, `rpc.ts`, `serialization.ts`, `worker-entry.ts`, `main-host.ts`
  - Opt-in via `"isolation": "worker"` in `openclaw.plugin.json`
  - Supports: `registerTool`, `on()` (async hooks), `registerService`, `registerCommand`, `api.logger`
  - Unsupported APIs throw clear errors; no silent fallback
  - Patched: `manifest.ts`, `manifest-registry.ts`, `registry.ts`, `loader.ts`
  - **Deferred to B-2/B-3:** `api.runtime` RPC proxy, channel/provider/HTTP bridging, sync hooks, `resourceLimits`

- [x] **CRIT-04** — Tailscale header trust model
  - Trust model documented in SECURITY.md "Tailscale Trust Model" section
  - Covers: validation layers table, trust assumptions, known limitations, operator recommendations
  - No code changes needed — existing whois verification + loopback binding is sound

---

### High (8 findings)

- [x] **HIGH-01** — Gateway token auth timing oracle
  - `safeEqualSecret()` now uses HMAC-SHA256 digest comparison instead of length-check-then-compare
  - Fixed in `secret-equal.ts`, consumed by `gateway/auth.ts`

- [x] **HIGH-02** — Device pairing token timing oracle
  - Same fix as HIGH-01 — both flows use `safeEqualSecret()` from `secret-equal.ts`

- [ ] **HIGH-03** — Exec allowlist argument bypass
  - Tool argument patterns can be crafted to bypass allowlist validation
  - **Requires**: Comprehensive argument parsing and validation
  - **Approach**: Document the limitation. Add warning in security audit output. Design a proper argument parser that handles shell quoting, pipes, and subshells.

- [x] **HIGH-04** — `$include` path traversal
  - Already fixed upstream — `includes.ts` now validates `isPathInside` with symlink resolution
  - No action needed

- [x] **HIGH-05** — Plugin scanner warn-only, never blocks
  - `shouldBlockPluginInstall()` in `plugin-install-policy.ts` blocks on critical findings
  - `--force` flag added to override blocking

- [x] **HIGH-06** — Auth rate limiting disabled by default
  - Non-loopback gateways now get a default rate limiter automatically
  - Defaults: 10 attempts, 1-minute window, 5-minute lockout, loopback exempt

- [x] **HIGH-07** — Config error logs may contain secrets
  - `scrubSecrets()` in `log-scrubber.ts` redacts credential patterns from log output
  - Applied to 3 log calls in `config/io.ts`

- [x] **HIGH-08** — Unrestricted memory indexing paths
  - `isWithinWorkspace()` in `path-boundary.ts` filters extra memory paths to workspace boundary
  - Paths outside workspace rejected with warning

---

### Medium (7 findings)

- [x] **MED-01** — Incomplete sensitive field redaction patterns
  - Added 6 new patterns to `SENSITIVE_PATTERNS` in `schema.hints.ts`
  - Added 3 whitelist entries for false positives

- [x] **MED-02** — Device signature replay window
  - `NonceCache` in `nonce-cache.ts` tracks signature hashes with 20-minute TTL
  - Duplicate signatures rejected at `message-handler.ts`

- [x] **MED-03** — DNS rebinding via loopback origin bypass
  - `isAllowedHostHeader()` in `host-validation.ts` validates Host header against known-safe list
  - Rejects public domain Host headers when origin is loopback

- [ ] **MED-04** — Plugin code signing
  - No verification that installed plugins come from a trusted source
  - **Requires**: PKI infrastructure, signature format, verification tooling
  - **Approach**: Add `signature` field to plugin manifest. Build signing CLI (`openclaw plugin sign`). Verify signatures at install and load time. Support a trust-on-first-use model for unsigned plugins.

- [ ] **MED-05** — Session data transmitted unencrypted
  - WebSocket messages between gateway and clients are not encrypted at the application layer
  - **Requires**: Key exchange protocol, session key management
  - **Approach**: Design TLS-like handshake over WebSocket. Alternatively, document that users should use SSH tunnels or Tailscale for encrypted transport. Evaluate whether application-layer encryption is worth the complexity given the transport-layer options.

- [ ] **MED-06** — Embedding content not filtered before indexing
  - Memory indexer processes all file content without sanitization
  - **Requires**: Content filtering hooks, plugin API for custom filters
  - **Approach**: Implement as an optional `before_embedding` plugin hook. Ship a default filter that strips common sensitive patterns (credentials in code, .env file contents). Allow users to configure custom exclusion patterns.

- [ ] **MED-07** — Approval request flooding
  - No per-session rate limit on tool approval prompts
  - **Requires**: UX design for rate limiting approval dialogs
  - **Approach**: Add a per-session counter for approval requests. After threshold, batch remaining approvals into a single prompt. Consider "approve all for this session" option.

---

### Low (4 findings)

- [ ] **LOW-01** — Device keys stored unencrypted
  - Device identity private keys are stored as plaintext PEM files
  - **Requires**: Passphrase or keychain integration
  - **Approach**: Encrypt private key with a user passphrase or integrate with OS keychain (macOS Keychain, Linux secret-service, Windows Credential Manager). Implement transparent decrypt on use.

- [ ] **LOW-02** — WebSocket payload size limits
  - Existing limits are present but may be too generous
  - **Requires**: Review and tightening of limits
  - **Approach**: Audit current max payload sizes. Set per-message-type limits based on expected content. Add server-side enforcement with descriptive error codes.

- [x] **LOW-03** — No centralized auth event logging
  - `recordAuthEvent()` in `auth-audit-log.ts` writes structured JSONL
  - Auto-rotates at 5MB, best-effort (never throws)

- [x] **LOW-04** — Config file permissions not enforced on existing files
  - Config read path now checks permissions and corrects to `0o600` if too open
  - Warning logged when permissions are corrected

---

## Scorecard

| Severity | Total | Fixed | Deferred |
|----------|-------|-------|----------|
| Critical | 4 | 4 | 0 |
| High | 8 | 7 | 1 |
| Medium | 7 | 3 | 4 |
| Low | 4 | 2 | 2 |
| **Total** | **23** | **16** | **7** |

*Note: HIGH-04 was already fixed upstream, counted as fixed but required no action from us. CRIT-03a and CRIT-03b are counted as one finding (CRIT-03) with two stages — both complete, so +1 to the fixed count. CRIT-04 addressed via documentation (trust model in SECURITY.md).*

Effective completion: **17 implementations** across **16 distinct findings** (CRIT-03 has two stages).

---

## Deferred Items from Completed Work

These were explicitly scoped out of the CRIT-02/CRIT-03b implementations:

- **WhatsApp credential encryption** — `src/web/auth-store.ts` writes are controlled by Baileys library; needs a wrapper
- **Worker B-2**: `api.runtime` RPC proxy (deeply nested Proxy forwarding calls to main thread)
- **Worker B-3**: Channel, provider, HTTP handler bridging (complex bidirectional interfaces)
- **Sync hook support** in Workers (`tool_result_persist`, `before_message_write`)
- **Worker memory limits** via `resourceLimits`
- **Linux `secret-tool`** support in `master-key.ts`
- **Config-based encryption flag** (alongside env var)
- **Key rotation** for master key

---

## Recommended Next Steps (by priority)

### Tier 1 — COMPLETE

1. ~~**CRIT-02: Encrypted credential storage**~~ — Done
2. ~~**CRIT-03b: Worker Thread plugin isolation**~~ — Done (Stage B-1)

### Tier 2 — Medium impact, moderate effort

3. **MED-04: Plugin code signing**
   - Natural follow-up to the plugin security pipeline (install blocking + capabilities)
   - Completes the chain: sign → scan → block → restrict

4. **HIGH-03: Exec allowlist argument hardening**
   - Document the limitation now, design proper argument validation

5. ~~**CRIT-04: Document Tailscale trust model**~~ — Done

### Tier 3 — Lower priority

6. **MED-05**: Evaluate session encryption vs transport-layer guidance
7. **MED-06**: Implement `before_embedding` filter hook
8. **MED-07**: Design approval request rate limiting UX
9. **LOW-01**: Device key encryption with keychain integration
10. **LOW-02**: Audit and tighten WebSocket payload limits

### Tier 4 — Worker Thread hardening (follow-on)

11. **Worker B-2**: `api.runtime` RPC proxy
12. **Worker B-3**: Channel/provider/HTTP handler bridging
13. **Worker sync hooks**: `tool_result_persist`, `before_message_write`
14. **Worker `resourceLimits`**: Memory caps per plugin Worker
