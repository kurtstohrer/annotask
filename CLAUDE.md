# Annotask

Visual UI design tool for web apps (Vue, React, Svelte, Astro, plain HTML/htmx). Developers make visual changes in the browser and Annotask generates structured reports that AI agents can apply to source code. Works with Vite and Webpack.

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

## Annotask API

When the Annotask design tool is running, you can interact with it:

- **MCP**: `POST http://localhost:5173/__annotask/mcp` — MCP tools for tasks, design spec, components, screenshots
- **HTTP**: `curl http://localhost:5173/__annotask/api/tasks` — get the current tasks
- **WebSocket**: `ws://localhost:5173/__annotask/ws` — live change stream
- **CLI**: `annotask tasks` / `annotask watch` — terminal tools

Use `/annotask-apply` to fetch and apply pending visual changes to source code.

## Structure

- `src/plugin/` — Vite plugin (multi-framework transform, toggle button, bridge client)
- `src/server/` — HTTP API, WebSocket server, shell serving, project state
- `src/webpack/` — Webpack plugin and transform loader
- `src/shell/` — Design tool UI (Vue 3 app, pre-built into dist/shell/)
- `src/shell/composables/` — Vue composables (style editor, tasks, screenshots, keyboard shortcuts, a11y scanner, annotations, viewport, interaction history, etc.)
- `src/shell/components/` — UI components (TaskDetailModal, inspector tabs, overlays, viewport selector, a11y panel, report viewer, etc.)
- `src/shell/utils/` — Helpers (stripMarkdown)
- `src/shared/` — Shared types (postMessage bridge protocol)
- `src/schema.ts` — TypeScript types for change reports, tasks, design spec, viewport, interaction history, element context
- `src/mcp/` — MCP server (Streamable HTTP transport, embedded in the Vite/Webpack server)
- `src/cli/` — CLI tool for terminal interaction
- `playgrounds/` — Test apps (vue-vite, vue-webpack, react-vite, svelte-vite, html-vite, astro, htmx-vite, mfe-vite)

## Shell Architecture

`App.vue` is the shell orchestrator — it wires composables together and handles bridge events. **Do not add business logic directly to App.vue.** Extract new concerns into composables under `src/shell/composables/`.

Key composables:
- `useSelectionModel` — Element selection state, rect tracking, hover, live styles, style/class change handlers
- `useTaskWorkflows` — Task creation flows (pin, arrow, highlight, section → task), pending task panel, accept/deny, annotation restoration
- `useAnnotationRects` — rAF loop keeping annotation overlays positioned during scroll/resize
- `useAnnotations` — Pin, arrow, section, highlight annotation state and route filtering
- `useStyleEditor` — Style/class change recording, undo, report generation
- `useIframeManager` — Bridge communication with the app iframe

When adding new shell features, create a new composable that accepts its dependencies via constructor params and returns refs + methods. App.vue should only orchestrate (init composables, wire bridge events, pass props to components).

## Key Shell Features

- **Viewport preview** — Device presets + custom dimensions, viewport info included in tasks/reports
- **Interaction history** — Tracks user navigation and clicks in the app (optional, off by default)
- **Element context** — Ancestor layout chain + DOM subtree snapshot on tasks (optional, off by default)
- **A11y checker** — axe-core WCAG scanning with one-click fix task creation (locally bundled, no CDN)
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
