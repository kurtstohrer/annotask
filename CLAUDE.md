# Annotask

Visual UI design and review tool for web apps (Vue, React, Svelte, SolidJS, Astro, plain HTML/htmx). Developers can annotate the UI, inspect and edit styles live, audit runtime issues, and let AI agents apply the resulting structured tasks to source code. Works with Vite and Webpack.

## MCP Server

Annotask includes an MCP server that starts automatically with the dev server at `POST /__annotask/mcp`. If your editor is configured with the Annotask MCP server, you have these tools:

| Tool | Description |
|------|-------------|
| `annotask_get_tasks` | List task summaries — filter by `status`, `mfe`. Use `detail=true` for full objects |
| `annotask_get_task` | Get full detail for a single task by ID (context, agent_feedback) |
| `annotask_update_task` | Transition status, set resolution, ask questions, mark blocked |
| `annotask_create_task` | Create a new pending task |
| `annotask_delete_task` | Delete a task and its screenshot |
| `annotask_get_design_spec` | Design spec summary, or full tokens for a `category` (colors, typography, etc.) |
| `annotask_get_components` | Search component libraries by name, library, category, or usage state |
| `annotask_get_component` | Get full detail for one component by name |
| `annotask_get_component_examples` | Get real in-repo usage examples for a component |
| `annotask_get_screenshot` | Task screenshot as base64 PNG |
| `annotask_get_code_context` | Ground a task to current source context (excerpt, symbol, imports, hash) |
| `annotask_get_data_context` | Resolve task data context |
| `annotask_get_interaction_history` | Fetch a task's pre-task user trace (route path + ~20 recent actions). Always captured server-side even when the user didn't embed it in the payload |
| `annotask_get_rendered_html` | Fetch the `outerHTML` snapshot of the task's selected element. Always captured; `source` field indicates embedded vs sidecar |
| `annotask_get_data_sources` | List detected data libraries and project data sources |
| `annotask_get_data_source_examples` | Get real in-repo usage examples for a data source |
| `annotask_get_data_source_details` | Get definition-level detail for a data source |
| `annotask_get_runtime_endpoints` | List endpoints the iframe has actually hit at runtime — aggregated per (origin, method, pattern). `orphans_only: true` surfaces gaps the static scanner missed |
| `annotask_get_api_schemas` | List discovered OpenAPI, GraphQL, tRPC, and JSON Schema sources |
| `annotask_get_api_operation` | Fetch one API operation by path |
| `annotask_resolve_endpoint` | Match a concrete URL to a known API operation |

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
annotask tasks               # Compact task summaries (use --detail for full objects)
annotask task <id>           # Single task detail (trimmed agent_feedback)
annotask design-spec         # Design spec summary (or --category=NAME slice)
annotask report              # Fetch live change report (no tasks)
annotask watch               # Live stream changes via WebSocket
annotask update-task <id> --status=<status>   # Update task status
annotask screenshot <id>     # Download a task's screenshot
annotask components [search] # List components (add --mcp for JSON)
annotask component <Name>    # Show component props
annotask code-context <id>   # Ground task to current source excerpt
annotask component-examples Button # Real in-repo component usage examples
annotask data-context <id>   # Resolve task data context
annotask interaction-history <id>  # Pre-task user trace (always captured, embed toggle decides payload inclusion)
annotask rendered-html <id>  # outerHTML snapshot of the task's selected element
annotask data-sources        # List data libraries + project data sources
annotask runtime-endpoints   # List endpoints the iframe hit at runtime (--orphans-only for gaps)
annotask data-source-examples useUserQuery # Real in-repo data-source usages
annotask data-source-details useUserQuery  # Definition-level data-source detail
annotask api-schemas         # Discovered API schemas
annotask api-operation /users --method=GET # One resolved API operation
annotask resolve-endpoint /api/users/42    # Match a concrete URL to a known schema
annotask init-skills         # Install agent skills into project
annotask init-mcp            # Write editor MCP config (--editor=claude|cursor|vscode|windsurf|all)
annotask mcp                 # Start MCP stdio server (proxies to dev server)
```

**MCP-parity flag:** pass `--mcp` to any command to force compact JSON output
that matches the `annotask_*` MCP tool responses (`visual` stripped,
`agent_feedback` trimmed, no ANSI/human prefixes). Skills call the CLI with
`--mcp` as a fallback when the MCP server isn't registered in the editor.

Options: `--port=N`, `--host=H`, `--server=URL` (override server.json),
`--mfe=NAME` (filter by MFE), `--output=PATH` (screenshot), `--mcp`,
`--detail` (tasks), `--status=STATUS` (tasks), `--category=NAME` (design-spec),
`--library=NAME` / `--limit=N` / `--offset=N` (components), `--context-lines=N`,
`--refresh`, `--used-only`, `--kind=K`, `--method=M`, `--schema-location=L`, `--search=Q`.

## Annotask API

- `POST /__annotask/mcp` — MCP endpoint (Streamable HTTP transport, JSON-RPC 2.0)
- `GET /__annotask/api/tasks` — Task list (supports `?mfe=NAME` filter)
- `GET /__annotask/api/tasks/:id` — Single task detail
- `POST /__annotask/api/tasks` — Create a task
- `PATCH /__annotask/api/tasks/:id` — Update task status
- `DELETE /__annotask/api/tasks/:id` — Delete a task and its screenshot
- `GET /__annotask/api/design-spec` — Design spec (tokens, framework, breakpoints)
- `GET /__annotask/api/components` — Component library catalog
- `GET /__annotask/api/component-usage` — Project component usage index
- `GET /__annotask/api/component-examples/:name` — In-repo component usage examples
- `GET /__annotask/api/code-context/:taskId` — Ground task to current source context
- `GET /__annotask/api/source-excerpt` — Direct source excerpt by file/line
- `GET /__annotask/api/data-context/:taskId` — Stored or resolved task data context
- `GET /__annotask/api/data-context/probe|resolve|element` — Shell data-context helpers
- `GET /__annotask/api/data-sources` — Project data-source catalog (add `?include_runtime=true` to append the runtime-observed endpoint catalog)
- `GET|POST|DELETE /__annotask/api/runtime-endpoints` — Runtime-observed endpoint catalog. Iframe fetch/XHR/beacon calls land here automatically. `GET ?merge_static=true` enriches rows with matching static sources + OpenAPI operations; `GET ?route=PATH` filters to one iframe route
- `GET /__annotask/api/data-source-examples/:name` — In-repo data-source usage examples
- `GET /__annotask/api/data-source-details/:name` — Definition-level data-source detail
- `GET /__annotask/api/data-source-bindings/:name` — Binding graph for highlights
- `GET /__annotask/api/api-schemas` — API schema catalog
- `GET /__annotask/api/api-operation` — One API operation by path
- `GET /__annotask/api/resolve-endpoint` — Resolve a concrete URL to a known operation
- `GET|POST /__annotask/api/tasks/:id/interaction-history` — Per-task user-trace sidecar (always written on task create; embed toggle only gates inclusion in the task payload)
- `GET|POST /__annotask/api/tasks/:id/rendered-html` — Per-task `outerHTML` sidecar (always written when a selection exists; 200 KB cap)
- `GET|POST /__annotask/api/performance` — Performance snapshots
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
- `src/shell/themes/` — Shell theme system (types, 18 built-in themes, barrel export)
- `src/shell/composables/` — Vue composables (shell theme, style editor, tasks, screenshots, keyboard shortcuts, a11y scanner, error monitor, perf monitor, annotations, viewport, interaction history, etc.)
- `src/shell/components/` — UI components (TaskDetailModal, DesignPanel, ElementStyleEditor, ShellThemeEditor, ErrorsTab, PerfTab, inspector tabs, overlays, viewport selector, a11y panel, report viewer, etc.)
- `src/shell/utils/` — Helpers (stripMarkdown)
- `src/shared/` — Shared types (postMessage bridge protocol)
- `src/schema.ts` — TypeScript types for change reports, tasks, design spec, viewport, interaction history, element context
- `src/mcp/` — MCP server (Streamable HTTP transport, embedded in the Vite/Webpack server)
- `src/cli/` — CLI tool for terminal interaction
- `playgrounds/simple/` — Single-framework test apps (vue-vite, vue-webpack, react-vite, svelte-vite, solid-vite, html-vite, astro, htmx-vite, mfe-vite)

## Shell Architecture

The shell has **3 top-level tabs** (see `useShellNavigation.ts`):

| Tab | Internal id | Sub-sections |
|-----|-------------|--------------|
| **Annotate** | `editor` | — (pins, arrows, sections, highlights) |
| **Design** | `design` | `tokens` / `inspector` / `components` |
| **Audit** | `develop` | `a11y` / `data` / `libraries` / `perf` / `errors` |

The "Audit" tab uses internal id `develop` (the label was renamed but the id was kept to avoid a breaking localStorage migration). Tab state lives in `useShellNavigation` (`shellView`, `designSection`, `developSection`, `activePanel`), persisted to localStorage and migrated from legacy ids (`theme`, `components`, `data`, `perf`, `a11y`) on first run.

`App.vue` is the shell orchestrator — it wires composables together and handles bridge events. **Do not add business logic directly to App.vue.** Extract new concerns into composables under `src/shell/composables/`.

Key composables:
- `useShellTheme` — Theme system: 63 CSS variables, 18 built-in themes, custom theme CRUD, system preference, localStorage persistence
- `useSelectionModel` — Element selection state, rect tracking, hover, live styles, style/class change handlers
- `useTaskWorkflows` — Task creation flows (pin, arrow, highlight, section → task), pending task panel, accept/deny, annotation restoration, auto-opens task panel on create
- `useAnnotationRects` — rAF loop keeping annotation overlays positioned during scroll/resize
- `useAnnotations` — Pin, arrow, section, highlight annotation state and route filtering
- `useStyleEditor` — Style/class change recording, undo, report generation
- `useIframeManager` — Bridge communication with the app iframe
- `useErrorMonitor` — Console error/warn capture, deduplication, bounded tracking, error → task creation
- `usePerfMonitor` — Web Vitals, performance scanning, interaction recording, bundle analysis, perf → task creation

When adding new shell features, create a new composable that accepts its dependencies via constructor params and returns refs + methods. App.vue should only orchestrate (init composables, wire bridge events, pass props to components).

## Shell Theme System

The shell has a VS Code-style theme system with 18 built-in themes and custom theme support. Themes control every color in the UI via 63 CSS custom properties.

### Architecture

- `src/shell/themes/types.ts` — `ShellThemeColors` (63 vars), `ShellTheme` interface, `THEME_COLOR_KEYS` array
- `src/shell/themes/builtin.ts` — 18 built-in theme definitions with `deriveDefaults()` helper
- `src/shell/composables/useShellTheme.ts` — Core composable: applies themes at runtime via `style.setProperty()`, handles localStorage persistence, system preference detection, custom theme CRUD, and a one-shot migration from the legacy `annotask:themeMode` key
- `src/shell/components/ShellThemeEditor.vue` — Full-screen custom theme creator with grouped color pickers and live preview

### How themes are applied

Themes are applied at runtime via `document.documentElement.style.setProperty()` for each of the 63 CSS variables. The `:root` block in App.vue provides dark fallback values, and `:root.light` provides light fallback values — these are safety nets for first paint before JS runs. Once `useShellTheme` initializes, it overrides all variables via inline styles.

### CSS variable categories (63 total)

| Category | Variables | Purpose |
|----------|-----------|---------|
| Surfaces (7) | `--bg`, `--surface`, `--surface-2`, `--surface-3`, `--surface-elevated`, `--surface-glass`, `--surface-overlay` | Background layers |
| Borders (2) | `--border`, `--border-strong` | Border colors |
| Text (5) | `--text`, `--text-muted`, `--text-on-accent`, `--text-inverse`, `--text-link` | Text colors |
| Accent (3) | `--accent`, `--accent-hover`, `--accent-muted` | Primary interactive color |
| Semantic (5) | `--danger`, `--success`, `--warning`, `--info`, `--focus-ring` | Semantic indicators |
| Palette (4) | `--purple`, `--orange`, `--cyan`, `--indigo` | Extended color palette |
| Utility (2) | `--overlay`, `--shadow` | Overlays and shadows |
| Status (7) | `--status-pending`, `--status-in-progress`, `--status-review`, `--status-denied`, `--status-accepted`, `--status-needs-info`, `--status-blocked` | Task lifecycle |
| Severity (4) | `--severity-critical`, `--severity-serious`, `--severity-moderate`, `--severity-minor` | A11y/perf findings |
| Modes (4) | `--mode-interact`, `--mode-arrow`, `--mode-draw`, `--mode-highlight` | Tool button active states |
| Layout (2) | `--layout-flex`, `--layout-grid` | Layout visualization |
| Roles (3) | `--role-container`, `--role-content`, `--role-component` | Element classification |
| Syntax (7) | `--syntax-property`, `--syntax-string`, `--syntax-number`, `--syntax-boolean`, `--syntax-null`, `--syntax-operator`, `--syntax-punctuation` | Code highlighting |
| Tool overlays (2) | `--pin-color`, `--highlight-color` | Pin dots and element selection |
| Annotations (6) | `--annotation-red`, `--annotation-orange`, `--annotation-yellow`, `--annotation-green`, `--annotation-blue`, `--annotation-purple` | Arrow/highlight presets |

### Built-in themes (18)

**Default:** Dark, Light
**High Contrast:** High Contrast Dark, High Contrast Light
**Accessibility:** Deuteranopia (blue/orange, no red-green)
**Editor:** Monokai, Solarized Dark, Solarized Light, Nord, One Dark, Dracula, GitHub Dark, GitHub Light, Catppuccin Mocha, Gruvbox Dark, Rosé Pine, Synthwave '84, Cobalt

### Adding a new built-in theme

In `src/shell/themes/builtin.ts`, use the `theme()` helper:

```typescript
const myTheme = theme('my-theme', 'My Theme', 'dark', 'editor', 'Description', {
  // ~28 core colors (surfaces, borders, text, accent, semantic, palette, utility)
  bg: '#...', surface: '#...', /* ... */
}, {
  // Optional overrides for derived values (status, severity, syntax, annotations)
  // deriveDefaults() fills these from core colors if not specified
  'annotation-red': '#...', 'annotation-orange': '#...', /* ... */
})
```

Then add it to the `BUILTIN_THEMES` array. The `deriveDefaults()` helper automatically derives status, severity, mode, layout, role, syntax, and annotation colors from core colors — override only what needs to differ.

**Important:** Each theme's 6 annotation colors must be visually distinct from each other (no overlapping shades). Use colors from the theme's native palette.

### Using rgba/transparent variants in CSS

Never hardcode `rgba()` with theme-dependent colors. Use `color-mix()`:

```css
/* Wrong: */ background: rgba(239, 68, 68, 0.15);
/* Right: */ background: color-mix(in srgb, var(--danger) 15%, transparent);
```

### localStorage keys

| Key | Purpose |
|-----|---------|
| `annotask:shellTheme` | Active theme ID (e.g. `'monokai'`, `'system'`) |
| `annotask:shellSystemThemes` | JSON `[darkId, lightId]` pair for system preference |
| `annotask:shellCustomThemes` | JSON array of user-created `ShellTheme` objects |

### Custom themes

Users create custom themes via Settings > Appearance > "+ Create Custom Theme". Custom themes are stored in localStorage with IDs prefixed `custom:`. The editor provides live preview — changes apply to the shell immediately. Missing keys inherit from the base theme.

## Key Shell Features

- **Viewport preview** — Device presets + custom dimensions, viewport info included in tasks/reports
- **Interaction history** — Tracks user navigation and clicks. Always captured and persisted per task to `.annotask/interaction-history/<id>.json`; the "Embed interaction history" toggle only decides whether it rides in the task payload. Agents retrieve via `annotask_get_interaction_history` when unembedded
- **Element context / rendered HTML** — Post-render `outerHTML` of the selected element. Always captured and persisted per task to `.annotask/rendered-html/<id>.json` (200 KB cap); the "Embed rendered HTML" toggle only decides payload inclusion. Agents retrieve via `annotask_get_rendered_html`
- **A11y checker** — axe-core WCAG scanning with one-click fix task creation (locally bundled, no CDN)
- **Error monitoring** — Console error/warn capture with deduplication, bounded memory, one-click fix tasks
- **Performance monitoring** — Web Vitals, DOM/resource/bundle analysis, interaction recording, perf score, one-click fix tasks
- **Data view** — Discovered data sources, schema matching, page highlights, and `api_update` task creation
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

Canonical list — `TASK_TYPES` in `src/schema.ts` is the single source of truth. HTTP, MCP, and CLI creation boundaries enforce this allow-list via `z.enum(TASK_TYPES)`.

| Type | Source | Description |
|------|--------|-------------|
| `annotation` | Pins, arrows, notes, text highlights | User intent described in `description`, optional `action` and `context` |
| `section_request` | Drawn sections | New content area with `description` and `placement` |
| `style_update` | Inspector style/class edits | CSS changes in `context.changes` array with `property`, `before`, `after` |
| `theme_update` | Theme page commit | One task per commit. `context.edits[]` — each entry carries `category`, `role`, `cssVar`, `theme_variant`, `theme_selector` (how that variant is activated in the DOM — attribute/class/media/default), `before`, `after`, `sourceFile`, `sourceLine`, `isNew`. `context.specFile` is the relative path to `.annotask/design-spec.json`; the agent patches it after applying CSS edits so the Theme page hot-reloads. |
| `a11y_fix` | A11y panel violations | WCAG fix with `rule`, `impact`, `help`, `elements` in `context` |
| `error_fix` | Errors tab "Fix" action | Console error/warning with `level`, `occurrences`, `errorId` in `context` |
| `perf_fix` | Perf tab "Fix" action | Performance finding with `metric`, `value`, `unit`, `severity`, `category`, `findingId` in `context` |
| `api_update` | Data view | Backend-contract edits for in-repo data sources; `context` carries `data_source_name`, `data_source_kind`, `schema_location`, `schema_kind`, `endpoint`, and desired change metadata |

## Task Lifecycle

```
pending → in_progress (agent locks) → review (agent done) → accepted (removed) or denied (with feedback)
                         └→ needs_info (agent asks) / blocked (cannot apply)
```
