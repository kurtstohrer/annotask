# Architecture

## Overview

Annotask is a Vite dev-server plugin with four modules:

```
┌─────────────────────────────────────────────────────┐
│  Vite Dev Server                                    │
│                                                     │
│  ┌──────────────┐  ┌────────────┐  ┌─────────────┐ │
│  │  Transform    │  │  API       │  │  WebSocket  │ │
│  │  Plugin       │  │  Middleware │  │  Server     │ │
│  │  (SFC attrs)  │  │  (REST)    │  │  (live)     │ │
│  └──────────────┘  └────────────┘  └─────────────┘ │
│                                                     │
│  ┌──────────────────────────────────────┐           │
│  │  Shell UI (Vue 3 SPA at /__annotask/)│           │
│  │  ┌────────────────────────────┐      │           │
│  │  │  User's App (iframe)       │      │           │
│  │  └────────────────────────────┘      │           │
│  └──────────────────────────────────────┘           │
│                                                     │
│  ┌──────────────┐                                   │
│  │  CLI          │ (external process, connects via  │
│  │  (annotask)   │  HTTP/WS to the same server)    │
│  └──────────────┘                                   │
└─────────────────────────────────────────────────────┘
```

## Modules

### Plugin (`src/plugin/`)

Two Vite plugins registered together:

1. **`annotask:transform`** (`enforce: 'pre'`, `apply: 'serve'`)
   - Transforms `.vue` SFC templates before the Vue compiler sees them
   - Injects `data-annotask-file`, `data-annotask-line`, `data-annotask-component` attributes onto every HTML element
   - Injects a toggle button script into the HTML page
   - Exposes Vue runtime and registered components on `window` for the shell to use

2. **`annotask:serve`** (`apply: 'serve'`)
   - `configureServer` hook sets up:
     - HTTP API middleware (`src/server/api.ts`)
     - WebSocket server (`src/server/ws-server.ts`)
     - Shell static file serving (`src/server/serve-shell.ts`)
     - Design spec and task file management (`src/server/state.ts`)

Key files:

| File | Responsibility |
|------|---------------|
| `src/plugin/index.ts` | Plugin entry, registers both plugins |
| `src/plugin/transform.ts` | SFC template parser and attribute injector |
| `src/plugin/toggle-button.ts` | Injected floating button HTML |
| `src/plugin/bridge-client.ts` | postMessage bridge script injected into the app |
| `src/server/index.ts` | Server factory (`createAnnotaskServer`) |
| `src/server/api.ts` | REST endpoints under `/__annotask/api/` |
| `src/server/ws-server.ts` | WebSocket broadcast at `/__annotask/ws` |
| `src/server/serve-shell.ts` | Static file server for pre-built shell |
| `src/server/state.ts` | Project state (tasks, design spec, config files) |
| `src/server/discovery.ts` | `.annotask/server.json` read/write for CLI discovery |
| `src/server/standalone.ts` | Standalone HTTP server (used by Webpack plugin) |

### Shell (`src/shell/`)

A Vue 3 SPA that serves as the design tool UI. Pre-built into `dist/shell/` during the build step and served by the plugin at `/__annotask/`.

The shell loads the user's app in an iframe (same-origin, so full DOM access) and provides:

- Element inspection (click to select, see source mapping)
- Style editing (layout, spacing, size, appearance controls)
- Class editing (add/remove CSS classes)
- Annotation tools (pins, arrows, drawn sections, sticky notes, text highlights)
- Theme page (edit design tokens from the design spec)
- Task management (create, review, accept/deny tasks)

Key composables:

| Composable | Purpose |
|------------|---------|
| `useStyleEditor` | Tracks style/class changes, builds the report |
| `useAnnotations` | Manages pins, arrows, sections, highlights, notes |
| `useIframeManager` | Cross-iframe DOM access and element resolution |
| `useDesignSpec` | Fetches and caches the design spec |
| `useInteractionMode` | Switches between select (design) and interact (app) modes |
| `useCanvasDrawing` | Arrow and section drawing on overlay canvas |
| `useLayoutOverlay` | Flex/grid layout visualization |
| `useElementClassification` | Semantic role detection for selected elements |
| `useTasks` | Task CRUD and lifecycle management |

