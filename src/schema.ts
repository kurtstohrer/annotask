// Type-only — wireframe-types.ts has no runtime imports, so no cycle.
import type { WireframeDataBinding } from './shared/wireframe-types'

export interface ViewportInfo {
  width: number | null
  height: number | null
}

/** Color scheme of the user's app at the moment a task was captured */
export interface ColorSchemeInfo {
  /** Effective scheme: 'light' or 'dark' */
  scheme: 'light' | 'dark'
  /** How the scheme was detected — useful for judging reliability */
  source: 'attribute' | 'class' | 'css-color-scheme' | 'background-luminance' | 'media-query' | 'fallback'
  /**
   * Detected DOM marker (data attribute or class) indicating the theming
   * convention in use. Agents can use this to locate the theme control.
   */
  marker?:
    | { kind: 'attribute'; host: 'html' | 'body'; name: string; value: string }
    | { kind: 'class'; host: 'html' | 'body'; name: string; framework: string }
}

export interface InteractionEntry {
  event: string
  route?: string
  /** Epoch ms. Optional on historical entries captured before timestamps were added. */
  timestamp?: number
  data: Record<string, unknown>
}

export interface InteractionSnapshot {
  current_route: string
  navigation_path: string[]
  recent_actions: InteractionEntry[]
}

export interface PerformanceSnapshot {
  url: string
  route: string
  timestamp: number
  vitals: Array<{ name: string; value: number; rating: 'good' | 'needs-improvement' | 'poor' }>
  navigation?: { domContentLoaded: number; loadComplete: number; ttfb: number }
  resourceSummary: {
    totalRequests: number
    totalTransferSize: number
    byType: Record<string, { count: number; size: number }>
  }
  longTaskCount: number
  totalBlockingTime: number
}

export interface AnnotaskReport {
  version: '1.0'
  project: {
    framework: 'vue' | 'react' | 'svelte' | 'solid' | 'astro' | 'html' | 'htmx'
    styling: string[]
    root: string
  }
  viewport?: ViewportInfo
  interaction_history?: InteractionSnapshot
  performance?: PerformanceSnapshot
  changes: AnnotaskChange[]
}

export type AnnotaskChange =
  | StyleUpdateChange
  | ClassUpdateChange
  | ScopedStyleUpdateChange
  | ComponentPropUpdateChange
  | TextUpdateChange
  | ComponentInsertChange
  | ComponentMoveChange
  | ComponentDeleteChange
  | AnnotationChange
  | SectionRequestChange
  | WireframeDirectionChange

interface BaseChange {
  id: string
  description: string
  file: string
  section: 'template' | 'style' | 'script'
  line: number
  component?: string
  mfe?: string
  viewport?: ViewportInfo
}

/** Direct inline style change on an element (from visual editing) */
export interface StyleUpdateChange extends BaseChange {
  type: 'style_update'
  element: string
  property: string
  before: string
  after: string
}

/** Tailwind/utility class changes */
export interface ClassUpdateChange extends BaseChange {
  type: 'class_update'
  element: string
  before: { classes: string }
  after: { classes: string }
}

/** @experimental Not yet emitted at runtime. CSS rules in <style scoped> */
export interface ScopedStyleUpdateChange extends BaseChange {
  type: 'scoped_style_update'
  selector: string
  before: Record<string, string> | null
  after: Record<string, string>
}

/**
 * One component-prop value change at a usage site (from the properties panel).
 * Per-prop (not a before/after dict) so edits collapse by (file, line, prop),
 * undo one field at a time, and read unambiguously for the agent.
 */
export interface ComponentPropUpdateChange extends BaseChange {
  type: 'component_prop_update'
  /** Component tag as written at the usage site (e.g. 'Button', 'PlanetCard'). */
  element: string
  prop: string
  /** Undefined when the prop wasn't set at the usage site (binding: 'new'). */
  before: unknown
  after: unknown
  /**
   * Honesty proof carried to the agent:
   *  'literal'            — plain attribute (label="Reset"); rewrite the attribute value
   *  'expression-literal' — literal through binding syntax (:count="3", count={3}); keep the syntax
   *  'new'                — prop not present at the usage site; add it
   * Bound expressions never appear here — the shell refuses to edit them.
   */
  binding: 'literal' | 'expression-literal' | 'new'
  /** Scanned type string ('boolean', "'small' | 'large'") — serialization hint. */
  prop_type?: string
}

/** Literal text-content change on an element (from the properties panel).
 *  Only emitted when the source content is a single literal text run —
 *  bound/mixed content is refused at the UI layer. */
export interface TextUpdateChange extends BaseChange {
  type: 'text_update'
  /** DOM tag of the element (e.g. 'h1'). */
  element: string
  before: string
  after: string
}

