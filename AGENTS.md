# Annotask

Visual UI design tool for web apps (Vue, React, Svelte, SolidJS, Astro, plain HTML/htmx). Developers make visual changes in the browser and Annotask generates structured reports that AI agents can apply to source code. Works with Vite and Webpack.

## MCP Server

Annotask includes an MCP server that starts automatically with the dev server at `POST /__annotask/mcp`. If your editor is configured with the Annotask MCP server, you have these tools:

| Tool | Description |
|------|-------------|
| `annotask_get_tasks` | List task summaries — filter by `status`, `mfe`. Use `detail=true` for full objects |
| `annotask_get_task` | Get full detail for a single task by ID (context, element_context, agent_feedback) |
| `annotask_update_task` | Transition status, set resolution, ask questions, mark blocked |
| `annotask_create_task` | Create a new pending task |
| `annotask_delete_task` | Delete a task and its screenshot |
| `annotask_get_design_spec` | Design spec summary, or full tokens for a `category` (colors, typography, etc.) |
| `annotask_get_components` | Search component libraries by name. Returns up to 20 results per library |
| `annotask_get_screenshot` | Task screenshot as base64 PNG |

### Applying tasks via MCP

1. Call `annotask_get_tasks` with `status: "pending"` — returns compact summaries
2. For each task, call `annotask_update_task` with `status: "in_progress"` to lock it
3. If the summary has enough context, apply directly. Otherwise call `annotask_get_task` for full detail
4. Apply the change to the source file
5. Call `annotask_update_task` with `status: "review"` and a short `resolution` note
6. Also process `status: "denied"` tasks — read `feedback` for what the user didn't like, then re-apply
7. If stuck, use `questions` parameter to ask the user (auto-sets `needs_info`)
8. If impossible, use `blocked_reason` to explain why (auto-sets `blocked`)

## Development

```bash
pnpm install
pnpm build                   # Build shell + plugin + CLI + vendor deps
pnpm dev:vue-vite             # Start Vue test app with Annotask
pnpm typecheck                # Type-check (tsc + vue-tsc)
```

Then open:
- App: http://localhost:5173/
- Annotask: http://localhost:5173/__annotask/
- API: http://localhost:5173/__annotask/api/tasks
- MCP: http://localhost:5173/__annotask/mcp

## Annotask CLI

```bash
annotask status              # Check if server is running
annotask tasks               # Compact task summaries (use --pretty for full objects)
annotask report              # Fetch live change report (no tasks)
annotask watch               # Live stream changes via WebSocket
annotask update-task <id> --status=<status>   # Update task status
annotask screenshot <id>     # Download a task's screenshot
annotask init-skills         # Install agent skills into project
annotask mcp                 # Start MCP stdio server (proxies to dev server)
```

Options: `--port=N`, `--host=H`, `--server=URL` (override server.json), `--mfe=NAME` (filter by MFE), `--output=PATH` (for screenshot command).

## Annotask API

- `POST /__annotask/mcp` — MCP endpoint (Streamable HTTP transport, JSON-RPC 2.0)
- `GET /__annotask/api/tasks` — Task list (supports `?mfe=NAME` filter)
- `GET /__annotask/api/tasks/:id` — Single task detail
- `POST /__annotask/api/tasks` — Create a task
- `PATCH /__annotask/api/tasks/:id` — Update task status
- `DELETE /__annotask/api/tasks/:id` — Delete a task and its screenshot
- `GET /__annotask/api/design-spec` — Design spec (tokens, framework, breakpoints)
- `POST /__annotask/api/screenshots` — Upload a screenshot
- `GET /__annotask/screenshots/:filename` — Serve a screenshot
- `GET /__annotask/api/status` — Health check
- `ws://localhost:5173/__annotask/ws` — Live WebSocket stream

Use `/annotask-apply` to fetch and apply pending visual changes to source code.

## Structure

