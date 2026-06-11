import { ref, computed, watch, type Ref } from 'vue'
import { usePaletteDrag } from './usePaletteDrag'
import { useWireframeDoc, type WireframeIframe } from './useWireframeDoc'
import { useDesignSession } from './useDesignSession'
import { normalizeRoute } from '../utils/routes'
import type { DropIndicatorRect } from '../types'
import type { InsertChangeRecord } from './useStyleEditor'
import type { WireframeInstance, WireframeFidelity } from '../../shared/wireframe-types'
import type { ResolvedElement, InsertVueComponentResult } from '../../shared/bridge-types'

/** The iframe surface the wireframe canvas needs — structural so tests can
 *  pass a small mock; useIframeManager's return satisfies it. */
export interface WireframeCanvasIframe extends WireframeIframe {
  currentRoute: Ref<string>
  bridgeReady: Ref<boolean>
  resolveElementAt: (shellX: number, shellY: number) => Promise<ResolvedElement | null>
  insertComponent: (targetEid: string, position: string, componentName: string, props?: Record<string, unknown>, module?: string, instanceId?: string) => Promise<InsertVueComponentResult>
  removePlaceholder: (eid: string) => Promise<void>
}

export interface WireframeCanvasDeps {
  iframe: WireframeCanvasIframe
  /** Task creation goes through useTaskWorkflows so wireframe tasks pick up
   *  route/viewport/color-scheme enrichment like every other task type. */
  createRouteTask: (data: Record<string, unknown>) => Promise<{ id: string } | null>
}

/**
 * Wireframe canvas pipeline — the drop shield handlers (palette drag-over
 * throttle + drop indicator + instance construction/persistence), the Build
 * collector, placement deletion, and the bridgeReady/route reapply watchers.
 * Extracted from App.vue per the shell architecture rule: App.vue
 * orchestrates, composables own behavior.
 */