/** Insert a new element/component */
export interface ComponentInsertChange extends Omit<BaseChange, 'component'> {
  type: 'component_insert'
  insert_inside?: { component?: string; element?: string; slot?: string }
  insert_position: 'append' | 'prepend' | 'before' | 'after'
  component: {
    tag: string
    library?: string
    props?: Record<string, unknown>
    classes?: string
    text_content?: string
  }
}

/** Legacy — emitted by the removed Reposition tool; no longer produced, but
 *  agents still apply it when present in older tasks/reports. */
export interface ComponentMoveChange extends BaseChange {
  type: 'component_move'
  element: {
    tag: string
    component?: string
    from_file: string
    from_line: number
  }
  move_to: {
    target_file: string
    target_line: number
    position: 'before' | 'after' | 'append' | 'prepend'
  }
}

/** @experimental Not yet emitted at runtime. Remove an element */
export interface ComponentDeleteChange extends BaseChange {
  type: 'component_delete'
  element: { component: string }
}

/** Annotation — user intent for AI agent */
export interface AnnotationChange extends BaseChange {
  type: 'annotation'
  intent: string
  action?: string
  context?: {
    element_tag?: string
    element_classes?: string
    parent_layout?: string
    siblings_count?: number
    /** Server-rendered fragment: METHOD /path that produced the selected
     *  markup (e.g. "POST /search") — the file to edit is the template behind
     *  that endpoint. Only present when the element has NO source file: the
     *  bridge stamps it on htmx/Turbo-swapped subtrees instead of mis-anchoring
     *  them to the nearest instrumented ancestor. */
    fragment_url?: string
  }
}

/** Section request — drawn rectangle with prompt for new content */
export interface SectionRequestChange extends BaseChange {
  type: 'section_request'
  position: {
    near_element?: string
    placement?: 'above' | 'below' | 'left' | 'right'
  }
  dimensions: {
    width: string
    height: string
  }
  prompt: string
}

/** Document CSS px in the wireframe canvas's capture coordinate space. */
export interface WireframeRect {
  x: number
  y: number
  width: number
  height: number
}

/**
 * One snapshot-wireframe direction — what the user's sketch encodes for ONE
 * canvas block, computed by diffing the original capture against the current
 * canvas at "Implement this wireframe" time. `file`/`line` (BaseChange) anchor
 * at the block's captured source, or for adds at the nearest anchored
 * neighbor block. Pixel geometry is a HINT; relational facts are the
 * contract — agents implement the intent with idiomatic layout, not absolute
 * positioning. `measured` is tool-derived geometry and `note` is the user's
 * verbatim words: never conflate the two channels.
 */
export interface WireframeDirectionChange extends BaseChange {
  type: 'wireframe_direction'
  op: 'move' | 'resize' | 'delete' | 'add' | 'note'
  /** The block's identity as captured/created — tool-derived, never invented. */
  block: { label: string; component?: string; tag?: string }
  /** Set when N>1 captured blocks share this (file, line) anchor — likely
   *  loop-rendered, so ONE source edit affects every instance. `ordinal` is
   *  the block's 1-based position among the sharers in document order. */
  sharedAnchor?: { ordinal: number; of: number }
  /** Set ONLY when `file` is '' (un-instrumented MFE remote, production
   *  bundle, geometric explode child): the block's capture-time DOM
   *  fingerprint — nth-of-type selector path, leading text, sanitized
   *  outerHTML head. Tool-captured, never invented. The agent resolves it to
   *  source via `annotask_resolve_fingerprint` before editing. */
  fingerprint?: { selector: string; textHead: string; htmlHead: string }
  /** TOOL-MEASURED spatial facts. Never user-authored. */
  measured?: {
    before?: WireframeRect
    after?: WireframeRect
    dx?: number
    dy?: number
    /** Resize as % of original (wPct: 150 = +50% wider). */
    wPct?: number
    hPct?: number
    /** Relational facts computed from box geometry, highest-value first —
     *  e.g. "now above the filters toolbar (was below)". Max 3. */
    relations?: string[]
  }
  /** op 'add' only. Component names/modules are REAL scanner output.
   *  'duplicate' = another copy of a captured block's anchored markup. */
  added?: {
    kind: 'component' | 'placeholder' | 'duplicate'
    componentName?: string
    library?: string
    module?: string
    /** Owning MFE id in a multi-MFE workspace — the package the agent must
     *  import the component from (and scope example search to). Absent in
     *  single-MFE projects; codegen then uses library/module as before. */
    mfe?: string
    props?: Record<string, unknown>
    previewProps?: Record<string, unknown>
    /** placeholder: the user's label, verbatim. Stays visibly a placeholder. */
    label?: string
    /** USER-WRITTEN markdown spec (drawn sections). Travels VERBATIM — never
     *  blended with measured geometry; the description quotes only its first
     *  line. */
    md?: string
    /** Wire THIS real catalog data source. The agent re-grounds it before
     *  use and never invents fields — see WIREFRAME_APPLY.md. */
    data?: WireframeDataBinding
    /** Where it goes relative to the anchored neighbor (file/line above). */
    position: 'before' | 'after' | 'append' | 'prepend'
  }
  /** USER-SAID, verbatim (the block's canvas note). Rides any op; op 'note'
   *  when the note is the only change on the block. */
  note?: string
  // NOTE: ops move/resize/delete/note also carry the inherited BaseChange.mfe —
  // the MFE the EXISTING element LIVES in (LOCATION semantics: the agent edits
  // THAT package, and it disambiguates two MFEs sharing a local path like
  // src/App.tsx). Distinct from `added.mfe` above (op 'add' = import-from).
}

