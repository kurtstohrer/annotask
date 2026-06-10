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

/** How faithfully a dropped component renders on the canvas. */
export type WireframeFidelity = 'live' | 'isolated-preview' | 'placeholder'

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

export interface WireframeRoute {
  route: string
  instances: WireframeInstance[]
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

/** Structural validation for the GET/PUT boundary. Mirrors the agent-configs
 *  PATCH validation discipline: shape-guard before persisting. Validates down
 *  to instance depth so one bad instance can't be persisted. */
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
    return (route.instances as unknown[]).every(isWireframeInstance)
  })
}
