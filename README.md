<p align="center">
  <img src="annotask-logo.png" alt="Annotask" width="120" />
</p>

<h1 align="center">Annotask</h1>

Visual markup tool for web apps. Annotate your UI in the browser — pins, arrows, drawn sections, notes — and Annotask generates structured tasks that AI coding agents apply to your source code. Supports Vue, React, Svelte, Astro, and plain HTML/htmx with Vite and Webpack.

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
                                     Applies code change
                                     Marks for review — one at a time
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

## Agent Setup

Annotask ships skills for AI coding agents. Install them into your project:

```bash
npx annotask init-skills
```

This copies skill files to `.claude/skills/` and `.agents/skills/` so your agent can discover them.

| Agent | Skill directory | Notes |
|-------|----------------|-------|
| Claude Code | `.claude/skills/` | Invoke with `/annotask-apply`, `/annotask-init` |
| GitHub Copilot | `.agents/skills/` | Auto-discovered by Copilot agents |
| OpenAI Codex | `.agents/skills/` | Uses the same `.agents/` convention |
| Other agents | `.agents/skills/` | Any agent that reads `.agents/skills/` |

### Skills

| Skill | What it does |
|-------|-------------|
| `/annotask-init` | Scans your project and generates `.annotask/design-spec.json` with detected tokens, fonts, colors, and component library. Run once per project. |
| `/annotask-apply` | Fetches pending tasks from the Annotask API, applies changes to source files, and marks them for review. |

## Quick Start

```bash
npm install -D annotask
```

### Vite (Vue, React, Svelte, or plain HTML)

```ts
import { annotask } from 'annotask'

export default defineConfig({
  plugins: [
    vue(),    // or react() or svelte() — omit for plain HTML/htmx
    annotask(),
  ],
})
```

### Astro

```js
import { defineConfig } from 'astro/config'
import { annotask } from 'annotask'

export default defineConfig({
  vite: {
    plugins: [annotask()],
  },
})
```

Astro source mapping uses Astro's native `data-astro-source-*` attributes — no extra configuration needed.

### Webpack

```ts
import { AnnotaskWebpackPlugin } from 'annotask/webpack'

// Add to your webpack config plugins (dev only):
plugins: [new AnnotaskWebpackPlugin()]
```

### Micro-frontends (single-spa, Module Federation, etc.)

For MFE architectures where multiple apps load into a single root shell:

**MFE child** (Vite) — adds `data-annotask-mfe` attribute to all elements:

```ts
import { annotask } from 'annotask'

export default defineConfig({
  plugins: [
    vue(),
    annotask({
      mfe: '@myorg/my-mfe',                    // MFE identity tag
      server: 'http://localhost:24678',         // Root's annotask server URL
    }),
  ],
})
```

**Root shell** (Webpack) — runs the annotask server, bridge, and shell UI:

```ts
import { AnnotaskWebpackPlugin } from 'annotask/webpack'

plugins: [new AnnotaskWebpackPlugin({ port: 24678 })]
```

When `server` is set, the MFE's local annotask server is skipped — the root handles it. When only `mfe` is set (no `server`), annotask runs normally for standalone development.

Tasks created from MFE elements carry the `mfe` field. Filter them with `GET /__annotask/api/tasks?mfe=@myorg/my-mfe` or use the CLI:

```bash
annotask report --mfe=@myorg/my-mfe
```

Start your dev server, then open:
- **App**: `http://localhost:5173/` (Vite) or `http://localhost:8090/` (Webpack)
- **Annotask**: `http://localhost:5173/__annotask/`

## Features

### Annotation tools (primary)
- **Pins** — Pin an element and describe what you want changed
- **Arrows** — Draw arrows to reference other elements or parts of the page
- **Drawn sections** — Draw a rectangle where new content should go, with a prompt
- **Text highlights** — Select text to mark it for editing

### Visual editing (experimental)
- **Element inspection** — Click any element to see its source file, line, component, and computed styles
- **Live style editing** — Modify layout, spacing, size, colors, and typography with immediate preview
- **Class editing** — Add, remove, or modify CSS classes on elements
- **Theme token editing** — Edit design tokens (colors, typography, spacing, borders) from a detected design spec

### Viewport preview
- **Device presets** — Quickly switch between phone, tablet, and desktop viewports (iPhone SE, iPhone 14 Pro, iPad, Desktop, etc.)
- **Custom dimensions** — Set any width/height for the preview
- **Viewport-tagged tasks** — Every task records the viewport dimensions so the AI agent generates the correct responsive CSS

### Accessibility checker
- **Page-level scanning** — Runs axe-core WCAG analysis on the entire page from the A11y panel
- **Violation cards** — Shows impact level, rule, description, and affected element count
- **One-click fix tasks** — Create tasks from violations with full context (HTML snippets, CSS selectors, source file/line, and fix suggestions)
- **Locally bundled** — axe-core and html2canvas are shipped with the package (no CDN dependency, works offline and under CSP)

### Task detail drawer
- **Slide-out detail view** — Click any task in the sidebar to open a full detail drawer
- **Markdown descriptions** — Task descriptions support full GitHub-flavored Markdown (rendered with `marked`)
- **Inline editing** — Click the rendered description to switch to a markdown editor; save with Ctrl+Enter
- **Screenshot thumbnails** — Clickable thumbnails with full-screen lightbox preview
- **Element display** — Shows selected element(s) with tag, classes, and component name
- **Multi-file view** — Shows all source files involved (primary, arrow targets, multi-element)
- **Interaction log** — History displayed as a numbered action log with route navigation and click details
- **JSON view** — Toggle raw JSON view of the complete task object with copy button
- **Accept/Deny actions** — Review tasks directly from the detail drawer (deny form includes screenshot, history, and DOM context options)