/**
 * Minimal component reference stored inside a task's `context` object.
 * Attached in two places:
 *   - `context.component` — the specific component the user selected
 *     (e.g. the `Slider` they clicked on).
 *   - `context.rendered.ancestors[]` — the outer components it lives
 *     inside, nearest first. Tells the agent *where* this element is
 *     rendered — useful when `task.file` doesn't pinpoint the usage site.
 *
 * `library` and `category` are filled server-side from the component
 * scanner catalog. `name` + `file` come from the bridge.
 */
export interface ComponentRef {
  name: string
  file?: string
  line?: number
  mfe?: string
  library?: string
  category?: string
}

/**
 * One data source referenced by the enclosing file — a hook call, store read,
 * fetch, GraphQL query, loader, or RPC client usage.
 */
/**
 * DataSource kind — framework-agnostic taxonomy:
 *   composable  React hooks, Vue composables, Svelte custom *-functions,
 *               Solid primitive wrappers. Anything that's a "function call
 *               that returns reactive or async state."
 *   signal      Fine-grained reactive primitive: Solid createSignal/
 *               createResource, Svelte $state / writable instance reads.
 *   store       Shared / global state container: Pinia, Zustand, Redux slice,
 *               Svelte writable/readable/derived store *definitions*.
 *   fetch       Direct network call — fetch / axios / ofetch / $fetch.
 *   graphql     GraphQL operation — gql tag, Apollo/urql queries.
 *   loader      Framework data loader — React Router useLoaderData, Remix
 *               loaders, Nuxt useAsyncData, Astro.props, SvelteKit load.
 *   rpc         Typed RPC call — tRPC procedure, server actions.
 */
export interface DataSource {
  kind: 'composable' | 'signal' | 'store' | 'fetch' | 'graphql' | 'loader' | 'rpc'
  /** Identifier used in source (e.g. "useUserQuery", "userStore", "apiClient"). */
  name: string
  /** Module the identifier was imported from, when resolvable. */
  module?: string
  /** Literal endpoint / query key when the call site used a string literal. */
  endpoint?: string
  /** HTTP method for fetch-kind sources. */
  method?: string
  /** Line in the source file where this reference lives. */
  line?: number
  /** Set when the endpoint was a template literal with interpolation (`/api/${id}`) — literal value is a best-effort prefix only. */
  dynamic_endpoint?: boolean
  /** Short name of the matched API schema's response type, if cross-reference succeeded (e.g. "Cat[]", "User"). Full schema via annotask_get_api_operation. */
  response_schema_ref?: string
  /** Mirrors the matched `ApiSchema.in_repo` — true when the backing API source lives in this repo, false for external contracts. Only present when `response_schema_ref` is also set. */
  schema_in_repo?: boolean
}

/**
 * Data context powering the selected element. Codebase-derived in V1 —
 * runtime network capture is deferred.
 */
export interface DataContext {
  /** Data sources referenced in the enclosing file. `sources[0]` is the one the agent should anchor on — nearest to task.line, ties broken composable>signal>store>fetch>graphql>loader>rpc. */
  sources: DataSource[]
  /** Identifiers read in the rendered template / JSX (best-effort), CSV. */
  rendered_identifiers?: string
  /** Route params / query keys read via router hooks, each field CSV. */
  route_bindings?: { params?: string; query?: string }
}

/** A data-fetching library detected in package.json (@tanstack/react-query, swr, pinia, etc.). */
export interface DataSourceLibrary {
  name: string
  version?: string
  /** Identifiers this library exports that we recognize (useQuery, defineStore, etc.). */
  detected_patterns: string[]
}

