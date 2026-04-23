# Changelog

All notable changes to this project are documented here. Versions follow [Semantic Versioning](https://semver.org/). Dates are ISO 8601.

## [0.2.5] - 2026-04-22

### Fixed
- Highlight tool selections land on the actual text (not 40px above) when the shell runs cross-origin from the app — the standalone webpack URL on a separate port, for example. The shell now pushes its iframe `getBoundingClientRect()` to the bridge via `frame:offset` on bridge ready, window resize, scroll, and layout changes, so the plugin has a real offset to apply when `window.frameElement` is inaccessible.

## [0.2.4] - 2026-04-22

### Changed
- Component library scan runs on a dedicated worker thread. Large bursts of synchronous filesystem and regex work no longer block the main event loop while the API is serving task and context requests. A fresh catalog triggers a `components:updated` WebSocket broadcast so the shell's Components tab refreshes without a manual reload.
- `/annotask-apply` SKILL.md trimmed to the core apply loop. Per-type guidance for `a11y_fix` and `theme_update` moved into new `A11Y_RULES.md` and `THEME_UPDATE.md` companion playbooks, read on demand.
- "Tab order" toggle moved from inside the A11y panel into the toolbar so the Audit header stays consistent with other scan/recording controls.
- Data view tabs reordered to Network / Hooks / APIs, with Network selected by default.

### Fixed
- Transform now strips inline `type` modifiers and accepts camelCase identifiers in imports, so libraries that ship lowercase exports get `data-annotask-source-module` attributes and highlight correctly.
- Vue `<component :is="x">` unwraps to the bound identifier so dynamic components get the right source-module attribute.

### Removed
- `src/server/component-context.ts` (and its test). The worker-backed catalog replaces the inline best-effort component enrichment on task create.

## [0.2.3] - 2026-04-22

### Added
- Runtime endpoint monitoring. The injected bridge client forwards the iframe's `fetch` / XHR / beacon calls to `POST /__annotask/api/runtime-endpoints`, where they're aggregated per `(origin, method, pattern)` and joined against static sources and OpenAPI operations on read. Surfaced via `annotask_get_runtime_endpoints` (MCP), `annotask runtime-endpoints` (CLI, with `--orphans-only` and `--route`), and the Audit data view.

## [0.2.2] - 2026-04-21

### Fixed
- Data-source scanner now dedups fetch entries by `(method, endpoint)` instead of endpoint alone, so distinct verbs on the same URL each get their own catalog row.
- `ThemePage` corrected the prop type on `activateColorScheme`.

## [0.2.1] - 2026-04-21

### Fixed
- Data-source scanner resolves `fetch()` URL constants, so calls built from a top-level `const API_URL = '...'` show up with the real endpoint in the catalog and in per-task `data_context`.

## [0.2.0] - 2026-04-21

### Added
- Multi-MFE stress-test playground at `playgrounds/stress-test/` with real `single-spa` host loading, a FastAPI/Node/Go/Rust/Java/Laravel service tier, and Playwright coverage for the lab.
- Per-MFE `/annotask-init` and `/annotask-apply` skill scaffolds, plus `just react`/`just svelte`/`just vue`/`just mfe` recipes for the simple playgrounds.
- `docs/data-source-discovery.md` — how the data-source scanner works, including the binding-graph second layer.

### Changed
- Playgrounds relocated from `playgrounds/` to `playgrounds/simple/` to make room for the stress-test tier.
- Solid JSX integration moved attribute injection from the transform into the load hook so framework-specific attribute handling stays in one place.
- htmx single-spa fragment fetch and Blade fallback handle Laravel being down gracefully.

## [0.1.0] - 2026-04-17

Initial public release.

## [Unreleased]

### Added
- **`src/server/validation.ts`** — canonical home for screenshot filename regex, valid task statuses, allowed status transitions, POST/PATCH field whitelists, and `agent_feedback` schema. Replaces ad-hoc duplication across the HTTP API, MCP server, and state layer.
- **`src/server/schemas.ts`** — zod schemas for every HTTP body and MCP tool argument set. The HTTP API and MCP server now parse at the boundary via `schema.safeParse()` instead of ad-hoc type checks.
- **`AnnotaskServer.flush()`** — drain pending task/perf writes before shutdown. `startStandaloneServer`'s `close()` is now async and flushes before closing.
- **`scripts/copy-vendor.mjs`** — replaces the inline `cp` chain in `pnpm build:vendor`. Fails the build loudly if an upstream package renames or drops a vendored file.
- **`src/shell/utils/routes.ts`** + **`src/shell/composables/useLocalStorageRef.ts`** — shared helpers that replace per-site `normalizeRoute` copies and `ref + watch + localStorage` triplets previously inlined in `App.vue`.
- **`docs/REVIEWING.md`** — PR review checklist with the invariants the codebase needs to keep.
- **`CHANGELOG.md`** (this file) and a **Release Process** section in `CONTRIBUTING.md`.
- Unit tests for `createProjectState` (concurrent PATCH, concurrent delete+update, screenshot cleanup, path-traversal refusal, disk round-trip), every `validation.ts` export, and `normalizeRoute`. Test count: 128 → 160.
- Optional `code` field on API error responses (keeps legacy `error: string` intact).
- Zod (`^4.3.6`) as a runtime dependency.

### Changed
- **BREAKING (internal):** `ProjectState.addTask/updateTask/deleteTask` are now `async`. Callers inside annotask already `await` them; any external consumer of `createProjectState` must await.
- Task mutations serialize through a single in-process mutex (`withTaskLock`). Concurrent PATCH requests to disjoint fields of the same task no longer lose writes.
- Screenshot unlinks (on `accepted` or delete) are chained after the successful write. A failed write no longer leaves an orphan screenshot.
- Screenshot upload filenames use `crypto.randomBytes(8)` (16 hex chars) instead of `Math.random().toString(36).slice(2,7)` — no more 5-char collision window.
- `fs.watch` on `.annotask/` no longer invalidates the task cache on our own atomic writes (tracked via `selfWriteUntil` window).
- WebSocket server enforces a 1 MiB per-frame size cap (`maxPayload`).
- `Cache-Control` on screenshot responses is now `private` instead of `public`.
- `server.json` is written with mode `0o600` — other users on shared machines can no longer read the live PID + port.
- Component scanner caches now carry a 5-minute TTL and coalesce concurrent scans through a single in-flight promise.
- MCP batch dispatch isolates per-item exceptions so one bad request no longer truncates the response array.
- MCP `annotask_update_task` runs new `agent_feedback` entries through the shared zod schema instead of a tool-local duplicate.
- MCP server version is baked from `package.json` at build time (`__ANNOTASK_VERSION__`) instead of a hardcoded `'0.0.29'`.
- `iframeBridge` no longer posts to `targetOrigin='*'`. The shell derives the iframe's origin from `iframe.src`/`contentWindow.location.origin` and refuses to send until it knows a concrete origin. Request IDs are now monotonic.
- `useAnnotationRects` and `useSelectionModel` rAF loops skip work while `document.hidden` is true.
- `useErrorMonitor` caps its buffer at 256 entries (oldest discarded, dedup keys tracked).
- `usePerfMonitor.perfFindings` caps at 128 entries (worst severities kept).
- `package.json`: added `"sideEffects": false` (tree-shaking); excluded sourcemaps from the published tarball; pinned `axe-core` and `html2canvas-pro` to exact versions since both are vendored into `dist/vendor/`.
- `.gitignore`: ignores `.claude/worktrees/`.

### Removed
- `src/shell/composables/useThemeMode.ts` — the deprecated wrapper around `useShellTheme` was unused at any call site.

### Security
- `annotask_get_screenshot` MCP tool now routes `task.screenshot` through `isSafeScreenshot` before path construction, closing a path-traversal hole for maliciously constructed task records.
- Added `originMatchesPort` helper for endpoints that want a stricter same-port origin check (available for future hardening; not wired by default since the shell can be served from a different port than the user's app).

### Breaking

- **API error shape.** Responses now use `{ error: { code, message } }` instead of a bare `error: string`. The `code` is one of `invalid_json`, `body_too_large`, `body_not_object`, `validation_failed`, `invalid_transition`, `forbidden_origin`, `not_found`. `PATCH`/`DELETE` on a missing task now returns HTTP 404 (previously 200 with a magic `{error: 'Task not found'}` string). The CLI and API tests have been updated accordingly.

### Extracted

- `src/shell/composables/useChangeHistory.ts` — `doUndo`, `doClearChanges`, `commitChangesAsTask`, and `selectionChanges` moved out of `App.vue`. App.vue is now 2012 lines (from 2142 at the start of the cleanup).
- `src/shell/components/PerfFindingDetail.vue` + `PerfResourceTables.vue` — pulled out of `PerfTab.vue`, which is now 199 lines (from 463).
- `src/shell/components/TaskAgentFeedback.vue`, `TaskInteractionHistory.vue`, `TaskJsonView.vue` — pulled out of `TaskDetailModal.vue`, which is now 791 lines (from 966).
- `src/shell/components/ThemeLibrariesTab.vue`, `ThemeAddTokenForm.vue` — pulled out of `ThemePage.vue`, which is now 819 lines (from 865). The add-token form, previously duplicated 5× with minor placeholder variations, is now one component reused across colors / families / scale / spacing / radius.