export function useWireframeCanvas(deps: WireframeCanvasDeps) {
  const { iframe } = deps
  const { currentRoute } = iframe

  const paletteDrag = usePaletteDrag()
  const wireframeDoc = useWireframeDoc()
  const session = useDesignSession()
  // instanceId → live container eid, populated on drop + on reapply. Runtime
  // only (container eids are session-volatile). deletePlacement reads it to
  // unmount the live node; reapply repopulates it after reload/route change.
  const containerEids = new Map<string, string>()
  function registerContainer(instanceId: string, containerEid: string): void {
    containerEids.set(instanceId, containerEid)
  }
  const dropIndicator = ref<DropIndicatorRect | null>(null)
  // dragover fires at high frequency; throttle the resolve round-trip (~30fps)
  // and guard against re-entrant in-flight requests, like the overlay engine.
  let lastDragResolveAt = 0
  let dragResolveInFlight = false

  function dropPositionFor(rect: { y: number; height: number }, clientY: number): 'before' | 'after' | 'append' {
    const rel = (clientY - rect.y) / Math.max(rect.height, 1)
    if (rel < 0.25) return 'before'
    if (rel > 0.75) return 'after'
    return 'append'
  }

  async function onPaletteDragOver(e: DragEvent): Promise<void> {
    if (!paletteDrag.draggingItem.value) return
    const now = Date.now()
    if (dragResolveInFlight || now - lastDragResolveAt < 33) return
    lastDragResolveAt = now
    dragResolveInFlight = true
    try {
      const hit = await iframe.resolveElementAt(e.clientX, e.clientY)
      // A mounted placement is not a drop target: it has no source anchor yet,
      // so a drop relative to it could not be expressed in real source.
      if (!hit || hit.instance_id) { dropIndicator.value = null; return }
      dropIndicator.value = {
        x: hit.rect.x, y: hit.rect.y, width: hit.rect.width, height: hit.rect.height,
        position: dropPositionFor(hit.rect, e.clientY),
      }
    } finally {
      dragResolveInFlight = false
    }
  }

  function onPaletteDragLeave(): void {
    dropIndicator.value = null
  }

  async function onPaletteDrop(e: DragEvent): Promise<void> {
    const item = paletteDrag.draggingItem.value
    paletteDrag.endDrag()
    dropIndicator.value = null
    if (!item) return
    const hit = await iframe.resolveElementAt(e.clientX, e.clientY)
    if (!hit || hit.instance_id) return
    const position = dropPositionFor(hit.rect, e.clientY)

    // Generate the instance id up front so it can be stamped on the mounted node
    // (data-annotask-instance) — placement identity for click/selection,
    // drop-target refusal, capture exclusion, and reapply's idempotency probe.
    const instanceId = `wfi-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
    // Components live-mount (honest fidelity from the bridge). HTML / layout
    // presets render through insert:placeholder (createPlaceholder styles them) —
    // never through insert:component, which would leave an empty div.
    let fidelity: WireframeFidelity = 'placeholder'
    let containerEid = ''
    if (item.kind === 'component') {
      // Mount with sample props (display) + on-demand module load; persist the
      // REAL props (item.props) below, not the sample ones.
      const res = await iframe.insertComponent(hit.eid, position, item.componentName, item.previewProps ?? item.props, item.module, instanceId)
      fidelity = res.fidelity ?? (res.mounted ? 'live' : 'placeholder')
      containerEid = res.eid
    } else {
      containerEid = await iframe.insertPlaceholder(hit.eid, position, item.tag, {
        classes: item.classes,
        textContent: item.textContent,
        category: item.category,
        library: item.library,
        defaultProps: item.props,
        instanceId,
      })
    }
    if (containerEid) registerContainer(instanceId, containerEid)

    const instance: WireframeInstance = {
      id: instanceId,
      kind: item.kind,
      anchor: {
        file: hit.file,
        line: parseInt(hit.line, 10) || 0,
        position,
        component: hit.component,
        targetTag: hit.tag,
        targetEid: hit.eid,
      },
      inserted: {
        tag: item.tag,
        componentName: item.kind === 'component' ? item.componentName : undefined,
        library: item.library,
        module: item.module,
        props: item.props,
        classes: item.classes,
        text_content: item.textContent,
      },
      fidelity,
      mounted: item.kind === 'component' ? fidelity !== 'placeholder' : true,
      status: 'placed',
      // Persist the previewed samples separately from the real props: reapply
      // re-mounts with them, and the agent reads them as label/value hints.
      ...(item.previewProps ? { previewProps: item.previewProps } : {}),
      createdAt: Date.now(),
    }
    void wireframeDoc.saveInstance(normalizeRoute(currentRoute.value), instance)

    // Journal the placement so session-wide undo can interleave it with style
    // edits. Cross-reference only — wireframe.json stays the canonical artifact
    // (the entry never duplicates the instance payload beyond the insert shape).
    const placeChange: InsertChangeRecord = {
      id: `wf-${instanceId}`,
      type: 'component_insert',
      description: `Place <${item.kind === 'component' ? item.componentName : item.tag}> ${position} ${hit.component || hit.tag}`,
      file: hit.file,
      section: 'template',
      line: parseInt(hit.line, 10) || 0,
      component: hit.component,
      insert_position: position,
      inserted: instance.inserted,
    }
    session.record({
      change: placeChange,
      anchor: { file: hit.file, line: parseInt(hit.line, 10) || 0, targetTag: hit.tag, component: hit.component, position },
      route: normalizeRoute(currentRoute.value),
      ...(containerEid ? { eid: containerEid } : {}),
      instanceId,
    })
  }

  // Placements on the current route — drives the palette's placements panel.
  const wireframePlacements = computed(() => wireframeDoc.instancesForRoute(normalizeRoute(currentRoute.value)))
  // Only never-built placements are buildable; building/applied ones already
  // belong to a task (the panel shows them with their status chip instead).
  const placedCount = computed(() => wireframePlacements.value.filter((i) => (i.status ?? 'placed') === 'placed').length)

  // Turn the current route's PLACED instances into ONE wireframe_apply task the
  // agent implements via /annotask-apply, then stamp them 'building' against
  // that task. The dominant anchor file (the route's page component) is the
  // task-level anchor; per-instance anchors live in the context.
  const isBuilding = ref(false)
  async function buildWireframeRoute(): Promise<void> {
    // Re-entrancy guard: without it a double-click collects the same 'placed'
    // batch twice before the first build's 'building' stamp persists.
    if (isBuilding.value) return
    const route = normalizeRoute(currentRoute.value)
    const instances = wireframeDoc.instancesForRoute(route).filter((i) => (i.status ?? 'placed') === 'placed')
    if (instances.length === 0) return
    isBuilding.value = true
    try {
      const fileCounts = new Map<string, number>()
      for (const i of instances) fileCounts.set(i.anchor.file, (fileCounts.get(i.anchor.file) ?? 0) + 1)
      let domFile = instances[0].anchor.file
      let domCount = -1
      for (const [f, c] of fileCounts) if (c > domCount) { domFile = f; domCount = c }
      const domLine = instances.find((i) => i.anchor.file === domFile)?.anchor.line ?? 0
      const summaryLines = instances.map((i) => {
        const what = i.kind === 'component' ? (i.inserted.componentName ?? i.inserted.tag) : i.inserted.tag
        return `- <${what}> ${i.anchor.position} ${i.anchor.component || i.anchor.targetTag || 'target'}`
      })
      const description = `Implement ${instances.length} placement${instances.length === 1 ? '' : 's'} on ${route}:\n${summaryLines.join('\n')}`
      const task = await deps.createRouteTask({
        type: 'wireframe_apply',
        description,
        file: domFile,
        line: domLine,
        context: { wireframe: { route, instances } },
      })
      // Stamp ONLY on success — a failed POST leaves the batch 'placed' so the
      // user can retry Build instead of orphaning instances against no task.
      if (task?.id) {
        await wireframeDoc.markInstancesBuilding(route, instances.map((i) => i.id), task.id)
      }
    } finally {
      isBuilding.value = false
    }
  }

  /** Remove one placement: unmount its live preview node (if mounted this
   *  session), delete it from the persisted doc, and drop its session entry. */
  async function deletePlacement(id: string): Promise<void> {
    const containerEid = containerEids.get(id)
    if (containerEid) {
      await iframe.removePlaceholder(containerEid)
      containerEids.delete(id)
    }
    await wireframeDoc.deleteInstance(normalizeRoute(currentRoute.value), id)
    session.removeByInstanceId(id)
  }

  // Re-apply persisted placements after the iframe (re)loads or the route
  // changes. A fresh bridge means a fresh DOM, so force a clean re-apply.
  // The design-session preview replay rides the same triggers: a persisted
  // session must never claim edits the fresh iframe doesn't show.
  watch(iframe.bridgeReady, (ready) => {
    if (!ready) return
    wireframeDoc.resetApplied()
    containerEids.clear() // fresh DOM → stale container eids
    void wireframeDoc.reapply(normalizeRoute(currentRoute.value), iframe, { force: true, onInstanceMounted: registerContainer })
    session.resetPreviewApplied()
    void session.reapplyPreviews(normalizeRoute(currentRoute.value), iframe, { force: true })
  })
  watch(currentRoute, (r) => {
    if (!iframe.bridgeReady.value) return
    void wireframeDoc.reapply(normalizeRoute(r), iframe, { onInstanceMounted: registerContainer })
    void session.reapplyPreviews(normalizeRoute(r), iframe)
  })

  return {
    paletteDrag,
    wireframeDoc,
    registerContainer,
    dropIndicator,
    onPaletteDragOver,
    onPaletteDragLeave,
    onPaletteDrop,
    wireframePlacements,
    placedCount,
    isBuilding,
    buildWireframeRoute,
    deletePlacement,
  }
}
