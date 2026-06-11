import { ref } from 'vue'
import { on as wsOn } from '../services/wsClient'
import {
  emptyWireframeDocument,
  type WireframeDocument,
  type WireframeInstance,
  type WireframeCanvasState,
} from '../../shared/wireframe-types'

/** The subset of the iframe manager that re-applying instances needs. */
export interface WireframeIframe {
  findTemplateGroup: (file: string, line: string, tagName: string) => Promise<{ eids: string[] }>
  insertComponent: (targetEid: string, position: string, componentName: string, props?: Record<string, unknown>, module?: string, instanceId?: string) => Promise<{ eid: string }>
  insertPlaceholder: (
    targetEid: string,
    position: string,
    tag: string,
    opts?: { classes?: string; textContent?: string; category?: string; library?: string; defaultProps?: Record<string, unknown>; instanceId?: string },
  ) => Promise<string>
  /** Optional DOM idempotency probe: lets reapply skip an instance whose
   *  `[data-annotask-instance]` node is still in the iframe (HMR re-renders
   *  don't always wipe the DOM, but they do re-fire bridgeReady → force
   *  reapply). useIframeManager satisfies this structurally. */
  resolveBySelectors?: (selectors: string[]) => Promise<Array<{ selector: string; eid: string | null }>>
}

// Module-singleton so every consumer shares one document + one WS subscription.
const doc = ref<WireframeDocument>(emptyWireframeDocument())
const isLoading = ref(false)
const loadError = ref<string | null>(null)
// Instances whose durable (file, line, tag) anchor no longer resolves in the
// live DOM — source drifted since the placement. Surfaced as a badge in the
// placements panel instead of a console.warn nobody sees.
const staleIds = ref<string[]>([])
// Instances whose insert call threw during the last reapply pass. Kept
// separate from staleIds: a failure is a bug/transient, a stale anchor is the
// user's source moving on.
const failedIds = ref<string[]>([])

let initialized = false
// Re-apply de-dup: which instance ids have been mounted into the CURRENT iframe
// document for the route below. Reset on route change or a forced reload.
let appliedRoute: string | null = null
const appliedIds = new Set<string>()

function setMembership(list: typeof staleIds, id: string, present: boolean): void {
  const has = list.value.includes(id)
  if (present && !has) list.value = [...list.value, id]
  else if (!present && has) list.value = list.value.filter((x) => x !== id)
}

async function load(): Promise<void> {
  isLoading.value = true
  loadError.value = null
  try {
    const res = await fetch('/__annotask/api/wireframe')
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    doc.value = (await res.json()) as WireframeDocument
  } catch (err) {
    loadError.value = (err as Error).message ?? 'Failed to load wireframe'
    doc.value = emptyWireframeDocument()
  } finally {
    isLoading.value = false
  }
}

async function persist(): Promise<void> {
  doc.value.updatedAt = Date.now()
  try {
    const res = await fetch('/__annotask/api/wireframe', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      // doc.value carries the rev from the last GET/PUT — the server's CAS
      // rejects a stale one so two tabs can't last-writer-wins each other.
      body: JSON.stringify(doc.value),
    })
    if (res.status === 409) {
      // Another writer (tab, or the server's task-accept hook) committed
      // first. Re-load and surface; never auto-retry the write — replaying
      // this in-memory doc would silently clobber the other writer's changes.
      await load()
      loadError.value = 'Wireframe changed in another tab — reloaded.'
      return
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    doc.value = (await res.json()) as WireframeDocument
  } catch (err) {
    loadError.value = (err as Error).message ?? 'Failed to save wireframe'
  }
}

function instancesForRoute(route: string): WireframeInstance[] {
  return doc.value.routes.find((r) => r.route === route)?.instances ?? []
}

async function saveInstance(route: string, instance: WireframeInstance): Promise<void> {
  let entry = doc.value.routes.find((r) => r.route === route)
  if (!entry) {
    entry = { route, instances: [] }
    doc.value.routes.push(entry)
  }
  const idx = entry.instances.findIndex((i) => i.id === instance.id)
  if (idx >= 0) entry.instances.splice(idx, 1, instance)
  else entry.instances.push(instance)
  entry.updatedAt = Date.now()
  await persist()
}

/** Patch one instance in place (e.g. a moved anchor or status change) and
 *  persist. Merges `patch.anchor` shallowly so callers can pass just the moved
 *  fields. No-ops if the instance isn't found. */
async function updateInstance(route: string, id: string, patch: Partial<WireframeInstance>): Promise<void> {
  const entry = doc.value.routes.find((r) => r.route === route)
  const inst = entry?.instances.find((i) => i.id === id)
  if (!entry || !inst) return
  const nextAnchor = patch.anchor ? { ...inst.anchor, ...patch.anchor } : inst.anchor
  Object.assign(inst, patch, { anchor: nextAnchor, updatedAt: Date.now() })
  entry.updatedAt = Date.now()
  await persist()
}

/**
 * Stamp a batch of instances 'building' against the task that now owns them —
 * one persist for the whole batch, not one PUT per instance. Called by Build
 * right after the wireframe_apply task is created; the stamp is what makes a
 * second Build click a no-op (it only collects 'placed' instances).
 */
async function markInstancesBuilding(route: string, ids: string[], taskId: string): Promise<void> {
  const entry = doc.value.routes.find((r) => r.route === route)
  if (!entry || ids.length === 0) return
  const idSet = new Set(ids)
  let touched = false
  for (const inst of entry.instances) {
    if (!idSet.has(inst.id)) continue
    inst.status = 'building'
    inst.taskId = taskId
    inst.updatedAt = Date.now()
    touched = true
  }
  if (!touched) return
  entry.updatedAt = Date.now()
  await persist()
}