/** A project-specific data entry point (a hook, store, fetch wrapper, etc. defined in src/). */
export interface ProjectDataEntry {
  kind: DataSource['kind']
  name: string
  /** Human-readable label used in the Data view list — preserves host/port +
   *  HTTP path (e.g. `localhost:4320 /api/health`) so same-path-different-host
   *  endpoints stay distinguishable to the user even when `name` normalizes
   *  to a short identifier. Optional — falls back to `name` when missing. */
  display_name?: string
  file: string
  line?: number
  /** Endpoint or query key extracted from the definition body, when a literal. */
  endpoint?: string
  /** HTTP verb for inline fetch / axios / ofetch / $fetch / htmx entries —
   *  upper-case (`GET`, `POST`, `PUT`, `PATCH`, `DELETE`). Two calls to the
   *  same endpoint with different methods produce distinct entries; the
   *  method is part of the scanner's dedup key. */
  method?: string
  /** Path-only endpoints (`/api/health`) resolved to an absolute URL via the
   *  nearest vite.config's server.proxy — so a Vue MFE that proxies `/api` to
   *  FastAPI at :4320 doesn't get its highlights attributed to Go at :4330
   *  just because both schemas expose `/api/health`. */
  resolved_endpoint?: string
  /** Non-definition references to `name` across src/. Ranking signal. */
  used_count: number
  /** Inline-fetch entries get an endpoint-derived name (`apiHealth`) that
   *  never appears verbatim in source, so the binding analyzer has nothing
   *  to match against. The scanner populates this with the local variable(s)
   *  that actually hold the fetch result (`health`, `workflows`, …) so the
   *  analyzer can trace those identifiers into template / JSX sites. */
  hint_symbols?: string[]
  /**
   * Where this entry came from. Omitted / 'static' for regex-scanned entries
   * (the default). 'runtime' marks synthetic entries promoted from the
   * runtime endpoint catalog — these have `file: ''` because they were
   * discovered by observing network traffic, not by scanning source.
   *
   * Consumers that need a real code location (binding analysis, examples,
   * details) must skip entries where `discovered_by === 'runtime'`. Agents
   * should treat them as "this endpoint exists but we haven't pinned down
   * the call site yet — try searching the codebase for its shape."
   */
  discovered_by?: 'static' | 'runtime'
}

/** Project-wide catalog of data sources — the data-library equivalent of ComponentCatalog. */
export interface DataSourceCatalog {
  libraries: DataSourceLibrary[]
  /** Sorted by used_count desc. */
  project_entries: ProjectDataEntry[]
  scannedAt: number
}

/**
 * A single network request captured by the in-iframe monitor. Mirrors what a
 * browser Network panel records, but trimmed to the fields agents and the
 * Data view care about. Bodies are intentionally NOT captured — runtime
 * discovery is about "what endpoints does this app actually hit", not about
 * reconstructing payloads.
 */
export interface NetworkCall {
  /** Monotonic counter from the iframe; unique within one page load. */
  id: string
  /** 'fetch' | 'xhr' | 'beacon' — how the call was issued. */
  initiator: 'fetch' | 'xhr' | 'beacon'
  /** HTTP method (upper-case). */
  method: string
  /** Full URL as observed by the client (including query string). */
  url: string
  /** Origin part of the URL (e.g. `http://localhost:4320`), or '' for same-origin relative URLs. */
  origin: string
  /** Path + query as observed (e.g. `/api/users/42?x=1`). */
  path: string
  /** Path with query string stripped — convenient for grouping. */
  pathNoQuery: string
  /** HTTP status code when the response completed. Missing on aborted / network-failed requests. */
  status?: number
  /** Response content-type, when known. */
  contentType?: string
  /** Iframe route at the time the request was issued (window.location.pathname). */
  route: string
  /** Epoch ms at request start. */
  startedAt: number
  /** Duration in ms. Missing while still pending. */
  durationMs?: number
  /** Set when the request failed before completion (network error, abort). */
  error?: string
  /** Response size in bytes from content-length, when advertised. */
  contentLength?: number
}

/**
 * Aggregated, runtime-observed endpoint — one row per (origin, method, path)
 * across all page loads since the dev server started. Persisted to
 * `.annotask/runtime-endpoints.json` so the catalog survives iframe
 * navigations and reloads, and agents can read it on demand.
 *
 * Complements the regex-driven static scanner: runtime hits confirm static
 * discoveries and expose endpoints the scanner missed (dynamic endpoints,
 * indirect libraries, generated clients).
 */
