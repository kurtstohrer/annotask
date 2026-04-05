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
  includeElementContext: Ref<boolean>
  currentRoute: Ref<string>
  activePanel: Ref<'tasks' | 'inspector'>
  clearSelection: () => void
  startAnnotationLoop: () => void
}) {
  const pendingTaskCreation = ref<PendingTaskContext | null>(null)
  const pendingTaskText = ref('')
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
  const restoredTaskIds = new Set<string>()

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
    const screenshotFilename = deps.screenshots.consumeScreenshot()
    if (screenshotFilename) extra.screenshot = screenshotFilename
    const vp = deps.viewport.effectiveViewport.value
    if (vp.width || vp.height) extra.viewport = { width: vp.width, height: vp.height }
    if (deps.includeHistory.value) {
      const snapshot = deps.interactionHistory.snapshotForChange(deps.currentRoute.value)
      if (snapshot.recent_actions.length > 0) extra.interaction_history = snapshot
    }
    if (deps.includeElementContext.value && deps.primarySelection.value?.eid) {
      const ctx = await deps.iframe.getElementContext(deps.primarySelection.value.eid)
      if (ctx) extra.element_context = ctx
    }
    deps.taskSystem.updateTaskStatus(taskId, 'denied', denyFeedbackText.value.trim(), Object.keys(extra).length > 0 ? extra : undefined)
    denyingTaskId.value = null
    denyFeedbackText.value = ''
  }

  function submitNewTask() {
    const text = newTaskText.value.trim()
    if (!text) return
    createRouteTask({ type: 'annotation', description: text, file: '', line: 0 })
    newTaskText.value = ''
    showNewTaskForm.value = false
  }

  async function createRouteTask(data: Record<string, unknown>): Promise<Task | null> {
    const mfe = deps.primarySelection.value?.mfe || ''
    const vp = deps.viewport.effectiveViewport.value
    const vpData = (vp.width || vp.height) ? { viewport: { width: vp.width, height: vp.height } } : {}
    const historySnapshot = deps.includeHistory.value ? deps.interactionHistory.snapshotForChange(deps.currentRoute.value) : null
    const historyData = historySnapshot && historySnapshot.recent_actions.length > 0 ? { interaction_history: historySnapshot } : {}
    let elementContextData: Record<string, unknown> = {}
    if (deps.includeElementContext.value && deps.primarySelection.value?.eid) {
      const ctx = await deps.iframe.getElementContext(deps.primarySelection.value.eid)
      if (ctx) elementContextData = { element_context: ctx }
    }
    const screenshotFilename = deps.screenshots.consumeScreenshot()
    const screenshotData = screenshotFilename ? { screenshot: screenshotFilename } : {}
    const task = await deps.taskSystem.createTask({ ...data, route: deps.currentRoute.value, ...(mfe ? { mfe } : {}), ...vpData, ...historyData, ...elementContextData, ...screenshotData })
    if (task) deps.activePanel.value = 'tasks'
    return task
  }

  async function onSectionSubmit(id: string) {
    const section = deps.annotations.drawnSections.value.find(s => s.id === id)
    if (!section || !section.prompt.trim()) return
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
      file: section.nearFile || '',
      line: section.nearLine || 0,
      component: section.nearComponent || '',
      placement: section.placement || '',
      visual: { kind: 'section', annotationId: section.id, x: Math.round(section.x), y: Math.round(section.y), width: Math.round(section.width), height: Math.round(section.height), nearEid: section.nearEid },
    })
    if (task) sectionTaskMap.value = { ...sectionTaskMap.value, [id]: task.id }
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
          toFile: arrow.toFile || toCtx?.file || '',
          toLine: arrow.toLine || toCtx?.line || 0,
          toTag: toCtx?.tag || '',
          toClasses: toCtx?.classes || '',
          toComponent: toCtx?.component || '',
        },
      }
    }
  }

  function describeElement(ctx: { file: string; line: string; component: string; tag: string; classes?: string } | null): string {
    if (!ctx) return 'element'
    const tag = ctx.tag || 'element'
    const cls = ctx.classes?.split(' ').find(c => c && !c.startsWith('data-'))
    if (ctx.component && cls) return `<${tag}.${cls}> in ${ctx.component}`
    if (ctx.component && ctx.tag !== ctx.component.toLowerCase()) return `<${tag}> in ${ctx.component}`
    if (cls) return `<${tag}.${cls}>`
    return `<${tag}>`
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

  function onArrowCreated(arrowId: string, fromCtx: { file: string; line: string; component: string; tag: string; classes?: string } | null, toCtx: { file: string; line: string; component: string; tag: string; classes?: string } | null) {
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
        toFile: arrow.toFile || toCtx?.file || '',
        toLine: arrow.toLine || toCtx?.line || 0,
        toTag: toCtx?.tag || '',
        toClasses: toCtx?.classes || '',
        toComponent: toCtx?.component || '',
      },
    }
    pendingTaskText.value = ''
  }

  function submitPendingArrowTask(id: string, description: string) {
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
        to_element: {
          tag: (meta.toTag as string) || '',
          classes: (meta.toClasses as string) || '',
          component: (meta.toComponent as string) || '',
          file: arrow.toFile || '',
          line: arrow.toLine || 0,
        },
      },
    })
  }

  async function submitPendingTask() {
    const ctx = pendingTaskCreation.value
    if (!ctx || !pendingTaskText.value.trim()) return

    if (ctx.kind === 'pin') {
      const meta = ctx.meta as { elementTag: string; elementClasses: string; pinX: number; pinY: number }
      deps.annotations.updatePinNote(ctx.annotationId!, pendingTaskText.value.trim())
      deps.styleEditor.recordAnnotation({
        file: ctx.file, line: String(ctx.line), component: ctx.component,
        intent: pendingTaskText.value.trim(),
        elementTag: meta.elementTag, elementClasses: meta.elementClasses,
      })
      createRouteTask({
        type: 'annotation',
        description: pendingTaskText.value.trim(),
        file: ctx.file, line: parseInt(String(ctx.line)) || 0, component: ctx.component,
        visual: { kind: 'pin', annotationId: ctx.annotationId!, x: meta.pinX, y: meta.pinY },
        context: {
          element_tag: meta.elementTag,
          element_classes: meta.elementClasses,
        },
      })
    } else if (ctx.kind === 'arrow') {
      submitPendingArrowTask(ctx.annotationId!, pendingTaskText.value.trim())
    } else if (ctx.kind === 'highlight') {
      const meta = ctx.meta as { selectedText: string; elementTag: string }
      const description = pendingTaskText.value.trim()
      deps.annotations.updateHighlight(ctx.annotationId!, { prompt: description })
      const hl = deps.annotations.highlights.value.find(h => h.id === ctx.annotationId)
      const intent = `Change "${meta.selectedText}" → ${description}`
      deps.styleEditor.recordAnnotation({
        file: ctx.file, line: String(ctx.line), component: ctx.component,
        intent, action: 'text_edit', elementTag: meta.elementTag,
      })
      createRouteTask({
        type: 'annotation', description: intent, file: ctx.file, line: parseInt(String(ctx.line)) || 0,
        component: ctx.component, action: 'text_edit',
        visual: { kind: 'highlight', annotationId: ctx.annotationId, eid: hl?.eid, rect: hl?.rect, color: hl?.color },
        context: { element_tag: meta.elementTag, selected_text: meta.selectedText },
      })
    } else if (ctx.kind === 'select') {
      const meta = ctx.meta as { elementTag: string; elementClasses: string }
      const description = pendingTaskText.value.trim()
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
        },
      })
      if (task && currentRects.length) {
        deps.taskElementRects.value = [...deps.taskElementRects.value, ...currentRects.map(rect => ({ taskId: task.id, rect }))]
        deps.startAnnotationLoop()
      }
    }

    pendingTaskCreation.value = null
    pendingTaskText.value = ''
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
    const targets = [{ file: sel.file, line: sel.line, component: sel.component, tag: sel.tagName, classes: sel.classes }]

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
        ...(targets.length > 1 ? {
          elements: targets.map(t => ({
            tag: t.tag, classes: t.classes, component: t.component,
            file: t.file, line: parseInt(t.line) || 0,
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
    const targets = [{ file: sel.file, line: sel.line, component: sel.component, tag: sel.tagName, classes: sel.classes }]

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
        // Restore rects but NOT eids — eids are volatile across reloads
        deps.annotations.updateArrow(arrow.id, {
          ...(v.fromRect ? { fromRect: v.fromRect } : {}),
          ...(v.toRect ? { toRect: v.toRect } : {}),
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
          v.color, v.rect,
        )
        hl.route = taskRoute
        v.annotationId = hl.id
      }
      // kind === 'select' uses taskElementRects from rAF loop — eids re-resolved when bridge connects
    }
  }

  async function resolveSelectTaskEids() {
    for (const task of deps.taskSystem.tasks.value) {
      const v = task.visual as any
      if (v?.kind === 'select' && task.file && task.line && task.status !== 'accepted') {
        try {
          const group = await deps.iframe.findTemplateGroup(task.file, String(task.line), '')
          if (group.eids.length > 0) {
            v.eids = group.eids
            const rects = group.rects.filter((r: any): r is BridgeRect => r !== null)
            for (const rect of rects) {
              deps.taskElementRects.value = [...deps.taskElementRects.value, { taskId: task.id, rect }]
            }
          }
        } catch { /* bridge not ready yet */ }
      }
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
    })
    if (task && currentRects.length) {
      deps.taskElementRects.value = [...deps.taskElementRects.value, ...currentRects.map(rect => ({ taskId: task.id, rect }))]
      deps.startAnnotationLoop()
    }
  }

  return {
    pendingTaskCreation, pendingTaskText,
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
