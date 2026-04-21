# Contributing To Annotask

## Architecture At A Glance

| Module | Purpose |
|--------|---------|
| `src/plugin/` | Vite integration, transform pipeline, bridge injection |
| `src/server/` | HTTP API, persistence, WebSocket server, scanners, workspace discovery |
| `src/mcp/` | embedded MCP server |
| `src/webpack/` | Webpack plugin and loader |
| `src/shell/` | Vue shell UI served at `/__annotask/` |
| `src/cli/` | `annotask` CLI |
| `src/shared/` | shared bridge and task-summary helpers |
| `src/schema.ts` | canonical contracts for tasks, reports, design spec, and context |

Annotask instruments supported app code in development, maps DOM elements back to source files, and exposes the resulting task and context data through the shell, HTTP API, WebSocket, CLI, and MCP.

More detail: [`docs/architecture.md`](docs/architecture.md)

## Build

```bash
pnpm install
pnpm build
pnpm build:shell
pnpm build:plugin
pnpm build:vendor
```

The shell build must run before the plugin build because the server serves `dist/shell/`.

## Test

```bash
pnpm test
pnpm test:watch
pnpm typecheck
pnpm test:e2e
pnpm test:e2e:stress
```

## Playground And Stress Lab

Simple playgrounds live under `playgrounds/simple/`.

The multi-MFE stress environment lives under `playgrounds/stress-test/` and is useful when changing:

- workspace discovery
- MFE filtering
- data-source scanning
- API schema discovery
- component aggregation across sibling packages

Useful scripts:

```bash
pnpm dev:vue-vite
pnpm dev:react-vite
pnpm dev:shell
pnpm dev:stress-host
pnpm stress-test:up
pnpm stress-test:down
```

## Shell Surfaces

The shell's user-facing tabs are:

- **Annotate**
- **Design**
- **Audit**

Internally the Audit tab still uses the `develop` view id in navigation state.

Keep `App.vue` orchestration-focused. New shell behavior should usually live in a composable under `src/shell/composables/`.

## Task And Change Contracts

`src/schema.ts` is the canonical source of truth.

Current change types in live reports:

- `style_update`
- `class_update`
- `component_insert`
- `component_move`
- `annotation`
- `section_request`

Schema-only experimental change types still present in the contract:

- `scoped_style_update`
- `prop_update`
- `component_delete`

Current task types:

- `annotation`
- `section_request`
- `style_update`
- `theme_update`
- `a11y_fix`
- `error_fix`
- `perf_fix`
- `api_update`

Current statuses:

- `pending`
- `in_progress`
- `applied`
- `review`
- `accepted`
- `denied`
- `needs_info`
- `blocked`

## Framework Support

Annotask supports Vue, React, Svelte, Solid, Astro, HTML, and htmx on Vite. Webpack support is available through `AnnotaskWebpackPlugin`.

Server-side scanning is now workspace-aware, so changes in scanners or task grounding should be evaluated against both single-package playgrounds and monorepo-style stress scenarios.

## Adding Or Changing APIs

When changing a public contract:

1. update `src/schema.ts` if the payload shape changes
2. update shared validation in `src/server/validation.ts` or `src/server/schemas.ts`
3. update HTTP handlers in `src/server/api.ts`
4. update MCP handlers in `src/mcp/server.ts` if the surface is agent-visible
5. add or update tests
6. update relevant docs

## Release Process

Versions are SemVer. The version source of truth is `package.json`, and the shell and MCP server read it via `__ANNOTASK_VERSION__` at build time.

1. update `CHANGELOG.md`
2. run `pnpm typecheck && pnpm test && pnpm build`
3. update `package.json` version and the matching changelog heading together
4. publish with `npm publish --access public`
5. tag the release in git if appropriate

Do not bump `package.json` without the matching changelog update in the same change set.

## Reviewing

See [`docs/REVIEWING.md`](docs/REVIEWING.md) for the PR checklist and invariants.