export interface RuntimeEndpoint {
  /** Lower-case origin (e.g. `http://localhost:4320`), or '' for same-origin calls. */
  origin: string
  /** HTTP method (upper-case). */
  method: string
  /** Request path with query string stripped. */
  path: string
  /** Pattern-normalized path — numeric segments and UUIDs replaced with `{id}` so calls against different ids collapse into one row. */
  pattern: string
  /** Number of times this endpoint has been observed. */
  count: number
  /** Epoch ms when this endpoint was first seen. */
  firstSeenAt: number
  /** Epoch ms when this endpoint was most recently observed. */
  lastSeenAt: number
  /** Last observed status code — handy for flagging 4xx/5xx endpoints. */
  lastStatus?: number
  /** Rolling set of status codes observed (dedup across calls). */
  statuses?: number[]
  /** Every iframe route that has produced this call, with per-route counts. */
  routes: Array<{ route: string; count: number; lastSeenAt: number }>
  /** Sample of most recent concrete URLs (cap 5) — preserves real ids for debugging without exploding the file. */
  sampleUrls: string[]
  /** Matched static data source name(s) — populated by the server when a known `ProjectDataEntry` endpoint matches this pattern. */
  matchedSources?: string[]
  /** Matched OpenAPI operation id, when `resolveEndpoint` finds one. */
  matchedOperationId?: string
  /** Matched OpenAPI schema location, when `resolveEndpoint` finds one. */
  matchedSchemaLocation?: string
  /** Rolling mean of `NetworkCall.durationMs` across timed samples (calls
   *  that completed and reported a duration). Drives the latency-coloured
   *  Network overlays in the Data view — green/yellow/orange/red buckets so
   *  a slow call stands out from a fast one. Missing when no completed
   *  sample has been ingested yet. */
  avgMs?: number
  /** Slowest single `durationMs` observed for this endpoint. Used for row
   *  tooltips and as the worst-case input when computing the latency
   *  bucket. */
  maxMs?: number
  /** Number of timed samples folded into `avgMs` so streaming-mean updates
   *  stay numerically stable across reloads (oldAvg * oldN + sample) / (oldN + 1). */
  latencySamples?: number
}

/** On-disk shape for the runtime endpoint catalog. */
export interface RuntimeEndpointCatalog {
  version: '1.0'
  /** Epoch ms of the last mutation. */
  updatedAt: number
  endpoints: RuntimeEndpoint[]
}

/**
 * Definition-level detail for one project-specific data source (hook, store,
 * fetch wrapper, GraphQL operation, tRPC router). The next step after the
 * catalog: the LLM has a name and needs the actual shape — signature, return
 * type, surrounding excerpt, co-located siblings, referenced types.
 *
 * V1 is regex-driven (no TS compiler), so `resolved_by` is always `'regex'`.
 * `confidence` is a coarse self-assessment based on pattern specificity —
 * agents can skip low-confidence results in favor of a follow-up Read.
 */
export interface DataSourceDetails {
  name: string
  kind: DataSource['kind']
  file: string
  line: number
  resolved_by: 'regex'
  confidence: 'high' | 'medium' | 'low'
  /** First declaration line, trimmed (e.g. "export function useUserQuery(id: string) {"). */
  signature?: string
  /** Return-type annotation when one is present on the signature (e.g. "UseUserQueryResult"). */
  return_type?: string
  /** ±N lines around the definition. Capped at code-context.ts sizing. */
  body_excerpt: string
  /** 1-based start line of body_excerpt. */
  excerpt_start_line: number
  /** 1-based end line of body_excerpt. */
  excerpt_end_line: number
  /** Leading import block from the defining file. */
  imports: string[]
  /** Other data-source exports co-located in the same file. */
  siblings: Array<{ name: string; kind: DataSource['kind']; line: number }>
  /** Named type identifiers referenced by the signature / return type. */
  referenced_types?: string[]
}

/**
 * Emitted when multiple data-source definitions share the requested name.
 * Agents disambiguate by re-calling with `file` and/or `kind`.
 */
export interface DataSourceDetailsAmbiguous {
  error: 'ambiguous'
  candidates: Array<{ name: string; kind: DataSource['kind']; file: string; line: number }>
}

/** Emitted when no definition matches the requested name. */
export interface DataSourceDetailsNotFound {
  error: 'not_found'
  name: string
}

export type DataSourceDetailsResult =
  | DataSourceDetails
  | DataSourceDetailsAmbiguous
  | DataSourceDetailsNotFound

/**
 * One node of a walkable response shape — `schemaToShape()` output
 * (data-source-shape.ts). Derived from a REAL schema only; residual `$ref`
 * cycle markers and GraphQL `$type` names degrade to honest `ref` leaves,
 * never fabricated key trees.
 */
export interface DataShapeNode {
  kind: 'object' | 'array' | 'scalar' | 'ref' | 'unknown'
  /** JSON-schema scalar type when kind 'scalar' ('string', 'number', …). */
  scalar?: string
  /** Object children by key, when kind 'object'. */
  children?: Record<string, DataShapeNode>
  /** Array item shape, when kind 'array'. */
  item?: DataShapeNode
  /** Named type (cycle marker / GraphQL $type), when kind 'ref'. */
  ref?: string
  /** Example/default value declared by the API contract at this node — REAL
   *  contract sample data (api-schema tier only), used to preview bound props
   *  honestly. For an array, an example array of items when the schema provides
   *  one. Never synthesized. */
  example?: unknown
}

