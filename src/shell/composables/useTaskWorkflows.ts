import { ref, computed, type Ref } from 'vue'
import type { BridgeRect } from '../../shared/bridge-types'
import type { useAnnotations } from './useAnnotations'
import type { useIframeManager } from './useIframeManager'
import type { useTasks } from './useTasks'
import type { useStyleEditor } from './useStyleEditor'
import type { useScreenshots } from './useScreenshots'
import type { useViewportPreview } from './useViewportPreview'
import type { useInteractionHistory } from './useInteractionHistory'
import type { SelectionData } from './useSelectionModel'
import type { Task } from './useTasks'
import { resolveForSelection, resolveForElement, type DataContextProbeResult } from '../services/dataContextClient'
import { useComponentContextCapture } from './useComponentContextCapture'

export interface PendingTaskContext {
  kind: 'pin' | 'arrow' | 'highlight' | 'select'
  label: string
  file: string
  line: string | number
  component: string
  annotationId?: string
  meta: Record<string, unknown>
}

export function useTaskWorkflows(deps: {
  iframe: ReturnType<typeof useIframeManager>
  annotations: ReturnType<typeof useAnnotations>
  taskSystem: ReturnType<typeof useTasks>
  styleEditor: ReturnType<typeof useStyleEditor>
  screenshots: ReturnType<typeof useScreenshots>
  viewport: ReturnType<typeof useViewportPreview>
  interactionHistory: ReturnType<typeof useInteractionHistory>
  primarySelection: Ref<SelectionData | null>
  selectedEids: Ref<string[]>
  selectionRects: Ref<BridgeRect[]>
  taskElementRects: Ref<{ taskId: string; rect: BridgeRect }[]>
  includeHistory: Ref<boolean>
  includeRenderedHtml: Ref<boolean>
  includeDataContext: Ref<boolean>
  dataContextProbe: Ref<DataContextProbeResult | null>
  currentRoute: Ref<string>
  activePanel: Ref<'tasks' | 'inspector'>
  clearSelection: () => void
  startAnnotationLoop: () => void
}) {
  const pendingTaskCreation = ref<PendingTaskContext | null>(null)
  const pendingTaskText = ref('')
  const submittingPendingTask = ref(false)
  const routeTasks = computed(() => deps.taskSystem.tasks.value)
  const showNewTaskForm = ref(false)
  const newTaskText = ref('')
  const denyingTaskId = ref<string | null>(null)
  const denyFeedbackText = ref('')
  const detailTaskId = ref<string | null>(null)
  const confirmDeleteTaskId = ref<string | null>(null)
  const detailTask = computed(() => detailTaskId.value ? deps.taskSystem.tasks.value.find(t => t.id === detailTaskId.value) ?? null : null)
  const sectionTaskMap = ref<Record<string, string>>({})
  const arrowDragTargetRect = ref<{ x: number; y: number; width: number; height: number } | null>(null)
  let arrowDragResolveTimer: ReturnType<typeof setTimeout> | null = null
  const arrowTaskIds = new Set<string>()
  const sectionSubmitInFlight = new Set<string>()
  const restoredTaskIds = new Set<string>()
  const componentContextCapture = useComponentContextCapture(deps.iframe)

  function removeTaskAnnotations(taskId: string) {
    const task = deps.taskSystem.tasks.value.find(t => t.id === taskId) as any
    if (!task) return
    if (task.visual) {
      const v = task.visual
      if (v.kind === 'pin') {
        if (v.annotationId) deps.annotations.removePin(v.annotationId)
        const pins = deps.annotations.getPinsForElement(task.file, task.line)
        for (const p of pins) deps.annotations.removePin(p.id)
      } else if (v.kind === 'arrow') {
        if (v.annotationId) deps.annotations.removeArrow(v.annotationId)
        const arrow = deps.annotations.arrows.value.find((a: any) =>
          Math.abs(a.fromX - v.fromX) < 5 && Math.abs(a.fromY - v.fromY) < 5
        )
        if (arrow) deps.annotations.removeArrow(arrow.id)
      } else if (v.kind === 'section') {
        if (v.annotationId) deps.annotations.removeDrawnSection(v.annotationId)
        const section = deps.annotations.drawnSections.value.find((s: any) =>
          Math.abs(s.x - v.x) < 5 && Math.abs(s.y - v.y) < 5
        )
        if (section) deps.annotations.removeDrawnSection(section.id)
      } else if (v.kind === 'highlight') {
        if (v.annotationId) deps.annotations.removeHighlight(v.annotationId)
        const ctx = task.context || {}
        const hl = deps.annotations.highlights.value.find((h: any) =>
          h.file === task.file && h.line === task.line && h.selectedText === (ctx.selected_text || '')
        )
        if (hl) deps.annotations.removeHighlight(hl.id)
      }
    }
    if (!task.visual && task.file && task.line != null) {
      const pins = deps.annotations.getPinsForElement(task.file, task.line)
      for (const p of pins) deps.annotations.removePin(p.id)
    }
    if (task.file && task.line != null) {
      deps.styleEditor.removeAnnotationsByFile(task.file, task.line)
    }
    const v = task.visual as any
    const taskEids: string[] = v?.eids || (v?.eid ? [v.eid] : [])
    if (taskEids.length && deps.primarySelection.value?.eid && taskEids.includes(deps.primarySelection.value.eid)) {
      deps.clearSelection()
    }
  }

  function executeDeleteTask() {
    if (!confirmDeleteTaskId.value) return
    removeTaskAnnotations(confirmDeleteTaskId.value)
    restoredTaskIds.delete(confirmDeleteTaskId.value)
    deps.taskSystem.deleteTask(confirmDeleteTaskId.value)
    confirmDeleteTaskId.value = null
  }

  function acceptTask(taskId: string) {
    removeTaskAnnotations(taskId)
    restoredTaskIds.delete(taskId)
    deps.taskSystem.updateTaskStatus(taskId, 'accepted')
  }

  async function submitDeny(taskId: string) {
    if (!denyFeedbackText.value.trim()) return
    const extra: Record<string, unknown> = {}
    // Preserve MFE context through the deny so it isn't lost on round-trip
    const task = deps.taskSystem.tasks.value.find(t => t.id === taskId)
    if (task?.mfe) extra.mfe = task.mfe
    const consumed = deps.screenshots.consumeScreenshot()
    if (consumed) {
      extra.screenshot = consumed.filename
      if (consumed.meta) extra.screenshot_meta = consumed.meta
    }
    const vp = deps.viewport.effectiveViewport.value
    if (vp.width || vp.height) extra.viewport = { width: vp.width, height: vp.height }
    const cs = await deps.iframe.getColorScheme()
    if (cs) extra.color_scheme = cs
    // Always snapshot history so the sidecar stays fresh on retry; embed in
    // the denied task payload only when the user opted in (same rule as task
    // creation).
    const denyHistorySnapshot = deps.interactionHistory.snapshotForChange(deps.currentRoute.value)
    const denyHistoryHasData = denyHistorySnapshot.recent_actions.length > 0
    if (denyHistoryHasData && deps.includeHistory.value) {
      extra.interaction_history = denyHistorySnapshot
    }
    if (denyHistoryHasData) {
      void fetch(`/__annotask/api/tasks/${encodeURIComponent(taskId)}/interaction-history`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(denyHistorySnapshot),
      }).catch(() => { /* best-effort */ })
    }
    // Denial is the one retry signal we always want to enrich: the user has
    // already seen the agent's attempt and is asking for another pass, so the
    // extra tokens of rendered HTML / data_context pay off. Override the
    // opt-in toggle here.
    if (deps.primarySelection.value?.eid) {
      const frag = await componentContextCapture.capture(deps.primarySelection.value.eid)
      if (frag.component || frag.rendered) {
        const denyCtx: Record<string, unknown> = {}
        if (frag.component) denyCtx.component = frag.component
        if (frag.rendered) denyCtx.rendered = frag.rendered
        extra.context = denyCtx
      }
      if (typeof frag.rendered === 'string' && frag.rendered) {
        void fetch(`/__annotask/api/tasks/${encodeURIComponent(taskId)}/rendered-html`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ html: frag.rendered }),
        }).catch(() => { /* best-effort */ })
      }
    }
    const denyFile = deps.primarySelection.value?.file || ''
    const denyLine = deps.primarySelection.value?.line ? parseInt(deps.primarySelection.value.line) || 0 : 0
    if (denyFile) {
      const dc = await resolveForSelection(denyFile, denyLine)
      if (dc) extra.data_context = dc
    }
    deps.taskSystem.updateTaskStatus(taskId, 'denied', denyFeedbackText.value.trim(), Object.keys(extra).length > 0 ? extra : undefined)
    denyingTaskId.value = null
    denyFeedbackText.value = ''
  }

  function submitNewTask() {
    const text = newTaskText.value.trim()
    if (!text) return
    createRouteTask({ type: 'annotation', description: text })
    newTaskText.value = ''
    showNewTaskForm.value = false
  }

  async function createRouteTask(data: Record<string, unknown>): Promise<Task | null> {
    const mfe = deps.primarySelection.value?.mfe || ''
    const vp = deps.viewport.effectiveViewport.value
    const vpData = (vp.width || vp.height) ? { viewport: { width: vp.width, height: vp.height } } : {}
    // Always snapshot interaction history — the toggle only decides whether it
    // rides in the task payload. The snapshot is persisted to a per-task
    // sidecar below so agents can retrieve it on demand via
    // annotask_get_interaction_history even when the user didn't embed.
    const historySnapshot = deps.interactionHistory.snapshotForChange(deps.currentRoute.value)
    const historyHasData = historySnapshot.recent_actions.length > 0
    const historyData = historyHasData && deps.includeHistory.value ? { interaction_history: historySnapshot } : {}

    // Snapshot selection once so the parallel awaits below don't race against
    // the user clicking somewhere else. The POST builder uses the same refs.
    const sel = deps.primarySelection.value
    const file = sel?.file || (typeof data.file === 'string' ? data.file : '')
    const line = sel?.line ? (parseInt(sel.line) || 0) : (typeof data.line === 'number' ? data.line : 0)
    const existingContext = (typeof data.context === 'object' && data.context && !Array.isArray(data.context))
      ? data.context as Record<string, unknown>
      : null
    const hasComponentInCtx = !!(existingContext && ('component' in existingContext || 'rendered' in existingContext))
    const wantComponentCapture = !hasComponentInCtx && !!sel?.eid

    // Run every enrichment round-trip concurrently — bridge requests and the
    // data-context HTTP calls are independent, so serializing them just stacked
    // their latencies and made "Add Task" feel laggy on cold bridges.
    const [colorScheme, elementDc, frag] = await Promise.all([
      deps.iframe.getColorScheme(),
      file && line ? resolveForElement(file, line) : Promise.resolve(null),
      wantComponentCapture ? componentContextCapture.capture(sel!.eid!) : Promise.resolve({} as { component?: unknown; rendered?: unknown }),
    ])

    const colorSchemeData = colorScheme ? { color_scheme: colorScheme } : {}

    let dataContextData: Record<string, unknown> = {}
    // Auto-capture element-bound data_context: only attach when the binding
    // analyzer can prove the selected element actually consumes one of the
    // file's data sources. File-level attachment was too noisy — a task on a
    // `<Switch>` would pick up an unrelated `useQuery` from the same file.
    // User can still force full file-level capture via the toggle.
    if (elementDc && elementDc.sources && elementDc.sources.length > 0) {
      dataContextData = { data_context: elementDc }
    } else if (file && line && deps.includeDataContext.value && deps.dataContextProbe.value?.hasData) {
      // Explicit opt-in fallback — resolving the file-level context is rare
      // enough that we don't eagerly fire it in the parallel burst above.
      const dc = await resolveForSelection(file, line)
      if (dc) dataContextData = { data_context: dc }
    }

    // Component info is automatic — cheap DOM walk, no toggle. `rendered`
    // (outerHTML) is opt-in via the "Include rendered HTML" toggle. Callers
    // can pre-populate both (the arrow flow supplies endpoint rendered HTML)
    // and we preserve whatever is already there.
    const componentFragment: { component?: unknown; rendered?: unknown } = {}
    if (frag.component) componentFragment.component = frag.component
    if (frag.rendered && deps.includeRenderedHtml.value) componentFragment.rendered = frag.rendered
    const mergedContext = (existingContext || Object.keys(componentFragment).length > 0)
      ? { context: { ...(existingContext || {}), ...componentFragment } }
      : {}
    const consumed = deps.screenshots.consumeScreenshot()
    const screenshotData: Record<string, unknown> = {}
    if (consumed) {
      screenshotData.screenshot = consumed.filename
      if (consumed.meta) screenshotData.screenshot_meta = consumed.meta
    }
    const task = await deps.taskSystem.createTask({ ...data, ...mergedContext, route: deps.currentRoute.value, ...(mfe ? { mfe } : {}), ...vpData, ...colorSchemeData, ...historyData, ...dataContextData, ...screenshotData })
    if (task) {
      deps.activePanel.value = 'tasks'
      // Sidecar persistence. Fire-and-forget: a failed sidecar write must not
      // block task creation, and the task row is already visible to the user
      // via the WS broadcast from createTask.
      if (historyHasData) {
        void fetch(`/__annotask/api/tasks/${encodeURIComponent(task.id)}/interaction-history`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(historySnapshot),
        }).catch(() => { /* best-effort */ })
      }
      if (typeof frag.rendered === 'string' && frag.rendered) {
        void fetch(`/__annotask/api/tasks/${encodeURIComponent(task.id)}/rendered-html`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ html: frag.rendered }),
        }).catch(() => { /* best-effort */ })
      }
    }
    return task
  }

  async function onSectionSubmit(id: string) {
    if (sectionSubmitInFlight.has(id)) return
    const section = deps.annotations.drawnSections.value.find(s => s.id === id)
    if (!section || !section.prompt.trim()) return
    sectionSubmitInFlight.add(id)
    try {
      const existingTaskId = sectionTaskMap.value[id]
      if (existingTaskId) {
        await deps.taskSystem.updateTask(existingTaskId, { description: section.prompt.trim() })
        return
      }
      deps.styleEditor.recordAnnotation({
        file: section.nearFile || '',
        line: String(section.nearLine || 0),
        component: section.nearComponent || '',
        intent: section.prompt.trim(),
        action: 'section_request',
      })
      const task = await createRouteTask({
        type: 'section_request',
        description: section.prompt.trim(),
        file: section.nearFile || undefined,
        line: section.nearLine || undefined,
        component: section.nearComponent || undefined,
        placement: section.placement || undefined,
        visual: { kind: 'section', annotationId: section.id, x: Math.round(section.x), y: Math.round(section.y), width: Math.round(section.width), height: Math.round(section.height), nearEid: section.nearEid },
      })
      if (task) sectionTaskMap.value = { ...sectionTaskMap.value, [id]: task.id }
    } finally {
      sectionSubmitInFlight.delete(id)
    }
  }

  function onArrowDragMove(x: number, y: number) {
    if (arrowDragResolveTimer) clearTimeout(arrowDragResolveTimer)
    arrowDragResolveTimer = setTimeout(async () => {
      const ctx = await deps.iframe.resolveElementAt(x, y)
      arrowDragTargetRect.value = ctx?.rect || null
    }, 50)
  }

  async function onArrowDragEnd(id: string, endpoint: 'from' | 'to', x: number, y: number) {
    if (arrowDragResolveTimer) { clearTimeout(arrowDragResolveTimer); arrowDragResolveTimer = null }
    arrowDragTargetRect.value = null
    const ctx = await deps.iframe.resolveElementAt(x, y)
    if (!ctx) return
    if (endpoint === 'from') {
      deps.annotations.updateArrow(id, { fromFile: ctx.file, fromLine: parseInt(ctx.line) || 0, fromComponent: ctx.component, fromRect: ctx.rect, fromEid: ctx.eid })
    } else {
      deps.annotations.updateArrow(id, { toFile: ctx.file, toLine: parseInt(ctx.line) || 0, toRect: ctx.rect, toEid: ctx.eid })
    }
    // Update pending task label if this arrow's task panel is open
    const pending = pendingTaskCreation.value
    if (pending && pending.kind === 'arrow' && pending.annotationId === id) {
      const arrow = deps.annotations.arrows.value.find(a => a.id === id)
      if (!arrow) return
      const fromCtx = await deps.iframe.resolveElementAt(arrow.fromX, arrow.fromY)
      const toCtx = await deps.iframe.resolveElementAt(arrow.toX, arrow.toY)
      const fromDesc = describeElement(fromCtx)
      const toDesc = describeElement(toCtx)
      pendingTaskCreation.value = {
        ...pending,
        label: `Arrow from ${fromDesc} → ${toDesc}`,
        file: arrow.fromFile || fromCtx?.file || '',
        line: arrow.fromLine || fromCtx?.line || '',
        component: arrow.fromComponent || fromCtx?.component || '',
        meta: {
          arrowColor: arrow.color || '',
          fromTag: fromCtx?.tag || '',
          fromClasses: fromCtx?.classes || '',
          fromComponent: fromCtx?.component || '',
          fromText: fromCtx?.text || '',
          toFile: arrow.toFile || toCtx?.file || '',
          toLine: arrow.toLine || toCtx?.line || 0,
          toTag: toCtx?.tag || '',
          toClasses: toCtx?.classes || '',
          toComponent: toCtx?.component || '',
          toText: toCtx?.text || '',
        },
      }
    }
  }

  function describeElement(ctx: { file: string; line: string; component: string; tag: string; classes?: string; text?: string } | null): string {
    if (!ctx) return 'element'
    const tag = ctx.tag || 'element'
    const cls = ctx.classes?.split(' ').find(c => c && !c.startsWith('data-'))
    const label = ctx.text ? ` "${ctx.text.length > 30 ? ctx.text.slice(0, 30) + '…' : ctx.text}"` : ''
    if (ctx.component && cls) return `<${tag}.${cls}>${label} in ${ctx.component}`
    if (ctx.component && ctx.tag !== ctx.component.toLowerCase()) return `<${tag}>${label} in ${ctx.component}`
    if (cls) return `<${tag}.${cls}>${label}`
    return `<${tag}>${label}`
  }

  /** Remove any uncommitted annotation (pending pin/arrow/highlight or orphan section). */
  function discardUncommittedAnnotations() {
    if (pendingTaskCreation.value && pendingTaskCreation.value.kind !== 'select') {
      cancelPendingTask()
    }
    for (const s of [...deps.annotations.drawnSections.value]) {
      if (!sectionTaskMap.value[s.id]) deps.annotations.removeDrawnSection(s.id)
    }
  }

  function onArrowCreated(arrowId: string, fromCtx: { file: string; line: string; component: string; tag: string; classes?: string; text?: string } | null, toCtx: { file: string; line: string; component: string; tag: string; classes?: string; text?: string } | null) {
    const arrow = deps.annotations.arrows.value.find(a => a.id === arrowId)
    if (!arrow) return

    const fromDesc = describeElement(fromCtx)
    const toDesc = describeElement(toCtx)

    pendingTaskCreation.value = {
      kind: 'arrow',
      label: `Arrow from ${fromDesc} → ${toDesc}`,
      file: arrow.fromFile || fromCtx?.file || '',
      line: arrow.fromLine || fromCtx?.line || '',
      component: arrow.fromComponent || fromCtx?.component || '',
      annotationId: arrowId,
      meta: {
        arrowColor: arrow.color || '',
        fromTag: fromCtx?.tag || '',
        fromClasses: fromCtx?.classes || '',
        fromComponent: fromCtx?.component || '',
        fromText: fromCtx?.text || '',
        toFile: arrow.toFile || toCtx?.file || '',
        toLine: arrow.toLine || toCtx?.line || 0,
        toTag: toCtx?.tag || '',
        toClasses: toCtx?.classes || '',
        toComponent: toCtx?.component || '',
        toText: toCtx?.text || '',
      },
    }
    pendingTaskText.value = ''
  }

  async function submitPendingArrowTask(id: string, description: string) {
    const arrow = deps.annotations.arrows.value.find(a => a.id === id)
    if (!arrow || !description.trim()) return
    if (arrowTaskIds.has(id)) return
    arrowTaskIds.add(id)

    deps.annotations.updateArrow(id, { label: description.trim() })

    const meta = pendingTaskCreation.value?.meta || {}
    deps.styleEditor.recordAnnotation({
      file: arrow.fromFile || '',
      line: String(arrow.fromLine || 0),
      component: arrow.fromComponent || '',
      intent: description.trim(),
      elementTag: (meta.fromTag as string) || '',
      elementClasses: (meta.fromClasses as string) || '',
    })
    const fromText = (meta.fromText as string) || ''
    const toText = (meta.toText as string) || ''
    const fromCC = arrow.fromEid ? await componentContextCapture.capture(arrow.fromEid) : {}
    const toCC = arrow.toEid ? await componentContextCapture.capture(arrow.toEid) : {}
    createRouteTask({
      type: 'annotation',
      description: description.trim(),
      file: arrow.fromFile || '',
      line: arrow.fromLine || 0,
      component: arrow.fromComponent || '',
      visual: { kind: 'arrow', annotationId: arrow.id, fromX: arrow.fromX, fromY: arrow.fromY, toX: arrow.toX, toY: arrow.toY, label: description.trim(), color: arrow.color, fromRect: arrow.fromRect, toRect: arrow.toRect, fromEid: arrow.fromEid, toEid: arrow.toEid },
      context: {
        from_element_tag: (meta.fromTag as string) || '',
        from_element_classes: (meta.fromClasses as string) || '',
        ...(fromText ? { from_element_text: fromText } : {}),
        to_element: {
          tag: (meta.toTag as string) || '',
          classes: (meta.toClasses as string) || '',
          component: (meta.toComponent as string) || '',
          file: arrow.toFile || '',
          line: arrow.toLine || 0,
          ...(toText ? { text: toText } : {}),
        },
        ...(fromCC.component ? { component: fromCC.component } : {}),
        ...(fromCC.rendered ? { rendered: fromCC.rendered } : {}),
        ...(toCC.component ? { to_component: toCC.component } : {}),
        ...(toCC.rendered ? { to_rendered: toCC.rendered } : {}),

      },
    })
  }

  async function submitPendingTask() {
    if (submittingPendingTask.value) return
    const ctx = pendingTaskCreation.value
    const description = pendingTaskText.value.trim()
    if (!ctx || !description) return

    submittingPendingTask.value = true
    try {
      if (ctx.kind === 'pin') {
        const meta = ctx.meta as { elementTag: string; elementClasses: string; pinX: number; pinY: number; elementText?: string; elementSourceTag?: string }
        deps.annotations.updatePinNote(ctx.annotationId!, description)
        deps.styleEditor.recordAnnotation({
          file: ctx.file, line: String(ctx.line), component: ctx.component,
          intent: description,
          elementTag: meta.elementTag, elementClasses: meta.elementClasses,
        })
        await createRouteTask({
          type: 'annotation',
          description,
          file: ctx.file, line: parseInt(String(ctx.line)) || 0, component: ctx.component,
          visual: { kind: 'pin', annotationId: ctx.annotationId!, x: meta.pinX, y: meta.pinY },
          context: {
            element_tag: meta.elementTag,
            element_classes: meta.elementClasses,
            ...(meta.elementText ? { element_text: meta.elementText } : {}),
            ...(meta.elementSourceTag ? { element_source_tag: meta.elementSourceTag } : {}),
          },
        })
      } else if (ctx.kind === 'arrow') {
        await submitPendingArrowTask(ctx.annotationId!, description)
      } else if (ctx.kind === 'highlight') {
        const meta = ctx.meta as { selectedText: string; elementTag: string; elementSourceTag?: string }
        deps.annotations.updateHighlight(ctx.annotationId!, { prompt: description })
        const hl = deps.annotations.highlights.value.find(h => h.id === ctx.annotationId)
        const intent = `Change "${meta.selectedText}" → ${description}`
        deps.styleEditor.recordAnnotation({
          file: ctx.file, line: String(ctx.line), component: ctx.component,
          intent, action: 'text_edit', elementTag: meta.elementTag,
        })
        await createRouteTask({
          type: 'annotation', description: intent, file: ctx.file, line: parseInt(String(ctx.line)) || 0,
          component: ctx.component, action: 'text_edit',
          visual: { kind: 'highlight', annotationId: ctx.annotationId, eid: hl?.eid, rect: hl?.rect, rects: hl?.rects, color: hl?.color },
          context: { element_tag: meta.elementTag, selected_text: meta.selectedText, ...(meta.elementSourceTag ? { element_source_tag: meta.elementSourceTag } : {}) },
        })
      } else if (ctx.kind === 'select') {
        const meta = ctx.meta as { elementTag: string; elementClasses: string; elementText?: string; elementSourceTag?: string }
        deps.styleEditor.recordAnnotation({
          file: ctx.file, line: String(ctx.line), component: ctx.component,
          intent: description, elementTag: meta.elementTag, elementClasses: meta.elementClasses,
        })
        const currentRects = [...deps.selectionRects.value]
        const eids = [...deps.selectedEids.value]
        const task = await createRouteTask({
          type: 'annotation', description,
          file: ctx.file, line: parseInt(String(ctx.line)) || 0, component: ctx.component,
          visual: { kind: 'select', eids },
          context: {
            element_tag: meta.elementTag,
            element_classes: meta.elementClasses,
            ...(meta.elementText ? { element_text: meta.elementText } : {}),
            ...(meta.elementSourceTag ? { element_source_tag: meta.elementSourceTag } : {}),
          },
        })
        if (task && currentRects.length) {
          deps.taskElementRects.value = [...deps.taskElementRects.value, ...currentRects.map(rect => ({ taskId: task.id, rect }))]
          deps.startAnnotationLoop()
        }
      }

      pendingTaskCreation.value = null
      pendingTaskText.value = ''
    } finally {
      submittingPendingTask.value = false
    }
  }

  function cancelPendingTask() {
    const ctx = pendingTaskCreation.value
    if (ctx && ctx.annotationId) {
      if (ctx.kind === 'pin') deps.annotations.removePin(ctx.annotationId)
      if (ctx.kind === 'arrow') deps.annotations.removeArrow(ctx.annotationId)
      if (ctx.kind === 'highlight') deps.annotations.removeHighlight(ctx.annotationId)
      deps.annotations.reclaimLastCounter()
    }
    pendingTaskCreation.value = null
    pendingTaskText.value = ''
  }

  async function onAddAnnotationNote(text: string) {
    if (!deps.primarySelection.value) return

    // Use selection metadata (already have file/line/component from click events)
    const sel = deps.primarySelection.value
    const targets = [{ file: sel.file, line: sel.line, component: sel.component, tag: sel.tagName, classes: sel.classes, text: sel.text || '' }]

    for (const t of targets) {
      deps.styleEditor.recordAnnotation({ file: t.file, line: t.line, component: t.component, intent: text, elementTag: t.tag, elementClasses: t.classes })
    }

    const primary = targets[0]
    // Capture all current rects + eids before async task creation
    const currentRects = [...deps.selectionRects.value]
    const eids = [...deps.selectedEids.value]
    const task = await createRouteTask({
      type: 'annotation', description: text,
      file: primary.file, line: parseInt(primary.line) || 0, component: primary.component,
      visual: { kind: 'select', eids },
      context: {
        element_tag: primary.tag,
        element_classes: primary.classes,
        ...(primary.text ? { element_text: primary.text } : {}),
        ...(sel.sourceTag ? { element_source_tag: sel.sourceTag } : {}),
        ...(targets.length > 1 ? {
          elements: targets.map(t => ({
            tag: t.tag, classes: t.classes, component: t.component,
            file: t.file, line: parseInt(t.line) || 0,
            ...(t.text ? { text: t.text } : {}),
          })),
        } : {}),
      },
    })
    // Seed task element highlights immediately (rAF loop will take over)
    if (task && currentRects.length) {
      deps.taskElementRects.value = [...deps.taskElementRects.value, ...currentRects.map(rect => ({ taskId: task.id, rect }))]
      deps.startAnnotationLoop()
    }
  }

  function onAddAnnotationAction(action: string, label: string) {
    if (!deps.primarySelection.value) return

    const sel = deps.primarySelection.value
    const targets = [{ file: sel.file, line: sel.line, component: sel.component, tag: sel.tagName, classes: sel.classes, text: sel.text || '' }]

    for (const t of targets) {
      deps.styleEditor.recordAnnotation({ file: t.file, line: t.line, component: t.component, intent: label, action, elementTag: t.tag, elementClasses: t.classes })
    }

    const primary = targets[0]
    createRouteTask({
      type: 'annotation', description: label,
      file: primary.file, line: parseInt(primary.line) || 0, component: primary.component,
      action,
      context: {
        element_tag: primary.tag,
        element_classes: primary.classes,
        ...(primary.text ? { element_text: primary.text } : {}),
        ...(sel.sourceTag ? { element_source_tag: sel.sourceTag } : {}),
      },
    })
  }

  async function restoreAnnotationsFromTasks() {
    await deps.taskSystem.fetchTasks()
    const fallbackRoute = deps.annotations.activeRoute.value || '/'

    for (const task of deps.taskSystem.tasks.value) {
      if (restoredTaskIds.has(task.id)) continue
      if (task.status === 'accepted') continue

      const v = task.visual as any
      if (!v) continue

      restoredTaskIds.add(task.id)
      const taskRoute = task.route || fallbackRoute

      if (v.kind === 'pin' && v.x != null && v.y != null) {
        const ctx = (task as any).context || {}
        const pin = deps.annotations.addPin(
          { file: task.file, line: String(task.line), component: task.component || '', elementTag: ctx.element_tag || v.element_tag || '', elementClasses: ctx.element_classes || '' },
          v.x, v.y
        )
        pin.route = taskRoute
        deps.annotations.updatePinNote(pin.id, task.description)
      } else if (v.kind === 'arrow') {
        const arrow = deps.annotations.addArrow(v.fromX, v.fromY, v.toX, v.toY, v.label || task.description, v.color)
        arrow.route = taskRoute
        // Restore rects + source file/line so the rAF loop can re-resolve eids on bridge ready.
        // Saved eids are NOT restored (they're volatile across reloads).
        const ctx = (task as any).context || {}
        const toEl = ctx.to_element || {}
        deps.annotations.updateArrow(arrow.id, {
          ...(v.fromRect ? { fromRect: v.fromRect } : {}),
          ...(v.toRect ? { toRect: v.toRect } : {}),
          ...(task.file ? { fromFile: task.file } : {}),
          ...(task.line ? { fromLine: task.line } : {}),
          ...(toEl.file ? { toFile: toEl.file as string } : {}),
          ...(toEl.line ? { toLine: toEl.line as number } : {}),
        })
      } else if (v.kind === 'section') {
        const section = deps.annotations.addDrawnSection(v.x, v.y, v.width, v.height)
        section.route = taskRoute
        if ((task as any).prompt || task.description) {
          deps.annotations.updateDrawnSection(section.id, {
            prompt: (task as any).prompt || task.description,
            nearFile: task.file, nearLine: task.line,
          })
        }
        sectionTaskMap.value = { ...sectionTaskMap.value, [section.id]: task.id }
      } else if (v.kind === 'highlight') {
        const ctx = (task as any).context || {}
        const hl = deps.annotations.addHighlight(
          ctx.selected_text || '',
          { file: task.file, line: task.line, component: task.component || '', elementTag: ctx.element_tag || '' },
          v.color, v.rect, undefined, v.rects,
        )
        hl.route = taskRoute
        v.annotationId = hl.id
      }
      // kind === 'select' uses taskElementRects from rAF loop — eids re-resolved when bridge connects
    }
  }

  /** Returns true if any annotation still needs an eid resolved */
  function hasUnresolvedAnnotations(): boolean {
    for (const t of deps.taskSystem.tasks.value) {
      const v = t.visual as any
      if (v?.kind === 'select' && t.file && t.line && t.status !== 'accepted' && !(v.eids?.length)) return true
    }
    for (const a of deps.annotations.arrows.value) {
      if (!a.fromEid && a.fromFile && a.fromLine) return true
      if (!a.toEid && a.toFile && a.toLine) return true
    }
    for (const s of deps.annotations.drawnSections.value) {
      if (!s.nearEid && s.nearFile && s.nearLine) return true
    }
    for (const h of deps.annotations.highlights.value) {
      if (!h.eid && h.file && h.line) return true
    }
    return false
  }

  /** Single-pass eid resolution against the bridge */
  async function resolveAnnotationEidsOnce() {
    // Select tasks (multi-element highlights)
    for (const task of deps.taskSystem.tasks.value) {
      const v = task.visual as any
      if (v?.kind === 'select' && task.file && task.line && task.status !== 'accepted' && !(v.eids?.length)) {
        const group = await deps.iframe.findTemplateGroup(task.file, String(task.line), '')
        if (group.eids.length > 0) {
          v.eids = group.eids
          const rects = group.rects.filter((r: any): r is BridgeRect => r !== null)
          for (const rect of rects) {
            deps.taskElementRects.value = [...deps.taskElementRects.value, { taskId: task.id, rect }]
          }
        }
      }
    }

    // Restored arrows: re-resolve from/to eids by file+line
    for (const arrow of deps.annotations.arrows.value) {
      if (!arrow.fromEid && arrow.fromFile && arrow.fromLine) {
        const g = await deps.iframe.findTemplateGroup(arrow.fromFile, String(arrow.fromLine), '')
        if (g.eids.length > 0) {
          const rect = g.rects[0] || undefined
          deps.annotations.updateArrow(arrow.id, {
            fromEid: g.eids[0],
            ...(rect ? { fromRect: rect as BridgeRect } : {}),
          })
        }
      }
      if (!arrow.toEid && arrow.toFile && arrow.toLine) {
        const g = await deps.iframe.findTemplateGroup(arrow.toFile, String(arrow.toLine), '')
        if (g.eids.length > 0) {
          const rect = g.rects[0] || undefined
          deps.annotations.updateArrow(arrow.id, {
            toEid: g.eids[0],
            ...(rect ? { toRect: rect as BridgeRect } : {}),
          })
        }
      }
    }

    // Restored drawn sections
    for (const section of deps.annotations.drawnSections.value) {
      if (!section.nearEid && section.nearFile && section.nearLine) {
        const g = await deps.iframe.findTemplateGroup(section.nearFile, String(section.nearLine), '')
        if (g.eids.length > 0) {
          deps.annotations.updateDrawnSection(section.id, { nearEid: g.eids[0] })
        }
      }
    }

    // Restored text highlights
    for (const hl of deps.annotations.highlights.value) {
      if (!hl.eid && hl.file && hl.line) {
        const g = await deps.iframe.findTemplateGroup(hl.file, String(hl.line), '')
        if (g.eids.length > 0) {
          hl.eid = g.eids[0]
          const rect = g.rects[0]
          if (rect) hl.rect = rect as BridgeRect
        }
      }
    }
  }

  async function resolveSelectTaskEids() {
    // The iframe app may mount its components after bridge:ready fires, so we
    // retry resolution a few times until all annotations have eids or we give up.
    // Each retry waits a frame to let Vue/React/Svelte render the next batch.
    const MAX_ATTEMPTS = 8
    const RETRY_DELAY_MS = 150
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      try { await resolveAnnotationEidsOnce() } catch { /* bridge hiccup, retry */ }
      if (!hasUnresolvedAnnotations()) break
      await new Promise(r => setTimeout(r, RETRY_DELAY_MS))
    }
    deps.startAnnotationLoop()
  }

  async function onAddGeneralTask(text: string) {
    const sel = deps.primarySelection.value
    const currentRects = [...deps.selectionRects.value]
    const eids = [...deps.selectedEids.value]
    const task = await createRouteTask({
      type: 'annotation',
      description: text,
      file: sel?.file || '',
      line: sel ? parseInt(sel.line) || 0 : 0,
      component: sel?.component || '',
      ...(eids.length ? { visual: { kind: 'select', eids } } : {}),
      ...(sel?.sourceTag || sel?.tagName || sel?.classes ? {
        context: {
          ...(sel?.tagName ? { element_tag: sel.tagName } : {}),
          ...(sel?.classes ? { element_classes: sel.classes } : {}),
          ...(sel?.text ? { element_text: sel.text } : {}),
          ...(sel?.sourceTag ? { element_source_tag: sel.sourceTag } : {}),
        },
      } : {}),
    })
    if (task && currentRects.length) {
      deps.taskElementRects.value = [...deps.taskElementRects.value, ...currentRects.map(rect => ({ taskId: task.id, rect }))]
      deps.startAnnotationLoop()
    }
  }

  return {
    pendingTaskCreation, pendingTaskText, submittingPendingTask,
    routeTasks,
    showNewTaskForm, newTaskText,
    denyingTaskId, denyFeedbackText,
    detailTaskId, detailTask,
    confirmDeleteTaskId,
    sectionTaskMap, arrowDragTargetRect,
    restoredTaskIds,
    discardUncommittedAnnotations,
    removeTaskAnnotations, executeDeleteTask,
    acceptTask, submitDeny, submitNewTask,
    createRouteTask,
    onSectionSubmit,
    onArrowDragMove, onArrowDragEnd,
    describeElement, onArrowCreated,
    submitPendingTask, cancelPendingTask,
    onAddAnnotationNote, onAddAnnotationAction,
    onAddGeneralTask,
    restoreAnnotationsFromTasks, resolveSelectTaskEids,
  }
}
