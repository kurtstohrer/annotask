# Development Guide

How to work on Annotask itself.

## Prerequisites

- Node.js >= 18
- pnpm (any recent version; CI uses v10)

## Setup

```bash
git clone <repo-url>
cd annotask
pnpm install
pnpm build
```

## Day-to-day development

### Run the playground

```bash
pnpm dev:playground
```

Opens the playground Vue app at `http://localhost:5173/` with Annotask enabled. The playground is a PrimeVue app with planets/moons data tables — enough UI surface to test editing features.

Annotask shell: `http://localhost:5173/__annotask/`

### Build

```bash
pnpm build              # Full build (shell → plugin → CLI)
pnpm build:shell        # Shell UI only (Vite build → dist/shell/)
pnpm build:plugin       # Plugin + CLI only (tsup → dist/)
```

Build order matters: shell must be built before the plugin, because the plugin serves `dist/shell/` as static files.

### Test

```bash
pnpm test               # Run all unit tests (Vitest)
pnpm test:watch         # Watch mode
pnpm test:e2e           # E2E tests (Playwright, requires dev server)
```

Unit test environments:
- Plugin tests (`src/plugin/__tests__/`): Node
- Shell tests (`src/shell/composables/__tests__/`): jsdom

E2E tests require the playground dev server running on port 5173. Playwright starts it automatically via `webServer` config.

### Shell UI development

For iterating on the shell UI without rebuilding:

```bash
pnpm dev:shell          # Vite dev server for shell alone
```

This runs the shell in standalone dev mode. Note: without the plugin's iframe integration, some features (element inspection, source mapping) won't work — but you can develop UI components and layouts.

## Project structure

```
src/
├── plugin/
│   ├── index.ts            # Plugin entry (two Vite plugins)
│   ├── transform.ts        # SFC template attribute injection
│   ├── toggle-button.ts    # Injected floating button HTML
│   ├── bridge-client.ts    # postMessage bridge script injected into app
│   └── __tests__/          # Unit tests
├── server/
│   ├── index.ts            # Server factory (createAnnotaskServer)
│   ├── api.ts              # HTTP REST middleware
│   ├── ws-server.ts        # WebSocket broadcast server
│   ├── serve-shell.ts      # Static file serving for shell
│   ├── state.ts            # Project state (tasks, design spec, config)
│   ├── discovery.ts        # .annotask/server.json read/write
│   └── standalone.ts       # Standalone HTTP server (for Webpack)
├── webpack/
│   ├── index.ts            # Webpack plugin export
│   ├── plugin.ts           # AnnotaskWebpackPlugin class
│   └── loader.ts           # SFC transform loader
├── shared/
│   └── bridge-types.ts     # postMessage protocol type definitions
├── shell/
│   ├── main.ts             # Vue app entry
│   ├── App.vue             # Main component
│   ├── index.html          # SPA template
│   ├── components/         # UI components (14 files)
│   ├── composables/        # Vue composables (11 files)
│   ├── services/           # iframe bridge & WebSocket client
│   ├── data/               # Tailwind color palette data
│   └── types.ts            # UI-specific types
├── cli/
│   └── index.ts            # CLI entry (annotask command)
└── schema.ts               # Canonical TypeScript types

playground/                  # Vite test app (pnpm workspace package)
├── src/
│   ├── components/
│   ├── pages/
│   └── router.ts
├── api/                     # FastAPI backend (Python)
├── package.json
└── vite.config.ts

playground-webpack/          # Webpack test app (pnpm workspace package)
├── src/
│   ├── components/
│   ├── pages/
│   └── router.ts
├── package.json
└── webpack.config.mjs

e2e/                         # Playwright browser tests
plan/                        # Roadmap and improvement notes
skills/                      # AI agent skills (shipped in npm package)
.claude/skills/              # Claude Code skill definitions
.github/workflows/           # CI pipeline
```

## Key conventions

- **ESM only** — no CommonJS. `"type": "module"` in package.json.
- **Vue 3 Composition API** — shell uses `<script setup>` and composables.
- **Vitest** for unit tests, **Playwright** for E2E.
- **tsup** bundles the plugin and CLI. **Vite** builds the shell.
- **pnpm workspaces** — the playground is a workspace package that depends on `@annotask/vite-plugin` via `workspace:*`.

## Adding a new API endpoint

1. Add the route handler in `src/server/api.ts`
2. Add corresponding TypeScript types in `src/schema.ts` if the endpoint returns a new shape
3. Add a test in `src/plugin/__tests__/api.test.ts`
4. If the shell consumes it, add a composable or update an existing one in `src/shell/composables/`

## Adding a new change type

1. Define the type in `src/schema.ts` (extend the `AnnotaskChange` union)
2. Emit the change in the relevant shell composable (usually `useStyleEditor`)
3. Update the `/apply-annotask` skill in `.claude/skills/apply-annotask/SKILL.md` to handle it
4. Add a test covering the new type

## Feature freeze

No new features until the stabilization criteria in `plan/improvements.md` are met. Focus on correctness, safety, and test coverage first.
