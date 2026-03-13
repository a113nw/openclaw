# Current Focus

## Completed

### Security Hardening (all findings addressed)

| ID         | Feature                                          | Status |
| ---------- | ------------------------------------------------ | ------ |
| CRIT-01    | Env allowlist for host exec                      | Done   |
| CRIT-02    | Credential encryption (AES-256-GCM + master key) | Done   |
| CRIT-03A   | Plugin capability declaration                    | Done   |
| CRIT-03B   | Worker thread isolation (worker bridge)          | Done   |
| CRIT-03C   | User consent + trust levels                      | Done   |
| HIGH-01/02 | Timing-safe secret comparison                    | Done   |
| HIGH-05    | Plugin install blocking (dangerous patterns)     | Done   |
| HIGH-07    | Log secret scrubbing                             | Done   |
| HIGH-08    | Workspace path boundary                          | Done   |
| MED-02     | Nonce replay cache                               | Done   |
| MED-03     | DNS rebinding protection                         | Done   |
| MED-04     | Plugin code signing (Ed25519, TOFU)              | Done   |
| MED-05     | Transport security runtime warning               | Done   |
| MED-06     | Embedding content filtering                      | Done   |
| MED-07     | Approval request rate limiting                   | Done   |
| LOW-03     | Auth audit log (JSONL)                           | Done   |

### Architecture Analysis

- Full codebase review completed (gateway, agent/LLM, plugins, channels, config/infra)
- Written up in `ARCHITECTURE.md`

### Tooling Setup

- Added `.tool-versions`, `.envrc`, direnv guard in `dotenv.ts`
- Documented in `TOOLING.md`

## In Progress

- Architectural review and planning for next work items
- Evaluating upstream divergence and sync strategy

## Blockers

None.
