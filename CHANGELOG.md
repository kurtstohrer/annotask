# Changelog

All notable changes to this project are documented here. Versions follow [Semantic Versioning](https://semver.org/). Dates are ISO 8601.

## [0.4.2] - 2026-06-23

### Added
- **Micro-frontend wireframes.** The snapshot wireframe now decomposes a single-spa / Module-Federation / qiankun route into per-MFE blocks instead of one opaque box per micro-frontend. The capture walker — extracted into a tested `src/plugin/bridge/wireframe-walker.ts` — descends through the un-instrumented mount container into each MFE's instrumented content, anchors every block DOWN to its own MFE source (never the host shell that authors the mount `<div>`), carries the owning MFE end-to-end (`anchor.mfe` / `direction.mfe`), and budgets blocks per MFE so a busy trailing MFE isn't dropped by the cap. Non-MFE apps take a byte-identical legacy path. Verified live against a 6-MFE single-spa stress app.
- **Deep-dive into nested elements.** Explode is re-enabled: double-click a captured block to break it into its direct children (repeat to go deeper). Re-resolution is MFE-scoped, so a package-local path shared across MFEs (`src/App.tsx`) lands on the right one. Hovering a block previews its children as outlines — purely informational; it never captures or explodes. Dragging an exploded shell carries its children with it.
- **Scan affordance on capture.** Capturing now sweeps a scan line over the still-visible live iframe instead of showing a blank screen.

### Fixed
- **Hash-routed apps no longer freeze the wireframe (and tasks/annotations) to one route.** Route tracking compared only `location.pathname` (always `/` under hash routing) and `normalizeRoute` stripped the hash, so single-spa / hash-history routes all collapsed into one bucket — the wireframe showed a stale capture and needed a manual Recapture on every route change. The bridge now reports `pathname + hash` and `normalizeRoute` keeps hash ROUTES (`#/react`) while still dropping plain scroll anchors (`#section`), so changing route re-keys the canvas and auto-captures the new route.
- **Cross-MFE apply and byte-exact undo.** Captured MFE anchors are rewritten to host-resolvable `../mfe-x/src/...` paths and the file-snapshot store is workspace-aware, so the embedded agent grounds and edits the correct package and undo/discard stay byte-exact even when two MFEs expose the same package-local path. A snapshot target that escapes containment is now skipped rather than aborting the whole batch.

## [0.4.1] - 2026-06-23

### Fixed
- **The selected provider now actually applies the task.** Built-in agent personas hard-coded `claude-local`, so every apply/seed run spawned `claude` regardless of the provider you picked in Settings → Providers — surfacing as `spawn claude ENOENT` when claude wasn't installed (e.g. you'd selected Copilot). Built-in personas now inherit the global active provider; an explicit per-persona pin in `.annotask/agents.json` still wins. Verified live across all four CLIs (claude/codex/opencode/copilot).
- **Per-agent provider/model pins persist.** Setting a persona's model in Settings → Agents was silently wiped whenever the provider's live model catalog couldn't be enumerated (Copilot's interactive-only picker is the canonical case) — and a saved value displayed as empty. The model field now keeps and shows the saved value; a stale id from a *different* provider is cleared on provider change instead, never on catalog-fetch failure.
- **Reloading the page no longer destroys an in-flight apply.** An applying CLI was bound to the browser tab: a reload tore down the SSE, killed the child mid-edit, and reverted the task to `pending`. The spawn server now keeps a task-bearing run alive across a client disconnect (detach grace) and finalizes it on the child's own exit — a clean exit lands the task in `review`, an interrupted/failed run reverts to `pending`. The client no longer reverts the task on `pagehide` and warns before an accidental reload. A stale orphan-finalize can no longer clobber a newer run for the same task.
- **Auto-run reliability.** The headless auto-run driver logs when its single-run guard blocks a drain (previously silent), and bounds each run so a hung provider can't pin the queue and stall every later task.
- **Conversation rendering.** Agent messages now style the full Markdown surface (lists, headings, blockquotes, links, tables) instead of only paragraphs/code; wide tool output and long tokens no longer scroll the whole panel (`min-width: 0` + code wrapping); the "agent paused for input" banner label meets contrast; and rendered links open in a new tab with `rel="noopener"`.

### Changed
- **Seed prompt carries the task inline.** Apply runs now embed a compact `Task grounding` block (file/line/component/route + per-type context, via the shared task-summary) in the seed prompt, so the agent applies directly instead of reflexively calling `annotask_get_task`. Heavy fields (screenshot, rendered HTML, interaction history) stay behind their MCP tools.

