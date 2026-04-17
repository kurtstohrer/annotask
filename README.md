<p align="center">
  <img src="annotask-logo.png" alt="Annotask" width="120" />
</p>

<h1 align="center">Annotask</h1>

Visual markup tool for web apps. Annotate your UI in the browser — pins, arrows, drawn sections, notes — and Annotask generates structured tasks that AI coding agents apply to your source code. Supports Vue, React, Svelte, SolidJS, and plain HTML with Vite and Webpack. Astro and htmx are experimental.

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

1. **You mark up the UI** — Use the Annotask shell to annotate elements: pin a component and describe what you want changed, draw a section where new content should go, highlight text that needs editing, or drop arrows showing where things should move.

2. **Tasks are created** — Each annotation becomes a structured task with full context: source file, line number, component name, element tag, surrounding layout, and your intent in plain language.

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

### Annotation tools (primary)
- **Pins** — Pin an element and describe what you want changed
- **Arrows** — Draw arrows between elements with color options, element outlines, and draggable endpoints
- **Drawn sections** — Draw a rectangle where new content should go, with a markdown editor for detailed descriptions. Movable and resizable.
- **Text highlights** — Select text to mark it for editing, with color options and visual highlight overlay

### Visual editing (experimental)
- **Element inspection** — Click any element to see its source file, line, component, and computed styles
- **Live style editing** — Modify layout, spacing, size, colors, and typography with immediate preview
- **Class editing** — Add, remove, or modify CSS classes on elements
- **Theme token editing** — Edit design tokens (colors, typography, spacing, borders) from a detected design spec

### Viewport & navigation
- **Device presets** — Switch between phone, tablet, and desktop viewports; custom dimensions supported
- **Viewport-tagged tasks** — Every task records viewport dimensions so the AI generates correct responsive CSS
- **Route navigation** — Editable route indicator in the toolbar; route persists across page reloads

### Accessibility checker
- **Page-level scanning** — Runs axe-core WCAG analysis on the entire page from the A11y panel
- **Violation cards** — Shows impact level, rule, description, and affected element count
- **One-click fix tasks** — Create tasks from violations with full context (HTML snippets, CSS selectors, source file/line, and fix suggestions)
- **Locally bundled** — axe-core and html2canvas are shipped with the package (no CDN dependency, works offline and under CSP)

### Error monitoring
- **Console capture** — Catches `console.error`, `console.warn`, and unhandled errors/rejections from the app iframe
- **Deduplication** — Groups identical errors by message and first stack frame with occurrence counts
- **Bounded capture** — Limits tracked error keys and truncates long messages/stacks to prevent memory bloat
- **One-click fix tasks** — Create tasks from errors with full context (message, stack, route, timestamp)
- **Pause/resume** — Toggle error capture without clearing the log

### Performance monitoring
- **Web Vitals** — Tracks CLS, LCP, FID, INP, and TTFB via the Performance API
- **Performance scan** — Analyzes DOM size, resource loading, long tasks, and bundle sizes
- **Interaction recording** — Record a session to capture a timeline of performance events grouped by user action
- **Performance score** — Aggregated score with good/needs-improvement/poor ratings
- **Bundle analysis** — Detects heavy packages and suggests lighter alternatives (e.g., moment → dayjs)
- **One-click fix tasks** — Create tasks from performance findings with severity and metrics

### Task detail drawer
- **Slide-out detail view** — Click any task to see full details, markdown description, screenshots, element context, and source files
- **Inline editing** — Click the description to edit markdown in-place; Ctrl+Enter to save
- **Accept/Deny workflow** — Review AI-applied changes directly from the drawer with optional feedback for retries
- **Screenshots** — Snip regions or full page, attached to tasks as multimodal AI context

### AI agent context
- **Interaction history** — Optionally attach user navigation path and click actions to tasks
- **Element context** — Optionally capture ancestor layout chain and DOM subtree snapshot
- **Breakpoint detection** — `annotask init` detects responsive breakpoints from Tailwind, Bootstrap, CSS variables, or media queries

### Infrastructure
- **Task pipeline** — `pending → in_progress → review → accepted/denied` lifecycle with `needs_info` and `blocked` statuses for agent feedback, live WebSocket updates
- **Security** — CORS restricted to localhost, field whitelisting on mutations, postMessage sender validation
- **CLI** — `annotask tasks`, `annotask report`, `annotask watch` for terminal access
- **API** — Full HTTP + WebSocket API for programmatic access

## CLI

```bash
annotask status                               # Check if server is running
annotask tasks                                # Compact task summaries (use --pretty for full objects)
annotask report                               # Fetch live change report (no tasks)
annotask watch                                # Live stream of changes via WebSocket
annotask update-task <id> --status=<status>   # Update task status
annotask screenshot <id>                      # Download a task's screenshot
annotask init-skills                          # Install agent skills into your project
annotask init-mcp                             # Write editor MCP config (--editor=claude|cursor|vscode|windsurf|all)
annotask mcp                                  # Start MCP stdio server (proxies to dev server)
```

Options: `--port=N`, `--host=H`, `--server=URL` (override server.json), `--mfe=NAME` (filter by MFE), `--output=PATH` (for screenshot command).

## API

### MCP (for AI agents)

- `POST /__annotask/mcp` — MCP endpoint ([Streamable HTTP transport](https://modelcontextprotocol.io/specification/2025-03-26/basic/transports#streamable-http)). Accepts JSON-RPC 2.0 requests, returns tool results. This is the recommended way for AI agents to interact with Annotask.

### HTTP (for scripts and custom integrations)

- `GET /__annotask/api/report` — Current change report (supports `?mfe=NAME` filter)
- `GET /__annotask/api/tasks` — Task list (supports `?mfe=NAME` filter)
- `GET /__annotask/api/tasks/:id` — Single task detail
- `POST /__annotask/api/tasks` — Create a task
- `PATCH /__annotask/api/tasks/:id` — Update task (whitelisted fields: status, description, feedback, screenshot, viewport, etc.)
- `DELETE /__annotask/api/tasks/:id` — Delete a task and clean up its screenshot
- `GET /__annotask/api/design-spec` — Design spec (tokens, framework, breakpoints)
- `GET /__annotask/api/components` — Component library catalog
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
- `src/shell/composables/` — Vue composables (style editor, tasks, screenshots, keyboard shortcuts, a11y scanner, error monitor, perf monitor, etc.)
- `src/shell/components/` — UI components (inspector tabs, overlays, task detail drawer, design panel, error/perf tabs, report viewer, etc.)
- `src/shared/` — Shared types (postMessage bridge protocol)
- `src/mcp/` — MCP server (Streamable HTTP transport, embedded in the Vite/Webpack server)
- `src/schema.ts` — TypeScript types for change reports, tasks, design spec, viewport, performance snapshots
- `src/cli/` — CLI tool for terminal interaction
- `skills/` — Agent skill definitions (shipped with the npm package)
- `playgrounds/` — Test apps (vue-vite, vue-webpack, react-vite, svelte-vite, solid-vite, html-vite, astro, htmx-vite, mfe-vite)

## Troubleshooting

See [SETUP.md](SETUP.md#troubleshooting) for common issues and solutions.