- `src/plugin/` — Vite plugin (multi-framework transform, toggle button, bridge client)
- `src/server/` — HTTP API, WebSocket server, shell serving, project state
- `src/webpack/` — Webpack plugin and transform loader
- `src/shell/` — Design tool UI (Vue 3 app, pre-built into dist/shell/)
- `src/shell/composables/` — Vue composables (style editor, tasks, screenshots, keyboard shortcuts, a11y scanner, error monitor, perf monitor, annotations, viewport, interaction history, etc.)
- `src/shell/components/` — UI components (TaskDetailModal, DesignPanel, ElementStyleEditor, ErrorsTab, PerfTab, inspector tabs, overlays, viewport selector, a11y panel, report viewer, etc.)
- `src/shell/utils/` — Helpers (stripMarkdown)
- `src/shared/` — Shared types (postMessage bridge protocol)
- `src/schema.ts` — TypeScript types for change reports, tasks, design spec, viewport, interaction history, element context
- `src/mcp/` — MCP server (Streamable HTTP transport, embedded in the Vite/Webpack server)
- `src/cli/` — CLI tool for terminal interaction
- `playgrounds/` — Test apps (vue-vite, vue-webpack, react-vite, svelte-vite, solid-vite, html-vite, astro, htmx-vite, mfe-vite)

## Shell Architecture

`App.vue` is the shell orchestrator — it wires composables together and handles bridge events. **Do not add business logic directly to App.vue.** Extract new concerns into composables under `src/shell/composables/`.

Key composables:
- `useSelectionModel` — Element selection state, rect tracking, hover, live styles, style/class change handlers
- `useTaskWorkflows` — Task creation flows (pin, arrow, highlight, section → task), pending task panel, accept/deny, annotation restoration
- `useAnnotationRects` — rAF loop keeping annotation overlays positioned during scroll/resize
- `useAnnotations` — Pin, arrow, section, highlight annotation state and route filtering
- `useStyleEditor` — Style/class change recording, undo, report generation
- `useIframeManager` — Bridge communication with the app iframe
- `useErrorMonitor` — Console error/warn capture, deduplication, bounded tracking, error → task creation
- `usePerfMonitor` — Web Vitals, performance scanning, interaction recording, bundle analysis, perf → task creation

When adding new shell features, create a new composable that accepts its dependencies via constructor params and returns refs + methods. App.vue should only orchestrate (init composables, wire bridge events, pass props to components).

## Key Shell Features

- **Viewport preview** — Device presets + custom dimensions, viewport info included in tasks/reports
- **Interaction history** — Tracks user navigation and clicks in the app (optional, off by default)
- **Element context** — Ancestor layout chain + DOM subtree snapshot on tasks (optional, off by default)
- **A11y checker** — axe-core WCAG scanning with one-click fix task creation (locally bundled, no CDN)
- **Error monitoring** — Console error/warn capture with deduplication, bounded memory, one-click fix tasks
- **Performance monitoring** — Web Vitals, DOM/resource/bundle analysis, interaction recording, perf score, one-click fix tasks
- **Screenshots** — Snipping tool captures regions or full page, attached to tasks, served via API, auto-cleaned on accept (max 4MB)
- **Task detail drawer** — Slide-out detail view with markdown rendering, inline editing, screenshot lightbox, element/file display, interaction log, JSON view, delete button
- **Task lifecycle** — `pending → in_progress → review → accepted/denied` with `needs_info` (agent asks questions) and `blocked` (agent can't apply) statuses, resolution messages, live status updates
- **Markdown descriptions** — Task descriptions support GitHub-flavored Markdown (rendered with `marked`)
- **Security** — CORS restricted to localhost, PATCH/DELETE field whitelisting, postMessage sender validation
- **Async I/O** — In-memory task cache with atomic file writes (no race conditions)
- **Inspector highlights** — Selection/hover overlays that track scroll and resize via rAF loop
- **Arrow tool** — Multi-color arrows with element outlines, edge-to-edge bezier paths, draggable endpoints, element-aware re-resolution on move, scroll/resize tracking via rAF
- **Section tool** — Markdown editor (edit/preview toggle), dark theme, movable/resizable sections with drag handles, explicit "Add Task" / "Update Task" button
- **Text highlights** — Multi-color highlights with visual overlay on selected text, sidebar task creation with preloaded text
- **Scroll/resize tracking** — All annotations (arrows, highlights, sections) follow elements during scroll and window resize via rAF loop, same pattern as inspector selections
- **Route persistence** — Iframe route saved to localStorage, restored on page reload
- **Editable route indicator** — Route input in toolbar navigates the iframe to a typed path
- **Confirm dialogs** — Reusable ConfirmDialog component for destructive actions (task deletion)
- **Task deletion** — DELETE /api/tasks/:id endpoint, trash icon in task detail drawer with confirm

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
pending → in_progress (agent locks) → review (agent done) → accepted (removed) or denied (with feedback)
```
