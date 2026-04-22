/**
 * Shared types for the postMessage bridge between the Annotask shell
 * and the client script injected into the user's app.
 *
 * All messages use BridgeMessage as the envelope.
 * The `source` field prevents echo loops.
 * Request/response pairs share the same `id`.
 */

export interface BridgeMessage {
  type: string
  id?: string
  payload: unknown
  source: 'annotask-shell' | 'annotask-client'
}

/** Serializable rect (DOMRect can't cross postMessage in all browsers) */
export interface BridgeRect {
  x: number
  y: number
  width: number
  height: number
}

// ── Lifecycle ───────────────────────────────────────────

export interface BridgeReadyPayload {
  version: string
}

// ── Element Resolution ──────────────────────────────────

export interface ResolveAtPointPayload {
  x: number
  y: number
}

export interface ResolvedElement {
  eid: string
  file: string
  line: string
  component: string
  /** JSX/template tag name as written in source (e.g. "Button", "Flex").
   *  PascalCase source_tag signals a custom/library component, even when the
   *  DOM tag is a plain HTML element (because the library root forwarded attrs). */
  source_tag?: string
  /** Nearest ancestor component whose data-annotask-component differs from
   *  `component`. Empty when the element has no distinct wrapping component. */
  parent_component?: string
  mfe?: string
  tag: string
  rect: BridgeRect
  classes: string
  /** Visible label text (aria-label/title/textContent, normalized, <=200 chars). */
  text?: string
}

export interface ResolveTemplateGroupPayload {
  file: string
  line: string
  tagName: string
}

export interface TemplateGroupResult {
  eids: string[]
  rects: BridgeRect[]
}

export interface ResolveRectsPayload {
  eids: string[]
}

/**
 * Bulk lookup of every element whose `data-annotask-file` attribute matches
 * one of the given file paths. Used by the Data view to highlight which DOM
 * elements are sourced from which project data source.
 */
export interface ResolveByFilesPayload {
  files: string[]
}

export interface ResolveByFilesMatch {
  file: string
  eid: string
  line: string
  rect: BridgeRect
}

export interface ResolveByFilesResult {
  matches: ResolveByFilesMatch[]
  /** True when the per-request rect cap was hit and the result was truncated. */
  truncated?: boolean
}

/**
 * Precise location-level lookup used by the Data view. Each location narrows
 * to one element: the one whose `data-annotask-file` equals `file` AND whose
 * `data-annotask-line` equals `line`. `line: 0` is treated as a wildcard —
 * the match turns into a file-level lookup (back-compat with the file-level
 * fallback analyzer). `ref` is an opaque token round-tripped in the response
 * so callers can attribute matches back to the originating site.
 */
export interface ResolveByLocation {
  file: string
  line: number
  /** Optional source tag filter. When present, only elements whose
   *  `data-annotask-source-tag` matches this tag name count as a hit —
   *  lets the Components view pick the outer Card root instead of an
   *  inner Checkbox that happens to share the same source line. */
  tag?: string
  ref?: string
}

export interface ResolveByLocationsPayload {
  locations: ResolveByLocation[]
}

export interface ResolveByLocationsMatch {
  ref?: string
  file: string
  line: number
  eid: string
  rect: BridgeRect
}

export interface ResolveByLocationsResult {
  matches: ResolveByLocationsMatch[]
  truncated?: boolean
}

/**
 * Lists every project-defined component currently rendered in the iframe,
 * grouped by name. `file` / `line` point at the first instance's root
 * element (the definition anchor). `instances` carries per-instance
 * (file, line, eid, rect) so the shell can drive highlights.
 */
export interface ProjectComponentInstance {
  file: string
  line: string
  eid: string
  rect: BridgeRect
  /** MFE id the instance's root element belongs to, read from
   *  `data-annotask-mfe`. Empty for non-MFE workspaces. The shell uses this
   *  to translate `file` (MFE-local) back to a workspace-relative path when
   *  comparing against the components catalog. */
  mfe?: string
}

export interface ProjectComponentInfo {
  name: string
  file: string
  line: string
  count: number
  instances: ProjectComponentInstance[]
}

export interface ListProjectComponentsResult {
  components: ProjectComponentInfo[]
}

/**
 * Resolves a list of CSS selectors against the iframe DOM. Used by the a11y
 * highlight overlay to convert axe's `node.target` selectors into eids + rects.
 * For each selector, returns the first matching element's eid + rect, or null.
 */
