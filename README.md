<p align="center">
  <img src="annotask-logo.png" alt="Annotask" width="120" />
</p>

<h1 align="center">Annotask</h1>

Visual UI design and review tool for web apps. Annotate your UI in the browser, inspect and edit styles live, audit accessibility and runtime health, and let AI agents apply the resulting structured tasks to your source code. Supports Vue, React, Svelte, SolidJS, and plain HTML with Vite and Webpack. Astro and htmx are experimental.

## Workflow

```
 You (in browser)                    Your coding agent
 ─────────────────                   ──────────────────
 Open Annotask shell
 Annotate the UI:
   pin elements, draw
   sections, add notes,         ──>  /annotask-apply
   describe what you want            Fetches pending tasks
                                     Locks each task (in_progress)
                                     Asks for clarification if stuck
                                     Applies code change
                                     Marks for review with resolution
 Answer agent questions           <──>
 Review changes live              <──
 as they come in:
   Accept ✓  or  Deny ✗
   (denied tasks include your
    feedback for the agent
    to retry with corrections)
```

### How it works

1. **You mark up or inspect the UI** — Use the Annotask shell to annotate elements, edit styles and classes live, inspect design tokens, browse project components, or create fix tasks from accessibility, performance, error, and data findings.

2. **Tasks are created** — Each annotation, design edit, or audit finding becomes a structured task with source mapping plus rich context: file, line, component info, viewport, route, screenshots, element context, data context, interaction history, color scheme, and more when available.

3. **Your coding agent applies the tasks** — Invoke `/annotask-apply` in Claude Code (or the equivalent skill in your agent). It processes tasks one at a time: locks the task (`in_progress`), applies the code change, then marks it for review — so you can start reviewing immediately while later tasks are still being applied.

4. **You review** — In the Annotask shell, click any task to open the detail drawer — see the full markdown description, screenshots, element context, interaction history, and source files. Accept or deny each change. Denied tasks include your feedback so the agent can retry with corrections.

## Setup

See **[SETUP.md](SETUP.md)** for the full setup guide — install, plugin config, MCP / skills setup, MFE configuration, and troubleshooting.

Quick version:

```bash
npm install -D annotask
```

```ts
// vite.config.ts
import { annotask } from 'annotask'

export default defineConfig({
  plugins: [vue(), annotask()],
})
```

```json
// .mcp.json — connect your AI agent via MCP
{
  "mcpServers": {
    "annotask": {
      "type": "url",
      "url": "http://localhost:5173/__annotask/mcp"
    }
  }
}
```

Start your dev server, then open `http://localhost:5173/__annotask/`.

## Features

### Editor
- **Annotation tools** — Pins, arrows, drawn sections, and text highlights become structured `annotation` or `section_request` tasks.
- **Screenshots** — Capture a region or full page and attach it to a task as multimodal context.
- **Viewport preview** — Phone, tablet, desktop, and custom dimensions; task payloads record viewport size.
- **Route-aware workflow** — Editable route bar, route persistence across reloads, and tasks filtered to the current route by default.
- **Per-task context toggles** — Attach DOM context, data context, and interaction history only when they add signal.

### Design
- **Inspector** — Source-mapped element inspection with computed styles, live style editing, class editing, and undo.
- **Layout overlay** — Visualize flex and grid containers, alignment, and gaps while inspecting the page.
- **Tokens page** — Edit detected design tokens for colors, typography, spacing, borders, and shadows through `theme_update` tasks.
- **Components page** — Browse detected component libraries, inspect props, slots, and events, see in-repo usage examples, and highlight matching components on the current route.

### Develop
- **Accessibility audits** — Local `axe-core` WCAG scans, element-level detail, tab-order visualization, and one-click `a11y_fix` tasks.
- **Data view** — Discover hooks, composables, stores, fetch wrappers, GraphQL, loaders, and tRPC usage; highlight where data sources are consumed; match endpoints against discovered API schemas.
- **Libraries view** — Surface the data and state libraries actually used in the project so agents can follow existing patterns.
- **Performance monitoring** — Web Vitals, navigation and resource timing, bundle analysis, issue findings, session recording, optional auto-scan on route changes, and `perf_fix` tasks.
- **Error monitoring** — Deduplicated console error and warning capture with occurrence counts, stacks, and `error_fix` tasks.

### Review
- **Task drawer** — Markdown description, screenshot lightbox, source/file info, interaction history, agent feedback thread, JSON view, and delete action.
- **Task lifecycle** — `pending → in_progress → review → accepted/denied`, plus `needs_info` for agent questions and `blocked` for unapplied work.
- **Retry loop** — Denied tasks keep reviewer feedback so the agent can retry with corrections.

