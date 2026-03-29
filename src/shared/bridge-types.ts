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
  tag: string
  rect: BridgeRect
  classes: string
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
  rect: BridgeRect
}

export interface ClickElementEvent {
  eid: string
  sourceEid: string
  file: string
  line: string
  component: string
  tag: string
  classes: string
  rect: BridgeRect
  shiftKey: boolean
  clientX: number
  clientY: number
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
  tag: string
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

// ── Source Mapping Check ────────────────────────────────

export interface CheckSourceMappingResult {
  hasMapping: boolean
}
