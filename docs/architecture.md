# Architecture

## Overview

Annotask is a dev-only system made of five major pieces:

```text
app dev server
  -> Annotask plugin / webpack integration
  -> Annotask HTTP API + WebSocket server + MCP endpoint
  -> Annotask shell at /__annotask/
  -> injected bridge client inside the user app
  -> CLI / agent clients talking to the same server
```

The shell loads the user app in an iframe, but interaction is mediated through a bridge so same-origin access is not required.

## Main Modules

### Plugin layer

`src/plugin/` instruments supported frameworks during development.

Responsibilities:

- inject source-mapping attributes into rendered markup
- inject the bridge client and toggle button into the app
- expose enough runtime metadata for selection, inspection, and highlighting
- start the Annotask server surface when running under Vite

Key files:

| File | Responsibility |
|------|---------------|
| `src/plugin/index.ts` | Vite plugin entry |
| `src/plugin/transform.ts` | Source-mapping attribute injection |
| `src/plugin/bridge-client.ts` | In-app bridge client |
| `src/plugin/toggle-button.ts` | Floating toggle launcher |

### Server layer

`src/server/` hosts the product back end.

Responsibilities:

- task persistence and atomic writes
- screenshot storage
- HTTP API routes
- WebSocket broadcast
- design-spec loading
- component scanning
- data-source scanning and binding analysis
- API schema scanning and endpoint resolution
- source-context helpers

Representative files:

| File | Responsibility |
|------|---------------|
| `src/server/api.ts` | HTTP routes under `/__annotask/api` |
| `src/server/ws-server.ts` | WebSocket transport |
| `src/server/state.ts` | Task and design-spec state |
| `src/server/component-scanner.ts` | Component-library catalog |
| `src/server/component-examples.ts` | In-repo component examples |
| `src/server/data-context.ts` | Task/file data-context resolution |
| `src/server/data-source-scanner.ts` | Project data-source catalog |
| `src/server/data-source-details.ts` | Definition-level data-source detail |
| `src/server/api-schema-scanner.ts` | OpenAPI, GraphQL, tRPC, JSON Schema discovery |
| `src/server/api-schema-resolver.ts` | Concrete endpoint matching |
| `src/server/code-context.ts` | Source excerpt and drift hash |

### MCP layer

`src/mcp/server.ts` exposes the agent-facing tool surface at `POST /__annotask/mcp`.

The MCP server is intentionally close to the HTTP API but not identical. It:

- returns task summaries by default to reduce token usage
- strips shell-only fields such as `visual`
- trims old `agent_feedback` exchanges
- adds tool-focused argument validation

### Shell layer

`src/shell/` is a Vue 3 SPA served at `/__annotask/`.

Current top-level surfaces:

- **Editor**: annotations, screenshots, viewport preview, pending-task creation
- **Design**: tokens, inspector, components
- **Develop**: a11y, data, libraries, performance, errors

Important constraints:

- `App.vue` is the orchestrator, not a business-logic dumping ground
- new shell features should usually land in a composable under `src/shell/composables/`

Key composables:

| Composable | Purpose |
|------------|---------|
| `useTaskWorkflows` | Annotation-to-task creation flows |
| `useSelectionModel` | Selected element state and source info |
| `useStyleEditor` | Live style/class edits and change recording |
| `useShellNavigation` | Editor / Design / Develop routing |
| `useScreenshots` | Snipping workflow and uploads |
| `useA11yScanner` | Accessibility scan and fix-task creation |
| `useProjectComponents` | Components page and on-page highlighting |
| `useDataSources` | Data view, schema catalog, and `api_update` task creation |
| `usePerfMonitor` | Web Vitals, scans, recordings, findings |
| `useErrorMonitor` | Error and warning capture |
| `useShellTheme` | 18 built-in themes plus custom theme CRUD |
| `useAnnotationRects` | Keeps overlays aligned during scroll/resize |
| `useAutoScan` | Debounced perf auto-scan on view or route changes |

### Shared schema

`src/schema.ts` is the main contract definition.

It defines:

- report and change types
- task types and statuses
- design spec structure
- element, component, and data context shapes
- performance and screenshot metadata
- API schema and data-source helper types

## Bridge Model

Annotask uses a `postMessage` bridge rather than direct DOM calls from the shell.

Why:

- works for cross-origin iframe setups
- supports multi-server MFE development
- keeps DOM interaction logic close to the app runtime

Bridge responsibilities include:

- point-to-element resolution
- hover and click events
- style and class application
- layout scans
- rendered-file discovery
- project-component listing
- accessibility and focus-order helpers

## Data Flow

### Annotation or design edit

```text
user action in shell
  -> bridge resolves target element
  -> shell captures source info and optional context
  -> task is written to .annotask/tasks.json
  -> API / WebSocket / MCP consumers see the new task
```

### Agent workflow

```text
agent fetches task summaries
  -> locks task with in_progress
  -> optionally fetches screenshot / code context / component examples / data context / API schema
  -> edits source code
  -> marks task review with a resolution note
  -> user accepts, denies, answers questions, or reviews blocked reason
```

### Audit workflow

```text
shell scan or monitor detects issue
  -> shell packages finding context
  -> creates a11y_fix / error_fix / perf_fix / api_update task
  -> same task pipeline takes over
```

## Persistence

Annotask stores state under `.annotask/`.

Common files:

- `tasks.json`
- `design-spec.json`
- `server.json`
- `screenshots/`

Writes are atomic so task updates do not corrupt the store on concurrent activity.

## Webpack Support

`src/webpack/` provides Webpack 5 support with a standalone Annotask server.

Key pieces:

- `AnnotaskWebpackPlugin`
- transform loader
- standalone server bootstrap

The goal is feature parity with the Vite path wherever possible.

## Build Outputs

`pnpm build` produces:

- prebuilt shell assets in `dist/shell/`
- plugin and server bundles
- webpack integration bundles
- CLI bundle
- vendored browser dependencies such as `axe-core` and `html2canvas`
