# Contributing to Annotask

## Architecture

Annotask has six main modules:

| Module | Purpose |
|--------|---------|
| `src/plugin/` | Vite integration, SFC transform, toggle button, bridge client |
| `src/server/` | HTTP API middleware, WebSocket server, shell serving, project state |
| `src/webpack/` | Webpack plugin and SFC transform loader |
| `src/shell/` | Design tool UI: Vue 3 app served at `/__annotask/` |
| `src/cli/` | Terminal tool: `annotask watch`, `annotask report`, `annotask init-skills` |
| `src/mcp/` | MCP server (Streamable HTTP transport, tools for tasks/design spec/screenshots) |
| `src/schema.ts` | TypeScript types defining the report contract |

The plugin injects source-mapping attributes into Vue SFC templates at compile time. The shell loads the user's app in an iframe and uses these attributes to map DOM elements back to source files.

## Build

```bash
pnpm install              # Install dependencies
pnpm build                # Build everything (shell + plugin + CLI)
pnpm build:shell          # Build shell UI only
pnpm build:plugin         # Build plugin + CLI only
```

## Test

```bash
pnpm test                 # Run all tests
pnpm test:watch           # Watch mode
```

Tests use [Vitest](https://vitest.dev/). Shell tests run in jsdom; plugin tests run in Node.

## Report Contract

`src/schema.ts` is the canonical schema for change reports. Any runtime change must conform to these types. The `shapeChange()` function in `useStyleEditor.ts` ensures report output matches the schema before broadcasting.

Currently implemented change types:
- `style_update` — Inline style changes
- `class_update` — CSS class changes
- `component_insert` — Drag-and-drop component insertion
- `component_move` — Element reordering
- `annotation` — Design intent notes, pins, arrows, sections

Schema-only types (not yet emitted at runtime):
- `component_delete`
- `scoped_style_update`
- `prop_update`

## Framework Support

Annotask supports **Vue 3**, **React**, **Svelte**, and **SolidJS**. The transform layer (`src/plugin/transform.ts`) has per-framework extraction logic that feeds into a shared HTML/JSX attribute injection scanner. SolidJS and React share the same JSX transform path. The bridge client detects the active framework at runtime for component mounting.

## Feature Freeze

No new features should be added until the stabilization exit criteria from `plan/improvements.md` are met:

1. Style/class edits produce correct before/after reports
2. Source anchors point to correct file and line
3. Runtime reports validated against schema
4. No Annotask instrumentation in production builds
5. Core flow covered by automated tests + CI
6. README explains what works, what's experimental, and how to verify