### Screenshots
- **Snipping tool** — Click "Add Screenshot" on any task form or deny form, then drag a region or click for full-page capture
- **Thumbnail preview** — Screenshot appears as a preview on the task form before submitting (removable)
- **Task-attached** — Screenshots are stored on the server and referenced by filename in the task
- **Multimodal AI context** — AI agents can download and view screenshots for visual understanding of what the user sees
- **Auto-cleanup** — Screenshot files are deleted when the task is accepted

### AI agent context

These optional features give the AI agent richer context beyond just "change this element" — helping it make better decisions about how and where to apply changes.

- **Interaction history** — Optionally track user navigation and button/link clicks in the app. Toggle per-task, off by default.
  > Without this, the agent only sees the task description and a file path. With it, the agent knows the user navigated from `/settings` → `/profile` → clicked "Edit" → scrolled down before creating the task. This helps reproduce bugs and understand which user flow is affected.

- **Element context** — Optionally capture the ancestor layout chain (3 levels of parent display, flex-direction, gap, grid-template) and DOM subtree (3 levels of children with tag, classes, text). Toggle per-task, off by default.
  > The agent can usually determine this by reading the source file — and in most cases it will. This feature provides the same information upfront as a shortcut, saving the agent a round-trip of reading and parsing the file. It includes the computed layout state from the live browser (display, flex-direction, gap, grid-template, child count) which may differ from what's in the source when styles are inherited, overridden, or applied dynamically.

- **Breakpoint detection** — `annotask init` detects responsive breakpoints from Tailwind, Bootstrap, CSS variables, or media query patterns and includes them in the design spec.
  > The agent can find breakpoints by reading config files and stylesheets — and usually will. This pre-detects them so the agent has the project's breakpoint system immediately alongside the viewport dimensions on each task. When a task is created at 375px, the agent can instantly map that to the right Tailwind prefix, Bootstrap tier, or custom media query without searching the codebase first.

### Infrastructure
- **Change reports** — Structured JSON of all changes, ready for agents to consume (supports `?mfe=` filtering)
- **Task pipeline** — `pending → in_progress → review → accepted/denied` lifecycle with live status updates
- **Security** — CORS restricted to localhost origins, PATCH field whitelisting, postMessage sender validation
- **Async I/O** — In-memory task cache with atomic file writes (no race conditions under concurrent access)
- **CLI** — `annotask tasks`, `annotask report`, `annotask watch` for terminal access
- **API** — HTTP and WebSocket endpoints for programmatic access

## CLI

```bash
annotask watch              # Live stream of changes
annotask report             # Fetch current report JSON
annotask status             # Check connection
annotask screenshot <id>    # Download a task's screenshot
annotask init-skills        # Install agent skills into your project
```

Options: `--port=N`, `--host=H`, `--server=URL` (override server.json), `--mfe=NAME` (filter by MFE), `--output=PATH` (for screenshot command).

## API

- `GET /__annotask/api/report` — Current change report (supports `?mfe=NAME` filter)
- `GET /__annotask/api/tasks` — Task list (supports `?mfe=NAME` filter)
- `POST /__annotask/api/tasks` — Create a task
- `PATCH /__annotask/api/tasks/:id` — Update task (whitelisted fields: status, description, feedback, screenshot, viewport, etc.)
- `POST /__annotask/api/screenshots` — Upload a screenshot (base64 PNG, max 4MB)
- `GET /__annotask/screenshots/:filename` — Serve a screenshot
- `GET /__annotask/api/status` — Health check
- `ws://localhost:5173/__annotask/ws` — Live WebSocket stream

CORS is restricted to localhost origins. Mutating requests from non-local origins are rejected.

## Supported Frameworks

| Framework | Vite | Webpack |
|-----------|------|---------|
| Vue 3     | Yes  | Yes     |
| React     | Yes  | Yes     |
| Svelte    | Yes  | Yes     |
| Astro     | Yes  | —       |
| Plain HTML| Yes  | —       |
| htmx      | Yes  | —       |

## Limitations

- **Dev mode only** — Annotask only runs in dev servers (Vite or Webpack), never in production builds
- **Local only** — API and WebSocket endpoints are localhost-restricted (CORS enforced, same model as Vite HMR)
- **Source mapping** — Works best with component files (`.vue`, `.tsx`, `.svelte`, `.astro`, `.html`); dynamic components and render functions may not map correctly

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
- `src/shell/composables/` — Vue composables (style editor, tasks, screenshots, keyboard shortcuts, a11y scanner, etc.)
- `src/shell/components/` — UI components (inspector tabs, overlays, task detail drawer, report viewer, etc.)
- `src/shared/` — Shared types (postMessage bridge protocol)
- `src/schema.ts` — TypeScript types for change reports
- `src/cli/` — CLI tool for terminal interaction
- `skills/` — Agent skill definitions (shipped with the npm package)
- `playgrounds/` — Test apps (vue-vite, vue-webpack, react-vite, svelte-vite, html-vite, astro, htmx-vite, mfe-vite)

## Troubleshooting

**Elements don't show source info**: Make sure your framework plugin (Vue, React, or Svelte) is installed and the Annotask plugin is listed after it in your Vite config. The transform needs to run before the framework compiler processes the source. For Astro, source mapping is automatic via Astro's native attributes. For plain HTML/htmx, source mapping is injected via `transformIndexHtml`.

**WebSocket not connecting**: Ensure the dev server is running. The CLI and shell connect to `/__annotask/ws` on the same port as your dev server.

**Changes not appearing in report**: Only style and class changes that differ from computed values are included. If before and after are identical, the change is filtered out.