async function deleteInstance(route: string, id: string): Promise<void> {
  const entry = doc.value.routes.find((r) => r.route === route)
  if (!entry) return
  entry.instances = entry.instances.filter((i) => i.id !== id)
  entry.updatedAt = Date.now()
  // Drop all bookkeeping for the dead id so badges and the de-dup set don't
  // reference an instance that no longer exists.
  appliedIds.delete(id)
  setMembership(staleIds, id, false)
  setMembership(failedIds, id, false)
  await persist()
}

/**
 * Re-mount the route's persisted instances into the live iframe after a reload
 * or route change. Only `status: 'placed'` (or legacy-undefined) instances
 * mount — 'building'/'applied' never re-mount, which is what stops a placement
 * from rendering NEXT TO the agent's freshly applied component when its edit
 * triggers HMR during review.
 *
 * Each instance is isolated: a stale anchor (source changed) or a throwing
 * insert fails soft — it lands in `staleIds`/`failedIds` for the placements
 * panel and never blocks the rest of the route, never deletes the instance.
 */
async function reapply(
  route: string,
  iframe: WireframeIframe,
  opts?: { force?: boolean; onInstanceMounted?: (id: string, containerEid: string) => void },
): Promise<void> {
  if (opts?.force || route !== appliedRoute) {
    appliedRoute = route
    appliedIds.clear()
  }
  const candidates = instancesForRoute(route).filter(
    (i) => (i.status ?? 'placed') === 'placed' && !appliedIds.has(i.id),
  )
  if (candidates.length === 0) return

  // DOM idempotency guard: a forced reapply can race an iframe whose DOM kept
  // the previous mounts (soft HMR). Skip any instance whose stamped node is
  // still present. Best-effort — appliedIds + the status filter already cover
  // the common SPA-route case when the probe isn't available.
  const alreadyInDom = new Set<string>()
  if (iframe.resolveBySelectors) {
    try {
      const matches = await iframe.resolveBySelectors(candidates.map((i) => `[data-annotask-instance="${i.id}"]`))
      matches.forEach((m, idx) => {
        if (m.eid) alreadyInDom.add(candidates[idx].id)
      })
    } catch { /* probe is best-effort */ }
  }

  for (const inst of candidates) {
    if (alreadyInDom.has(inst.id)) {
      appliedIds.add(inst.id)
      continue
    }
    try {
      const group = await iframe.findTemplateGroup(inst.anchor.file, String(inst.anchor.line), inst.anchor.targetTag ?? '')
      if (group.eids.length === 0) {
        setMembership(staleIds, inst.id, true)
        continue
      }
      setMembership(staleIds, inst.id, false)
      appliedIds.add(inst.id)
      const targetEid = group.eids[0]
      // Stamp the instance id on the re-mounted node (placement identity +
      // idempotency probe); record the resulting container eid for unmount lookups.
      if (inst.kind === 'component') {
        // Mount with the sample props the user previewed (when captured) so a
        // reload doesn't degrade a live mount to an empty 'rendered-empty' box.
        const res = await iframe.insertComponent(targetEid, inst.anchor.position, inst.inserted.componentName ?? inst.inserted.tag, inst.previewProps ?? inst.inserted.props, inst.inserted.module, inst.id)
        if (res?.eid) opts?.onInstanceMounted?.(inst.id, res.eid)
      } else {
        const eid = await iframe.insertPlaceholder(targetEid, inst.anchor.position, inst.inserted.tag, {
          classes: inst.inserted.classes,
          textContent: inst.inserted.text_content,
          category: inst.kind === 'layout-preset' ? 'layout-preset' : undefined,
          library: inst.inserted.library,
          defaultProps: inst.inserted.props,
          instanceId: inst.id,
        })
        if (eid) opts?.onInstanceMounted?.(inst.id, eid)
      }
      setMembership(failedIds, inst.id, false)
    } catch (err) {
      setMembership(failedIds, inst.id, true)
      console.warn(`[Annotask] wireframe reapply failed for ${inst.id} (${inst.anchor.file}:${inst.anchor.line}):`, err)
    }
  }
}

/** Drop the re-apply de-dup state (e.g. before a forced reload re-apply). */
function resetApplied(): void {
  appliedRoute = null
  appliedIds.clear()
}

// ── Snapshot-wireframe canvas ─────────────────────────────

function canvasForRoute(route: string): WireframeCanvasState | null {
  return doc.value.routes.find((r) => r.route === route)?.canvas ?? null
}

/** Replace the route's canvas wholesale and persist. The canvas is one
 *  editing surface — block-level patch methods would re-implement the doc. */
async function saveCanvas(route: string, canvas: WireframeCanvasState): Promise<void> {
  let entry = doc.value.routes.find((r) => r.route === route)
  if (!entry) {
    entry = { route, instances: [] }
    doc.value.routes.push(entry)
  }
  entry.canvas = canvas
  entry.updatedAt = Date.now()
  await persist()
}

async function clearCanvas(route: string): Promise<void> {
  const entry = doc.value.routes.find((r) => r.route === route)
  if (!entry?.canvas) return
  delete entry.canvas
  entry.updatedAt = Date.now()
  await persist()
}

export function useWireframeDoc() {
  if (!initialized) {
    initialized = true
    void load()
    // Another shell/tab (or an external edit) changed the doc — re-load. Never
    // re-PUT here, or two listeners would ping-pong forever.
    wsOn('wireframe:updated', () => { void load() })
  }
  return {
    doc,
    isLoading,
    loadError,
    staleIds,
    failedIds,
    load,
    instancesForRoute,
    saveInstance,
    updateInstance,
    markInstancesBuilding,
    deleteInstance,
    reapply,
    resetApplied,
    canvasForRoute,
    saveCanvas,
    clearCanvas,
  }
}
