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

The scanner is scoped to the **running package only** — it reads that package's own `package.json` and walks that package's own `src/`, not sibling workspace packages. This was a deliberate fix: aggregating every workspace package surfaced sibling apps' data libraries and endpoints (a Vue app would show another app's hooks and endpoints), polluting the catalog and the on-page data highlights. See "Workspace Behavior" below for what workspace-awareness now means in practice.

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
  display_name?: string        // e.g. "localhost:4320 GET /api/health" for inline fetches
  file: string                 // workspace-relative
  line?: number                // 1-based definition line
  endpoint?: string            // literal endpoint or query key when extractable
  resolved_endpoint?: string   // rewritten through the nearest vite.config proxy
  used_count: number           // ranking signal (non-definition references across src/)
  hint_symbols?: string[]      // local vars holding the fetch result (for the binding analyzer)
}
```

The scanner itself (`src/server/data-source-scanner.ts`) tracks three more provenance fields that aren't promoted to the shared `schema.ts` type yet, so they ride the wire on any entry that has them (structurally a superset — assignable to `ProjectDataEntry[]` for consumers that don't know about them) but aren't part of the canonical contract:

- `endpoint_source?: 'url' | 'literal-path' | 'query-key' | 'guess'` — how `endpoint` was actually derived. `'guess'` marks the low-confidence "first quoted string in the vicinity" fallback (e.g. a `defineStore('user', ...)` store id) — never silently treated as a real fetchable URL.
- `query_key?: string` — populated when the only thing found was a TanStack/SWR-style `queryKey` (an identifier, not a URL). Kept separate from `endpoint` so a queryKey is never mistaken for something fetchable, even though it's still mirrored into `endpoint` for backward-compatible display.
- `method_known?: boolean` — whether `method` reflects a real signal (an explicit verb, an axios method call, or an htmx attribute) as opposed to the HTTP-default `'GET'` fallback used when the options argument couldn't be inspected.

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

`scanDataSources()` reads dependencies and walks `src/` for the **running package only** — the same host-package scoping as the component scanner, and for the same reason (aggregating every workspace package leaked sibling apps' hooks/endpoints into a project that can never call them). `resolveWorkspace()` is still used, but only to compute the base that file paths are relativized against (the workspace root, not `projectRoot`), so a monorepo member's paths come out looking like `packages/foo/src/…` and stay consistent with `component-usage`'s paths and the shell's `useWorkspace()` MFE-id mapping — it does not widen what gets scanned. There is no `mfe` parameter on any data-source endpoint (HTTP, MCP, or CLI) analogous to the component catalog's project-components lookup; the data catalog is always exactly the running package's own libraries and `src/` entries.

Path-only endpoints like `/api/health` are resolved through the nearest `vite.config`'s `server.proxy` — so a Vue MFE proxying `/api` to a FastAPI service at :4320 doesn't get its highlights attributed to a Go service at :4330 that happens to expose the same path.

## Scanner Strategies

The scanner runs in order (see `scanDataSourcesUncached` in `src/server/data-source-scanner.ts`):

### 1. Library detection

Reads `dependencies` + `devDependencies` from the running package's `package.json` and cross-checks against `DATA_LIB_PATTERNS` — the hand-curated map of package name → identifiers we know how to recognize. A library only survives if at least one of its identifiers actually appears in source.

Confirmation is dependency-gated and call-shape aware: comments and string/template-literal contents are stripped from each file before matching, so a mention of `useQuery` in a comment doesn't false-confirm a library. Single-word identifiers that read as ordinary prose or unrelated code (`create`, `computed`, `derived` — zustand/mobx/svelte respectively) require call-shape (`create(`) rather than a bare word match, so e.g. Svelte's `derived` no longer false-confirms against an unrelated `$derived` rune usage. Dotted patterns (`axios.get`) and non-word-leading patterns (`$fetch`) are matched correctly — both were previously broken by escaping/`\b`-boundary bugs that made axios and `$fetch` unrecognizable regardless of actual usage.

### 2. Project entry detection

Walks the running package's `src/` (capped at 5000 files) and matches `ENTRY_PATTERNS` — regexes for distinct declaration shapes, listed roughly from most to least specific:

- named composables / hooks (`export function useX(...)`, `export const useX = (...)`)
- Pinia stores (`defineStore`)
- Zustand stores (`create(...)`)
- Jotai atoms
- Svelte stores (`writable`, `readable`, `derived`)
- Solid primitives (`createSignal`, `createResource`, `createStore`)
- GraphQL operations (tagged `` gql`...` ``)
- tRPC routers (`createTRPCRouter`)
- Fetch wrappers in API-ish directories, or anywhere the function body does real HTTP — covers both `export function getX(...)` and the arrow-const form that dominates modern codebases (`export const getX = async (id) => fetch(...)`), plus "helper indirection" through a pre-configured client object (`apiClient.get(...)`, `httpClient.post(...)`) rather than a bare global identifier
- Inline fetches in component files (`fetch()`, `axios.*()`, `ofetch()`, `$fetch()`, two-step `new URL(...)` + `fetch(url)` builds, htmx `hx-*` attributes)

Every pattern in `ENTRY_PATTERNS` is applied exhaustively across the whole file — there is no "first pattern wins and suppresses the rest" mechanism. The patterns are written to match structurally distinct declaration shapes (a Pinia store's `defineStore(` vs a plain composable's `= (` / `= async (` / `= function`), so in practice they rarely overlap on the same text; when a real HTTP call already gets claimed by a named fetch-wrapper match, the separate inline-call pass explicitly skips that same endpoint so it isn't cataloged a second time anonymously. "Specificity order" describes the list above, not an arbitration rule between patterns.

### 3. Endpoint resolution

Literal endpoints extracted from the definition body are run through `parseViteProxy()` against the nearest `vite.config` so `/api/health` becomes `http://localhost:4320/api/health`. Endpoint literals are tagged with `endpoint_source` (see "Project entries" above) so a low-confidence guess is never confused with a confirmed URL/path, and `${id}`-style template interpolations are preserved as a `:param` placeholder (`` `/api/planets/${id}` `` → `/api/planets/:param`) rather than truncating the path at the `$`.

### 4. Usage counting

For name-keyed entries (composables, stores, signals, …), a combined alternation regex counts non-definition references to each entry's name across every file, excluding the definition line. When two entries share the same name, counting is scoped to same-file references only — a shared name can't be safely attributed project-wide (two unrelated `useData` composables would otherwise inflate each other's count). For `fetch`-kind entries, the synthetic endpoint-derived name (e.g. `apiHealth`) never appears verbatim in source, so those are instead counted by searching for the entry's `hint_symbols` — the real local variables that hold the fetch result — scoped to the entry's own file. `used_count` drives the sort order and the `used_only` filter either way.

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
| `vue-router`, `react-router{,-dom}`, `@remix-run/react`, `next`, `@solidjs/router`, `astro` (`getCollection`/`getEntry`/`getEntryBySlug`/`getStaticPaths`) | `loader` |
| `@trpc/client`, `@trpc/react-query`, `@trpc/next` | `rpc` |

Full map in `DATA_LIB_PATTERNS` (`src/server/data-source-scanner.ts`).

htmx is a special case: it's attribute-driven, so there's no JS identifier to confirm against, and its canonical install is often a CDN `<script>` tag rather than an npm dependency. It's recognized two ways, independent of whether `htmx.org` is even in `package.json`: real `hx-get`/`hx-post`/`hx-put`/`hx-patch`/`hx-delete`/… attribute usage anywhere in scanned files (including plain `.html`), and the canonical `<script src="…htmx…">` CDN tag. Either signal alone surfaces the library; both together are required to synthesize a library entry when there's no `package.json` dependency to gate on at all.

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

Catalog scans are cached in memory with a 60-second TTL. Concurrent scans are coalesced behind a single in-flight promise. `clearDataSourceCache()` also clears the vite-proxy lookup cache used by endpoint resolution. `GET /api/data-sources` accepts `?refresh=1` (or `?refresh=true`) to clear the cache and force a rescan before responding — without it, a data source deleted or renamed on disk keeps being served from the 60s cache with no escape hatch. The returned `scannedAt` is stamped at scan time.

The binding graph has its own 60s TTL keyed per source + hint + scope.

The data-context probe cache is keyed by realpath + mtime and evicts FIFO at 500 entries — it backs the fast UX path that needs a boolean + primary signal per file without a full resolve.

## HTTP, MCP, And CLI Access

### HTTP

```bash
curl http://localhost:5173/__annotask/api/data-sources
curl http://localhost:5173/__annotask/api/data-sources?kind=composable&used_only=1
curl "http://localhost:5173/__annotask/api/data-sources?refresh=1"
curl http://localhost:5173/__annotask/api/data-source-examples/useUserQuery?limit=5
curl http://localhost:5173/__annotask/api/data-source-details/useUserQuery
curl http://localhost:5173/__annotask/api/data-source-bindings/useUserQuery
```

### MCP

- `annotask_get_data_sources` — supports `kind`, `library`, `search`, `used_only`, `merge_runtime` (default true — promotes orphan runtime-observed endpoints into `project_entries` with `discovered_by: "runtime"` and `file: ""`; pass `false` for a pure static-scan view)
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

- modify a fetch contract, query, mutation, or store — there is no dedicated task type for this; these arrive as `annotation` tasks carrying `data_context` plus runtime-endpoint evidence, and the catalog is how you ground them
- add a new UI that needs to bind to existing data — start from `used_only=true` to narrow the whole-project catalog down to sources with a real reference somewhere in `src/` (this is project-wide ranking by `used_count`, not a "what's fetched on the current page" filter — for that, use the per-task/per-element `data_context` or the shell's separate "On page" toggle, which is driven by live highlight rects from the iframe)
- rewire a component to a different hook or store that matches project conventions
- understand what data an element on the current page depends on — use the per-task `data_context`, then call `annotask_get_data_source_details` on the primary source for its shape
- trace a source end-to-end through prop chains — the bindings endpoint returns the full render-site graph

For API-contract work, pair data sources with `annotask_get_api_operation` / `annotask_resolve_endpoint` — the `response_schema_ref` on a source points directly at the schema the fetch returns.
