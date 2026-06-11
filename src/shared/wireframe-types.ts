/**
 * Wireframe document — the persisted, multi-route artifact behind the
 * drag-and-drop wireframe tool. One `.annotask/wireframe.json` per project,
 * keyed by iframe route (like RuntimeEndpoint.routes[]). This single definition
 * is shared by the server GET/PUT validator, the shell `useWireframeDoc`
 * composable, and the agent-facing `wireframe_apply` task context — so the
 * persisted shape, the shell, and codegen never drift.
 *
 * `inserted` deliberately mirrors `InsertChangeRecord.inserted`
 * (useStyleEditor) and `ComponentInsertChange.component` (schema.ts) so the
 * `wireframe_apply` playbook can lift an instance straight into the existing
 * component-insert codegen shape.
 */

import type { DataSource } from '../schema'

/** How faithfully a dropped component renders on the canvas. */
export type WireframeFidelity = 'live' | 'isolated-preview' | 'placeholder'

/**
 * Binding from a wireframe block (palette component or drawn section) to a
 * REAL project data source — scanner-catalog identity, never invented. The
 * agent re-grounds it via `annotask_get_data_source_details` /
 * `annotask_get_api_operation` before wiring; `shape_source` is the honesty
 * tag for where the drill-down shape came from.
 */
export interface WireframeDataBinding {
  /** REAL catalog identity — scanner names, never invented. */
  kind: DataSource['kind']
  /** e.g. "useUserQuery" */
  name: string
  module?: string
  endpoint?: string
  /** Drill-down into the resolved shape, user-selected.
   *  e.g. "items[]" (the list), "data.user" (an object). */
  path?: string
  /** Keys the element should display, when the user narrowed them.
   *  e.g. ["name", "price"]. */
  fields?: string[]
  /** Where the shape came from — the honesty tag the agent sees.
   *  'api-schema' (real contract) | 'source-details' (regex inference,
   *  confidence attached) | 'none' (user typed the path blind). */
  shape_source: 'api-schema' | 'source-details' | 'none'
}

/** Runtime mirror of DataSource['kind'] — typed against the union so schema
 *  drift breaks typecheck instead of silently accepting unknown kinds. */
export const DATA_SOURCE_KINDS: readonly DataSource['kind'][] =
  ['composable', 'signal', 'store', 'fetch', 'graphql', 'loader', 'rpc']

const SHAPE_SOURCES: readonly string[] = ['api-schema', 'source-details', 'none']

export function isWireframeDataBinding(value: unknown): value is WireframeDataBinding {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const b = value as Record<string, unknown>
  if (!DATA_SOURCE_KINDS.includes(b.kind as DataSource['kind'])) return false
  if (typeof b.name !== 'string' || !b.name) return false
  if (!SHAPE_SOURCES.includes(b.shape_source as string)) return false
  for (const k of ['module', 'endpoint', 'path'] as const) {
    if (b[k] !== undefined && (typeof b[k] !== 'string' || !b[k])) return false
  }
  if (b.fields !== undefined) {
    if (!Array.isArray(b.fields)) return false
    if (!(b.fields as unknown[]).every((f) => typeof f === 'string' && !!f)) return false
  }
  return true
}

/** What was dropped: a real project/library component, a raw HTML element, or a
 *  styled layout preset (flex row, grid, container, …). */
export type WireframeKind = 'component' | 'html' | 'layout-preset'

/** Where the new node sits relative to the drop target. */
export type WireframePosition = 'before' | 'after' | 'append' | 'prepend'

/**
 * Lifecycle of one placement. Absent means 'placed' (legacy docs predate the
 * field). 'building' = batched into a wireframe_apply task that is still in
 * flight; 'applied' is reserved for instances whose source edit landed but
 * whose doc entry hasn't been cleared yet. Only 'placed' instances re-mount
 * on reload and only 'placed' instances are collected by Build — that pair of
 * rules is what stops a placement from rendering NEXT TO the agent's freshly
 * applied component during review, and stops a double-click from emitting a
 * duplicate task.
 */
export type WireframeInstanceStatus = 'placed' | 'building' | 'applied'

