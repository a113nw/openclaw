# entmoot-openclaw

Fork of [openclaw/openclaw](https://github.com/openclaw/openclaw) with a security hardening layer.

## Fork Context

- **Origin:** `git@github.com:a113nw/openclaw.git` (public)
- **Upstream:** `https://github.com/openclaw/openclaw.git` (remote: `upstream`)
- **Fork point:** commit `f753da867` (last upstream commit before our changes)
- **Branches:**
  - `main` — our fork with security additions
  - `upstream-at-fork` — snapshot at fork point
  - `upstream-latest` — tracks `upstream/main`

## What We Changed

98 files changed, +8,684 lines / -47 lines. All changes are security-focused:

- **`src/security/`** — 58 new files: credential encryption, plugin isolation (worker bridge), plugin signing, env allowlist, log scrubbing, embedding content filtering, nonce replay cache, DNS rebinding protection, approval rate limiting, auth audit log, timing-safe comparison, path boundary, plugin capabilities/consent
- **Surgical patches** to 17 existing files in `src/gateway/`, `src/plugins/`, `src/config/`, `src/memory/`, `src/infra/`, `src/agents/`
- **`SECURITY.md`** — comprehensive threat model and security policy (+381 lines)
- **`ARCHITECTURE.md`** — full architectural analysis of the upstream codebase

See `ARCHITECTURE.md` for the complete architectural review.

## Upstream Instructions

The upstream `AGENTS.md` contains maintainer conventions for the original openclaw project. Those conventions apply here except where this file overrides them.

## Our Conventions

- Security modules live in `src/security/`. Tests colocated as `*.test.ts`, integration tests in `src/security/__integration__/`.
- Commit style: `feat(security): <description> (<FINDING-ID>)` for security features, standard Conventional Commits otherwise.
- PRs flow from `develop` -> `main` via merge commits.
- Always run security tests before pushing: `pnpm test src/security/`
- See `_NOW.md` for current focus, `_GOING.md` for roadmap.
