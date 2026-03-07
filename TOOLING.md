# Tooling Standards

## Cross-Project Approach

All projects follow a standardized tooling setup:

### Runtimes

- **asdf** manages all language runtimes: Python, Node.js, Go. Each project pins its versions in `.tool-versions`. Run `asdf install` on first clone.
- **Python**: 3.11+ depending on project. Managed by asdf.
- **Node.js**: 22.x for all JS/TS projects. Managed by asdf.
- **Go**: 1.26.x where needed (vorga-riskapi). Managed by asdf.
- **pnpm**: Installed globally via `npm install -g pnpm`. Used for TypeScript monorepos.

### Environment

- **direnv** manages environment variables via `.envrc`. Variables load/unload automatically on `cd`. No manual `source .env` or app-level dotenv loading needed.
- **`.envrc`** activates Python venvs and loads `.env` files. asdf runtimes are handled by the shell hook in `.zshrc`.
- **`.env` files** are committed. Use `.env.local` (gitignored) for personal overrides.

### Python

- **`pyproject.toml` + `uv`** for dependency management. Lock with `uv pip compile`, install with `uv pip sync`.
- **`ruff`** for linting/formatting, **`mypy`** for type checking (strict where possible).
- **`.venv/`** in project root, activated automatically by `.envrc`.

### JavaScript/TypeScript

- **`pnpm`** for monorepos (entmoot-openclaw, entmoot-closedclaw).
- **`npm`** for single-package projects (affinity-jamjuice, chromatic-web, chromatic-qbe/M5, vorga-riskapi/web).

### Committed files

- `.envrc`, `.tool-versions`, `pyproject.toml`, and `.env` files are always committed.
- `.env.local` is gitignored (personal overrides only).

## This Project: entmoot-openclaw

**Status: Mostly compliant.** TypeScript/pnpm monorepo. Uses its own dotenv loading internally.

### TODO

- [ ] Add `.tool-versions` with `nodejs 22.12.0`
- [ ] Add `.envrc`:
  ```
  dotenv_if_exists .env
  ```
- [ ] Run `direnv allow` after adding `.envrc`
