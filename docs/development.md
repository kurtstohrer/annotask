# Development Guide

How to work on Annotask itself.

## Prerequisites

- Node.js 18+
- pnpm

Some stress-test services also need language runtimes such as Python, Go, Rust, or Java if you run them outside Docker.

## Setup

```bash
git clone <repo-url>
cd annotask
pnpm install
pnpm build
```

## Core Scripts

### Build

```bash
pnpm build
pnpm build:shell
pnpm build:plugin
pnpm build:vendor
```

Build order matters:

1. `build:shell` writes `dist/shell/`
2. `build:plugin` bundles the plugin, server, webpack integration, standalone server, loader, and CLI
3. `build:vendor` copies pinned browser-side vendor assets into `dist/vendor/`

### Test

```bash
pnpm test
pnpm test:watch
pnpm typecheck
pnpm test:e2e
pnpm test:e2e:stress
```

Current test buckets:

- unit tests with Vitest
- shell composable tests in jsdom
- plugin and server tests in Node
- Playwright end-to-end coverage for the main playgrounds
- Playwright stress-lab coverage for the multi-MFE environment

### Shell UI Work

```bash
pnpm dev:shell
```

This runs the shell on its own without a fully instrumented app iframe. Good for shell-only UI work, not enough to validate source mapping or bridge interactions.

## Playground Scripts

Simple playgrounds:

```bash
pnpm dev:vue-vite
pnpm dev:vue-primevue
pnpm dev:vue-webpack
pnpm dev:react-vite
pnpm dev:react-radix
pnpm dev:svelte-vite
pnpm dev:solid-vite
pnpm dev:html-vite
pnpm dev:astro
pnpm dev:htmx-vite
pnpm dev:mfe-vite
```

Stress-lab scripts:

```bash
pnpm dev:stress-host
pnpm dev:stress-vue-data-lab
pnpm dev:stress-react-workflows
pnpm dev:stress-svelte-streaming
pnpm dev:stress-solid-component-lab
pnpm dev:stress-htmx-partials
pnpm dev:stress-react-sidebar
pnpm dev:stress-fastapi
pnpm dev:stress-node-api
pnpm dev:stress-go-api
pnpm dev:stress-rust-api
pnpm stress-test:up
pnpm stress-test:down
```

`playgrounds/simple/` also has a `justfile` for convenience recipes like `just react`, `just svelte`, `just vue`, and `just mfe`.

## Current Project Shape

### Source Tree

```text
src/
  plugin/      Vite integration and transforms
  server/      HTTP API, persistence, scanners, workspace discovery
  mcp/         embedded MCP server
  webpack/     Webpack plugin and loader
  shell/       Vue shell UI served at /__annotask/
  cli/         annotask CLI
  shared/      shared task-summary and bridge helpers
  schema.ts    canonical contracts
```

### Workspaces

The pnpm workspace currently includes:

- `playgrounds/simple/*`
- `playgrounds/stress-test/apps/*`
- `playgrounds/stress-test/packages/*`
- `playgrounds/stress-test/services/node-api`

Annotask's server-side scanners are workspace-aware, so contributor changes in component scanning, data scanning, or API schema discovery should be tested against both single-package playgrounds and the stress lab when relevant.

## Shell Architecture Notes

- `App.vue` is still the orchestration hub and is larger than the desired long-term target
- `ThemePage.vue` is also still oversized and under ongoing extraction pressure
- new shell behavior should generally land in a composable under `src/shell/composables/`
- the user-facing tabs are **Annotate**, **Design**, and **Audit**, while the internal Audit view id remains `develop`

Useful shell files:

- `src/shell/App.vue`
- `src/shell/components/AppToolbar.vue`
- `src/shell/components/HelpOverlay.vue`
- `src/shell/composables/useShellNavigation.ts`
- `src/shell/composables/useTaskWorkflows.ts`
- `src/shell/composables/useProjectComponents.ts`
- `src/shell/composables/useDataSources.ts`
- `src/shell/composables/useWorkspace.ts`

## Conventions

- ESM only
- TypeScript throughout
- Vue 3 Composition API in the shell
- zod-validated server and MCP boundaries
- `src/schema.ts` and `src/shared/*` are the shared contracts and should stay strict
- use `apply_patch` for source edits in agent workflows

## Working On APIs Or Task Contracts

When adding or changing a task or API surface:

1. update `src/schema.ts` if the wire shape changes
2. update shared validation in `src/server/validation.ts` or `src/server/schemas.ts`
3. update the HTTP route in `src/server/api.ts` and MCP tooling in `src/mcp/server.ts` if needed
4. add or update tests in `src/plugin/__tests__/` or `src/server/__tests__/`
5. update docs in `README.md`, `docs/api.md`, `docs/cli.md`, or `docs/skills.md`

## Release Workflow

See [`../CONTRIBUTING.md`](../CONTRIBUTING.md) and [`distribution.md`](distribution.md) for publishing details. The short version is:

```bash
pnpm typecheck
pnpm test
pnpm build
npm pack --dry-run
```

Then update `package.json` and `CHANGELOG.md` together before publishing.
