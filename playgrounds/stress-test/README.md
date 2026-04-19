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
  mfe-htmx-partials/         # htmx — port 4260 — mfe: htmx-partials
services/
  java-api/                  # Spring Boot — port 4310
  fastapi/                   # FastAPI — port 4320
  go-api/                    # Go — port 4330
  node-api/                  # Node — port 4340
  laravel/                   # Laravel — port 4350 (serves Blade pages + JSON)
  rust-api/                  # Rust — port 4360 (serves htmx fragments)
packages/
  shared-fixtures/           # Deterministic seed data
  shared-contracts/          # Shared TS contracts / generated types
  shared-ui-tokens/          # Cross-MFE design tokens
  upstream-adapters/         # External-source adapters + snapshot fallbacks
  source-snapshots/          # Pinned snapshots of external data
e2e/                         # Playwright specs for host + each MFE + services
```

## Status

| Slice | Native dev | Docker (compose) |
|-------|-----------|------------------|
| `apps/host-single-spa` | ✅ | — |
| `apps/mfe-react-workflows` | ✅ | — |
| `apps/mfe-vue-data-lab` | ✅ | — |
| `apps/mfe-svelte-streaming` | ✅ | — |
| `apps/mfe-solid-component-lab` | ✅ | — |
| `apps/mfe-htmx-partials` | ✅ | — |
| `services/fastapi` | ✅ | ✅ |
| `services/node-api` | ✅ | ✅ |
| `services/go-api` | ✅ | ✅ |
| `services/rust-api` | ✅ | ✅ |
| `services/java-api` | — | ✅ (first build ~3–5 min) |
| `services/laravel` | — | ✅ (first build ~3–6 min; serves the Blade slot on :4350) |

The Blade "MFE" is served directly by Laravel on port 4350 — there is no
separate frontend workspace for it. The host iframes `:4350` for the
Blade slot; when Laravel isn't running, that iframe shows a connection
error (expected — start it with `just laravel`).

## Component library per framework

Each MFE uses a distinct component library so annotask's component
discovery has real breadth to traverse.

| MFE | Framework | Library | Imports from library |
|-----|-----------|---------|----------------------|
| `mfe-react-workflows` | React 19 | [Mantine](https://mantine.dev) | `Container`, `Card`, `Table`, `Badge`, `Button`, `Alert`, `Group`, `Stack`, `Title`, `Text` |
| `mfe-vue-data-lab` | Vue 3 | [Naive UI](https://www.naiveui.com) | `NCard`, `NDataTable`, `NDescriptions`, `NTag`, `NButton`, `NAlert`, `NSpace`, `NLayout` |
| `mfe-svelte-streaming` | Svelte 5 | [bits-ui](https://bits-ui.com) | `Dialog.Root`, `Dialog.Portal`, `Dialog.Overlay`, `Dialog.Content`, `Dialog.Close` |
| `mfe-solid-component-lab` | Solid | [Kobalte](https://kobalte.dev) | `Tabs`, `Button` |
| `mfe-htmx-partials` | htmx | [Pico.css](https://picocss.com) | classless styling — `<article>`, `<header>`, `<hgroup>`, `<button class="secondary">` |
| `mfe-blade-legacy-lab` (Laravel) | Blade | native `<x-*>` components | `<x-card>`, `<x-button>`, `<x-status-pill>`, `<x-workflow-table>` |

## Shared packages

Used across every MFE / service in the stress tier:

| Package | What it carries |
|---------|-----------------|
| `@annotask/stress-contracts` | `Health`, `Workflow`, `Product`, `MetricSeries`, `ComponentUsage` types |
| `@annotask/stress-fixtures` | Deterministic seed arrays (`workflows`, `products`, `metrics`, `componentUsage`) |
| `@annotask/stress-ui-tokens` | `tokens.css` — CSS custom properties every MFE imports at entry |
| `@annotask/stress-snapshots` | Pinned external-data snapshots (e.g. github-trending) |
| `@annotask/stress-upstream-adapters` | Live-or-snapshot fallback adapter pattern |


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
