# Annotask Stress Lab

Multi-MFE, multi-service environment that deliberately exercises as much of
Annotask as possible in one place. See `plan/annotask-stress-playground-plan.md`
(gitignored in this repo) for the full design rationale.

## Layout

```
apps/
  host-single-spa/           # single-spa root config — port 4200
  mfe-react-sidebar/         # React — port 4250 — mfe: react-sidebar (persistent chrome)
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
| `apps/mfe-react-sidebar` | ✅ | — |
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

## Real single-spa mounting

The stress-test MFEs are **not** iframe-wrapped. The host is a genuine single-spa
root — it imports each MFE's `src/single-spa.*` module cross-origin over
ESM and registers it as a single-spa application with a hash-based
activity function:

```
host (:4200)
├── registerApplication('@stress/react-sidebar',   import('http://localhost:4250/src/single-spa.tsx'), always-active)
├── registerApplication('@stress/vue-data-lab',    import('http://localhost:4220/src/single-spa.ts'),  #/vue)
├── registerApplication('@stress/react-workflows', import('http://localhost:4210/src/single-spa.tsx'), #/react)
├── registerApplication('@stress/svelte-streaming',   ...,                                             #/svelte)
├── registerApplication('@stress/solid-component-lab',...,                                             #/solid)
└── registerApplication('@stress/htmx-partials',      ...,                                             #/htmx)
```

The sidebar is registered with `activeWhen: () => true` so it stays mounted on every route — it provides persistent shell chrome (brand, nav, theme toggle). Content MFEs stack in an absolutely-positioned viewport next to the sidebar; only the active route's mount div contains rendered DOM at any time, and it fills the full content area.

Each MFE ships a small `single-spa.*` entry that exports
`bootstrap/mount/unmount` via its framework adapter:

| MFE | Adapter |
|-----|---------|
| React | `single-spa-react` |
| Vue | `single-spa-vue` |
| Svelte 5 | hand-written using `svelte`'s `mount`/`unmount` |
| Solid | hand-written using `solid-js/web`'s `render` |
| htmx | hand-written (injects HTML fragment + `htmx.process`) |

Each MFE also keeps its solo `main.*` entry so it still boots standalone
at its own port (fast iteration + existing smoke tests).

Under single-spa all MFE JS runs in the host's origin (`:4200`), so each
app fetches its service via absolute URL (Vue → `:4320`, React →
`:4310`, Svelte → `:4330`, Solid → `:4340`, htmx → `:4360`). Every
service has open CORS.

The React MFE uses `@vitejs/plugin-react-swc` plus a small preamble
shim in the host's `index.html` that installs the React Fast Refresh
globals before any MFE module loads — necessary because plugin-react's
Fast Refresh preamble normally comes from the MFE's own index.html,
which single-spa skips.

## Component library per framework

Each MFE uses a distinct component library so annotask's component
discovery has real breadth to traverse.

| MFE | Framework | Library | Imports from library |
|-----|-----------|---------|----------------------|
| `mfe-react-sidebar` | React 19 | [Radix Themes](https://www.radix-ui.com/themes) | `Theme`, `Flex`, `Box`, `Heading`, `Text`, `Separator`, `Badge`, `IconButton`, plus `@radix-ui/react-icons` |
| `mfe-react-workflows` | React 19 | [Mantine](https://mantine.dev) | `Container`, `Card`, `Table`, `Badge`, `Button`, `Alert`, `Group`, `Stack`, `Title`, `Text` |
| `mfe-vue-data-lab` | Vue 3 | [Naive UI](https://www.naiveui.com) | `NCard`, `NDataTable`, `NDescriptions`, `NTag`, `NButton`, `NAlert`, `NSpace`, `NLayout` |
| `mfe-svelte-streaming` | Svelte 5 | [bits-ui](https://bits-ui.com) | `Dialog.Root`, `Dialog.Portal`, `Dialog.Overlay`, `Dialog.Content`, `Dialog.Close` |
| `mfe-solid-component-lab` | Solid | [Kobalte](https://kobalte.dev) | `Tabs`, `Button` |
| `mfe-htmx-partials` | htmx | [Pico.css](https://picocss.com) | classless styling — `<article>`, `<header>`, `<hgroup>`, `<button class="secondary">` |

## Shared packages

Used across every MFE / service in the stress tier:

| Package | What it carries |
|---------|-----------------|
| `@annotask/stress-contracts` | `Health`, `Workflow`, `Product`, `MetricSeries`, `ComponentUsage` types |
| `@annotask/stress-fixtures` | Deterministic seed arrays (`workflows`, `products`, `metrics`, `componentUsage`) |
| `@annotask/stress-ui-tokens` | `tokens.css` — CSS custom properties every MFE imports at entry, plus `bootstrapTheme()` / `applyTheme()` / `onThemeChange()` helpers so each MFE syncs its framework-level provider (Mantine, Naive UI, Radix Themes) with the shared `light` / `dark` data-theme flag |
| `@annotask/stress-snapshots` | Pinned external-data snapshots (e.g. github-trending) |
| `@annotask/stress-upstream-adapters` | Live-or-snapshot fallback adapter pattern |

## Service endpoints

Every service exposes its OpenAPI document via the framework idiom its
language prefers, so annotask's schema scanner (which probes each mapped
docker-compose port) discovers them with zero configuration.

| Service | Port | OpenAPI path | Data domain | Routes |
|---------|------|--------------|-------------|--------|
| `fastapi`  | 4320 | `/openapi.json`  (FastAPI auto) | workflows | `GET /api/health`, `GET /api/workflows?status=`, `GET /api/workflows/{id}`, `POST /api/workflows/{id}/transitions?to=` |
| `java-api` | 4310 | `/v3/api-docs`   (springdoc)     | workflows + products | `GET /api/health`, `GET /api/workflows`, `GET /api/workflows/{id}`, `POST /api/workflows/{id}/transitions`, `GET /api/products`, `GET /api/products/{id}` |
| `node-api` | 4340 | `/openapi.json`  (`@fastify/swagger` from route schemas) | products | `GET /api/health`, `GET /api/products?category=&in_stock=`, `GET /api/products/{id}` |
| `go-api`   | 4330 | `/openapi.json`  (`//go:embed openapi.json`, hand-maintained) | metrics | `GET /api/health`, `GET /api/metrics?name=`, `GET /api/metrics/{name}` |
| `rust-api` | 4360 | `/openapi.json`  (`include_str!` of hand-maintained spec) | component-usage + htmx | `GET /api/health`, `GET /api/health-fragment` (HTML), `GET /api/component-usage` |

Go and Rust deliberately keep zero third-party dependencies (`go run .` and
`cargo run` stay subsecond), so their OpenAPI documents are hand-maintained
JSON embedded at build time. FastAPI, Spring Boot, and Fastify generate
their documents automatically from the route signatures.


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

Docker compose (services only — adds Java):

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
