# Architecture

## Overview

Annotask is a dev-only system made of five cooperating layers:

```text
app dev server
  -> Annotask plugin / webpack integration
  -> Annotask HTTP API + WebSocket server + MCP endpoint
  -> Annotask shell at /__annotask/
  -> injected bridge client inside the user app
  -> CLI / agent clients talking to the same server
```

The shell loads the user app in an iframe, but almost all interaction goes through a `postMessage` bridge rather than direct DOM access.

## Runtime Pieces

### Plugin Layer

`src/plugin/` handles Vite integration.

Responsibilities:

- inject `data-annotask-*` source anchors into supported source files during dev
- inject the bridge client into HTML responses
- expose runtime handles for framework-specific component rendering helpers
- start the embedded Annotask server when running under Vite
- write `.annotask/server.json` for CLI and agent discovery

Key files:

- `src/plugin/index.ts`
- `src/plugin/transform.ts`
- `src/plugin/bridge-client.ts`
- `src/plugin/toggle-button.ts`

### Webpack Layer

`src/webpack/` provides Webpack support.

Responsibilities:

- pre-loader transform for supported source files
- standalone Annotask server bootstrap
- auto-proxy `/__annotask` routes back into the standalone server

Key files:

- `src/webpack/plugin.ts`
- `src/webpack/loader.ts`

### Server Layer

`src/server/` hosts the backend surface.

Responsibilities:

- task persistence under `.annotask/tasks.json`
- design-spec loading and normalization
- screenshot storage and cleanup
- performance snapshot persistence
- HTTP API routes
- WebSocket broadcast
- workspace discovery
- component scanning and usage scanning
- data-source scanning, binding analysis, and detail lookup
- API schema discovery and endpoint resolution
- code-context helpers

Representative files:

- `src/server/api.ts`
- `src/server/state.ts`
- `src/server/ws-server.ts`
- `src/server/workspace.ts`
- `src/server/workspace-catalog.ts`
- `src/server/component-scanner.ts`
- `src/server/component-scanner-worker.ts` — worker-thread entry for the component scan
- `src/server/component-usage.ts`
- `src/server/component-examples.ts`
- `src/server/data-context.ts`
- `src/server/data-source-scanner.ts`
- `src/server/data-source-details.ts`
- `src/server/api-schema-scanner.ts`
- `src/server/api-schema-resolver.ts`
- `src/server/runtime-endpoints.ts` — runtime endpoint catalog + static-source join helpers
- `src/server/code-context.ts`
- `src/server/validation.ts`
- `src/server/schemas.ts`
- `src/server/agent-spawn.ts` — localhost-only subprocess spawner for local-CLI providers (SSE streaming, run registry, `ANNOTASK_MAX_PERMISSION` ceiling)
- `src/server/agent-configs.ts` — per-persona project directions in `.annotask/agents.json`
- `src/server/agent-detect.ts` — probe which local CLIs are installed and logged in
- `src/server/agent-models.ts` — per-provider model catalog (live probe where supported, curated fallback)
- `src/server/task-thread.ts` — per-task conversation threads (append-only JSONL + SSE)
- `src/server/usage-ledger.ts` — append-only token-usage ledger at `.annotask/usage.jsonl`
- `src/server/wireframe-store.ts` — persisted multi-route wireframe document
- `src/server/draft-edits.ts` — opt-in render-in-place drafts (journaled, hash-guarded revert)
- `src/server/init.ts` — init-wizard scan runner (design spec, agent configs, style guide)
- `src/server/path-safety.ts` — shared path-traversal guard for user-supplied file paths
- `src/server/origin.ts` — origin validation (`isLocalOrigin`, stricter `originMatchesPort`)

The server pre-warms component caches in the background on startup so the first Components page open and the first component-related MCP call do not pay the full scan cost. The component scan runs on a dedicated worker thread (`component-scanner-worker.ts`) so large bursts of synchronous filesystem and regex work do not block the event loop while the API serves task and context requests.

Runtime-observed endpoint data lives alongside the static catalog: the injected bridge client forwards iframe `fetch` / XHR / beacon calls to `POST /__annotask/api/runtime-endpoints`, and `runtime-endpoints.ts` aggregates them per `(origin, method, pattern)` and joins them against static sources and OpenAPI operations on read.

### Embedded Agent Layer

`src/embedded/` lets the shell run apply/init/chat turns through an AI provider without leaving the browser.

Four locally installed agent CLIs are first-class providers — all of them get the same spawn, streaming, permission, and conversation treatment:

- `src/embedded/claude-local-provider.ts` — Claude Code
- `src/embedded/codex-local-provider.ts` — Codex
- `src/embedded/opencode-local-provider.ts` — opencode
- `src/embedded/copilot-local-provider.ts` — GitHub Copilot CLI

They share `src/embedded/cli-local-provider.ts` (spawn-over-HTTP plumbing against `/api/agent/spawn`) and sit alongside direct API providers (`anthropic-provider.ts`, `openai-provider.ts`, `openrouter-provider.ts`, `openai-compatible-provider.ts`, `paperclip-provider.ts`).

Supporting modules:

- `provider.ts` / `provider-factory.ts` / `provider-config.ts` - provider contract, construction, and settings
- `permission-mode.ts` / `permission-mode-flags.ts` - `default` / `plan` / `bypass` modes mapped onto each CLI's native flags
- `persona.ts` - per-task-type agent personas
- `budget-cap.ts` - per-conversation spend cap
- `event-log.ts` / `redaction.ts` - turn event capture with secret redaction