### Schema (`src/schema.ts`)

TypeScript types defining the report contract. This is the canonical source of truth for:

- `AnnotaskReport` — The change report structure
- `AnnotaskChange` — Discriminated union of all change types
- `AnnotaskTask` — Task in the review pipeline
- `AnnotaskDesignSpec` — Design token specification
- `DesignSpecToken` — Individual token with role, value, and source tracking

### Webpack (`src/webpack/`)

Webpack 5 plugin providing the same functionality as the Vite plugin:

- **`AnnotaskWebpackPlugin`** — registers a pre-transform loader and starts a standalone HTTP server
- **`src/webpack/loader.ts`** — SFC transform loader (runs before `vue-loader`)
- Uses `src/server/standalone.ts` to start an independent HTTP + WebSocket server (default port 24678)

### CLI (`src/cli/`)

Standalone Node.js binary (`annotask`) that connects to a running dev server (Vite or Webpack):

- `watch` — WebSocket client that streams changes in real-time
- `report` — HTTP GET to fetch current report JSON
- `status` — Health check
- `init-skills` — Install AI agent skill files into the project

## Cross-origin support (postMessage bridge)

Annotask uses a **postMessage bridge** instead of direct iframe DOM access. This enables cross-origin iframes, which is critical for Single-SPA microfrontend architectures where the MFE's Vite dev server is on a different port than the root shell.

**Architecture:**
- A **client bridge script** (`src/plugin/bridge-client.ts`) is injected into the user's app alongside the toggle button
- The client script handles all DOM interactions: hover, click, style reads/writes, element resolution, layout scanning
- The **shell bridge service** (`src/shell/services/iframeBridge.ts`) communicates via `window.postMessage`
- Elements are identified by **eid** (element ID) strings, stored in a `WeakRef`-backed registry in the client

**Message flow:**
- Shell sends commands: `resolve:at-point`, `style:apply`, `class:set`, `layout:scan`, etc.
- Client pushes events: `hover:enter`, `click:element`, `route:changed`, etc.
- Request/response pairs share an `id` field with timeouts
- High-frequency events (hover) use `requestAnimationFrame` throttling

## Data flow

### Style editing

```
User clicks element in shell
  → Client script detects click, resolves source mapping, pushes click:element event
  → Shell receives event via postMessage, updates selection model (eid-based)
  → User edits style in property panel
  → Shell sends style:apply command to client via postMessage
  → Client applies inline style, returns before value
  → Shell records change, broadcasts via WebSocket
  → CLI / API consumers receive the change
```

### Task pipeline

```
User creates annotation/edit in shell
  → Task written to .annotask/tasks.json and broadcast via WS
  → AI agent fetches tasks via GET /api/tasks
  → Agent applies change to source code
  → Agent PATCHes task status to "review"
  → User reviews in Annotask, accepts or denies
  → Denied tasks get feedback field, go back to pending
```

### Source mapping

The transform plugin parses SFC `<template>` blocks as raw strings (not AST) using a character-level scanner. For each opening HTML tag, it appends:

```html
<div data-annotask-file="src/components/Foo.vue"
     data-annotask-line="5"
     data-annotask-component="Foo">
```

The scanner handles:
- Quoted attribute values (won't break on `>` inside quotes)
- Backtick template literals
- Self-closing tags
- Vue directive syntax

Line numbers are template-relative (line 1 = first line of `<template>`).

## Build pipeline

```
pnpm build
  ├── build:shell    →  vite build (src/shell/ → dist/shell/)
  └── build:plugin   →  tsup:
                          src/plugin/index.ts    → dist/index.js      (Vite plugin)
                          src/server/index.ts    → dist/server.js     (server API)
                          src/server/standalone.ts → dist/standalone.js (standalone server)
                          src/webpack/index.ts   → dist/webpack.js    (Webpack plugin)
                          src/webpack/loader.ts  → dist/webpack-loader.js (Webpack loader)
                          src/cli/index.ts       → dist/cli.js        (CLI binary)
```

The shell is pre-built into `dist/shell/` so the plugin can serve it as static files without requiring Vue as a runtime dependency for consumers.
