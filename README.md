<p align="center">
  <img src="annotask-logo.png" alt="Annotask" width="120" />
</p>

<h1 align="center">Annotask</h1>

Visual UI design and review tool for web apps. Annotate the UI in the browser, inspect and edit styles live, audit runtime issues, and let AI agents apply the resulting structured tasks back to source code.

Supports Vue, React, Svelte, SolidJS, Astro, plain HTML, and htmx on Vite. Webpack support is available through `AnnotaskWebpackPlugin` for the non-Astro integration path.

## Workflow

```text
You in the browser                    Your coding agent
------------------                    -----------------
Open /__annotask/
Annotate, inspect, edit,
or create audit fixes           -->   Reads tasks over MCP / CLI / HTTP
                                      Locks task: in_progress
                                      Pulls extra context only when needed
                                      Applies code changes
                                      Marks task review-ready

Review in the task drawer        <--> Answers questions / retries denied work
Accept or deny changes
```

## What It Does

Annotask has three user-facing surfaces.

- **Annotate**: pins, arrows, drawn sections, text highlights, screenshots, route-aware tasks, viewport capture.
- **Design**: tokens, live inspector, layout overlay, detected component catalogs, in-repo component examples.
- **Audit**: accessibility, data sources, API schemas, detected data/state libraries, performance findings, console errors.

Tasks can carry grounded context when available:

- source file and line
- component references and examples
- viewport and route
- screenshots
- color-scheme detection
- interaction history
- element context
- data context and API schema links

## Quick Start

Install:

```bash
npm install -D annotask
```

Vite:

```ts
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { annotask } from 'annotask'

export default defineConfig({
  plugins: [vue(), annotask()],
})
```

Webpack:

```ts
import { AnnotaskWebpackPlugin } from 'annotask/webpack'

export default {
  plugins: [new AnnotaskWebpackPlugin()],
}
```

Start your dev server, then open `http://localhost:5173/__annotask/`.

Connect an agent over MCP:

```bash
npx annotask init-mcp --editor=claude
```

Or install the bundled skills:

```bash
npx annotask init-skills
```

## Agent Surfaces

- **MCP**: `POST /__annotask/mcp` with 18 tools for tasks, design spec, components, screenshots, code context, data context, data sources, and API schemas.
- **CLI**: `annotask status`, `tasks`, `task`, `design-spec`, `components`, `component-examples`, `data-context`, `data-sources`, `api-schemas`, `resolve-endpoint`, `init-mcp`, `init-skills`, `mcp`, and more.
- **HTTP + WebSocket**: local API under `/__annotask/api/*` and live updates on `/__annotask/ws`.

## Task Model

Canonical task types live in `src/schema.ts`:

- `annotation`
- `section_request`
- `style_update`
- `theme_update`
- `a11y_fix`
- `error_fix`
- `perf_fix`
- `api_update`

Statuses:

- `pending`
- `in_progress`
- `applied`
- `review`
- `accepted`
- `denied`
- `needs_info`
- `blocked`

Typical path:

```text
pending -> in_progress -> review -> accepted | denied
                     \-> needs_info
                     \-> blocked
```

`applied` exists as an optional intermediate automation state and is accepted by the API, CLI, and MCP layers.

## Current Highlights

- Route-aware task filtering and editable route bar
- Screenshot uploads and automatic cleanup on acceptance
- Variant-aware design spec with `themes[]`, `defaultTheme`, and per-theme token values
- Workspace-aware scanning across monorepos and MFEs
- MFE filters in the shell's Components and Audit data views
- Component examples from real in-repo usage
- Data-source discovery, binding analysis, and endpoint-to-schema resolution
- Local `axe-core` accessibility scanning
- Performance snapshots, findings, and session recording
- Console error and warning capture with one-click fix tasks
- 18 built-in shell themes plus custom theme editing across 63 CSS variables

## Framework Support

| Framework | Vite | Webpack |
|-----------|------|---------|
| Vue 3 | Yes | Yes |
| React | Yes | Yes |
| Svelte | Yes | Yes |
| SolidJS | Yes | Yes |
| Plain HTML | Yes | No |
| Astro | Yes | No |
| htmx | Yes | No |

Annotask is dev-only. It does not run in production builds.

## Monorepos And MFEs

Annotask is workspace-aware. When the project lives inside a pnpm, npm, Yarn, Bun, or Lerna workspace, server-side scanners can walk sibling packages for:

- component libraries used by adjacent MFEs
- project data sources and bindings
- API schemas
- workspace package metadata and MFE ids

For MFE setups, child apps can point at a root Annotask server with `annotask({ mfe, server })` or `new AnnotaskWebpackPlugin({ mfe, server })`.

## Docs

- [SETUP.md](SETUP.md)
- [docs/setup.md](docs/setup.md)
- [docs/cli.md](docs/cli.md)
- [docs/api.md](docs/api.md)
- [docs/skills.md](docs/skills.md)
- [docs/component-discovery.md](docs/component-discovery.md)
- [docs/architecture.md](docs/architecture.md)
- [docs/development.md](docs/development.md)

## Development

```bash
pnpm install
pnpm build
pnpm dev:vue-vite
pnpm typecheck
pnpm test
pnpm test:e2e
```

Useful extras:

- `pnpm dev:shell` for standalone shell UI work
- `pnpm test:e2e:stress` for the stress-test environment
- `pnpm stress-test:up` / `pnpm stress-test:down` for Docker-based stress services

## Project Structure

- `src/plugin/` - Vite integration and transform pipeline
- `src/server/` - HTTP API, WebSocket server, persistence, scanners
- `src/mcp/` - embedded MCP server
- `src/webpack/` - Webpack plugin and loader
- `src/shell/` - Vue shell UI served at `/__annotask/`
- `src/cli/` - `annotask` CLI
- `src/schema.ts` - canonical task, report, design-spec, and context types
- `skills/` - bundled `/annotask-init` and `/annotask-apply` skills
- `playgrounds/simple/` - single-framework demos
- `playgrounds/stress-test/` - multi-MFE, multi-service stress lab