### Agent Grounding
- **Component context** — Selected-component metadata plus real in-repo examples.
- **Data context** — Primary data source, rendered identifiers, route bindings, and matched response schemas.
- **Element context** — Ancestor layout chain and DOM subtree snapshot.
- **Interaction history** — Navigation path and recent user actions leading up to the task.
- **Code context** — Source excerpts, enclosing symbol, import block, and drift hash via MCP, CLI, and API helpers.
- **Color-scheme detection** — Tasks record the effective light or dark mode when relevant.

### Shell UX
- **Built-in themes** — 18 built-in shell themes including high-contrast and deuteranopia-safe options.
- **Custom themes** — Create and persist custom shell themes across all 63 CSS variables with live preview.
- **Help overlay** — Built-in product documentation covering workflow, task types, agent integration, and settings.

### Platform
- **Task pipeline** — Live WebSocket updates, atomic task writes, screenshot cleanup on acceptance, and task locking for agents.
- **Cross-origin bridge** — postMessage-based iframe bridge supports cross-origin dev setups and MFE architectures.
- **Security** — Localhost-only mutation surface, validated task transitions, safe screenshot handling, and sender validation.
- **Framework coverage** — Vite and Webpack support for Vue, React, Svelte, Solid, HTML, with experimental Astro and htmx support.

## CLI

```bash
annotask status                               # Check if server is running
annotask tasks                                # Compact task summaries (use --detail for full objects)
annotask task <id>                            # Single task detail
annotask design-spec                          # Design spec summary or a single category
annotask report                               # Fetch live change report (no tasks)
annotask watch                                # Live stream of changes via WebSocket
annotask update-task <id> --status=<status>   # Update task status
annotask screenshot <id>                      # Download a task's screenshot
annotask components [search]                  # Search detected component libraries
annotask component <Name>                     # Full component detail
annotask code-context <task-id>               # Ground a task to current source context
annotask component-examples Button            # In-repo component usage examples
annotask data-context <task-id>               # Resolved task data context
annotask data-sources                         # Project data-source catalog
annotask data-source-examples useUserQuery    # In-repo data-source usage examples
annotask data-source-details useUserQuery     # Definition-level data-source detail
annotask api-schemas                          # Discovered OpenAPI / GraphQL / tRPC schemas
annotask api-operation /users --method=GET    # One resolved API operation
annotask resolve-endpoint /api/users/42       # Match a concrete URL to a known schema
annotask init-skills                          # Install agent skills into your project
annotask init-mcp                             # Write editor MCP config (--editor=claude|cursor|vscode|windsurf|all)
annotask mcp                                  # Start MCP stdio server (proxies to dev server)
```

Common flags: `--mcp`, `--detail`, `--status=STATUS`, `--category=NAME`, `--library=NAME`, `--limit=N`, `--offset=N`, `--context-lines=N`, `--kind=K`, `--method=M`, `--schema-location=L`, `--search=Q`, `--used-only`, `--refresh`, `--mfe=NAME`, `--server=URL`, `--port=N`, `--host=H`, `--output=PATH`.

## API

### MCP (for AI agents)