export interface WireframeAnchor {
  /** Source file of the drop target, as emitted by `data-annotask-file`
   *  (package-local). The durable half of the anchor. */
  file: string
  /** Opening-tag line of the drop target (`data-annotask-line`). */
  line: number
  /** Placement relative to the target element. */
  position: WireframePosition
  /** The drop target's owning component — context for the codegen agent. */
  component?: string
  /** The drop target's tag — helps re-resolve the anchor after reload/HMR. */
  targetTag?: string
  /** Volatile same-session element id of the target. NOT durable across reload;
   *  re-resolved from (file, line, targetTag) via `resolve:template-group`. */
  targetEid?: string
}

export interface WireframeInserted {
  /** HTML tag, or the lowercased component tag. */
  tag: string
  /** Component constructor name when `kind === 'component'`. */
  componentName?: string
  library?: string
  /** Import specifier (e.g. "primevue/button") for on-demand re-mount. */
  module?: string
  props?: Record<string, unknown>
  classes?: string
  text_content?: string
}

export interface WireframeInstance {
  id: string
  kind: WireframeKind
  anchor: WireframeAnchor
  inserted: WireframeInserted
  fidelity: WireframeFidelity
  /** Whether the live mount actually rendered (components only; always true for
   *  html/layout-preset placeholders, which render deterministically). */
  mounted: boolean
  /** Lifecycle state. Optional so legacy docs stay valid; absent == 'placed'. */
  status?: WireframeInstanceStatus
  /** The wireframe_apply task this instance was batched into (status
   *  'building'/'applied'). Cleared when the task is deleted (revert) and the
   *  whole instance is removed when the task is accepted. */
  taskId?: string
  /** Display-only sample props the user actually previewed on the canvas.
   *  Kept SEPARATE from `inserted.props` (the real props): the agent uses
   *  these as hints for sensible labels/values, and reapply mounts with them
   *  so a reload doesn't degrade to an empty 'rendered-empty' placeholder. */
  previewProps?: Record<string, unknown>
  createdAt: number
  updatedAt?: number
}

// ── Snapshot-wireframe canvas ────────────────────────────
// The frozen-image canvas behind Wireframe mode: per-block html2canvas
// captures of the live route, manipulated as positioned images. Block PNGs
// live on disk (.annotask/wireframe-snapshots/) — the doc stores FILENAMES,
// never dataUrls, so the CAS round-trip stays small.

/** 'captured' — rasterized from the live route (carries a source anchor).
 *  'palette'  — a component snapshot dropped from the palette.
 *  'placeholder' — a user-drawn labeled box; stays visibly a placeholder. */
export type WireframeBlockKind = 'captured' | 'palette' | 'placeholder'

/** Iframe-document CSS px at capture time — the canvas coordinate space. */
export interface WireframeBlockRect {
  x: number
  y: number
  width: number
  height: number
}

/** Source identity of a captured block (data-annotask-* at capture time).
 *  `file` may be '' when the element carried no stamp — honest, no chip. */
export interface WireframeBlockAnchor {
  file: string
  line: number
  component?: string
  sourceTag?: string
  tag?: string
  /** First class name at capture time — the human-distinct direction label
   *  ('toolbar', 'layout'); component names repeat across a page's blocks. */
  cssClass?: string
  /** 'header' | 'nav' | 'footer' | 'aside' | 'content' from block discovery. */
  role?: string
}

/** What a palette block stands for — REAL scanner names, mirrors
 *  WireframeInserted so apply-time codegen can lift it directly. */
export interface WireframePaletteRef {
  tag: string
  componentName?: string
  library?: string
  module?: string
  props?: Record<string, unknown>
  previewProps?: Record<string, unknown>
}

