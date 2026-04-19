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
| `apps/host-single-spa` | Implemented |
| `apps/mfe-react-workflows` | Implemented |
| `apps/mfe-vue-data-lab` | Implemented |
| `apps/mfe-svelte-streaming` | Implemented |
| `apps/mfe-solid-component-lab` | Implemented |
| `apps/mfe-blade-legacy-lab` | Vite placeholder; real Blade via Laravel service |
| `apps/mfe-htmx-partials` | Implemented |
| `services/fastapi` | Implemented (health + OpenAPI) |
| `services/node-api` | Implemented |
| `services/go-api` | Implemented |
| `services/rust-api` | Implemented (JSON + HTML fragment) |
| `services/java-api` | Docker-only stub |
| `services/laravel` | Docker-only stub |


## Running the lab

After a one-time `pnpm build` at the repo root (so the workspace resolves
the built annotask plugin), use the justfile in this directory:

```bash
cd playgrounds/stress-test
just up            # start everything: 4 native services + host + every MFE
just down          # kill anything listening on stress-lab ports
just test          # run the Playwright suite (boots servers itself)
just list          # show every recipe
```

Individual pieces:

```bash
just host          # just the host shell on :4200
just vue           # Vue data-lab on :4220
just fastapi       # FastAPI on :4320
# ...and one recipe per MFE / service
```

Docker compose (services only — adds Java + Laravel once those ship):

```bash
just compose-up
just compose-down
```

The justfile is a thin wrapper — you can call the underlying pnpm scripts
directly from the repo root (`pnpm dev:stress-host`, `pnpm test:e2e:stress`,
etc.) if you prefer.

## Conventions

- MFE ids are kebab-case and match the directory name minus the `mfe-` prefix.
- Frontend ports occupy the `42x0` band; service ports occupy `43x0`.
- Each MFE consumes annotask via `workspace:*` — same wiring as `playgrounds/simple/`.
- External data sources use a live-plus-snapshot pattern. Live is nice-to-have,
  snapshot is the default. Adapters live in `packages/upstream-adapters/`.