## [0.4.0] - 2026-06-22

### Fixed
- **Apply/undo lifecycle no longer wedges.** A crash, aborted run, server restart, orphan reconcile, or an agent that pauses at `needs_info` / is `denied` used to strand the snapshot batch as `running` and the session entries as `applying` — permanently disabling Undo, Discard, AND re-apply at once, and leaving the wireframe canvas locked at `building` forever. Every terminal transition (HTTP and the server-side orphan/boot sweep) now routes through one shared closure that seals the batch, releases the entries, and unlocks the canvas. `applyInFlight` keys off the (always-sealed) batch status, so undo/discard re-enable as soon as the agent stops.
- **Undo is byte-exact across the agent's whole footprint.** Previously only the *predicted anchor* files were snapshotted, so the freeform agent's edits to shared layouts / imported children / global CSS were silently un-reverted. In a git project the engine now captures a pre-apply baseline (`git stash create`) and, at seal, folds every tracked file the agent actually touched into the batch (pre-apply bytes from `git show`). An agent-**deleted** file is recreated from its held bytes on undo (it used to vanish despite a held copy). Non-git projects keep anchor-only coverage with a documented limitation.
- **Retry re-verifies.** Denying and re-running an apply now re-stamps its entries so the next review re-checks them, instead of showing the first run's stale written/failed verdicts.
- **Anchorless wireframe blocks no longer crash the apply.** A captured block with no `data-annotask-*` ancestor (file `''`) used to mint the task and then throw in `snapshotFiles`, stranding an orphan task with no batch. Empty anchors are filtered from the snapshot set; the directions still ride the task (screenshot-anchored).
- **`needs_info` answers reach the agent.** On resume, the seed prompt now quotes the answered clarifications inline, so a no-MCP embedded agent doesn't loop asking the same question.
- **Cross-tab safety.** When a second tab loses the spawn race (409 `task_already_running`), it no longer reverts the *winning* tab's live run to pending — the losing run is a benign no-op.
- **Wireframe schema migration.** `wireframe.json` now runs through a migration shim before validation, so a future schema bump (or a legacy version-less doc) upgrades in place instead of silently wiping every saved wireframe.

