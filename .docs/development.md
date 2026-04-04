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

### Run a playground

```bash
pnpm dev:vue-vite           # Vue + Vite (port 5173)
pnpm dev:vue-webpack        # Vue + Webpack (port 8090)
pnpm dev:react-vite         # React + Vite (port 5174)
pnpm dev:svelte-vite        # Svelte + Vite (port 5175)
pnpm dev:html-vite          # Plain HTML + Vite (port 5176)
pnpm dev:astro              # Astro (port 5177)
pnpm dev:htmx-vite          # htmx + Vite (port 5178)
pnpm dev:mfe-vite           # MFE + Vite (port 5180)
```

Opens the playground app with Annotask enabled.

Annotask shell: `http://localhost:5173/__annotask/`

### Build

```bash
pnpm build              # Full build (shell → plugin → vendor)
pnpm build:shell        # Shell UI only (Vite build → dist/shell/)
pnpm build:plugin       # Plugin + CLI only (tsup → dist/)
pnpm build:vendor       # Copy axe-core + html2canvas to dist/vendor/
```

Build order matters: shell must be built before the plugin, because the plugin serves `dist/shell/` as static files. Vendor deps are copied last.

### Test

```bash
pnpm test               # Run all unit tests (Vitest)
pnpm test:watch         # Watch mode
pnpm typecheck          # Type-check (tsc + vue-tsc)
pnpm test:e2e           # E2E tests (Playwright, all frameworks)
```

Unit test environments:
- Plugin tests (`src/plugin/__tests__/`): Node
- Shell tests (`src/shell/composables/__tests__/`): jsdom

E2E tests cover vue-vite, react-vite, svelte-vite, html-vite, astro, htmx-vite, vue-webpack, and mfe-vite. Playwright starts dev servers automatically via `webServer` config.

CI runs typecheck + unit tests on every push, and Playwright e2e (vue-vite + react-vite matrix) as a separate job.

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
│   ├── App.vue             # Main component (orchestrator — wires composables, no business logic)
│   ├── index.html          # SPA template
│   ├── components/         # UI components (TaskDetailModal, DesignPanel, ElementStyleEditor, ErrorsTab, PerfTab, overlays, controls)
│   ├── composables/        # Vue composables (style editor, tasks, screenshots, a11y, keyboard, error monitor, perf monitor, etc.)
│   ├── utils/              # Helpers (stripMarkdown)
│   ├── services/           # iframe bridge & WebSocket client
│   ├── data/               # Tailwind color palette data
│   └── types.ts            # UI-specific types
├── mcp/
│   └── server.ts           # MCP server (Streamable HTTP, tools for tasks/design spec/screenshots)
├── cli/
│   └── index.ts            # CLI entry (annotask command)
└── schema.ts               # Canonical TypeScript types

playgrounds/
├── vue-vite/                # Vue + Vite test app (port 5173)
├── vue-webpack/             # Vue + Webpack test app (port 8090)
├── react-vite/              # React + Vite test app (port 5174)
├── svelte-vite/             # Svelte + Vite test app (port 5175)
├── html-vite/               # Plain HTML + Vite (port 5176)
├── astro/                   # Astro (port 5177)
├── htmx-vite/               # htmx + Vite (port 5178)
└── mfe-vite/                # MFE + Vite (port 5180)

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
- **pnpm workspaces** — the playground is a workspace package that depends on `annotask` via `workspace:*`.

## Adding a new API endpoint

1. Add the route handler in `src/server/api.ts`
2. Add corresponding TypeScript types in `src/schema.ts` if the endpoint returns a new shape
3. Add a test in `src/plugin/__tests__/api.test.ts`
4. If the shell consumes it, add a composable or update an existing one in `src/shell/composables/`

## Adding a new change type

1. Define the type in `src/schema.ts` (extend the `AnnotaskChange` union)
2. Emit the change in the relevant shell composable (usually `useStyleEditor`)
3. Update the `/annotask-apply` skill in `.claude/skills/annotask-apply/SKILL.md` to handle it
4. Add a test covering the new type