export interface WireframeBlock {
  id: string
  kind: WireframeBlockKind
  /** Current rect on the canvas (the user's transform). */
  rect: WireframeBlockRect
  z: number
  /** USER-SAID, verbatim — never mixed with tool-measured facts. */
  note?: string
  /** Snapshot filename under .annotask/wireframe-snapshots/. */
  image?: string
  createdAt: number
  updatedAt?: number
  // captured blocks
  anchor?: WireframeBlockAnchor
  /** Rect as captured — the diff baseline for move/resize directions. */
  originalRect?: WireframeBlockRect
  /** Soft delete: hidden on the canvas but kept so the diff sees it. */
  deleted?: boolean
  captureError?: string
  clipped?: boolean
  /** Exploded container: this block is now the SHELL backdrop (its image has
   *  the children hidden); its children exist as separate blocks. Not
   *  explodable again. */
  shell?: boolean
  /** Set on duplicates; the original block's id (image file is shared). */
  duplicateOf?: string
  // palette blocks
  component?: WireframePaletteRef
  fidelity?: WireframeFidelity
  // placeholder blocks
  label?: string
  /** Data-source binding (any kind — palette components and drawn sections).
   *  REAL catalog identity; carried into the add direction's `added.data`. */
  data?: WireframeDataBinding
}

export interface WireframeCanvasState {
  capturedAt: number
  viewport: { width: number; height: number; docWidth: number; docHeight: number; scale: number }
  /** Full-document capture filename — the honest "before" for composites. */
  fullImage?: string
  /** Block discovery hit the cap; some page regions have no block. */
  truncated?: boolean
  blocks: WireframeBlock[]
  /** Apply lifecycle, mirroring WireframeInstanceStatus semantics:
   *  absent/'sketch' = editable; 'building' = batched into a task in flight. */
  status?: 'sketch' | 'building'
  taskId?: string
}

export interface WireframeRoute {
  route: string
  instances: WireframeInstance[]
  /** Snapshot-wireframe canvas for this route (absent until first capture). */
  canvas?: WireframeCanvasState
  updatedAt?: number
}

export interface WireframeDocument {
  version: '1.0'
  updatedAt: number
  /** Server-managed write revision. Stamped/incremented by the store on every
   *  successful PUT; a PUT whose `rev` doesn't match the current doc is
   *  rejected with 409 so two tabs can't last-writer-wins each other. Absent
   *  only on legacy docs that predate the field (first PUT stamps it). */
  rev?: number
  routes: WireframeRoute[]
}

export const WIREFRAME_DOC_VERSION = '1.0' as const

const WIREFRAME_KINDS: readonly string[] = ['component', 'html', 'layout-preset']
const WIREFRAME_POSITIONS: readonly string[] = ['before', 'after', 'append', 'prepend']
const WIREFRAME_STATUSES: readonly string[] = ['placed', 'building', 'applied']
const BLOCK_KINDS: readonly string[] = ['captured', 'palette', 'placeholder']
const CANVAS_STATUSES: readonly string[] = ['sketch', 'building']
/** Snapshot filenames are shell-minted ids + .png — reject anything else at
 *  the PUT boundary so a poisoned doc can't traverse on the serve path. The
 *  server's upload/serve/delete routes enforce the same shape. */
export const WIREFRAME_SNAPSHOT_FILENAME_RE = /^[a-z0-9][a-z0-9-]{0,63}\.png$/

