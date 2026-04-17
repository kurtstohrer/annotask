# Contributing to Annotask

## Architecture

| Module | Purpose |
|--------|---------|
| `src/plugin/` | Vite integration, multi-framework transform, toggle button, bridge client |
| `src/server/` | HTTP API middleware, WebSocket server, shell serving, project state |
| `src/webpack/` | Webpack plugin and SFC transform loader |
| `src/shell/` | Design tool UI: Vue 3 app served at `/__annotask/` |
| `src/shared/` | Shared types used by both plugin and shell (postMessage bridge protocol) |
| `src/cli/` | Terminal tool: `annotask tasks`, `watch`, `report`, `update-task`, `screenshot`, `init-skills`, `init-mcp`, `mcp`, etc. |
| `src/mcp/` | MCP server (Streamable HTTP transport, tools for tasks/design spec/components/screenshots) |
| `src/schema.ts` | TypeScript types defining the report and task contracts |

The plugin injects source-mapping attributes into component templates at compile time (Vue SFCs, JSX for React/Solid, Svelte, Astro, plain HTML). The shell loads the user's app in an iframe and uses these attributes to map DOM elements back to source files.

More detail: [`docs/architecture.md`](docs/architecture.md).

## Build

```bash
pnpm install              # Install dependencies
pnpm build                # Build everything (shell → plugin/CLI → vendor)
pnpm build:shell          # Shell UI only (Vite → dist/shell/)
pnpm build:plugin         # Plugin + CLI only (tsup → dist/)
pnpm build:vendor         # Copy axe-core + html2canvas to dist/vendor/
```

Build order matters: the shell must be built before the plugin, because the plugin serves `dist/shell/` as static files. Vendor deps are copied last.

## Test

```bash
pnpm test                 # Unit tests (Vitest)
pnpm test:watch           # Watch mode
pnpm typecheck            # tsc + vue-tsc
pnpm test:e2e             # E2E tests (Playwright, all frameworks)
```

Unit test environments:
- Plugin tests (`src/plugin/__tests__/`): Node
- Shell tests (`src/shell/composables/__tests__/`): jsdom

E2E tests cover vue-vite, vue-webpack, react-vite, svelte-vite, html-vite, astro, htmx-vite, and mfe-vite. Playwright starts each dev server automatically.

## Report and Task Contracts

`src/schema.ts` is the canonical source of truth for both change reports and tasks. Any runtime output must conform to these types. `shapeChange()` in `useStyleEditor.ts` normalizes change output before broadcasting.

Currently emitted change types:
- `style_update` — Inline style changes
- `class_update` — CSS class changes
- `component_insert` — Drag-and-drop component insertion
- `component_move` — Element reordering
- `annotation` — Design intent notes, pins, arrows, text highlights
- `section_request` — Drawn section requests for new content

Schema-only types (defined but not yet emitted at runtime):
- `component_delete`
- `scoped_style_update`
- `prop_update`

Task types (created by the shell, consumed by agents): `annotation`, `style_update`, `theme_update`, `section_request`, `a11y_fix`. See [`docs/api.md`](docs/api.md) and the CLAUDE.md "Task Types" section for the full shape of each.

## Framework Support

Annotask supports **Vue 3**, **React**, **Svelte**, and **SolidJS** as first-class targets (Vite + Webpack where applicable). **Plain HTML**, **Astro**, and **htmx** are supported on Vite only, with Astro and htmx marked experimental.

The transform layer (`src/plugin/transform.ts`) has per-framework extraction logic that feeds into a shared HTML/JSX attribute injection scanner. React and SolidJS share the JSX transform path. Astro sources its data-attributes from Astro's native `data-astro-source-*` instrumentation, so no Annotask-specific transform is needed.

## Stability bar

Annotask has a set of stabilization exit criteria the core loop must keep meeting before adding new features:

1. Style/class edits produce correct before/after reports
2. Source anchors point to correct file and line
3. Runtime reports validated against schema
4. No Annotask instrumentation in production builds
5. Core flow covered by automated tests + CI
6. README explains what works, what's experimental, and how to verify

If a change would regress any of these, it belongs behind stabilization work first. See `plan/annotask-gap-remediation-plan.md` for the current remediation backlog.

## Release Process

Versions are SemVer. The source of truth is `package.json`; the MCP server and shell read it at build time via `__ANNOTASK_VERSION__`.

1. **Write the changelog entry first.** Edit `CHANGELOG.md` under `## [Unreleased]`. Categorize under Added / Changed / Fixed / Security / Removed.
2. **Verify.** `pnpm typecheck && pnpm test && pnpm build`. The build step runs `scripts/copy-vendor.mjs`, which fails loudly if the vendored upstream files have moved.
3. **Bump.** Edit `package.json` `version` and promote `## [Unreleased]` to `## [x.y.z] — YYYY-MM-DD` in `CHANGELOG.md`. Commit `chore(release): vx.y.z`.
4. **Tag + publish.** `git tag vx.y.z && git push --follow-tags`. `npm publish` from a clean working tree.
5. **Post-release.** Reopen a fresh `## [Unreleased]` block in `CHANGELOG.md` and commit.

Never bump `package.json` without a changelog entry in the same commit — the review checklist (`docs/REVIEWING.md`) pins this.

## Reviewing PRs

See `docs/REVIEWING.md` for the review checklist. Core rules: one canonical definition per rule, no business logic in `App.vue`, shared-state composables use singleton-with-refcount, every boundary validates with zod, every rAF loop has a `document.hidden` guard, size budgets hold.