export interface ResolveBySelectorsPayload {
  selectors: string[]
}

export interface ResolveBySelectorsMatch {
  selector: string
  eid: string | null
  rect: BridgeRect | null
}

export interface ResolveBySelectorsResult {
  matches: ResolveBySelectorsMatch[]
}

// ── Accessibility Inspection ───────────────────────────

/**
 * Per-element accessibility metadata that the shell shows in the inspector
 * and attaches to a11y_fix tasks. Fields:
 * - `accessible_name`: computed name (simplified AccName algorithm)
 * - `name_source`: which signal produced the name (aria-label, labelledby, alt, label, text, none)
 * - `role`: explicit ARIA role or inferred from tag
 * - `role_source`: 'explicit' | 'implicit' | 'none'
 * - `tabindex`: numeric tabindex if set
 * - `focusable`: whether the element receives keyboard focus
 * - `focus_indicator`: 'visible' | 'none' | 'unknown' — outline/box-shadow probe
 * - `contrast`: foreground/background hex + ratio + WCAG levels (only when text)
 * - `aria_attrs`: list of ARIA attributes present and their values
 */
export interface AccessibilityInfo {
  eid: string
  tag: string
  accessible_name: string
  name_source: 'aria-labelledby' | 'aria-label' | 'label' | 'alt' | 'title' | 'text' | 'placeholder' | 'value' | 'none'
  role: string
  role_source: 'explicit' | 'implicit' | 'none'
  tabindex: number | null
  focusable: boolean
  focus_indicator: 'visible' | 'none' | 'unknown'
  contrast?: {
    foreground: string
    background: string
    ratio: number
    aa_normal: boolean
    aa_large: boolean
    aaa_normal: boolean
    aaa_large: boolean
  }
  aria_attrs: Array<{ name: string; value: string }>
}

export interface ComputeAccessibilityInfoPayload {
  eids: string[]
}

export interface ComputeAccessibilityInfoResult {
  items: Array<AccessibilityInfo | null>
}

// ── Tab-order Inspection ───────────────────────────────

/**
 * Single entry in the computed tab order. `index` is 1-based position in the
 * sequence (skip elements get index = -1). `domOrder` is the element's
 * absolute position in document order among focusables. When `index` and
 * `domOrder` disagree, the element is part of a tab/visual-order mismatch.
 */
export interface TabOrderEntry {
  eid: string
  rect: BridgeRect
  tag: string
  role: string
  accessible_name: string
  tabindex: number | null
  is_positive_tabindex: boolean
  is_disabled_focusable: boolean
  index: number
  domOrder: number
}

export interface ComputeTabOrderResult {
  entries: TabOrderEntry[]
  /** Element pairs where DOM order and tab order disagree (visual flow vs keyboard flow). */
  reorderings: Array<{ aEid: string; bEid: string; reason: string }>
}

// ── Component Chain Resolution ─────────────────────────

/**
 * Walks the owning-component chain for a selected element. `primary` is the
 * component whose template renders the element (from `data-annotask-*`
 * attributes on the element itself); `ancestors` are outer components
 * wrapping it, nearest first. Library/category are filled server-side; the
 * bridge only reports what is on the DOM.
 */
export interface ResolveComponentChainPayload {
  eid: string
}

export interface ComponentChainEntry {
  name: string
  file?: string
  line?: number
  mfe?: string
}

export interface ResolveComponentChainResult {
  primary: ComponentChainEntry
  /** Rendered outerHTML of the selected element, with data-annotask-* attrs
   *  stripped. Truncated to ~4KB — agents see what shipped to the DOM without
   *  bloating the task payload. */
  rendered?: string
}

// ── Style Operations ────────────────────────────────────

export interface StyleApplyPayload {
  eid: string
  property: string
  value: string
}

export interface StyleApplyResult {
  before: string
}

export interface StyleApplyBatchPayload {
  eids: string[]
  property: string
  value: string
}

export interface StyleGetComputedPayload {
  eid: string
  properties: string[]
}

export interface StyleGetComputedResult {
  styles: Record<string, string>
}

export interface ClassSetPayload {
  eid: string
  classes: string
}

export interface ClassSetResult {
  before: string
}

export interface ClassSetBatchPayload {
  eids: string[]
  classes: string
}

export interface StyleUndoPayload {
  eid: string
  property: string
  value: string
}

export interface ClassUndoPayload {
  eid: string
  classes: string
}

