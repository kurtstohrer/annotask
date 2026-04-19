# Annotask Stress Lab

Multi-MFE, multi-service environment that deliberately exercises as much of
Annotask as possible in one place. See `plan/annotask-stress-playground-plan.md`
(gitignored in this repo) for the full design rationale.

## Layout

```
apps/
  host-single-spa/           # single-spa root config — port 4200
  mfe-react-workflows/       # React — port 4210 — mfe: react-workflows
  mfe-vue-data-lab/          # Vue — port 4220 — mfe: vue-data-lab
  mfe-svelte-streaming/      # Svelte — port 4230 — mfe: svelte-streaming
  mfe-solid-component-lab/   # Solid — port 4240 — mfe: solid-component-lab
  mfe-blade-legacy-lab/      # Blade SSR — port 4250 — mfe: blade-legacy-lab
  mfe-htmx-partials/         # htmx — port 4260 — mfe: htmx-partials
services/
  java-api/                  # Spring Boot — port 4310
  fastapi/                   # FastAPI — port 4320
  go-api/                    # Go — port 4330
  node-api/                  # Node — port 4340
  laravel/                   # Laravel — port 4350 (serves Blade MFE)
  rust-api/                  # Rust — port 4360 (serves htmx fragments)
packages/
  shared-fixtures/           # Deterministic seed data
  shared-contracts/          # Shared TS contracts / generated types
  shared-ui-tokens/          # Cross-MFE design tokens
  upstream-adapters/         # External-source adapters + snapshot fallbacks
  source-snapshots/          # Pinned snapshots of external data
e2e/                         # Playwright specs for host + each MFE + services
```

## Current skeleton status

| Slice | State |
|-------|-------|
| `apps/host-single-spa` | Implemented (minimal shell + nav) |
| `apps/mfe-vue-data-lab` | Implemented (minimal boot + annotask mfe id) |
| `services/fastapi` | Implemented (health endpoint) |
| Everything else | README stub only |

The first vertical slice exists to prove the pattern — host + one MFE + one
service, all bootable. Remaining MFEs and services land in follow-up commits.

## Running the implemented slice

From the repo root:

```bash
pnpm build                          # build annotask once (required by workspace deps)
pnpm dev:stress-fastapi             # start FastAPI on :4320
pnpm dev:stress-vue-data-lab        # start Vue data lab on :4220
pnpm dev:stress-host                # start host on :4200
```

Open `http://localhost:4200/` for the host.

Once Docker is in play (next pass), `pnpm stress-test:up` will run the full
compose stack.

## Conventions

- MFE ids are kebab-case and match the directory name minus the `mfe-` prefix.
- Frontend ports occupy the `42x0` band; service ports occupy `43x0`.
- Each MFE consumes annotask via `workspace:*` — same wiring as `playgrounds/simple/`.
- External data sources use a live-plus-snapshot pattern. Live is nice-to-have,
  snapshot is the default. Adapters live in `packages/upstream-adapters/`.
