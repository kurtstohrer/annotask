# Data Source Discovery

Annotask scans a project's data-fetching libraries and local code to build a catalog of data sources used by:

- Audit > Data in the shell
- `GET /__annotask/api/data-sources`
- `GET /__annotask/api/data-source-examples/:name`
- `GET /__annotask/api/data-source-details/:name`
- `GET /__annotask/api/data-source-bindings/:name`
- `annotask_get_data_sources`, `annotask_get_data_source_examples`, `annotask_get_data_source_details`
- the `annotask data-sources`, `data-source-examples`, `data-source-details` CLI commands
- per-task `data_context` enrichment (the primary source a task is bound to)

The scanner is workspace-aware, so in monorepos it aggregates data libraries and definitions across sibling packages and MFEs rather than only the current package.

## Two Layers

The catalog distinguishes **libraries** (data-fetching packages found in `package.json`) from **project entries** (concrete hooks, stores, fetch wrappers, GraphQL operations, and tRPC routers defined in `src/`).

A library entry only appears if it is both installed *and* at least one of its recognized identifiers is actually used somewhere in `src/`. This avoids listing packages that are declared but never imported.

## What Gets Extracted

### Library entries

```ts
interface DataSourceLibrary {
  name: string
  version?: string
  detected_patterns: string[]  // identifiers this library exports that we recognize
}
```

### Project entries

```ts
interface ProjectDataEntry {
  kind: 'composable' | 'signal' | 'store' | 'fetch' | 'graphql' | 'loader' | 'rpc'
  name: string
  display_name?: string        // e.g. "localhost:4320 /api/health" for inline fetches
  file: string                 // workspace-relative
  line?: number                // 1-based definition line
  endpoint?: string            // literal endpoint or query key when extractable
  resolved_endpoint?: string   // rewritten through the nearest vite.config proxy
  used_count: number           // ranking signal (non-definition references across src/)
  hint_symbols?: string[]      // local vars holding the fetch result (for the binding analyzer)
}
```

### Catalog shape

```ts
interface DataSourceCatalog {
  libraries: DataSourceLibrary[]
  project_entries: ProjectDataEntry[]  // sorted by used_count desc
  scannedAt: number
}
```

### Runtime reference (on tasks)

The per-task `data_context.sources[]` uses a narrower `DataSource` shape — identifier, kind, module, endpoint, method, line, dynamic-endpoint flag, and (when the endpoint matches an API schema) a `response_schema_ref` + `schema_in_repo` pair. See `src/schema.ts` for the canonical definitions.

## Current Shell UX

The Audit > Data page lives in `src/shell/components/DataSourcesPage.vue` and is driven by `src/shell/composables/useDataSources.ts`.

Three sub-tabs:

- `hooks` — project data sources (composables, stores, signals, fetches, GraphQL, tRPC)
- `libraries` — detected data-fetching libraries
- `apis` — discovered API schemas (OpenAPI, GraphQL, tRPC) — served by a separate scanner (see `api-schema-scanner.ts`), but shown alongside for context

Filters:

- free-text search across name / file / endpoint
- `All` vs `On page` (driven by live highlight rects from the iframe)
- MFE filter when workspace MFEs are present

Detail pane shows signature, return type, body excerpt, leading imports, co-located siblings, and the binding graph (rendering sites where this source is consumed). Highlights in the app iframe come from the binding-graph `sites`, not from grep.

## Workspace Behavior

`scanDataSources()` uses `resolveWorkspace()` to read dependencies and walk `src/` across every workspace package. File paths are relativized against the workspace root so cross-MFE references stay unambiguous, and `useWorkspace()` in the shell maps those paths back to MFE ids for filtering.

Path-only endpoints like `/api/health` are resolved through the nearest `vite.config`'s `server.proxy` — so a Vue MFE proxying `/api` to a FastAPI service at :4320 doesn't get its highlights attributed to a Go service at :4330 that happens to expose the same path.

## Scanner Strategies

The scanner runs in order (see `scanDataSourcesUncached` in `src/server/data-source-scanner.ts`):

### 1. Library detection

Reads `dependencies` + `devDependencies` from every workspace `package.json` and cross-checks against `DATA_LIB_PATTERNS` — the hand-curated map of package name → identifiers we know how to recognize. A library only survives if at least one of its identifiers actually appears in source.

### 2. Project entry detection

Walks each package's `src/` (capped at 5000 files) and matches `ENTRY_PATTERNS` — specificity-ordered regexes for:

- named composables / hooks (`export function useX(...)`, `export const useX = (...)`)
- Pinia stores (`defineStore`)
- Zustand stores (`create(...)`)
- Jotai atoms
- Svelte stores (`writable`, `readable`, `derived`)
- Solid primitives (`createSignal`, `createResource`, `createStore`)
- GraphQL operations (tagged `` gql`...` ``)
- tRPC routers (`createTRPCRouter`)
- Fetch wrappers in API-ish directories
- Inline fetches in component files (`fetch()`, `axios.*()`, `ofetch()`, `$fetch()`, `new URL()`, htmx `hx-*` attributes)

First match wins, so more specific patterns take precedence over generic ones.

### 3. Endpoint resolution

Literal endpoints extracted from the definition body are run through `parseViteProxy()` against the nearest `vite.config` so `/api/health` becomes `http://localhost:4320/api/health`.

### 4. Usage counting

One combined alternation regex per file counts non-definition references to each entry's name. Definition lines are excluded by line number. `used_count` drives the sort order and the `used_only` filter.

### 5. Hint symbols for inline fetches