// ── Layout ──────────────────────────────────────────────

export interface LayoutContainerData {
  eid: string
  display: 'flex' | 'grid'
  direction: string
  rect: BridgeRect
  columns?: number[]
  rows?: number[]
  columnGap: number
  rowGap: number
  templateColumns?: string
  templateRows?: string
}

export interface LayoutAddTrackPayload {
  eid: string
  axis: 'col' | 'row'
}

export interface LayoutAddTrackResult {
  property: string
  before: string
  after: string
}

export interface LayoutAddChildResult {
  childEid: string
}

// ── Classification ──────────────────────────────────────

export interface ElementClassificationData {
  role: 'container' | 'content' | 'component'
  display: string
  isFlexContainer: boolean
  isGridContainer: boolean
  flexDirection?: string
  childCount: number
  isComponentUnit: boolean
}

// ── Interaction Events (client → shell, no response) ────

export interface HoverEnterEvent {
  eid: string
  tag: string
  file: string
  component: string
  source_tag?: string
  parent_component?: string
  rect: BridgeRect
}

export interface ClickElementEvent {
  eid: string
  sourceEid: string
  file: string
  line: string
  component: string
  source_tag?: string
  parent_component?: string
  mfe?: string
  tag: string
  classes: string
  rect: BridgeRect
  shiftKey: boolean
  clientX: number
  clientY: number
  /** Visible label text (aria-label/title/textContent, normalized, <=200 chars). */
  text?: string
}

export interface RouteChangedEvent {
  path: string
}

export interface SelectionTextEvent {
  text: string
  eid: string
  file: string
  line: number
  component: string
  source_tag?: string
  mfe?: string
  tag: string
  rect?: { x: number; y: number; width: number; height: number }
  rects?: { x: number; y: number; width: number; height: number }[]
}

export interface KeyDownEvent {
  key: string
  ctrlKey: boolean
  metaKey: boolean
  shiftKey: boolean
}

// ── Mode ────────────────────────────────────────────────

export type InteractionMode = 'select' | 'interact' | 'pin' | 'arrow' | 'draw' | 'highlight'

export interface ModeSetPayload {
  mode: InteractionMode
}

// ── Theme ───────────────────────────────────────────────

export interface ThemeInjectCssPayload {
  css: string
  styleId: string
}

export interface ThemeRemoveCssPayload {
  styleId: string
}

// ── Color Palette ───────────────────────────────────────

export interface ColorSwatch {
  name: string
  value: string
}

// ── Color Scheme ────────────────────────────────────────

export type ColorScheme = 'light' | 'dark'

/** How the color scheme was detected in the user's app */
export type ColorSchemeSource =
  | 'attribute'           // theme attribute on <html> or <body>
  | 'class'               // theme class on <html> or <body>
  | 'css-color-scheme'    // CSS color-scheme property on <html>
  | 'background-luminance'// computed background luminance — universal fallback
  | 'media-query'         // prefers-color-scheme media query
  | 'fallback'            // no signal — defaulted to light

/**
 * A DOM marker that indicates the user's theming convention. Lets agents
 * locate the theme control even when scheme was inferred from luminance.
 */
export type ColorSchemeMarker =
  | { kind: 'attribute'; host: 'html' | 'body'; name: string; value: string }
  | { kind: 'class'; host: 'html' | 'body'; name: string; framework: string }

export interface ColorSchemeResult {
  scheme: ColorScheme
  source: ColorSchemeSource
  marker?: ColorSchemeMarker
}

/**
 * Unsolicited push from the client when the iframe's color scheme changes —
 * class/attribute toggled on html/body, or prefers-color-scheme flips. Payload
 * is a ColorSchemeResult. Lets the shell's Theme page follow the iframe live
 * instead of polling.
 */
export type ColorSchemeChangedEvent = ColorSchemeResult

// ── Insert / Move ───────────────────────────────────────

export interface InsertPlaceholderPayload {
  targetEid: string
  position: 'before' | 'after' | 'append' | 'prepend'
  tag: string
  classes?: string
  textContent?: string
  category?: string
  library?: string
  defaultProps?: Record<string, unknown>
}

export interface InsertPlaceholderResult {
  placeholderEid: string
}

export interface MoveElementPayload {
  eid: string
  targetEid: string
  position: 'before' | 'after' | 'append' | 'prepend'
}

export interface InsertComponentPayload {
  targetEid: string
  position: 'before' | 'after' | 'append' | 'prepend'
  componentName: string
  props?: Record<string, unknown>
}