- `POST /__annotask/mcp` — MCP endpoint ([Streamable HTTP transport](https://modelcontextprotocol.io/specification/2025-03-26/basic/transports#streamable-http)). Accepts JSON-RPC 2.0 requests, returns tool results. This is the recommended way for AI agents to interact with Annotask.

Core tools:

- `annotask_get_tasks`, `annotask_get_task`, `annotask_update_task`, `annotask_create_task`, `annotask_delete_task`
- `annotask_get_design_spec`
- `annotask_get_components`, `annotask_get_component`, `annotask_get_component_examples`
- `annotask_get_screenshot`, `annotask_get_code_context`
- `annotask_get_data_context`, `annotask_get_data_sources`, `annotask_get_data_source_examples`, `annotask_get_data_source_details`
- `annotask_get_api_schemas`, `annotask_get_api_operation`, `annotask_resolve_endpoint`

### HTTP (for scripts and custom integrations)

- `GET /__annotask/api/report` — Current change report (supports `?mfe=NAME` filter)
- `GET /__annotask/api/tasks` — Task list (supports `?mfe=NAME` filter)
- `GET /__annotask/api/tasks/:id` — Single task detail
- `POST /__annotask/api/tasks` — Create a task
- `PATCH /__annotask/api/tasks/:id` — Update task (whitelisted fields: status, description, feedback, screenshot, viewport, etc.)
- `DELETE /__annotask/api/tasks/:id` — Delete a task and clean up its screenshot
- `GET /__annotask/api/design-spec` — Design spec (tokens, framework, breakpoints)
- `GET /__annotask/api/components` — Component library catalog
- `GET /__annotask/api/component-usage` — Project usage index for detected components
- `GET /__annotask/api/code-context/:taskId` — Ground a task to current source context
- `GET /__annotask/api/source-excerpt?file=...&line=...` — Direct source excerpt for a file/line
- `GET /__annotask/api/component-examples/:name` — In-repo component usage examples
- `GET /__annotask/api/data-context/:taskId` — Stored or resolved task data context
- `GET /__annotask/api/data-context/probe|resolve|element` — File and line data-context helpers used by the shell
- `GET /__annotask/api/data-sources` — Project data-source catalog
- `GET /__annotask/api/data-source-examples/:name` — In-repo data-source usage examples
- `GET /__annotask/api/data-source-details/:name` — Definition-level data-source detail
- `GET /__annotask/api/data-source-bindings/:name` — Binding graph for page highlights
- `GET /__annotask/api/api-schemas` — Discovered OpenAPI, GraphQL, tRPC, and JSON Schema catalog
- `GET /__annotask/api/api-operation` — One API operation by path (+ optional method)
- `GET /__annotask/api/resolve-endpoint` — Resolve a concrete URL against known schemas
- `GET|POST /__annotask/api/performance` — Performance snapshots
- `POST /__annotask/api/screenshots` — Upload a screenshot (base64 PNG, max 4MB)
- `GET /__annotask/screenshots/:filename` — Serve a screenshot
- `GET /__annotask/api/status` — Health check
- `ws://localhost:5173/__annotask/ws` — Live WebSocket stream

CORS is restricted to localhost origins. Mutating requests (POST, PATCH, DELETE) from non-local origins are rejected.

## Supported Frameworks

| Framework      | Vite         | Webpack |
|----------------|--------------|---------|
| Vue 3          | Yes          | Yes     |
| React          | Yes          | Yes     |
| Svelte         | Yes          | Yes     |
| SolidJS        | Yes          | Yes     |
| Plain HTML     | Yes          | —       |
| Astro          | Experimental | —       |
| htmx           | Experimental | —       |

## Limitations

- **Dev mode only** — Annotask only runs in dev servers (Vite or Webpack), never in production builds
- **Local only** — API and WebSocket endpoints are localhost-restricted (CORS enforced, same model as Vite HMR)
- **Source mapping** — Works best with component files (`.vue`, `.tsx`, `.jsx`, `.svelte`, `.astro`, `.html`); dynamic components and render functions may not map correctly

## Development

```bash
pnpm install
pnpm build                   # Build shell + plugin + CLI + vendor deps
pnpm dev:vue-vite             # Start Vue test app with Annotask
pnpm test                     # Run unit tests
pnpm typecheck                # Type-check (tsc + vue-tsc)
pnpm test:e2e                 # Run E2E tests (all frameworks)
```

## Project Structure

- `src/plugin/` — Vite plugin (multi-framework transform, toggle button, bridge client)
- `src/server/` — HTTP API, WebSocket server, shell serving, project state
- `src/webpack/` — Webpack plugin and transform loader
- `src/shell/` — Design tool UI (Vue 3 app, pre-built into dist/shell/)
- `src/shell/themes/` — Shell theme system (built-in themes, defaults, and types)
- `src/shell/composables/` — Vue composables (selection model, tasks, screenshots, keyboard shortcuts, a11y, data, components, errors, perf, themes, overlays, navigation, etc.)
- `src/shell/components/` — UI components (toolbar, inspector, overlays, task drawer, design panel, components and data pages, audit tabs, report viewer, help and settings, etc.)
- `src/shell/services/` — Shell-side API and bridge helpers
- `src/shared/` — Shared types (postMessage bridge protocol)
- `src/mcp/` — MCP server (Streamable HTTP transport, embedded in the Vite/Webpack server)
- `src/schema.ts` — TypeScript types for change reports, tasks, design spec, viewport, performance snapshots
- `src/cli/` — CLI tool for terminal interaction
- `skills/` — Agent skill definitions (shipped with the npm package)
- `playgrounds/simple/` — Single-framework test apps (vue-vite, vue-webpack, react-vite, svelte-vite, solid-vite, html-vite, astro, htmx-vite, mfe-vite)

## Troubleshooting

See [SETUP.md](SETUP.md#troubleshooting) for common issues and solutions.
