# Annotask

Visual UI design tool for web apps. Make visual changes in the browser and Annotask generates structured reports that AI agents can apply to source code. Supports Vue, React, and Svelte with Vite and Webpack.

## Quick Start

```bash
npm install -D annotask
```

### Vite (Vue, React, or Svelte)

```ts
import { annotask } from 'annotask'

export default defineConfig({
  plugins: [
    vue(),    // or react() or svelte()
    annotask(),
  ],
})
```

### Webpack

```ts
import { AnnotaskWebpackPlugin } from 'annotask/webpack'

// Add to your webpack config plugins (dev only):
plugins: [new AnnotaskWebpackPlugin()]
```

Start your dev server, then open:
- **App**: `http://localhost:5173/` (Vite) or `http://localhost:8090/` (Webpack)
- **Annotask**: `http://localhost:5173/__annotask/`

## Features

- **Element inspection** — Click any element to see its source file, line, component, and computed styles
- **Live style editing** — Modify layout, spacing, size, colors, and typography with immediate preview
- **Class editing** — Add, remove, or modify CSS classes on elements
- **Annotation tools** — Pins, arrows, drawn sections, and text highlights to communicate design intent
- **Theme token editing** — Edit design tokens (colors, typography, spacing, borders) from a detected design spec
- **Change reports** — Structured JSON reports of all visual changes, ready for AI agents to consume
- **CLI tool** — `annotask watch` for live streaming, `annotask report` for current state
- **Task pipeline** — Create, review, accept, or deny design change tasks

## How It Works

Annotask runs entirely in your dev server (never in production builds):

1. A **build plugin** transforms source files (Vue SFCs, React JSX/TSX, Svelte) to inject source-mapping attributes (`data-annotask-file`, `data-annotask-line`, `data-annotask-component`)
2. A **shell UI** loads your app in an iframe and provides design tools
3. Changes are tracked and broadcast via **WebSocket** and served via **HTTP API**
4. AI agents or the CLI can consume the change report to patch source files

## CLI

```bash
annotask watch              # Live stream of changes
annotask watch --port=3000  # Custom port
annotask report             # Fetch current report JSON
annotask report | jq        # Pipe to jq
annotask status             # Check connection
```

## API

- `GET /__annotask/api/report` — Current change report
- `GET /__annotask/api/tasks` — Task list
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

## Limitations

- **Dev mode only** — Annotask only runs in dev servers (Vite or Webpack), never in production builds
- **Local only** — API and WebSocket endpoints are unauthenticated (same model as Vite HMR)
- **Source mapping** — Works best with component files (`.vue`, `.tsx`, `.svelte`); dynamic components and render functions may not map correctly

## Development

```bash
pnpm install
pnpm build                   # Build shell + plugin + CLI
pnpm dev:vue-vite             # Start Vue test app with Annotask
pnpm test                     # Run tests
pnpm test:watch               # Watch mode
```

## Project Structure

- `src/plugin/` — Vite plugin (multi-framework transform, toggle button, bridge client)
- `src/server/` — HTTP API, WebSocket server, shell serving, project state
- `src/webpack/` — Webpack plugin and transform loader
- `src/shell/` — Design tool UI (Vue 3 app, pre-built into dist/shell/)
- `src/shared/` — Shared types (postMessage bridge protocol)
- `src/schema.ts` — TypeScript types for change reports
- `src/cli/` — CLI tool for terminal interaction
- `playgrounds/` — Test apps (vue-vite, vue-webpack, react-vite, svelte-vite)

## Troubleshooting

**Elements don't show source info**: Make sure your framework plugin (Vue, React, or Svelte) is installed and the Annotask plugin is listed after it in your Vite config. The transform needs to run before the framework compiler processes the source.

**WebSocket not connecting**: Ensure the dev server is running. The CLI and shell connect to `/__annotask/ws` on the same port as your dev server.

**Changes not appearing in report**: Only style and class changes that differ from computed values are included. If before and after are identical, the change is filtered out.