### Changed
- **Wireframe surface reduced for this release.** Data binding (picker, shape drill-down, prop→field map, loop repeat) and explode-to-children are gated off (`src/shell/wireframeFeatures.ts`) while the binding shape-confidence honesty ladder is reworked; existing persisted bindings still render read-only. Capture/sketch/directions and the implement loop are unchanged.
- **Embedded-agent cost guard.** Per-USD budget caps stay out (pricing isn't portable across the local-CLI / HTTP provider matrix); the idle + max-duration watchdogs are the runaway guard. The dead `BudgetCap` module was removed and the stale 0.3.0 CHANGELOG "budget cap" wording corrected.
- **Security disclosure.** SECURITY.md now states the out-of-box posture explicitly (no permission ceiling by default; same-origin app code can drive agents), the README gained a Security section, and the dev server prints a loud warning when it binds beyond loopback (`vite --host`).
- Wireframe capture/enter errors surface in an app-level banner instead of flashing and vanishing when the canvas fails to mount.

### CI
- Added a secret-gated, schedule/dispatch-only `live-cli` job that runs the apply→write→verify loop against a real CLI — the per-PR suites cover the server lifecycle/undo logic deterministically.

## [0.3.0] - 2026-06-17

### Added
- **Embedded local-CLI agents.** All four local agent CLIs — claude, codex, opencode, and copilot — are first-class providers, plus HTTP API providers (Anthropic, OpenAI-compatible, OpenRouter). Runs are spawned as same-port-origin-gated SSE under an `ANNOTASK_MAX_PERMISSION` ceiling with redaction, and are bounded by idle + max-duration watchdogs (per-USD caps were dropped — pricing isn't portable across the local-CLI/HTTP provider matrix); a tabbed Settings overlay configures providers, models, effort, and per-persona project directions (`.annotask/agents.json`). Per-task conversation history persists to `.annotask/conversations/<taskId>.jsonl` and stays in sync across the shell Conversation tab, MCP readers, and the terminal for every provider.
- **Wireframing — freeze, sketch, real.** A route can be frozen into a manipulable snapshot canvas (`wireframe:capture` rasterizes the page into per-block html2canvas captures, each carrying its `data-annotask-file/-line` source anchor). The canvas supports drag (snap/align guides), 8-handle resize, marquee/shift-click multi-select with group move, arrow-key nudge, soft-delete/undelete, duplicate, undo/redo + z-index, notes, double-click explode-to-children, place-first palette-component placement with an inline configure popover (props, data binding, loop repetition, live regenerated snapshot on the app-true surface), and drawn sections (a labeled box with an optional markdown spec and a REAL data-source binding with shape drill-down). State persists per-route in `.annotask/wireframe.json` (snapshot PNGs under `.annotask/wireframe-snapshots/`, orphans GC'd at boot) and survives F5. "Implement this wireframe" diffs the sketch into anchored `wireframe_direction` entries, composes a labeled before/after, and drives the embedded agent through the apply loop.
- **Wireframe data binding.** Components and drawn sections bind to REAL catalog data sources (`GET /api/data-source-shape`) and drill into the resolved shape — into an OpenAPI/GraphQL/tRPC response (`shape_source: 'api-schema'`), a regex-inferred return type (`'source-details'`), or honest free-text (`'none'`). The binding (`name`, `path`, `fields`, `shape_source`) rides the add direction so the agent wires the real hook instead of guessing.
- **Design-session apply loop + byte-exact reversibility.** Design-tool edits journal to `.annotask/design-session.json`; "Apply now" snapshots every touched file BEFORE the agent runs (`.annotask/file-snapshots.json`), mints ONE `wireframe_apply` task, and the embedded agent writes the source. Accept commits the bytes; "Undo last apply" restores that batch's pre-apply bytes; "Discard session" restores every touched file to its session base — all hash-guarded so a file edited outside Annotask is never clobbered, and agent-CREATED files are netted into undo in git projects.
- **MCP grounding tools.** `annotask_conversation_read` / `annotask_conversation_post` / `annotask_conversation_subscribe` for the per-task thread, plus `annotask_get_source_excerpt`, `annotask_get_binding_classification`, `annotask_get_data_source_*`, `annotask_get_playbook`, and `annotask_get_agent_directions` (with matching CLI commands).
- **`scripts/sync-skills.mjs`** + `pnpm sync:skills` — `skills/` is the canonical skill tree; the `.claude/skills/`, `.agents/skills/`, and vue-webpack playground mirrors are regenerated from it, and CI fails when the mirrors drift.
- **`src/server/validation.ts`** — canonical home for screenshot filename regex, valid task statuses, allowed status transitions, POST/PATCH field whitelists, and `agent_feedback` schema. Replaces ad-hoc duplication across the HTTP API, MCP server, and state layer.
- **`src/server/schemas.ts`** — zod schemas for every HTTP body and MCP tool argument set. The HTTP API and MCP server now parse at the boundary via `schema.safeParse()` instead of ad-hoc type checks.
- **`AnnotaskServer.flush()`** — drain pending task/perf writes before shutdown. `startStandaloneServer`'s `close()` is now async and flushes before closing.
- **`scripts/copy-vendor.mjs`** — replaces the inline `cp` chain in `pnpm build:vendor`. Fails the build loudly if an upstream package renames or drops a vendored file.
- **`src/shell/utils/routes.ts`** + **`src/shell/composables/useLocalStorageRef.ts`** — shared helpers that replace per-site `normalizeRoute` copies and `ref + watch + localStorage` triplets previously inlined in `App.vue`.
- **`docs/REVIEWING.md`** — PR review checklist with the invariants the codebase needs to keep.
- **`CHANGELOG.md`** (this file) and a **Release Process** section in `CONTRIBUTING.md`.
- Optional `code` field on API error responses (keeps legacy `error: string` intact).
- Zod (`^4.3.6`) as a runtime dependency.

### Changed
- **Tool-strip pivot.** Wireframe mode is now the single "move things" surface in Design: the Reposition tool was removed everywhere, and the Annotate tab's Draw-Section tool moved into the wireframe canvas. The legacy `component_move`, `component_prop_update`, `text_update`, and `section_request` task/change types stay documented and applicable but are no longer emitted.
- Docs/contract drift sweep: removed the long-dead `api_update` task type from every doc that still taught it as live, documented `wireframe_apply` in every task-type list, documented the embedded-agent / wireframe / init / usage / conversation endpoint surface and new WebSocket events, and rewrote the `PERF_FIX.md` playbook to match the real perf-finding enums.
- **BREAKING (internal):** `ProjectState.addTask/updateTask/deleteTask` are now `async`. Callers inside annotask already `await` them; any external consumer of `createProjectState` must await.
- Task mutations serialize through a single in-process mutex (`withTaskLock`). Concurrent PATCH requests to disjoint fields of the same task no longer lose writes.
- Screenshot unlinks (on `accepted` or delete) are chained after the successful write. A failed write no longer leaves an orphan screenshot.
- Screenshot upload filenames use `crypto.randomBytes(8)` (16 hex chars) — no more 5-char collision window.
- `fs.watch` on `.annotask/` no longer invalidates the task cache on our own atomic writes (tracked via `selfWriteUntil` window).
- WebSocket server enforces a 1 MiB per-frame size cap (`maxPayload`).
- `Cache-Control` on screenshot responses is now `private` instead of `public`.
- `server.json` is written with mode `0o600` — other users on shared machines can no longer read the live PID + port.
- Component scanner caches now carry a 5-minute TTL and coalesce concurrent scans through a single in-flight promise.
- MCP batch dispatch isolates per-item exceptions so one bad request no longer truncates the response array.
- MCP `annotask_update_task` runs new `agent_feedback` entries through the shared zod schema instead of a tool-local duplicate.
- MCP server version is baked from `package.json` at build time (`__ANNOTASK_VERSION__`) instead of a hardcoded value.
- `iframeBridge` no longer posts to `targetOrigin='*'`. The shell derives the iframe's origin and refuses to send until it knows a concrete origin. Request IDs are now monotonic.
- `useAnnotationRects` and `useSelectionModel` rAF loops skip work while `document.hidden` is true.
- `useErrorMonitor` caps its buffer at 256 entries; `usePerfMonitor.perfFindings` caps at 128 (worst severities kept).
- `package.json`: added `"sideEffects": false` (tree-shaking); excluded sourcemaps from the published tarball; pinned `axe-core` and `html2canvas-pro` to exact versions since both are vendored into `dist/vendor/`.

### Fixed
- **Wireframe apply lifecycle — data-loss races.** "Undo last apply" and "Discard session" are now inert while an apply run is in flight (the snapshot engine also refuses a still-running, unsealed batch), so a one-click revert can no longer clobber the agent's in-progress bytes. The batch now (re-)seals by task on every `review`, so re-apply-after-deny and pure-placement applies establish a correct undo baseline instead of falsely reporting "edited outside Annotask". A crashed/aborted seed run now seals its batch `failed` and returns its session entries to `pending` instead of stranding them in `applying`.
- **XSS hardening.** The Conversation surface and agent-directions preview render model/user markdown through the shared `safeMd()` (DOMPurify) helper instead of raw `marked.parse()` + `v-html`.
- Cumulative token counter no longer double-counts across turns (each persisted message holds exactly its own turn).
- Wireframe live preview no longer silently degrades to a placeholder when a binding maps a nested object/array field — overlay props are plain-cloned before crossing `postMessage` (`DataCloneError`).
- Dev server tolerates a wrong-shape `tasks.json` instead of crashing on boot.

### Removed
- `src/shell/composables/useThemeMode.ts` — the deprecated wrapper around `useShellTheme` was unused at any call site.

### Security
- All `/__annotask/*` requests are Host-gated against non-local hostnames. Agent spawn routes additionally enforce same-port origin matching (`origin_port_mismatch`) and the server-side `ANNOTASK_MAX_PERMISSION` permission ceiling so a page on another localhost port cannot spawn credential-bearing CLIs, and no client can request more permission than the admin allows.
- `annotask_get_screenshot` MCP tool now routes `task.screenshot` through `isSafeScreenshot` before path construction, closing a path-traversal hole.

### Breaking
- **API error shape.** Responses now use `{ error: { code, message } }` instead of a bare `error: string`. `PATCH`/`DELETE` on a missing task now returns HTTP 404 (previously 200 with a magic `{error: 'Task not found'}` string).

## [0.2.6] - 2026-04-23

### Fixed
- Draw Section tool no longer 400s when the rectangle misses a `data-annotask-file`-tagged element (common over third-party component-library elements). `CreateTaskBody` now preprocesses `file: ''` to `undefined` before `SafeSourceFile` validation, and accepts `placement` instead of silently stripping it. The shell section submit also sends `undefined` instead of empty fallbacks for missing optionals. Fixes #34.

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
