# Annotask

Visual UI design tool for web apps (Vue, React, Svelte, Astro, plain HTML/htmx). Developers make visual changes in the browser and Annotask generates structured reports that AI agents can apply to source code. Works with Vite and Webpack.

## MCP Server

Annotask includes an MCP server that starts automatically with the dev server at `POST /__annotask/mcp`. If your editor is configured with the Annotask MCP server, you have these tools:

| Tool | Description |
|------|-------------|
| `annotask_get_tasks` | List tasks — filter by `status` (`pending`, `denied` for actionable work) or `mfe` |
| `annotask_update_task` | Transition status, set resolution, ask questions, mark blocked |
| `annotask_create_task` | Create a new pending task |
| `annotask_delete_task` | Delete a task and its screenshot |
| `annotask_get_report` | Live change report from the browser session |
| `annotask_get_design_spec` | Design tokens — colors, typography, spacing, borders, breakpoints |
| `annotask_get_components` | Component library catalog with props |
| `annotask_get_screenshot` | Task screenshot as base64 PNG |

### Applying tasks via MCP

1. Call `annotask_get_tasks` with `status: "pending"` — these are ready to apply
2. For each task, call `annotask_update_task` with `status: "in_progress"` to lock it
3. Read the task's `file`, `line`, `description`, `context`, and `screenshot` for full context
4. Apply the change to the source file
5. Call `annotask_update_task` with `status: "review"` and a short `resolution` note
6. Also process `status: "denied"` tasks — read `feedback` for what the user didn't like, then re-apply
7. If stuck, use `questions` parameter to ask the user (auto-sets `needs_info`)
8. If impossible, use `blocked_reason` to explain why (auto-sets `blocked`)

## Development

```bash
pnpm install
pnpm build                   # Build shell + plugin + CLI
pnpm dev:vue-vite             # Start Vue test app with Annotask
```

Then open:
- App: http://localhost:5173/
- Annotask: http://localhost:5173/__annotask/
- API: http://localhost:5173/__annotask/api/report
- MCP: http://localhost:5173/__annotask/mcp

## Annotask CLI

```bash
annotask status              # Check if server is running
annotask tasks               # Fetch pending tasks
annotask report              # Fetch full report + tasks
annotask watch               # Live stream changes via WebSocket
annotask update-task <id> --status=<status>   # Update task status
annotask screenshot <id>     # Download a task's screenshot
annotask init-skills         # Install agent skills into project
annotask mcp                 # Start MCP stdio server (proxies to dev server)
```

## Annotask API

- `POST /__annotask/mcp` — MCP endpoint (Streamable HTTP transport, JSON-RPC 2.0)
- `GET /__annotask/api/tasks` — Task list (supports `?mfe=NAME` filter)
- `POST /__annotask/api/tasks` — Create a task
- `PATCH /__annotask/api/tasks/:id` — Update task status
- `GET /__annotask/api/report` — Current change report
- `GET /__annotask/api/design-spec` — Design spec (tokens, framework, breakpoints)
- `POST /__annotask/api/screenshots` — Upload a screenshot
- `GET /__annotask/screenshots/:filename` — Serve a screenshot
- `GET /__annotask/api/status` — Health check
- `ws://localhost:5173/__annotask/ws` — Live WebSocket stream

## Structure

- `src/plugin/` — Vite plugin (multi-framework transform, toggle button, bridge client)
- `src/server/` — HTTP API, WebSocket server, shell serving, project state
- `src/webpack/` — Webpack plugin and transform loader
- `src/shell/` — Design tool UI (Vue 3 app, pre-built into dist/shell/)
- `src/shell/composables/` — Vue composables (viewport preview, interaction history, style editor, annotations, etc.)
- `src/shell/components/` — UI components (inspector tabs, overlays, viewport selector, a11y panel, etc.)
- `src/shared/` — Shared types (postMessage bridge protocol)
- `src/schema.ts` — TypeScript types for change reports, tasks, design spec, viewport, interaction history, element context
- `src/cli/` — CLI tool for terminal interaction
- `playgrounds/` — Test apps (vue-vite, vue-webpack, react-vite, svelte-vite, html-vite, astro, htmx-vite, mfe-vite)

## Shell Architecture

`App.vue` is the shell orchestrator — it wires composables together and handles bridge events. **Do not add business logic directly to App.vue.** Extract new concerns into composables under `src/shell/composables/`.

Key composables:
- `useSelectionModel` — Element selection, rect tracking, live styles, style/class changes
- `useTaskWorkflows` — Task creation flows, pending task panel, accept/deny, annotation restoration
- `useAnnotationRects` — rAF loop for annotation overlay positioning
- `useAnnotations` — Annotation state (pins, arrows, sections, highlights)
- `useStyleEditor` — Style/class change recording, undo, report generation
- `useIframeManager` — Bridge communication with the app iframe

## Key Shell Features

- **Viewport preview** — Device presets + custom dimensions, viewport info included in tasks/reports
- **Interaction history** — Tracks user navigation and clicks in the app (optional, off by default)
- **Element context** — Ancestor layout chain + DOM subtree snapshot on tasks (optional, off by default)
- **A11y checker** — axe-core WCAG scanning with one-click fix task creation
- **Screenshots** — Snipping tool captures regions or full page, attached to tasks, served via API, auto-cleaned on accept
- **Inspector highlights** — Selection/hover overlays that track scroll and resize via rAF loop

## Task Types

| Type | Source | Description |
|------|--------|-------------|
| `annotation` | Pins, arrows, notes, text highlights | User intent described in `description`, optional `action` and `context` |
| `style_update` | Inspector style/class edits | CSS changes in `context.changes` array with `property`, `before`, `after` |
| `theme_update` | Theme page token edits | Design token changes with `category`, `role`, `before`, `after`, `cssVar` |
| `section_request` | Drawn sections | New content area with `description` and `placement` |
| `a11y_fix` | A11y panel violations | WCAG fix with `rule`, `impact`, `help`, `elements` in `context` |

## Task Lifecycle

```
pending → applied (by agent) → review (user checks) → accepted (removed) or denied (with feedback)
```