export interface InsertComponentResult {
  eid: string
  mounted: boolean
}

/** @deprecated Use InsertComponentPayload */
export type InsertVueComponentPayload = InsertComponentPayload
/** @deprecated Use InsertComponentResult */
export type InsertVueComponentResult = InsertComponentResult

// ── Component Library ──────────────────────────────────

export interface ComponentPropInfo {
  name: string
  type: string | null
  required: boolean
  default: unknown
}

export interface ComponentInfo {
  name: string
  props: ComponentPropInfo[]
}

export interface ComponentsListResult {
  components: ComponentInfo[]
}

// ── Source Mapping Check ────────────────────────────────

export interface CheckSourceMappingResult {
  hasMapping: boolean
}

// ── Console / Error Monitor ────────────────────────────

export interface ConsoleErrorEvent {
  level: 'error' | 'warn'
  message: string
  stack: string
  /** Number of times this exact error has occurred */
  count: number
  timestamp: number
}

export interface UnhandledErrorEvent {
  type: 'error' | 'rejection'
  message: string
  stack: string
  timestamp: number
}

// ── Performance ────────────────────────────────────────

export type WebVitalRating = 'good' | 'needs-improvement' | 'poor'

export interface WebVitalMetric {
  name: 'LCP' | 'FCP' | 'CLS' | 'INP' | 'TTFB'
  value: number
  rating: WebVitalRating
}

export interface ResourceEntry {
  name: string
  initiatorType: string
  transferSize: number
  duration: number
  startTime: number
}

export interface LongTaskEntry {
  startTime: number
  duration: number
}

export interface LayoutShiftEntry {
  value: number
  startTime: number
  hadRecentInput: boolean
}

export interface PerfNavigationTiming {
  domContentLoaded: number
  loadComplete: number
  domInteractive: number
  ttfb: number
  responseTime: number
  domProcessing: number
}

/** A single event captured during a performance recording */
export interface PerfTimelineEvent {
  /** Milliseconds since recording started */
  time: number
  type: 'action' | 'long-task' | 'layout-shift' | 'paint' | 'navigation'
  label: string
  duration?: number
  value?: number
  detail?: string
}

/** Result from perf:stop-recording */
export interface PerfRecording {
  startTime: number
  endTime: number
  duration: number
  url: string
  route: string
  events: PerfTimelineEvent[]
  vitals: WebVitalMetric[]
  navigation?: PerfNavigationTiming
  resources: ResourceEntry[]
  error?: string
}

/** Result from perf:scan (quick snapshot of current vitals) */
export interface PerfScanResult {
  timestamp: number
  url: string
  route: string
  vitals: WebVitalMetric[]
  navigation?: PerfNavigationTiming
  resources: ResourceEntry[]
  error?: string
}

// ── Network Monitor ────────────────────────────────────

/**
 * One captured fetch / XMLHttpRequest call pushed from the iframe to the shell.
 * Mirrors `NetworkCall` in schema.ts — defined here as a plain interface so the
 * plain-JS bridge client doesn't have to import TypeScript-only modules.
 *
 * `initiator` distinguishes calls the monitor hooked: 'fetch' (window.fetch),
 * 'xhr' (XMLHttpRequest.send), 'beacon' (navigator.sendBeacon — which can't
 * carry a response, so these never get a status).
 */
export interface NetworkCallEvent {
  id: string
  initiator: 'fetch' | 'xhr' | 'beacon'
  method: string
  url: string
  origin: string
  path: string
  pathNoQuery: string
  status?: number
  contentType?: string
  route: string
  startedAt: number
  durationMs?: number
  error?: string
  contentLength?: number
}

/**
 * Batched push from the iframe — emitted every ~1s while there are unreported
 * calls in the buffer, and immediately when the user navigates (so the server
 * aggregator always has a chance to bucket calls under the previous route
 * before the route changes).
 */
export interface NetworkCallsBatch {
  calls: NetworkCallEvent[]
}

/**
 * Unsolicited push emitted just after `route:changed` so the aggregator knows
 * to treat subsequent calls as belonging to a new page load for per-load
 * accounting. Counts persist across loads — this is just a marker.
 */
export interface NetworkPageLoadEvent {
  route: string
  /** Epoch ms at load detection. */
  at: number
  /** Incrementing per-iframe load counter — helps the aggregator dedup the same iframe reloading. */
  loadId: number
}