Server-side counterparts live in `src/server/`: `agent-spawn.ts` (allow-listed subprocess spawner, SSE streaming, run registry), `agent-detect.ts`, `agent-models.ts`, `agent-configs.ts`, `task-thread.ts` (per-task conversation persistence), and `usage-ledger.ts` (token spend). Spawn requests pass the same-port origin gate in `origin.ts`, and the server enforces the `ANNOTASK_MAX_PERMISSION` ceiling regardless of what the client asks for.

### MCP Layer

`src/mcp/server.ts` exposes the agent-facing tool surface at `POST /__annotask/mcp`.

Compared with raw HTTP, MCP:

- returns task summaries by default
- strips the shell-only `visual` field
- trims older `agent_feedback` on single-task reads
- validates tool args with shared zod schemas

### Shell Layer

`src/shell/` is a Vue 3 SPA served at `/__annotask/`.

User-facing top-level surfaces:

- **Annotate**
- **Design**
- **Audit**

Internally the Audit tab still uses the `develop` id in `useShellNavigation` to preserve localStorage compatibility.

Current sub-sections:

- Annotate: tasks and annotation workflows
- Design: Tokens, Inspector, Components
- Audit: Accessibility, Data, Libraries, Performance, Errors

Important constraint:

- `App.vue` remains an orchestrator and is not supposed to absorb new business logic

Key composables:

- `useTaskWorkflows` - annotation and task creation flows
- `useSelectionModel` - selected element state, source info, and rect tracking
- `useStyleEditor` - live style/class editing and change recording
- `useShellNavigation` - Annotate / Design / Audit routing
- `useShellTheme` - built-in themes and custom theme CRUD
- `useDesignSpec` - design-spec loading and theme activation helpers
- `useProjectComponents` - Components page data, filters, and usage lookups
- `useDataSources` - Audit data and library views, API schema links, runtime endpoint catalog
- `usePerfMonitor` - performance scans, findings, recordings
- `useErrorMonitor` - console error and warning capture
- `useA11yScanner` - WCAG scanning and fix-task creation
- `useWorkspace` - shell-side workspace and MFE filter state
- `useAnnotationRects` - overlay tracking during scroll and resize

## Workspace-Aware Scanning

Annotask is no longer single-package only.

`src/server/workspace.ts` walks upward from `projectRoot` and detects workspace definitions from:

- `pnpm-workspace.yaml`
- `package.json` `workspaces`
- `lerna.json`

Scanners use that package list to aggregate:

- component-library dependencies across sibling packages
- project data sources across MFEs and shared packages
- in-repo API schemas
- workspace package metadata and configured MFE ids

The shell consumes `/api/workspace` via `useWorkspace` and exposes MFE filters in the Components page and Audit data views.

## Theme And Design Spec Model

The design spec in `.annotask/design-spec.json` is variant-aware.

Important fields:

- `themes[]`
- `defaultTheme`
- token arrays with `values: Record<themeId, string>`
- `cssVar`, `sourceFile`, and `sourceLine` for editable tokens

`ThemePage.vue` creates one `theme_update` task per commit, bundling every token edit in `context.edits[]`. Agents apply those edits to source files and then patch the design spec so the Tokens page hot-reloads consistently.

## Bridge Model

Annotask relies on a `postMessage` bridge so it can support local cross-origin iframes and MFE setups.

Bridge responsibilities include:

- element hit-testing and selection
- hover and click events
- style and class application
- rendered-file discovery
- layout overlay scans
- accessibility and focus-order helpers
- route and render-change notifications

Key client code lives in:

- `src/plugin/bridge-client.ts`
- `src/plugin/bridge/*`
- `src/shell/services/iframeBridge.ts`

## Data Flow

### Annotation Or Edit

```text
user action in shell
  -> bridge resolves element and source location
  -> shell packages task context
  -> task is written under .annotask/
  -> API, WebSocket, CLI, and MCP consumers can read it
```

### Agent Loop

```text
agent fetches task summaries
  -> locks task with in_progress
  -> optionally fetches screenshot / code context / components / data context / API schemas
  -> edits source code
  -> marks task review-ready with a resolution note
  -> reviewer accepts, denies, answers questions, or sees blocked reason
```

### Audit Findings

```text
shell scan or monitor detects issue
  -> shell packages contextual details
  -> creates a11y_fix / error_fix / perf_fix task
  -> normal task pipeline takes over
```

## Persistence

Annotask stores state under `.annotask/`.

Common files:

- `tasks.json`
- `design-spec.json`
- `server.json`
- `performance.json`
- `screenshots/`
- `agents.json` - per-persona project directions and provider preferences
- `wireframe.json` - multi-route wireframe document
- `usage.jsonl` - append-only token-usage ledger
- `conversations/<taskId>.jsonl` - append-only per-task conversation threads
- `interaction-history/<taskId>.json` - per-task user-trace sidecars
- `rendered-html/<taskId>.json` - per-task `outerHTML` sidecars

Writes are atomic. Task mutations serialize through a lock in `state.ts`, and screenshot cleanup happens only after a successful task write.

## Build Outputs

`pnpm build` produces:

- prebuilt shell assets in `dist/shell/`
- plugin, server, standalone-server, and webpack bundles in `dist/`
- CLI bundle in `dist/cli.js`
- webpack loader bundle in `dist/webpack-loader.js`
- component scanner worker bundle in `dist/component-scanner-worker.js`
- vendored browser dependencies in `dist/vendor/`

The shell build runs first because the server serves `dist/shell/` as static assets.