/**
 * Shape resolution for one data source — the binding picker's honesty-tagged
 * ladder result. `shape_source` says which rung answered:
 *   'api-schema'     — a real API contract matched the entry's endpoint;
 *                      `shape` is walkable, `match_confidence` is the
 *                      endpoint-match score.
 *   'source-details' — regex-inferred hints only (`return_type` /
 *                      `referenced_types` / `signature`, with the regex
 *                      `details_confidence`); NO `shape` tree — expanding a
 *                      type name into keys would fabricate.
 *   'none'           — nothing known; the picker offers free-text entry,
 *                      visibly blind.
 */
export interface DataSourceShape {
  name: string
  kind: DataSource['kind']
  file: string
  endpoint?: string
  method?: string
  shape_source: 'api-schema' | 'source-details' | 'none'
  /** Walkable response shape — present only for 'api-schema'. */
  shape?: DataShapeNode
  /** Short schema-type name (e.g. "Planet[]") for agent follow-up. */
  schema_ref?: string
  schema_kind?: ApiSchema['kind']
  /** resolveEndpoint score 0..1 ('api-schema' rung). */
  match_confidence?: number
  /** Regex-resolution confidence ('source-details' rung). */
  details_confidence?: 'high' | 'medium' | 'low'
  /** Verbatim inferred hints ('source-details' rung). */
  return_type?: string
  referenced_types?: string[]
  signature?: string
}

export type DataSourceShapeResult = DataSourceShape | DataSourceDetailsAmbiguous | DataSourceDetailsNotFound

/**
 * A single element-rendering site that consumes a data source. The pair
 * (file, line) maps directly onto the `data-annotask-file` + `data-annotask-line`
 * attributes the transform injects on every DOM element, so the iframe can
 * look up rects without any additional metadata.
 *
 * Framework-agnostic. Emitted by every analyzer: Vue, React, Svelte, Solid.
 * The `tainted_symbols` field is a best-effort list of the identifiers the
 * element actually reads (e.g. `['planet', 'planet.moons']`) — used for the
 * floating highlight label.
 */
export interface BindingSite {
  file: string
  line: number
  tainted_symbols: string[]
}

/**
 * One outgoing one-hop prop edge from a parent component to a child. Lets the
 * graph builder re-analyze the child file with `prop_name` seeded as a
 * tainted symbol, so e.g. `<PlanetCard :planet="planet" />` in the parent
 * tracks through to `{{ planet.moons }}` in the child.
 *
 * `to_hint` is the child component tag name as written. The graph builder
 * resolves it to a file via the parent's imports where possible, otherwise
 * falls back to a `PascalCase` → `PascalCase.(vue|tsx|jsx|svelte)` search.
 */
export interface PropEdge {
  from_file: string
  from_line: number
  to_hint: string
  prop_name: string
  source_expr: string
}

/**
 * Per-source binding graph assembled by walking every supported file and
 * propagating one hop through prop edges. Returned by the server endpoint;
 * the shell turns `sites` into highlight targets and (optionally) displays
 * the prop edges in the detail pane.
 */
export interface SourceBindingGraph {
  source_name: string
  sites: BindingSite[]
  prop_edges: PropEdge[]
  /**
   * True when at least one file fell back to the file-level heuristic (no
   * framework-specific parser installed). The shell can warn agents that
   * discovery may include false positives from that file.
   */
  partial: boolean
  /** Per-file diagnostics for debugging the taint pass. */
  diagnostics?: Array<{ file: string; analyzer: string; note: string }>
}

/**
 * A discovered API schema (OpenAPI, GraphQL, tRPC, plain JSON Schema).
 * Raw schema bodies are passed through verbatim — the scanner doesn't normalize
 * OpenAPI and GraphQL into a single canonical form. Agents get whichever
 * shape the source emits and use `kind` to know how to read it.
 */
export interface ApiSchema {
  kind: 'openapi' | 'graphql' | 'trpc' | 'jsonschema'
  /** Whether we read it from disk or fetched over HTTP from the dev server. */
  source: 'file' | 'dev-server'
  /** Filesystem path (relative to projectRoot) or URL the schema came from. */
  location: string
  /** Origin this schema describes (e.g. `http://localhost:4320`). Used to
   *  scope highlight matches so the same path on different services stays
   *  attributed to the right service. Populated from the OpenAPI `servers`
   *  field for filesystem specs, or from `location` for HTTP probes. */
  origin?: string
  title?: string
  version?: string
  /**
   * True when this API's source (or the backend implementing it) appears to
   * live in this repo — agents should treat the schema as editable, not
   * external. Always true for schemas read off disk; true for dev-server
   * probes when a backend source directory (api/, server/, backend/, app/api/,
   * routes/api/, pages/api/, src/api/, src/server/) is present.
   */
  in_repo: boolean
  /** Number of operations exposed by this schema — agents can ask for the full list via annotask_get_api_operation. */
  operation_count: number
  operations: ApiOperation[]
}

