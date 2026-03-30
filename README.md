# Annotask

Visual markup tool for web apps. Annotate your UI in the browser — pins, arrows, drawn sections, notes — and Annotask generates structured tasks that AI coding agents apply to your source code. Supports Vue, React, Svelte, Astro, and plain HTML/htmx with Vite and Webpack.

## Workflow

```
 You (in browser)                    Your coding agent
 ─────────────────                   ──────────────────
 Open Annotask shell
 Annotate the UI:
   pin elements, draw
   sections, add notes,         ──>  /annotask-apply
   describe what you want            Reads tasks from Annotask API
                                     Edits source files
                                     Marks tasks as "ready for review"
 Review changes in                <──
 Annotask shell:
   Accept ✓  or  Deny ✗
   (denied tasks return
    with your feedback
    for the agent to retry)
```

### How it works

1. **You mark up the UI** — Use the Annotask shell to annotate elements: pin a component and describe what you want changed, draw a section where new content should go, highlight text that needs editing, or drop arrows showing where things should move.

2. **Tasks are created** — Each annotation becomes a structured task with full context: source file, line number, component name, element tag, surrounding layout, and your intent in plain language.

3. **Your coding agent applies the tasks** — Invoke `/annotask-apply` in Claude Code (or the equivalent skill in your agent). It fetches pending tasks from the Annotask API, edits the source files, and marks each task as ready for review.

4. **You review** — Back in the Annotask shell, accept or deny each change. Denied tasks return to the queue with your feedback so the agent can retry with corrections.

## Agent Setup

Annotask ships skills for AI coding agents. Install them into your project:

```bash
npx annotask init-skills
```

This copies skill files to `.claude/skills/` and `.agents/skills/` so your agent can discover them.

| Agent | Skill directory | Notes |
|-------|----------------|-------|
| Claude Code | `.claude/skills/` | Invoke with `/annotask-apply`, `/annotask-init`, `/annotask-watch` |
| GitHub Copilot | `.agents/skills/` | Auto-discovered by Copilot agents |
| OpenAI Codex | `.agents/skills/` | Uses the same `.agents/` convention |
| Other agents | `.agents/skills/` | Any agent that reads `.agents/skills/` |

### Skills

| Skill | What it does |
|-------|-------------|
| `/annotask-init` | Scans your project and generates `.annotask/design-spec.json` with detected tokens, fonts, colors, and component library. Run once per project. |
| `/annotask-apply` | Fetches pending tasks from the Annotask API, applies changes to source files, and marks them for review. |
| `/annotask-watch` | Streams live changes from the Annotask WebSocket so your agent can narrate what you're doing in real time. |

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
- **Notes** — Attach free-text design notes to any element

### Visual editing (experimental)
- **Element inspection** — Click any element to see its source file, line, component, and computed styles
- **Live style editing** — Modify layout, spacing, size, colors, and typography with immediate preview
- **Class editing** — Add, remove, or modify CSS classes on elements
- **Theme token editing** — Edit design tokens (colors, typography, spacing, borders) from a detected design spec

### Infrastructure
- **Change reports** — Structured JSON of all changes, ready for agents to consume
- **Task pipeline** — Create, review, accept, or deny design change tasks
- **CLI** — `annotask watch` for live streaming, `annotask report` for current state
- **API** — HTTP and WebSocket endpoints for programmatic access

## CLI

```bash
annotask watch              # Live stream of changes
annotask report             # Fetch current report JSON
annotask status             # Check connection
annotask init-skills        # Install agent skills into your project
```

Options: `--port=N`, `--host=H`, `--server=URL` (override server.json), `--mfe=NAME` (filter by MFE).

## API

- `GET /__annotask/api/report` — Current change report
- `GET /__annotask/api/tasks` — Task list (supports `?mfe=NAME` filter)
- `POST /__annotask/api/tasks` — Create a task
- `PATCH /__annotask/api/tasks/:id` — Update task status
- `GET /__annotask/api/status` — Health check
- `ws://localhost:5173/__annotask/ws` — Live WebSocket stream

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
- **Local only** — API and WebSocket endpoints are unauthenticated (same model as Vite HMR)
- **Source mapping** — Works best with component files (`.vue`, `.tsx`, `.svelte`, `.astro`, `.html`); dynamic components and render functions may not map correctly

## Development

```bash
pnpm install
pnpm build                   # Build shell + plugin + CLI
pnpm dev:vue-vite             # Start Vue test app with Annotask
pnpm test                     # Run tests
pnpm test:e2e                 # Run E2E tests (all frameworks)
```

## Project Structure

- `src/plugin/` — Vite plugin (multi-framework transform, toggle button, bridge client)
- `src/server/` — HTTP API, WebSocket server, shell serving, project state
- `src/webpack/` — Webpack plugin and transform loader
- `src/shell/` — Design tool UI (Vue 3 app, pre-built into dist/shell/)
- `src/shared/` — Shared types (postMessage bridge protocol)
- `src/schema.ts` — TypeScript types for change reports
- `src/cli/` — CLI tool for terminal interaction
- `skills/` — Agent skill definitions (shipped with the npm package)
- `playgrounds/` — Test apps (vue-vite, vue-webpack, react-vite, svelte-vite, html-vite, astro, htmx-vite, mfe-vite)

## Troubleshooting

**Elements don't show source info**: Make sure your framework plugin (Vue, React, or Svelte) is installed and the Annotask plugin is listed after it in your Vite config. The transform needs to run before the framework compiler processes the source. For Astro, source mapping is automatic via Astro's native attributes. For plain HTML/htmx, source mapping is injected via `transformIndexHtml`.

**WebSocket not connecting**: Ensure the dev server is running. The CLI and shell connect to `/__annotask/ws` on the same port as your dev server.

**Changes not appearing in report**: Only style and class changes that differ from computed values are included. If before and after are identical, the change is filtered out.