export function emptyWireframeDocument(): WireframeDocument {
  return { version: WIREFRAME_DOC_VERSION, updatedAt: 0, routes: [] }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

/** Instance-depth shape guard. The PUT boundary must reject a single malformed
 *  instance — once persisted it would poison every subsequent reapply pass and
 *  the agent's wireframe_apply context. */
export function isWireframeInstance(value: unknown): value is WireframeInstance {
  if (!isPlainObject(value)) return false
  if (typeof value.id !== 'string' || !value.id) return false
  if (!WIREFRAME_KINDS.includes(value.kind as string)) return false
  if (!isPlainObject(value.anchor)) return false
  const anchor = value.anchor as Record<string, unknown>
  if (typeof anchor.file !== 'string') return false
  if (typeof anchor.line !== 'number') return false
  if (!WIREFRAME_POSITIONS.includes(anchor.position as string)) return false
  if (!isPlainObject(value.inserted)) return false
  if (typeof (value.inserted as Record<string, unknown>).tag !== 'string') return false
  // Optional lifecycle fields — when present they must be well-formed, or the
  // accept/delete hooks and the Build collector would misread them.
  if (value.status !== undefined && !WIREFRAME_STATUSES.includes(value.status as string)) return false
  if (value.taskId !== undefined && typeof value.taskId !== 'string') return false
  if (value.previewProps !== undefined && !isPlainObject(value.previewProps)) return false
  return true
}

function isBlockRect(value: unknown): value is WireframeBlockRect {
  if (!isPlainObject(value)) return false
  return typeof value.x === 'number' && typeof value.y === 'number'
    && typeof value.width === 'number' && typeof value.height === 'number'
}

/** Block-depth shape guard with per-kind requirements: a captured block must
 *  carry its anchor + original rect (the diff baseline), a palette block its
 *  component ref, a placeholder its label — a block missing its kind's
 *  substance could only fabricate. */
export function isWireframeBlock(value: unknown): value is WireframeBlock {
  if (!isPlainObject(value)) return false
  if (typeof value.id !== 'string' || !value.id) return false
  if (!BLOCK_KINDS.includes(value.kind as string)) return false
  if (!isBlockRect(value.rect)) return false
  if (typeof value.z !== 'number') return false
  if (typeof value.createdAt !== 'number') return false
  if (value.note !== undefined && typeof value.note !== 'string') return false
  if (value.image !== undefined && !WIREFRAME_SNAPSHOT_FILENAME_RE.test(value.image as string)) return false
  if (value.deleted !== undefined && typeof value.deleted !== 'boolean') return false
  if (value.shell !== undefined && typeof value.shell !== 'boolean') return false
  if (value.duplicateOf !== undefined && typeof value.duplicateOf !== 'string') return false
  if (value.data !== undefined && !isWireframeDataBinding(value.data)) return false
  if (value.kind === 'captured') {
    const anchor = value.anchor as Record<string, unknown> | undefined
    if (!isPlainObject(anchor) || typeof anchor.file !== 'string' || typeof anchor.line !== 'number') return false
    if (!isBlockRect(value.originalRect)) return false
  }
  if (value.kind === 'palette') {
    const component = value.component as Record<string, unknown> | undefined
    if (!isPlainObject(component) || typeof component.tag !== 'string' || !component.tag) return false
  }
  if (value.kind === 'placeholder') {
    if (typeof value.label !== 'string' || !value.label) return false
  }
  return true
}

export function isWireframeCanvasState(value: unknown): value is WireframeCanvasState {
  if (!isPlainObject(value)) return false
  if (typeof value.capturedAt !== 'number') return false
  const vp = value.viewport as Record<string, unknown> | undefined
  if (!isPlainObject(vp)) return false
  for (const k of ['width', 'height', 'docWidth', 'docHeight', 'scale']) {
    if (typeof vp[k] !== 'number') return false
  }
  if (value.fullImage !== undefined && !WIREFRAME_SNAPSHOT_FILENAME_RE.test(value.fullImage as string)) return false
  if (value.status !== undefined && !CANVAS_STATUSES.includes(value.status as string)) return false
  if (value.taskId !== undefined && typeof value.taskId !== 'string') return false
  if (!Array.isArray(value.blocks)) return false
  return (value.blocks as unknown[]).every(isWireframeBlock)
}

/** Structural validation for the GET/PUT boundary. Mirrors the agent-configs
 *  PATCH validation discipline: shape-guard before persisting. Validates down
 *  to instance/block depth so one bad instance or block can't be persisted. */
export function isWireframeDocument(value: unknown): value is WireframeDocument {
  if (!isPlainObject(value)) return false
  const doc = value as Record<string, unknown>
  if (doc.version !== WIREFRAME_DOC_VERSION) return false
  if (typeof doc.updatedAt !== 'number') return false
  if (doc.rev !== undefined && typeof doc.rev !== 'number') return false
  if (!Array.isArray(doc.routes)) return false
  return doc.routes.every((r) => {
    if (!isPlainObject(r)) return false
    const route = r as Record<string, unknown>
    if (typeof route.route !== 'string' || !Array.isArray(route.instances)) return false
    if (route.canvas !== undefined && !isWireframeCanvasState(route.canvas)) return false
    return (route.instances as unknown[]).every(isWireframeInstance)
  })
}