/**
 * One callable operation in an API schema — an OpenAPI path+method, a GraphQL
 * field, or a tRPC procedure.
 */
export interface ApiOperation {
  /** OpenAPI operationId, GraphQL field name, tRPC procedure name. */
  id?: string
  /**
   * HTTP method for OpenAPI (GET/POST/...), 'query'/'mutation'/'subscription'
   * for GraphQL, 'query'/'mutation' for tRPC.
   */
  method: string
  /**
   * Path pattern. OpenAPI: "/users/{id}". GraphQL: the field name
   * ("users" / "createUser"). tRPC: the dotted procedure path ("users.list").
   */
  path: string
  summary?: string
  /** Request body / input schema — framework-native JSON Schema subset. */
  request_schema?: Record<string, unknown>
  /** Primary success response schema — 200/201 for OpenAPI, field type for GraphQL, output for tRPC. */
  response_schema?: Record<string, unknown>
  /** Named types referenced by this operation (e.g. ["Cat", "User"]) — lets agents chase details. */
  schema_refs?: string[]
}

export interface ApiSchemaCatalog {
  schemas: ApiSchema[]
  scannedAt: number
}

/**
 * Spatial metadata about a task screenshot, captured alongside the image.
 * Lets an agent relate crop pixels back to the DOM without having to guess
 * from the image alone. All rects are in iframe-local coordinates (pixels).
 */
export interface ScreenshotMeta {
  /** Visible iframe viewport at capture time. */
  viewport_rect: { w: number; h: number }
  /** devicePixelRatio at capture time — lets agents reason about crop pixel density. */
  device_pixel_ratio: number
  /** The user-selected crop bounds, if a snip was taken (vs. a full-page capture). */
  crop_rect?: { x: number; y: number; w: number; h: number }
  /** Primary element rect, set by pin / select / highlight flows. */
  element_rect?: { x: number; y: number; w: number; h: number }
  /** Arrow tasks carry both endpoints. */
  arrow_endpoints?: [{ x: number; y: number }, { x: number; y: number }]
  /** Section-request tasks carry the drawn section bounds. */
  section_bounds?: { x: number; y: number; w: number; h: number }
}

/**
 * Per-task aggregate of provider token usage. Rolled up from each assistant
 * turn's `ThreadMessage.usage` (input/output + Anthropic cache buckets), plus
 * a `turns` counter and the timestamp of the last update so the UI can show
 * "last activity X ago" without re-reading the JSONL log.
 */
export interface TokenUsage {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheCreationTokens: number
  /** Number of provider turns folded into the totals above. */
  turns: number
  /** Epoch ms of the most recent contribution. */
  lastUpdated: number
}

/** A single question the agent asks the user */
export interface AgentFeedbackQuestion {
  id: string
  text: string
  type: 'text' | 'choice'
  options?: string[]  // required when type === 'choice'
}

/** One exchange: agent asks question(s), user responds */
export interface AgentFeedbackEntry {
  asked_at: number
  message?: string  // optional markdown context/explanation
  questions: AgentFeedbackQuestion[]
  answered_at?: number
  answers?: Array<{ id: string; value: string }>
}

/**
 * Canonical list of task types recognized across HTTP, MCP, CLI, shell UI,
 * and task-summary lifting. Single source of truth — consumers must derive
 * from this tuple rather than hardcoding strings.
 */
export const TASK_TYPES = [
  'annotation',
  'section_request',
  'style_update',
  'theme_update',
  'a11y_fix',
  'error_fix',
  'perf_fix',
  'wireframe_apply',
] as const

export type TaskType = typeof TASK_TYPES[number]

/**
 * Permission mode for agent actions. Three modes, two tiers (global + task):
 *   - `default` — CLI asks for non-trivial tool use (its own default behavior)
 *   - `plan`    — read-only. Enforced natively where possible (claude's
 *                 `--permission-mode plan`, codex's read-only sandbox) and via
 *                 a model-level system-prompt directive on CLIs that lack a
 *                 native plan flag (opencode, copilot headless).
 *   - `bypass`  — bypass all permission checks (historical default)
 *
 * Resolved per-task as `task ?? global`. The persona tier was dropped — it
 * added a dropdown nobody used and the chip menu in the Conversation tab
 * already covers the "per-task tighten/loosen" flow.
 *
 * acceptEdits was removed in the same cut: only claude-local could
 * meaningfully distinguish it from `default`, so it was theater on the other
 * three CLIs.
 */