Inline fetches like `const health = await fetch('/api/health').then(r => r.json())` get an endpoint-derived name (`apiHealth`) that never appears verbatim in source, which would leave the binding analyzer with nothing to match. `collectHintSymbols()` captures the local variables that hold the fetch result (`health`) so the analyzer can still trace them into templates / JSX.

## Recognized Libraries

| Library | Kind |
|---------|------|
| `@tanstack/{react,vue,solid,svelte}-query`, `swr` | `composable` |
| `@apollo/client`, `urql`, `@urql/{vue,svelte}`, `graphql-request` | `composable` / `graphql` |
| `axios`, `ofetch`, `htmx.org` | `fetch` |
| `pinia`, `vuex`, `zustand`, `@reduxjs/toolkit`, `react-redux`, `jotai`, `valtio`, `mobx`, `svelte`, `svelte/store`, `$app/stores` | `store` |
| `solid-js` (`createSignal`, `createMemo`, `createEffect`) | `signal` |
| `solid-js` (`createResource`) | `composable` |
| `solid-js` (`createStore`) | `store` |
| `vue-router`, `react-router{,-dom}`, `@remix-run/react`, `next`, `@solidjs/router` | `loader` |
| `@trpc/client`, `@trpc/react-query`, `@trpc/next` | `rpc` |

Full map in `DATA_LIB_PATTERNS` (`src/server/data-source-scanner.ts`).

## Binding Graph

The second layer — `resolveBindingGraph()` in `src/server/binding-analysis/` — traces where a data source is rendered. Two-pass:

1. **Seed pass** — walk every supported file and run the framework analyzer (Vue, Svelte, JSX/TSX, plus a regex fallback) with `sourceName` as the taint seed. Record render sites and component prop edges.
2. **Prop propagation** — for each prop edge, re-analyze the child file with the prop name seeded as tainted. This picks up patterns like `<PlanetCard :planet="planet" />` → `{{ planet.moons }}` in the child.

Returns a `SourceBindingGraph` with `sites` (file + line + tainted symbols), `prop_edges`, a `partial` flag when any file fell back to file-level heuristics, and per-file diagnostics. Cached 60s, keyed by `projectRoot::sourceName::hintSymbols::scopeFile`.

The shell uses `sites` as DOM highlight targets via the `data-annotask-file` / `data-annotask-line` attributes the transform injects on every rendered element.

## Data-Context vs Data-Sources

The catalog is project-wide. The per-task `data_context` is a narrower slice — "which sources power *this* element?" — resolved at task-create time by `src/server/data-context.ts`:

| | Data-Source Catalog | Data Context |
|---|---|---|
| Scope | project-wide | per-file / per-task |
| Driver | filesystem scan + pattern matching | task file + line + binding graph |
| Returns | `DataSourceCatalog` | `DataContext` (sources + rendered_identifiers + route_bindings) |
| Caching | 60s TTL, coalesced | probe cache keyed by realpath+mtime, FIFO evicted at 500 |
| Used by | Data tab, agent exploration | task enrichment, agent anchor |

`resolveDataContext()` also cross-references `scanApiSchemas()` to populate `response_schema_ref` on sources whose endpoints match a known operation. `resolveElementDataContext()` uses the binding graph with a ±3-line tolerance for element-level precision.

`sources[0]` on a task is the one an agent should anchor on — nearest to `task.line`, with ties broken in the order `composable > signal > store > fetch > graphql > loader > rpc`.

## Caching

Catalog scans are cached in memory with a 60-second TTL. Concurrent scans are coalesced behind a single in-flight promise. `clearDataSourceCache()` also clears the vite-proxy lookup cache used by endpoint resolution.

The binding graph has its own 60s TTL keyed per source + hint + scope.

The data-context probe cache is keyed by realpath + mtime and evicts FIFO at 500 entries — it backs the fast UX path that needs a boolean + primary signal per file without a full resolve.

## HTTP, MCP, And CLI Access

### HTTP

```bash
curl http://localhost:5173/__annotask/api/data-sources
curl http://localhost:5173/__annotask/api/data-sources?kind=composable&used_only=1
curl http://localhost:5173/__annotask/api/data-source-examples/useUserQuery?limit=5
curl http://localhost:5173/__annotask/api/data-source-details/useUserQuery
curl http://localhost:5173/__annotask/api/data-source-bindings/useUserQuery
```

### MCP

- `annotask_get_data_sources` — supports `kind`, `library`, `search`, `used_only`
- `annotask_get_data_source_examples` — supports `name`, `kind`, `limit`
- `annotask_get_data_source_details` — supports `name`, `kind`, `file`, `context_lines`

When multiple definitions share a name, `annotask_get_data_source_details` returns `{ error: 'ambiguous', candidates: [...] }` — re-call with `file` and/or `kind` to disambiguate.

### CLI

```bash
annotask data-sources
annotask data-sources --kind=composable --used-only --mcp
annotask data-source-examples useUserQuery --limit=5 --mcp
annotask data-source-details useUserQuery --file=src/composables/useUserQuery.ts --mcp
```

## When Agents Should Use It

Reach for the data-source catalog when a task asks to:

- modify a fetch contract, query, mutation, or store — this is the `api_update` task type's primary surface
- add a new UI that needs to bind to existing data — start from `used_only=true` to see what's already fetched on this page
- rewire a component to a different hook or store that matches project conventions
- understand what data an element on the current page depends on — use the per-task `data_context`, then call `annotask_get_data_source_details` on the primary source for its shape
- trace a source end-to-end through prop chains — the bindings endpoint returns the full render-site graph

For API-contract work, pair data sources with `annotask_get_api_operation` / `annotask_resolve_endpoint` — the `response_schema_ref` on a source points directly at the schema the fetch returns.