export const PERMISSION_MODES = ['default', 'plan', 'bypass'] as const

export type PermissionMode = typeof PERMISSION_MODES[number]

/** Task in the review pipeline */
export interface AnnotaskTask {
  id: string
  type: TaskType
  description: string
  file: string
  line: number
  component?: string
  mfe?: string              // MFE identity (e.g. '@myorg/my-mfe') for multi-project setups
  route?: string            // iframe route when task was created
  status: 'pending' | 'in_progress' | 'applied' | 'review' | 'accepted' | 'denied' | 'needs_info' | 'blocked'
  intent?: string
  action?: string
  context?: Record<string, unknown>
  viewport?: ViewportInfo
  color_scheme?: ColorSchemeInfo
  interaction_history?: InteractionSnapshot
  data_context?: DataContext              // codebase-derived data source info for the selected element
  screenshot?: string       // Screenshot filename, served at /__annotask/screenshots/{filename}
  screenshot_meta?: ScreenshotMeta       // spatial metadata for the screenshot
  feedback?: string         // denial notes from reviewer
  agent_feedback?: AgentFeedbackEntry[]  // agent clarification thread
  blocked_reason?: string                // why agent cannot apply this task (markdown)
  resolution?: string                    // brief note on what the agent did
  visual?: Record<string, unknown>       // annotation visual state for restoration
  /** Aggregate provider token usage across this task's conversation turns. */
  tokenUsage?: TokenUsage
  /**
   * Per-task permission-mode override. Wins over the persona and global
   * tiers when set. Absent = inherit (resolver falls back to persona, then global).
   */
  permissionMode?: PermissionMode
  createdAt: number
  updatedAt: number
}

export interface AnnotaskTaskList {
  version: '1.0'
  tasks: AnnotaskTask[]
}

/** How a theme variant is activated in the user's app (used to match iframe detection) */
export interface DesignSpecThemeSelector {
  kind: 'attribute' | 'class' | 'media' | 'default'
  host?: 'html' | 'body'        // attribute / class host element
  name?: string                 // attribute name ('data-theme') or class name ('dark')
  value?: string                // attribute value ('dark')
  media?: string                // '(prefers-color-scheme: dark)'
}

/** One theme variant — 'light', 'dark', or a named theme like 'forest' / 'solarized' */
export interface DesignSpecTheme {
  id: string                    // stable id used to key per-variant token values
  name: string                  // human label
  scheme?: 'light' | 'dark'     // classification for fallback matching when the iframe only reports scheme
  selector: DesignSpecThemeSelector
}

/** A single design token with semantic role and source tracking */
export interface DesignSpecToken {
  role: string          // semantic: 'primary', 'background', 'heading-font', 'base-size', etc.
  /**
   * Resolved value per theme variant. Keyed by DesignSpecTheme.id.
   * Tokens that don't vary across variants carry the same value for each id.
   */
  values: Record<string, string>
  cssVar?: string       // '--color-primary' (enables live preview when present)
  source: string        // human-readable: 'var(--color-primary)', 'tailwind.config:colors.primary'
  sourceFile?: string   // 'src/assets/main.css'
  sourceLine?: number   // 12
}

/** Design spec generated by /annotask-init skill */
export interface AnnotaskDesignSpec {
  version: '1.0'
  framework: {
    name: string
    version: string
    styling: string[]
  }
  /** Theme variants detected in the app. Absent/empty ⇒ single-theme app. */
  themes?: DesignSpecTheme[]
  /** Theme id used when no selector matches the iframe's current state. */
  defaultTheme?: string
  colors: DesignSpecToken[]
  typography: {
    families: DesignSpecToken[]
    scale: DesignSpecToken[]
    weights: string[]
  }
  spacing: DesignSpecToken[]
  borders: {
    radius: DesignSpecToken[]
  }
  breakpoints?: Record<string, string>
  icons: {
    library: string
    version?: string
  } | null
  components: {
    library: string
    version?: string
    used: string[]
  } | null
}

/** @deprecated Use AnnotaskDesignSpec instead */
export interface AnnotaskConfig {
  version: '1.0'
  framework: {
    name: string
    version: string
    styling: string[]
  }
  tokens: {
    colors: Record<string, string>
    spacing: Record<string, string>
    fonts: Record<string, string>
  }
  layouts: Array<{
    name: string
    classes: string
    description: string
  }>
  componentUnits: Array<{
    selector: string
    elements: string[]
    description: string
  }>
  library: {
    name: string
    version?: string
    components: string[]
  } | null
}
