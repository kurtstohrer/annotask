<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted, computed } from 'vue'
import LayoutControls from './components/LayoutControls.vue'
import SpacingControls from './components/SpacingControls.vue'
import SizeControls from './components/SizeControls.vue'
import AppearanceControls from './components/AppearanceControls.vue'
import { useStyleEditor } from './composables/useStyleEditor'
import { useInteractionMode } from './composables/useInteractionMode'
import { useDesignSpec } from './composables/useDesignSpec'
import { useLayoutOverlay } from './composables/useLayoutOverlay'
import { useAnnotations } from './composables/useAnnotations'
import { type ElementRole } from './composables/useElementClassification'
import { useIframeManager } from './composables/useIframeManager'
import { useCanvasDrawing } from './composables/useCanvasDrawing'
import type { ClickElementEvent, HoverEnterEvent, BridgeRect } from '../shared/bridge-types'
import ModeToolbar from './components/ModeToolbar.vue'
import ContextMenu from './components/ContextMenu.vue'
import PinOverlay from './components/PinOverlay.vue'
import ArrowOverlay from './components/ArrowOverlay.vue'
import DrawnSectionOverlay from './components/DrawnSectionOverlay.vue'
import NotesTab from './components/NotesTab.vue'
import TextHighlightOverlay from './components/TextHighlightOverlay.vue'
import LayoutOverlay from './components/LayoutOverlay.vue'
import ThemePage from './components/ThemePage.vue'
import ReportViewer from './components/ReportViewer.vue'
import { useTasks } from './composables/useTasks'

const styleEditor = useStyleEditor()
const { applyStyle, recordAnnotation, recordClassChange, removeAnnotationsByFile, changes, report } = styleEditor

async function doUndo() {
  const undoInfo = styleEditor.undo()
  if (!undoInfo) return
  if (undoInfo.type === 'style' && undoInfo.eid) {
    await iframe.undoStyle(undoInfo.eid, undoInfo.property!, undoInfo.value || '')
  } else if (undoInfo.type === 'class' && undoInfo.eid) {
    await iframe.undoClass(undoInfo.eid, undoInfo.classes || '')
  } else if (undoInfo.type === 'insert_remove' && undoInfo.eid) {
    await iframe.removePlaceholder(undoInfo.eid)
  }
  await readLiveStyles()
}

async function doClearChanges() {
  const placeholderEids = styleEditor.clearChanges()
  for (const eid of placeholderEids) {
    await iframe.removePlaceholder(eid)
  }
}
const annotations = useAnnotations()
const taskSystem = useTasks()

// ── State ──────────────────────────────────────────────
const iframeRef = ref<HTMLIFrameElement | null>(null)
const { mode: interactionMode } = useInteractionMode()
const { isInitialized: configInitialized } = useDesignSpec()
const shellView = ref<'editor' | 'theme'>(
  localStorage.getItem('annotask:shellView') === 'theme' ? 'theme' : 'editor'
)
watch(shellView, (v) => localStorage.setItem('annotask:shellView', v))
const layoutOverlay = useLayoutOverlay(iframeRef)
const iframe = useIframeManager(iframeRef)
const { currentRoute } = iframe
const canvas = useCanvasDrawing(annotations, (x: number, y: number) => iframe.resolveElementAt(x, y), () => interactionMode.value, onArrowCreated)
const { drawingArrow, drawingRect, onCanvasPointerDown, onCanvasPointerMove, onCanvasPointerUp } = canvas

// Sync mode to bridge + clear selection on interact
watch(interactionMode, (mode) => {
  iframe.setMode(mode)
  if (mode === 'interact') {
    primarySelection.value = null
    selectedEids.value = []
    templateGroupEids.value = []
    hoverRect.value = null
    hoverInfo.value = null
  }
})
const showWarning = ref(false)
const showReportPanel = ref(false)
const activeTab = ref<'layout' | 'spacing' | 'size' | 'style' | 'classes' | 'notes'>('layout')
// Markup visibility toggles
const showMarkup = ref({ pins: true, arrows: true, sections: true, highlights: true })
const showTaskPanel = ref(localStorage.getItem('annotask:showTaskPanel') === 'true')
watch(showTaskPanel, (v) => localStorage.setItem('annotask:showTaskPanel', String(v)))
const showNewTaskForm = ref(false)
const newTaskText = ref('')
const denyingTaskId = ref<string | null>(null)
const denyFeedbackText = ref('')
const showShortcuts = ref(localStorage.getItem('annotask:showShortcuts') === 'true')
watch(showShortcuts, (v) => localStorage.setItem('annotask:showShortcuts', String(v)))

// ── Pending Task Creation (sidebar panel after pin/arrow placement) ──
interface PendingTaskContext {
  kind: 'pin' | 'arrow'
  /** Colored icon label, e.g. "Pin on <div>" or "Arrow from Header → Footer" */
  label: string
  file: string
  line: string | number
  component: string
  /** For pin: pin id. For arrow: arrow id */
  annotationId: string
  /** Extra data for task creation */
  meta: Record<string, unknown>
}
const pendingTaskCreation = ref<PendingTaskContext | null>(null)
const pendingTaskText = ref('')

// All tasks show in list (visual annotations are route-filtered separately)
const routeTasks = computed(() => taskSystem.tasks.value)

function acceptTask(taskId: string) {
  // Remove visual annotations associated with this task
  const task = taskSystem.tasks.value.find(t => t.id === taskId) as any
  if (task?.visual) {
    const v = task.visual
    if (v.annotationId) {
      // Use stable annotation ID when available
      if (v.kind === 'pin') annotations.removePin(v.annotationId)
      else if (v.kind === 'arrow') annotations.removeArrow(v.annotationId)
      else if (v.kind === 'section') annotations.removeDrawnSection(v.annotationId)
    } else if (v.kind === 'pin') {
      const pins = annotations.getPinsForElement(task.file, task.line)
      for (const p of pins) annotations.removePin(p.id)
    } else if (v.kind === 'arrow') {
      const arrow = annotations.arrows.value.find((a: any) =>
        Math.abs(a.fromX - v.fromX) < 5 && Math.abs(a.fromY - v.fromY) < 5
      )
      if (arrow) annotations.removeArrow(arrow.id)
    } else if (v.kind === 'section') {
      const section = annotations.drawnSections.value.find((s: any) =>
        Math.abs(s.x - v.x) < 5 && Math.abs(s.y - v.y) < 5
      )
      if (section) annotations.removeDrawnSection(section.id)
    }
  }
  // Also remove annotation change records from the report
  if (task.file && task.line != null) {
    removeAnnotationsByFile(task.file, task.line)
  }

  taskSystem.updateTaskStatus(taskId, 'accepted')
}

function submitDeny(taskId: string) {
  if (!denyFeedbackText.value.trim()) return
  taskSystem.updateTaskStatus(taskId, 'denied', denyFeedbackText.value.trim())
  denyingTaskId.value = null
  denyFeedbackText.value = ''
}

function submitNewTask() {
  const text = newTaskText.value.trim()
  if (!text) return
  createRouteTask({ type: 'annotation', description: text, file: '', line: 0, intent: text })
  newTaskText.value = ''
  showNewTaskForm.value = false
}

const pendingHighlight = ref<{ text: string; x: number; y: number; file: string; line: number; component: string; tag: string } | null>(null)

// ── Selection Model ────────────────────────────────────
const primarySelection = ref<{
  file: string; line: string; component: string
  tagName: string; classes: string; eid: string
} | null>(null)
const selectedEids = ref<string[]>([])
const templateGroupEids = ref<string[]>([])
const applyToGroup = ref(true)

const editTargetEids = computed<string[]>(() => {
  if (selectedEids.value.length > 1) return selectedEids.value
  if (applyToGroup.value && templateGroupEids.value.length > 1) return templateGroupEids.value
  return primarySelection.value ? [primarySelection.value.eid] : []
})

// Async-refreshed rects (updated on selection change)
const selectionRects = ref<BridgeRect[]>([])
const groupRects = ref<BridgeRect[]>([])
let rectsGeneration = 0

async function refreshRects() {
  const gen = ++rectsGeneration

  if (selectedEids.value.length > 0) {
    const rects = await iframe.getElementRects(selectedEids.value)
    if (gen !== rectsGeneration) return // stale
    selectionRects.value = rects.filter((r): r is BridgeRect => r !== null)
  } else {
    selectionRects.value = []
  }

  if (applyToGroup.value && selectedEids.value.length <= 1 && templateGroupEids.value.length > 0) {
    const otherEids = templateGroupEids.value.filter(eid => !selectedEids.value.includes(eid))
    const rects = await iframe.getElementRects(otherEids)
    if (gen !== rectsGeneration) return // stale
    groupRects.value = rects.filter((r): r is BridgeRect => r !== null)
  } else {
    groupRects.value = []
  }
}

watch([selectedEids, templateGroupEids, applyToGroup], refreshRects, { deep: true })

const selectionSummary = computed(() => {
  const explicit = selectedEids.value.length
  const group = templateGroupEids.value.length
  if (explicit > 1) return `${explicit} elements selected`
  if (group > 1) return `1 selected · ${group} instances in template`
  return null
})

const selectedElementRole = ref<ElementRole | null>(null)

async function refreshElementRole() {
  if (!primarySelection.value) { selectedElementRole.value = null; return }
  const classification = await iframe.classifyElement(primarySelection.value.eid)
  selectedElementRole.value = classification?.role || null
}

// Live computed styles
const liveStyles = ref<Record<string, string>>({})
const editingClasses = ref('')
const hoverRect = ref<BridgeRect | null>(null)
const hoverInfo = ref<{ tag: string; file: string; component: string } | null>(null)

const allStyleProps = [
  'display', 'position', 'width', 'height', 'min-width', 'max-width', 'min-height', 'max-height',
  'padding', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
  'margin', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
  'gap', 'flex-direction', 'align-items', 'justify-content', 'flex-wrap',
  'background-color', 'color', 'font-size', 'font-weight', 'font-family',
  'text-align', 'line-height', 'letter-spacing',
  'border', 'border-radius', 'border-color', 'border-width',
  'opacity', 'overflow', 'box-shadow',
]

async function readLiveStyles() {
  if (!primarySelection.value?.eid) return
  liveStyles.value = await iframe.getComputedStyles(primarySelection.value.eid, allStyleProps)
}

// ── Event Handlers (bridge-based) ──────────────────────

async function onIframeLoad() {
  iframe.initBridgeForIframe()

  iframe.onBridgeReady(async () => {
    // Sync mode
    iframe.setMode(interactionMode.value)
    // Check source mapping
    showWarning.value = !(await iframe.checkSourceMapping())
    // Get initial route
    const route = await iframe.getCurrentRoute()
    annotations.setRoute(route)
    // Restore annotations
    restoreAnnotationsFromTasks()
    // Rescan layout if overlay is active
    if (layoutOverlay.showOverlay.value) layoutOverlay.scan()
  })
}

// Subscribe to bridge events
function setupBridgeEvents() {
  iframe.onBridgeEvent('hover:enter', (data: HoverEnterEvent) => {
    const shellRect = iframe.toShellRect(data.rect)
    hoverRect.value = shellRect
    hoverInfo.value = data.file ? { tag: data.tag, file: data.file, component: data.component } : null
  })

  iframe.onBridgeEvent('hover:leave', () => {
    hoverRect.value = null
    hoverInfo.value = null
  })

  iframe.onBridgeEvent('click:element', async (data: ClickElementEvent) => {
    const { file, line, component, tag: tagName, classes, eid, shiftKey, clientX, clientY } = data
    const shellRect = iframe.toShellRect(data.rect)

    // Pin mode: create pin → open task creation panel
    if (interactionMode.value === 'pin') {
      const pinX = shellRect ? shellRect.x + shellRect.width / 2 : clientX
      const pinY = shellRect ? shellRect.y : clientY
      const pin = annotations.addPin(
        { file, line, component, elementTag: tagName, elementClasses: classes },
        pinX, pinY
      )
      primarySelection.value = { file, line, component, tagName, classes, eid }
      selectedEids.value = [eid]
      await readLiveStyles()
      await refreshElementRole()
      pendingTaskCreation.value = {
        kind: 'pin',
        label: `Pin on ${describeElement({ file, line, component, tag: tagName, classes })}`,
        file, line, component,
        annotationId: pin.id,
        meta: { elementTag: tagName, elementClasses: classes, pinX, pinY },
      }
      pendingTaskText.value = ''
      return
    }

    if (shiftKey && primarySelection.value) {
      const idx = selectedEids.value.indexOf(eid)
      if (idx >= 0) {
        selectedEids.value.splice(idx, 1)
        if (selectedEids.value.length === 0) {
          primarySelection.value = null
          templateGroupEids.value = []
        }
      } else {
        selectedEids.value.push(eid)
      }
      await refreshRects()
    } else {
      primarySelection.value = { file, line, component, tagName, classes, eid }
      selectedEids.value = [eid]
      const group = await iframe.findTemplateGroup(file, line, tagName)
      templateGroupEids.value = group.eids
      applyToGroup.value = group.eids.length > 1
      editingClasses.value = classes
      await readLiveStyles()
      await refreshElementRole()
      await refreshRects()
    }

    hoverRect.value = null
  })

  iframe.onBridgeEvent('contextmenu:element', async (data: ClickElementEvent) => {
    const { file, line, component, tag: tagName, classes, eid } = data
    const shellRect = iframe.toShellRect(data.rect)
    primarySelection.value = { file, line, component, tagName, classes, eid }
    selectedEids.value = [eid]
    await readLiveStyles()
    await refreshElementRole()
    contextMenu.value = {
      visible: true,
      x: shellRect ? shellRect.x + shellRect.width / 2 : data.clientX,
      y: shellRect ? shellRect.y + shellRect.height / 2 : data.clientY,
    }
  })

  iframe.onBridgeEvent('selection:text', (data: { text: string; eid: string; file: string; line: number; component: string; tag: string }) => {
    const iframeEl = iframeRef.value
    const offsetX = iframeEl?.getBoundingClientRect().left || 0
    const offsetY = iframeEl?.getBoundingClientRect().top || 0
    pendingHighlight.value = {
      text: data.text,
      x: offsetX + 100,
      y: offsetY + 100,
      file: data.file,
      line: data.line,
      component: data.component,
      tag: data.tag,
    }
  })

  iframe.onBridgeEvent('keydown', (data: { key: string; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }) => {
    if ((data.ctrlKey || data.metaKey) && data.key === 'z' && !data.shiftKey) {
      doUndo()
    }
  })

  iframe.onBridgeEvent('route:changed', (data: { path: string }) => {
    annotations.setRoute(data.path)
  })
}

// ── Style Change Handler ───────────────────────────────
async function onStyleChange(property: string, value: string) {
  if (!primarySelection.value) return
  const meta = {
    file: primarySelection.value.file,
    line: primarySelection.value.line,
    component: primarySelection.value.component,
  }
  // Apply via bridge to all targets
  const eids = editTargetEids.value
  for (const eid of eids) {
    const before = await iframe.applyStyleVia(eid, property, value)
    // Record the change (first apply captures before, subsequent just update after)
    applyStyle(eid, property, value, before, meta)
  }
  await readLiveStyles()
}

async function applyClassChange() {
  if (!primarySelection.value) return
  const before = primarySelection.value.classes
  const after = editingClasses.value
  if (before === after) return
  const meta = {
    file: primarySelection.value.file,
    line: primarySelection.value.line,
    component: primarySelection.value.component,
  }
  const eids = editTargetEids.value
  for (const eid of eids) {
    await iframe.setClass(eid, after)
    recordClassChange(eid, before, after, meta)
  }
  primarySelection.value.classes = after
  await readLiveStyles()
}

// ── Report ─────────────────────────────────────────────

// ── Context Menu ──────────────────────────────────────
const contextMenu = ref({ visible: false, x: 0, y: 0 })


// ── Annotation Handlers ──────────────────────────────
async function onAddAnnotationNote(text: string) {
  if (!primarySelection.value) return

  // Use selection metadata (already have file/line/component from click events)
  const sel = primarySelection.value
  const targets = [{ file: sel.file, line: sel.line, component: sel.component, tag: sel.tagName, classes: sel.classes }]

  for (const t of targets) {
    recordAnnotation({ file: t.file, line: t.line, component: t.component, intent: text, elementTag: t.tag, elementClasses: t.classes })

    const existing = annotations.getPinsForElement(t.file, parseInt(t.line))
    if (existing.length === 0) {
      // Get rect via bridge for pin placement
      const rect = selectionRects.value[0]
      const pinX = rect ? rect.x + rect.width / 2 : 100
      const pinY = rect ? rect.y + 10 : 100
      const pin = annotations.addPin(
        { file: t.file, line: t.line, component: t.component, elementTag: t.tag, elementClasses: t.classes },
        pinX, pinY
      )
      annotations.updatePinNote(pin.id, text)
    }
  }

  const primary = targets[0]
  const pinForPrimary = annotations.getPinsForElement(primary.file, parseInt(primary.line))
  const pinPos = pinForPrimary.length > 0 ? { x: pinForPrimary[0].clickX, y: pinForPrimary[0].clickY } : null
  createRouteTask({
    type: 'annotation', description: text,
    file: primary.file, line: parseInt(primary.line) || 0, component: primary.component,
    intent: text,
    visual: pinPos ? { kind: 'pin', annotationId: pinForPrimary[0].id, x: pinPos.x, y: pinPos.y } : undefined,
    context: {
      element: {
        tag: primary.tag,
        classes: primary.classes,
        component: primary.component,
        file: primary.file,
        line: parseInt(primary.line) || 0,
      },
      ...(targets.length > 1 ? {
        elements: targets.map(t => ({
          tag: t.tag, classes: t.classes, component: t.component,
          file: t.file, line: parseInt(t.line) || 0,
        })),
      } : {}),
    },
  })
}

function onAddAnnotationAction(action: string, label: string) {
  if (!primarySelection.value) return

  const sel = primarySelection.value
  const targets = [{ file: sel.file, line: sel.line, component: sel.component, tag: sel.tagName, classes: sel.classes }]

  for (const t of targets) {
    recordAnnotation({ file: t.file, line: t.line, component: t.component, intent: label, action, elementTag: t.tag, elementClasses: t.classes })
  }

  const primary = targets[0]
  createRouteTask({
    type: 'annotation', description: label,
    file: primary.file, line: parseInt(primary.line) || 0, component: primary.component,
    intent: label, action,
    context: {
      element: {
        tag: primary.tag, classes: primary.classes, component: primary.component,
        file: primary.file, line: parseInt(primary.line) || 0,
      },
    },
  })
}

// ── Restore annotations from saved tasks ─────────────
async function restoreAnnotationsFromTasks() {
  await taskSystem.fetchTasks()
  const route = currentRoute.value
  for (const task of taskSystem.tasks.value) {
    // Only restore for current route (or tasks without route)
    if (task.route && task.route !== route) continue
    if (task.status === 'accepted') continue

    const v = task.visual as any
    if (!v) continue

    if (v.kind === 'pin' && v.x && v.y) {
      // Check if pin already exists at this location
      const existing = annotations.getPinsForElement(task.file, task.line)
      if (existing.length === 0) {
        const pin = annotations.addPin(
          { file: task.file, line: String(task.line), component: task.component || '', elementTag: v.element_tag || '', elementClasses: '' },
          v.x, v.y
        )
        annotations.updatePinNote(pin.id, task.description)
      }
    } else if (v.kind === 'arrow') {
      annotations.addArrow(v.fromX, v.fromY, v.toX, v.toY, v.label || task.description)
    } else if (v.kind === 'section') {
      const section = annotations.addDrawnSection(v.x, v.y, v.width, v.height)
      if (task.prompt || task.description) {
        annotations.updateDrawnSection(section.id, {
          prompt: (task as any).prompt || task.description,
          nearFile: task.file, nearLine: task.line,
        })
      }
    }
  }
}

// ── Task helper (adds route + visual data) ───────────
function createRouteTask(data: Record<string, unknown>) {
  return taskSystem.createTask({ ...data, route: currentRoute.value })
}

// ── Text Highlight Handlers ──────────────────────────
function onSubmitHighlight(prompt: string) {
  if (!pendingHighlight.value || !prompt.trim()) return
  const h = pendingHighlight.value
  const hl = annotations.addHighlight(h.text, { file: h.file, line: h.line, component: h.component, elementTag: h.tag })
  annotations.updateHighlight(hl.id, { prompt: prompt.trim() })
  const intent = `Change "${h.text}" → ${prompt.trim()}`
  recordAnnotation({
    file: h.file, line: String(h.line), component: h.component,
    intent, action: 'text_edit', elementTag: h.tag,
  })
  createRouteTask({
    type: 'annotation', description: intent, file: h.file, line: h.line,
    component: h.component, intent, action: 'text_edit',
    context: {
      element: {
        tag: h.tag, component: h.component,
        file: h.file, line: h.line,
      },
      selected_text: h.text,
    },
  })
  pendingHighlight.value = null
}

function onCancelHighlight() {
  pendingHighlight.value = null
}

// ── Drawn Section → Task ──────────────────────────────
const sectionTaskIds = new Set<string>()

function onSectionCommit(id: string) {
  const section = annotations.drawnSections.value.find(s => s.id === id)
  if (!section || !section.prompt.trim()) return
  if (sectionTaskIds.has(id)) return
  sectionTaskIds.add(id)

  recordAnnotation({
    file: section.nearFile || '',
    line: String(section.nearLine || 0),
    component: section.nearComponent || '',
    intent: section.prompt.trim(),
    action: 'section_request',
  })
  createRouteTask({
    type: 'section_request',
    description: section.prompt.trim(),
    file: section.nearFile || '',
    line: section.nearLine || 0,
    component: section.nearComponent || '',
    prompt: section.prompt.trim(),
    placement: section.placement || '',
    visual: { kind: 'section', annotationId: section.id, x: Math.round(section.x), y: Math.round(section.y), width: Math.round(section.width), height: Math.round(section.height) },
    context: {
      near_element: {
        component: section.nearComponent || '',
        file: section.nearFile || '',
        line: section.nearLine || 0,
      },
      placement: section.placement || '',
    },
  })
}

// ── Arrow → Task ─────────────────────────────────────
const arrowTaskIds = new Set<string>()

function describeElement(ctx: { file: string; line: string; component: string; tag: string; classes?: string } | null): string {
  if (!ctx) return 'element'
  const tag = ctx.tag || 'element'
  // Use first meaningful class if available
  const cls = ctx.classes?.split(' ').find(c => c && !c.startsWith('data-'))
  if (ctx.component && cls) return `<${tag}.${cls}> in ${ctx.component}`
  if (ctx.component && ctx.tag !== ctx.component.toLowerCase()) return `<${tag}> in ${ctx.component}`
  if (cls) return `<${tag}.${cls}>`
  return `<${tag}>`
}

function onArrowCreated(arrowId: string, fromCtx: { file: string; line: string; component: string; tag: string; classes?: string } | null, toCtx: { file: string; line: string; component: string; tag: string; classes?: string } | null) {
  const arrow = annotations.arrows.value.find(a => a.id === arrowId)
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
  const arrow = annotations.arrows.value.find(a => a.id === id)
  if (!arrow || !description.trim()) return
  if (arrowTaskIds.has(id)) return
  arrowTaskIds.add(id)

  annotations.updateArrow(id, { label: description.trim() })

  const meta = pendingTaskCreation.value?.meta || {}
  recordAnnotation({
    file: arrow.fromFile || '',
    line: String(arrow.fromLine || 0),
    component: arrow.fromComponent || '',
    intent: description.trim(),
    action: 'relocate',
    elementTag: (meta.fromTag as string) || '',
    elementClasses: (meta.fromClasses as string) || '',
  })
  createRouteTask({
    type: 'annotation', action: 'relocate',
    description: description.trim(),
    file: arrow.fromFile || '',
    line: arrow.fromLine || 0,
    component: arrow.fromComponent || '',
    intent: description.trim(),
    visual: { kind: 'arrow', annotationId: arrow.id, fromX: arrow.fromX, fromY: arrow.fromY, toX: arrow.toX, toY: arrow.toY, label: description.trim() },
    context: {
      from_element: {
        tag: (meta.fromTag as string) || '',
        classes: (meta.fromClasses as string) || '',
        component: (meta.fromComponent as string) || '',
        file: arrow.fromFile || '',
        line: arrow.fromLine || 0,
      },
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

// ── Pending Task Submission (sidebar panel) ─────────
function submitPendingTask() {
  const ctx = pendingTaskCreation.value
  if (!ctx || !pendingTaskText.value.trim()) return

  if (ctx.kind === 'pin') {
    const meta = ctx.meta as { elementTag: string; elementClasses: string; pinX: number; pinY: number }
    annotations.updatePinNote(ctx.annotationId, pendingTaskText.value.trim())
    recordAnnotation({
      file: ctx.file, line: String(ctx.line), component: ctx.component,
      intent: pendingTaskText.value.trim(),
      elementTag: meta.elementTag, elementClasses: meta.elementClasses,
    })
    createRouteTask({
      type: 'annotation',
      description: pendingTaskText.value.trim(),
      file: ctx.file, line: parseInt(String(ctx.line)) || 0, component: ctx.component,
      intent: pendingTaskText.value.trim(),
      visual: { kind: 'pin', annotationId: ctx.annotationId, x: meta.pinX, y: meta.pinY },
      context: {
        element: {
          tag: meta.elementTag,
          classes: meta.elementClasses,
          component: ctx.component,
          file: ctx.file,
          line: parseInt(String(ctx.line)) || 0,
        },
      },
    })
  } else if (ctx.kind === 'arrow') {
    submitPendingArrowTask(ctx.annotationId, pendingTaskText.value.trim())
  }

  pendingTaskCreation.value = null
  pendingTaskText.value = ''
}

function cancelPendingTask() {
  const ctx = pendingTaskCreation.value
  if (ctx) {
    // Remove the annotation since user cancelled
    if (ctx.kind === 'pin') annotations.removePin(ctx.annotationId)
    if (ctx.kind === 'arrow') annotations.removeArrow(ctx.annotationId)
  }
  pendingTaskCreation.value = null
  pendingTaskText.value = ''
}

// ── General Add Task ─────────────────────────────────
function onAddGeneralTask(text: string) {
  createRouteTask({
    type: 'annotation',
    description: text,
    file: '',
    line: 0,
    component: '',
    intent: text,
    context: {},
  })
}


// ── Shell keyboard ────────────────────────────────────
function onShellKeyDown(e: KeyboardEvent) {
  const mod = e.ctrlKey || e.metaKey

  // Ctrl/Cmd shortcuts
  if (mod && e.key === 'z' && !e.shiftKey) {
    e.preventDefault()
    doUndo()
    return
  }

  const tag = (e.target as HTMLElement)?.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return

  const key = e.key

  // Toggle shortcuts panel
  if (key === '?' || (key === '/' && e.shiftKey)) {
    showShortcuts.value = !showShortcuts.value
    return
  }

  // Escape: close shortcuts, cancel pending task, or clear selection
  if (key === 'Escape') {
    if (showReportPanel.value) { showReportPanel.value = false; return }
    if (showShortcuts.value) { showShortcuts.value = false; return }
    if (pendingTaskCreation.value) { cancelPendingTask(); return }
    primarySelection.value = null
    selectedEids.value = []
    templateGroupEids.value = []
    selectionRects.value = []
    groupRects.value = []
    return
  }

  // Layout overlay toggle
  if ((key === 'l' || key === 'L') && !mod) {
    layoutOverlay.toggle()
    return
  }

  // Toggle task/inspector panel
  if (key === 't' || key === 'T') {
    if (!mod) { showTaskPanel.value = !showTaskPanel.value; return }
  }
}

// ── Lifecycle ──────────────────────────────────────────
onMounted(() => {
  iframe.mountBridge()
  setupBridgeEvents()
  iframeRef.value?.addEventListener('load', onIframeLoad)
  document.addEventListener('keydown', onShellKeyDown)
})
onUnmounted(() => {
  iframe.unmountBridge()
})

const appUrl = computed(() => {
  const params = new URLSearchParams(window.location.search)
  return params.get('appUrl') || window.location.origin + '/'
})
</script>

<template>
  <div class="annotask-shell">
    <!-- Toolbar -->
    <header class="toolbar">
      <div class="toolbar-left">
        <svg class="logo" viewBox="0 0 85.81 90.51" fill="currentColor" xmlns="http://www.w3.org/2000/svg"><path d="m72.02 90.31c-.17-.1-.43-.48-.57-.82-.37-.93-1.97-3.46-2.74-4.33-.66-.74-.77-.79-5.99-2.5-2.93-.96-5.52-1.85-5.77-1.98-.47-.25-.35.01-4.7-9.99-1.1-2.53-2.11-4.72-2.25-4.87-.22-.24-1.7-.26-11.7-.21-6.3.03-11.51.12-11.58.19-.11.11-2.06 4.98-4.34 10.84-.4 1.04-1.21 3.11-1.8 4.6-.58 1.49-1.52 3.88-2.08 5.32-.64 1.65-1.18 2.76-1.45 3.02l-.44.41H8.31 0l.49-1.22c4.92-12.33 8.69-21.78 9.54-23.94 1.22-3.09 4.33-10.89 6.52-16.32.82-2.03 1.72-4.3 2-5.05.28-.74 1.17-2.97 1.97-4.96 2.26-5.6 3-7.45 4.7-11.72 2.32-5.86 5.17-13 7.63-19.11 1.2-2.98 2.29-5.73 2.44-6.13.15-.4.45-.9.68-1.13l.42-.41h8.22c4.57 0 8.4.07 8.63.17.49.19.22-.38 3.81 8.22 1.57 3.77 3 7.18 3.17 7.57.73 1.72 6 14.31 7.22 17.22 1.71 4.1 5.73 13.7 6 14.34.17.4.66 1.58 1.09 2.61.43 1.04 1.63 3.94 2.68 6.46 1.05 2.51 1.9 4.63 1.9 4.71 0 .08-.14.2-.3.27-.17.07-2.89 1.13-6.05 2.37-3.16 1.23-6.39 2.5-7.17 2.81-.78.31-1.47.51-1.53.45-.06-.06-.47-1.07-.92-2.24-1.24-3.24-5.96-15.5-7.72-20.06-.86-2.23-2.45-6.33-3.52-9.11-1.07-2.78-2.93-7.6-4.14-10.73-1.2-3.12-2.4-6.25-2.67-6.94l-.48-1.26-.19.54c-.42 1.17-1.35 3.64-3.23 8.56-1.08 2.83-2.45 6.44-3.05 8.02-.6 1.59-2.24 5.89-3.65 9.56l-2.57 6.67 8.58.05 8.58.05.31.76c.17.42 1.14 2.91 2.16 5.54 6.49 16.81 6.66 17.24 6.88 17.18.08-.02 1.08-.41 2.21-.87 1.13-.46 3.45-1.39 5.15-2.06 5.12-2.03 14.4-5.73 14.68-5.85.14-.06.39-.01.55.12.32.25 2.19 4.68 2.19 5.19 0 .18-.14.48-.3.68-.27.32-5.46 2.61-10.94 4.83-4.74 1.92-6.58 2.65-7.29 2.92l-.77.29 1.94.34 1.94.34.77-.38c1.61-.79 3.36-1.45 7.27-2.71 2.22-.72 4.1-1.32 4.19-1.33.16-.02.94 1.75 2.24 5.12.41 1.04 1.36 3.49 2.13 5.45.77 1.96 1.39 3.71 1.39 3.89 0 .75-.14.76-6.94.76-4.33 0-6.64-.07-6.85-.2z"/></svg>
        <div class="view-toggle">
          <button :class="['toggle-btn', { active: shellView === 'editor' }]" @click="shellView = 'editor'">Editor</button>
          <button :class="['toggle-btn', { active: shellView === 'theme' }]" @click="shellView = 'theme'">Theme</button>
        </div>
        <template v-if="shellView === 'editor'">
          <ModeToolbar v-model="interactionMode" />
          <button :class="['tool-btn', { active: layoutOverlay.showOverlay.value }]" @click="layoutOverlay.toggle()" title="Show Layout (L)">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="3" x2="9" y2="21"/></svg>
          </button>
        </template>
      </div>
      <div v-if="shellView === 'editor'" class="toolbar-center">
        <code class="route-indicator">{{ currentRoute }}</code>
      </div>
      <div v-else class="toolbar-center" />
      <div v-if="shellView === 'editor'" class="toolbar-right">
        <div class="panel-toggle">
          <button :class="['toggle-btn', { active: !showTaskPanel }]" @click="showTaskPanel = false">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M4 4l7.07 17 2.51-7.39L21 11.07z"/></svg>
            Inspector
          </button>
          <button :class="['toggle-btn', { active: showTaskPanel }]" @click="showTaskPanel = true">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
            Tasks
            <span v-if="routeTasks.length" class="toggle-badge">{{ routeTasks.length }}</span>
          </button>
        </div>
        <div class="visibility-toggles">
          <button :class="['vis-btn', { off: !showMarkup.pins }]" @click="showMarkup.pins = !showMarkup.pins" title="Toggle Pins">P</button>
          <button :class="['vis-btn', { off: !showMarkup.arrows }]" @click="showMarkup.arrows = !showMarkup.arrows" title="Toggle Arrows">A</button>
          <button :class="['vis-btn', { off: !showMarkup.sections }]" @click="showMarkup.sections = !showMarkup.sections" title="Toggle Sections">D</button>
          <button :class="['vis-btn', { off: !showMarkup.highlights }]" @click="showMarkup.highlights = !showMarkup.highlights" title="Toggle Highlights">H</button>
        </div>
        <span v-if="changes.length" class="change-count">{{ changes.length }} change{{ changes.length === 1 ? '' : 's' }}</span>
        <button :class="['tool-btn', { active: showReportPanel }]" :disabled="!report" @click="showReportPanel = !showReportPanel">
          View Report
        </button>
        <button v-if="changes.length" class="tool-btn danger" @click="doClearChanges">Clear</button>
        <button :class="['tool-btn', { active: showShortcuts }]" @click="showShortcuts = !showShortcuts" title="Keyboard Shortcuts (?)">?</button>
      </div>
      <div v-else class="toolbar-right" />
    </header>

    <!-- Banners -->
    <div v-if="showWarning" class="warning-banner">
      Source mapping unavailable — add <code>annotask()</code> to your Vite plugins.
    </div>
    <div v-if="!configInitialized" class="setup-banner">
      Annotask not initialized — run <code>/init-annotask</code> in your AI assistant to set up project tokens and component detection.
    </div>

    <!-- Main -->
    <div class="main">
      <div class="canvas-area"
        @pointerdown="shellView === 'editor' ? onCanvasPointerDown($event) : undefined"
        @pointermove="shellView === 'editor' ? onCanvasPointerMove($event) : undefined"
        @pointerup="shellView === 'editor' ? onCanvasPointerUp($event) : undefined"
      >
        <iframe ref="iframeRef" :src="appUrl" class="app-iframe" />
        <!-- Editor overlays: only in editor mode -->
        <template v-if="shellView === 'editor'">
        <!-- Drawing shield: captures pointer events for arrow/draw/sticky modes -->
        <div v-if="interactionMode === 'arrow' || interactionMode === 'draw'"
          class="drawing-shield" :class="interactionMode" />

        <!-- Hover highlight -->
        <div v-if="hoverRect" class="highlight hover" :style="{ left: hoverRect.x+'px', top: hoverRect.y+'px', width: hoverRect.width+'px', height: hoverRect.height+'px' }">
          <div v-if="hoverInfo" class="hover-label">
            <span class="hover-tag">&lt;{{ hoverInfo.tag }}&gt;</span>
            <span v-if="hoverInfo.component" class="hover-comp">{{ hoverInfo.component }}</span>
          </div>
        </div>

        <!-- Template group highlights -->
        <div v-for="(rect, i) in groupRects" :key="'g'+i" class="highlight group"
          :style="{ left: rect.x+'px', top: rect.y+'px', width: rect.width+'px', height: rect.height+'px' }" />

        <!-- Selection highlights -->
        <div v-for="(rect, i) in selectionRects" :key="'s'+i" class="highlight select"
          :style="{ left: rect.x+'px', top: rect.y+'px', width: rect.width+'px', height: rect.height+'px' }">
          <div v-if="i === 0 && primarySelection" class="select-label">
            &lt;{{ primarySelection.tagName }}&gt; · {{ primarySelection.component }}
          </div>
        </div>

        <!-- Pins -->
        <PinOverlay v-if="showMarkup.pins"
          :pins="annotations.routePins.value"
          :selectedPinId="annotations.selectedPinId.value"
          :iframeOffset="{ x: iframeRef?.getBoundingClientRect()?.left || 0, y: iframeRef?.getBoundingClientRect()?.top || 0 }"
          @select-pin="id => { annotations.selectedPinId.value = id; activeTab = 'notes' }"
          @remove-pin="annotations.removePin"
        />

        <!-- Arrows -->
        <ArrowOverlay v-if="showMarkup.arrows"
          :arrows="annotations.routeArrows.value"
          :selectedId="annotations.selectedArrowId.value"
          :drawingArrow="drawingArrow"
          @select="annotations.selectedArrowId.value = $event"
          @remove="annotations.removeArrow"
        />

        <!-- Drawn sections -->
        <DrawnSectionOverlay v-if="showMarkup.sections"
          :sections="annotations.routeSections.value"
          :selectedId="annotations.selectedSectionId.value"
          :drawingRect="drawingRect"
          @select="annotations.selectedSectionId.value = $event"
          @remove="annotations.removeDrawnSection"
          @update-prompt="(id, prompt) => annotations.updateDrawnSection(id, { prompt })"
          @commit="onSectionCommit"
        />

        <!-- Text highlight prompt -->
        <TextHighlightOverlay v-if="showMarkup.highlights"
          :highlights="annotations.routeHighlights.value"
          :selectedId="annotations.selectedHighlightId.value"
          :pending="pendingHighlight"
          @select="annotations.selectedHighlightId.value = $event"
          @remove="annotations.removeHighlight"
          @update-prompt="(id, p) => annotations.updateHighlight(id, { prompt: p })"
          @submit-pending="onSubmitHighlight"
          @cancel-pending="onCancelHighlight"
        />

        <!-- Layout overlay -->
        <LayoutOverlay
          v-if="layoutOverlay.showOverlay.value"
          :containers="layoutOverlay.containers.value"
        />
        </template><!-- end editor overlays -->
      </div>

      <!-- Theme panel -->
      <aside v-if="shellView === 'theme'" class="theme-panel">
        <ThemePage :iframeRef="iframeRef" />
      </aside>

      <!-- Shortcuts Panel -->
      <aside class="panel" v-if="shellView === 'editor' && showShortcuts">
        <div class="panel-source">
          <span class="source-path" style="color:var(--text)">Keyboard Shortcuts</span>
          <button class="component-badge" style="cursor:pointer;margin-left:auto" @click="showShortcuts = false">Esc to close</button>
        </div>
        <div class="shortcuts-panel">
          <div class="shortcut-group">
            <div class="shortcut-group-title">Tools</div>
            <div class="shortcut-row"><kbd>V</kbd><span>Select</span></div>
            <div class="shortcut-row"><kbd>P</kbd><span>Pin</span></div>
            <div class="shortcut-row"><kbd>A</kbd><span>Arrow</span></div>
            <div class="shortcut-row"><kbd>D</kbd><span>Draw Section</span></div>
            <div class="shortcut-row"><kbd>H</kbd><span>Highlight Text</span></div>
            <div class="shortcut-row"><kbd>I</kbd><span>Interact Mode</span></div>
          </div>
          <div class="shortcut-group">
            <div class="shortcut-group-title">View</div>
            <div class="shortcut-row"><kbd>L</kbd><span>Toggle Layout Overlay</span></div>
            <div class="shortcut-row"><kbd>T</kbd><span>Toggle Task Panel</span></div>
            <div class="shortcut-row"><kbd>?</kbd><span>Toggle Shortcuts</span></div>
            <div class="shortcut-row"><kbd>Esc</kbd><span>Deselect / Close Panel</span></div>
          </div>
          <div class="shortcut-group">
            <div class="shortcut-group-title">Actions</div>
            <div class="shortcut-row"><kbd class="mod">Ctrl</kbd><kbd>Z</kbd><span>Undo</span></div>
            <div class="shortcut-row"><kbd class="mod">Ctrl</kbd><kbd>Enter</kbd><span>Submit Form</span></div>
          </div>
          <div class="shortcut-hint">On Mac, use <kbd class="mod">⌘</kbd> instead of <kbd class="mod">Ctrl</kbd></div>
        </div>
      </aside>

      <!-- Pending Task Creation Panel (after pin/arrow placement) -->
      <aside class="panel" v-else-if="shellView === 'editor' && pendingTaskCreation">
        <div class="panel-source">
          <span class="source-path" style="color:var(--text)">Add Task</span>
        </div>
        <div class="pending-task-panel">
          <div class="pending-task-context">
            <div class="pending-task-kind" :class="pendingTaskCreation.kind">
              <svg v-if="pendingTaskCreation.kind === 'pin'" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="10" r="3"/><path d="M12 21.7C17.3 17 20 13 20 10a8 8 0 1 0-16 0c0 3 2.7 7 8 11.7z"/></svg>
              <svg v-else-if="pendingTaskCreation.kind === 'arrow'" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
              <span>{{ pendingTaskCreation.label }}</span>
            </div>
            <code class="pending-task-file">{{ pendingTaskCreation.file }}:{{ pendingTaskCreation.line }}</code>
          </div>
          <textarea
            v-model="pendingTaskText"
            class="pending-task-input"
            rows="3"
            placeholder="Describe the change..."
            autofocus
            @keydown.enter.ctrl="submitPendingTask"
            @keydown.escape="cancelPendingTask"
          />
          <div class="pending-task-actions">
            <button class="submit-btn" :disabled="!pendingTaskText.trim()" @click="submitPendingTask">Add Task</button>
            <button class="cancel-btn" @click="cancelPendingTask">Cancel</button>
          </div>
        </div>
      </aside>

      <!-- Task Panel (takes over sidebar when active) -->
      <aside class="panel" v-else-if="shellView === 'editor' && showTaskPanel">
        <div class="panel-source">
          <span class="source-path" style="color:var(--text)">Tasks</span>
          <span class="component-badge">{{ taskSystem.tasks.value.length }}</span>
          <button class="new-task-toggle" @click="showNewTaskForm = !showNewTaskForm">
            {{ showNewTaskForm ? '−' : '+' }} New
          </button>
        </div>

        <!-- New task form (collapsible) -->
        <div v-if="showNewTaskForm" class="new-task-form">
          <textarea v-model="newTaskText" class="new-task-input" rows="2" placeholder="Describe a change..." @keydown.enter.ctrl="submitNewTask" />
          <div class="new-task-actions">
            <button class="submit-btn" :disabled="!newTaskText.trim()" @click="submitNewTask">Add</button>
            <button class="cancel-btn" @click="showNewTaskForm = false; newTaskText = ''">Cancel</button>
          </div>
        </div>

        <div class="tab-content">
          <div v-if="taskSystem.tasks.value.length === 0 && !showNewTaskForm" class="empty-hint" style="padding:20px 0">
            No tasks yet. Click + New to add one.
          </div>
          <div v-for="task in routeTasks" :key="task.id" class="task-card" :class="task.status">
            <div class="task-card-header">
              <span class="task-status-dot" :class="task.status" />
              <span class="task-card-desc">{{ task.description }}</span>
              <button class="task-card-close" @click="acceptTask(task.id)">×</button>
            </div>
            <div class="task-card-meta">
              <code class="task-card-file">{{ task.file }}:{{ task.line }}</code>
              <span v-if="task.route" class="task-route-badge">{{ task.route }}</span>
            </div>
            <div v-if="task.feedback" class="task-card-feedback">{{ task.feedback }}</div>
            <div v-if="task.status === 'review'" class="task-card-actions">
              <template v-if="denyingTaskId !== task.id">
                <button class="task-accept" @click="acceptTask(task.id)">Accept</button>
                <button class="task-deny" @click="denyingTaskId = task.id; denyFeedbackText = ''">Deny</button>
              </template>
              <template v-else>
                <input v-model="denyFeedbackText" class="deny-feedback-input" placeholder="What needs to change?" autofocus @keydown.enter="submitDeny(task.id)" @keydown.escape="denyingTaskId = null" />
                <button class="task-deny" :disabled="!denyFeedbackText.trim()" @click="submitDeny(task.id)">Send</button>
                <button class="cancel-btn" style="padding:4px 8px;font-size:10px" @click="denyingTaskId = null">Cancel</button>
              </template>
            </div>
          </div>
        </div>
      </aside>

      <!-- Property Panel -->
      <aside class="panel" v-else-if="shellView === 'editor' && primarySelection">
        <div class="panel-source">
          <code class="source-path">{{ primarySelection.file }}:{{ primarySelection.line }}</code>
          <span class="component-badge">{{ primarySelection.component }}</span>
          <span v-if="selectedElementRole" class="role-badge" :class="selectedElementRole">{{ selectedElementRole }}</span>
        </div>

        <div v-if="selectionSummary" class="panel-group-bar">
          <span class="group-summary">{{ selectionSummary }}</span>
          <label v-if="templateGroupEids.length > 1 && selectedEids.length <= 1" class="group-toggle">
            <input type="checkbox" v-model="applyToGroup" />
            <span class="toggle-label">Apply to all {{ templateGroupEids.length }}</span>
          </label>
        </div>

        <div class="panel-tabs">
          <button :class="['tab', { active: activeTab === 'layout' }]" @click="activeTab = 'layout'">Layout</button>
          <button :class="['tab', { active: activeTab === 'spacing' }]" @click="activeTab = 'spacing'">Spacing</button>
          <button :class="['tab', { active: activeTab === 'size' }]" @click="activeTab = 'size'">Size</button>
          <button :class="['tab', { active: activeTab === 'style' }]" @click="activeTab = 'style'">Style</button>
          <button :class="['tab', { active: activeTab === 'classes' }]" @click="activeTab = 'classes'">Classes</button>
          <button :class="['tab', { active: activeTab === 'notes' }]" @click="activeTab = 'notes'">
            Task <span v-if="annotations.routePins.value.length" class="tab-badge">{{ annotations.routePins.value.length }}</span>
          </button>
        </div>

        <div class="tab-content">
          <LayoutControls v-if="activeTab === 'layout'" :computedStyles="liveStyles" @change="onStyleChange" />
          <SpacingControls v-if="activeTab === 'spacing'" :computedStyles="liveStyles" @change="onStyleChange" />
          <SizeControls v-if="activeTab === 'size'" :computedStyles="liveStyles" @change="onStyleChange" />
          <AppearanceControls v-if="activeTab === 'style'" :computedStyles="liveStyles" :iframeDoc="null" @change="onStyleChange" />
          <div v-if="activeTab === 'classes'" class="classes-tab">
            <textarea v-model="editingClasses" class="class-editor" rows="4" @blur="applyClassChange" @keydown.enter.ctrl="applyClassChange" placeholder="Edit CSS classes..." />
            <p class="hint">Ctrl+Enter or blur to apply</p>
          </div>
          <NotesTab
            v-if="activeTab === 'notes'"
            :pins="annotations.routePins.value"
            :selectedPinId="annotations.selectedPinId.value"
            :selectedElement="primarySelection"
            :elementRole="selectedElementRole"
            :tasks="taskSystem.tasks.value"
            @add-note="onAddAnnotationNote"
            @add-action="onAddAnnotationAction"
            @add-task="onAddGeneralTask"
            @select-pin="annotations.selectedPinId.value = $event"
            @update-note="annotations.updatePinNote($event, '')"
            @remove-pin="annotations.removePin($event)"
            @accept-task="taskSystem.updateTaskStatus($event, 'accepted')"
            @deny-task="(id, fb) => taskSystem.updateTaskStatus(id, 'denied', fb)"
            @cancel-task="taskSystem.updateTaskStatus($event, 'accepted')"
          />
        </div>

        <div v-if="changes.length" class="changes-footer">
          <details>
            <summary class="changes-summary">{{ changes.length }} change{{ changes.length === 1 ? '' : 's' }} recorded</summary>
            <div class="changes-list">
              <div v-for="ch in changes" :key="ch.id" class="change-item">
                <template v-if="ch.type === 'style_update'">
                  <code class="change-prop">{{ ch.property }}</code>
                  <span class="change-arrow">→</span>
                  <code class="change-val">{{ ch.after }}</code>
                </template>
                <template v-else-if="ch.type === 'annotation'">
                  <code class="change-prop">{{ ch.action || 'note' }}</code>
                  <span class="change-arrow">→</span>
                  <code class="change-val">{{ ch.intent.substring(0, 30) }}</code>
                </template>
              </div>
            </div>
          </details>
        </div>
      </aside>

      <!-- Empty state -->
      <aside class="panel empty" v-else-if="shellView === 'editor'">
        <div class="empty-content">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.3"><path d="M4 4l7.07 17 2.51-7.39L21 11.07z"/></svg>
          <p>Click an element to inspect</p>
          <p class="empty-hint">Press P to pin, hover to highlight</p>
        </div>
      </aside>
    </div>

    <!-- Context menu -->
    <ContextMenu v-bind="contextMenu" @close="contextMenu.visible = false" />

    <!-- Report viewer slide-out -->
    <ReportViewer v-if="showReportPanel" :report="report" @close="showReportPanel = false" />
  </div>
</template>

<style>
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

:root {
  --bg: #0a0a0a;
  --surface: #141414;
  --surface-2: #1e1e1e;
  --border: #2a2a2a;
  --text: #e4e4e7;
  --text-muted: #71717a;
  --accent: #3b82f6;
  --danger: #ef4444;
}

html, body, #app { height: 100%; overflow: hidden; background: var(--bg); color: var(--text); font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; font-size: 13px; }

.annotask-shell { display: flex; flex-direction: column; height: 100%; }

/* Toolbar */
.toolbar { display: flex; align-items: center; justify-content: space-between; height: 40px; padding: 0 12px; background: var(--surface); border-bottom: 1px solid var(--border); flex-shrink: 0; }
.toolbar-left, .toolbar-right { display: flex; align-items: center; gap: 8px; }
.logo { height: 20px; width: auto; margin-right: 12px; color: var(--accent); }
.tool-btn { display: flex; align-items: center; gap: 4px; padding: 4px 10px; border: 1px solid var(--border); border-radius: 6px; background: var(--surface-2); color: var(--text); font-size: 12px; cursor: pointer; }
.tool-btn:hover { background: var(--border); }
.tool-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.tool-btn.active { background: var(--accent); border-color: var(--accent); color: white; }
.tool-btn.danger { color: var(--danger); }
/* Panel toggle (Inspector/Tasks) */
.panel-toggle { display: flex; border: 1px solid var(--border); border-radius: 6px; overflow: hidden; }
.toggle-btn {
  display: flex; align-items: center; gap: 3px;
  padding: 3px 8px; border: none;
  background: var(--surface-2); color: var(--text-muted);
  font-size: 11px; cursor: pointer; transition: all 0.1s;
}
.toggle-btn:first-child { border-right: 1px solid var(--border); }
.toggle-btn:hover { background: var(--border); color: var(--text); }
.toggle-btn.active { background: var(--accent); color: white; }
.toggle-badge {
  display: inline-flex; align-items: center; justify-content: center;
  min-width: 14px; height: 14px; padding: 0 3px;
  font-size: 8px; font-weight: 700;
  background: rgba(255,255,255,0.25); color: white;
  border-radius: 7px;
}
.toggle-btn:not(.active) .toggle-badge { background: var(--accent); color: white; }

/* View toggle (Editor/Theme) */
.view-toggle { display: flex; border: 1px solid var(--border); border-radius: 6px; overflow: hidden; margin-right: 8px; }

/* Theme panel */
.theme-panel { width: 440px; background: var(--surface); border-left: 1px solid var(--border); display: flex; flex-direction: column; flex-shrink: 0; overflow: hidden; }

.visibility-toggles { display: flex; gap: 1px; margin-right: 4px; }
.vis-btn {
  width: 20px; height: 20px; border: none; border-radius: 3px;
  background: var(--surface-2); color: var(--text-muted);
  font-size: 9px; font-weight: 700; cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  transition: all 0.1s;
}
.vis-btn:hover { background: var(--border); color: var(--text); }
.vis-btn.off { opacity: 0.3; text-decoration: line-through; }
.change-count { font-size: 11px; color: var(--text-muted); }

/* Banners */
.warning-banner { padding: 8px 16px; background: rgba(234, 179, 8, 0.1); border-bottom: 1px solid rgba(234, 179, 8, 0.3); color: #eab308; font-size: 12px; }
.warning-banner code { background: rgba(234, 179, 8, 0.15); padding: 1px 4px; border-radius: 3px; }
.setup-banner { padding: 8px 16px; background: rgba(59, 130, 246, 0.08); border-bottom: 1px solid rgba(59, 130, 246, 0.2); color: #60a5fa; font-size: 12px; }
.setup-banner code { background: rgba(59, 130, 246, 0.15); padding: 1px 6px; border-radius: 3px; font-weight: 600; }

/* Main */
.main { display: flex; flex: 1; overflow: hidden; }
.toolbar-center { display: flex; align-items: center; gap: 8px; }
.route-indicator { font-size: 11px; color: var(--text-muted); background: var(--surface-2); padding: 2px 8px; border-radius: 4px; border: 1px solid var(--border); }
.canvas-area { flex: 1; position: relative; overflow: hidden; }
.app-iframe { width: 100%; height: 100%; border: none; }
.drawing-shield { position: absolute; inset: 0; z-index: 9999; }
.drawing-shield.arrow { cursor: crosshair; }
.drawing-shield.draw { cursor: crosshair; }

/* Highlights */
.highlight { position: fixed; pointer-events: none; z-index: 10000; border-radius: 2px; }
.highlight.hover { background: rgba(59,130,246,0.1); border: 1.5px solid rgba(59,130,246,0.5); }
.highlight.group { background: rgba(168,85,247,0.08); border: 1.5px dashed rgba(168,85,247,0.4); }
.highlight.select { background: rgba(59,130,246,0.08); border: 2px solid var(--accent); }

.hover-label, .select-label {
  position: absolute; bottom: 100%; left: -1px;
  display: flex; align-items: center; gap: 6px;
  padding: 2px 8px; font-size: 11px; font-weight: 500; white-space: nowrap;
  border-radius: 4px 4px 0 0;
}
.hover-label { background: var(--accent); color: white; }
.hover-tag { font-family: monospace; }
.hover-comp { opacity: 0.7; }
.select-label { background: var(--accent); color: white; font-family: monospace; font-size: 10px; }

/* Panel */
.panel { width: 320px; background: var(--surface); border-left: 1px solid var(--border); display: flex; flex-direction: column; flex-shrink: 0; overflow: hidden; }
.panel.empty { justify-content: center; align-items: center; }
.panel-source { padding: 10px 14px; border-bottom: 1px solid var(--border); display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.source-path { font-size: 12px; color: var(--accent); word-break: break-all; font-family: monospace; }
.component-badge { font-size: 10px; padding: 2px 6px; background: var(--surface-2); border: 1px solid var(--border); border-radius: 4px; color: var(--text-muted); white-space: nowrap; }
.role-badge { font-size: 9px; padding: 1px 5px; border-radius: 3px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.03em; }
.role-badge.container { background: rgba(34,197,94,0.15); color: #22c55e; }
.role-badge.content { background: rgba(59,130,246,0.15); color: #3b82f6; }
.role-badge.component { background: rgba(168,85,247,0.15); color: #a855f7; }

/* Group bar */
.panel-group-bar { display: flex; align-items: center; justify-content: space-between; padding: 6px 14px; border-bottom: 1px solid var(--border); background: rgba(168, 85, 247, 0.06); }
.group-summary { font-size: 11px; color: #a855f7; }
.group-toggle { display: flex; align-items: center; gap: 5px; cursor: pointer; }
.group-toggle input { accent-color: #a855f7; width: 14px; height: 14px; cursor: pointer; }
.toggle-label { font-size: 11px; color: var(--text-muted); }

/* Tabs */
.panel-tabs { display: flex; border-bottom: 1px solid var(--border); flex-shrink: 0; }
.tab { flex: 1; padding: 8px 4px; font-size: 11px; font-weight: 500; background: none; border: none; border-bottom: 2px solid transparent; color: var(--text-muted); cursor: pointer; transition: all 0.15s; }
.tab:hover { color: var(--text); }
.tab.active { color: var(--accent); border-bottom-color: var(--accent); }
.tab-badge { display: inline-flex; align-items: center; justify-content: center; min-width: 14px; height: 14px; padding: 0 3px; font-size: 9px; font-weight: 700; background: var(--accent); color: white; border-radius: 7px; margin-left: 3px; }

/* Tab content */
.tab-content { flex: 1; overflow-y: auto; padding: 14px; }

/* Classes tab */
.class-editor { width: 100%; padding: 8px; background: var(--bg); border: 1px solid var(--border); border-radius: 6px; color: var(--text); font-family: monospace; font-size: 12px; resize: vertical; outline: none; }
.class-editor:focus { border-color: var(--accent); }
.hint { font-size: 10px; color: var(--text-muted); margin-top: 4px; }

/* Empty state */
.empty-content { text-align: center; color: var(--text-muted); }
.empty-content p { margin-top: 8px; }
.empty-hint { font-size: 11px; opacity: 0.6; }

/* Changes footer */
.changes-footer { border-top: 1px solid var(--border); flex-shrink: 0; }
.changes-summary { padding: 8px 14px; font-size: 11px; color: var(--text-muted); cursor: pointer; list-style: none; }
.changes-summary::-webkit-details-marker { display: none; }
.changes-summary::before { content: '▸ '; }
details[open] > .changes-summary::before { content: '▾ '; }
.changes-list { max-height: 200px; overflow-y: auto; padding: 0 14px 10px; }
.change-item { display: flex; align-items: center; gap: 6px; padding: 3px 0; font-size: 11px; }
.change-prop { color: var(--text-muted); font-family: monospace; }
.change-arrow { color: var(--text-muted); font-size: 10px; }
.change-val { color: #22c55e; font-family: monospace; }

/* Task cards in sidebar */
.task-card { padding: 8px; border: 1px solid var(--border); border-radius: 6px; margin-bottom: 6px; }
.task-card.review { border-color: #f59e0b; }
.task-card.denied { border-color: #ef4444; }
.task-card-header { display: flex; align-items: center; gap: 6px; margin-bottom: 3px; }
.task-status-dot { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; }
.task-status-dot.pending { background: #71717a; }
.task-status-dot.review { background: #f59e0b; }
.task-status-dot.denied { background: #ef4444; }
.task-card-desc { font-size: 11px; color: var(--text); flex: 1; }
.task-card-close { width: 16px; height: 16px; border: none; background: none; color: var(--text-muted); font-size: 13px; cursor: pointer; padding: 0; display: flex; align-items: center; justify-content: center; border-radius: 3px; }
.task-card-close:hover { color: #ef4444; background: rgba(239,68,68,0.1); }
.task-card-meta { display: flex; align-items: center; gap: 6px; }
.task-card-file { font-size: 9px; color: var(--text-muted); }
.task-route-badge { font-size: 8px; padding: 1px 5px; background: rgba(59,130,246,0.12); color: #60a5fa; border-radius: 3px; font-weight: 600; }
.task-card-feedback { font-size: 10px; color: #ef4444; font-style: italic; margin-top: 3px; }
/* New task form */
.new-task-toggle {
  margin-left: auto; padding: 2px 8px; font-size: 10px; font-weight: 600;
  background: var(--accent); color: white; border: none; border-radius: 4px; cursor: pointer;
}
.new-task-toggle:hover { opacity: 0.9; }
.new-task-form { padding: 8px 14px; border-bottom: 1px solid var(--border); }
.new-task-input {
  width: 100%; padding: 6px 8px; font-size: 12px;
  background: var(--bg); border: 1px solid var(--border); border-radius: 5px;
  color: var(--text); resize: none; outline: none; font-family: inherit;
}
.new-task-input:focus { border-color: var(--accent); }
.new-task-actions { display: flex; gap: 4px; margin-top: 4px; }
.submit-btn {
  padding: 4px 12px; font-size: 11px; font-weight: 600;
  background: var(--accent); color: white; border: none; border-radius: 4px; cursor: pointer;
}
.submit-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.cancel-btn {
  padding: 4px 12px; font-size: 11px;
  background: var(--surface-2); color: var(--text-muted); border: 1px solid var(--border); border-radius: 4px; cursor: pointer;
}

.task-card-actions { display: flex; gap: 4px; margin-top: 6px; align-items: center; }
.deny-feedback-input {
  flex: 1; padding: 4px 8px; font-size: 10px;
  background: var(--bg); border: 1px solid #ef4444; border-radius: 4px;
  color: var(--text); outline: none;
}
.deny-feedback-input:focus { box-shadow: 0 0 0 2px rgba(239,68,68,0.2); }
.task-card-actions .task-accept, .task-card-actions .task-deny {
  flex: 1; padding: 5px 0; font-size: 11px; font-weight: 600;
  border: none; border-radius: 5px; cursor: pointer; transition: all 0.12s;
  display: flex; align-items: center; justify-content: center; gap: 4px;
}
.task-card-actions .task-accept { background: rgba(34,197,94,0.15); color: #22c55e; }
.task-card-actions .task-accept:hover { background: #22c55e; color: white; }
.task-card-actions .task-deny { background: rgba(239,68,68,0.12); color: #ef4444; }
.task-card-actions .task-deny:hover { background: #ef4444; color: white; }

/* Pending task creation panel */
.pending-task-panel { padding: 14px; display: flex; flex-direction: column; gap: 12px; }
.pending-task-context { display: flex; flex-direction: column; gap: 6px; }
.pending-task-kind {
  display: flex; align-items: center; gap: 6px;
  font-size: 12px; font-weight: 600; color: var(--text);
}
.pending-task-kind.pin { color: var(--accent); }
.pending-task-kind.pin svg { stroke: var(--accent); }
.pending-task-kind.arrow { color: #ef4444; }
.pending-task-kind.arrow svg { stroke: #ef4444; }
.pending-task-file { font-size: 11px; color: var(--text-muted); font-family: monospace; }
.pending-task-input {
  width: 100%; padding: 8px 10px; font-size: 12px;
  background: var(--bg); color: var(--text);
  border: 1px solid var(--border); border-radius: 6px;
  resize: vertical; font-family: inherit; line-height: 1.4;
}
.pending-task-input:focus { border-color: var(--accent); outline: none; }
.pending-task-actions { display: flex; gap: 6px; }
.pending-task-actions .submit-btn {
  flex: 1; padding: 6px 12px; font-size: 11px; font-weight: 600;
  background: var(--accent); color: white; border: none; border-radius: 5px; cursor: pointer;
}
.pending-task-actions .submit-btn:disabled { opacity: 0.4; cursor: default; }
.pending-task-actions .cancel-btn {
  padding: 6px 12px; font-size: 11px;
  background: var(--surface-2); color: var(--text-muted);
  border: 1px solid var(--border); border-radius: 5px; cursor: pointer;
}
.pending-task-actions .cancel-btn:hover { background: var(--border); color: var(--text); }

/* Shortcuts panel */
.shortcuts-panel { padding: 14px; overflow-y: auto; flex: 1; }
.shortcut-group { margin-bottom: 16px; }
.shortcut-group-title {
  font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em;
  color: var(--text-muted); margin-bottom: 8px; padding-bottom: 4px;
  border-bottom: 1px solid var(--border);
}
.shortcut-row {
  display: flex; align-items: center; gap: 6px;
  padding: 4px 0; font-size: 12px; color: var(--text);
}
.shortcut-row span { margin-left: auto; color: var(--text-muted); font-size: 11px; }
.shortcut-row kbd {
  display: inline-flex; align-items: center; justify-content: center;
  min-width: 22px; height: 20px; padding: 0 5px;
  background: var(--surface-2); border: 1px solid var(--border); border-radius: 4px;
  font-family: inherit; font-size: 11px; font-weight: 600; color: var(--text);
  box-shadow: 0 1px 0 var(--border);
}
.shortcut-row kbd.mod { font-size: 10px; color: var(--text-muted); }
.shortcut-hint {
  font-size: 11px; color: var(--text-muted); padding-top: 8px;
  border-top: 1px solid var(--border); display: flex; align-items: center; gap: 4px; flex-wrap: wrap;
}
.shortcut-hint kbd {
  display: inline-flex; align-items: center; justify-content: center;
  min-width: 18px; height: 16px; padding: 0 4px;
  background: var(--surface-2); border: 1px solid var(--border); border-radius: 3px;
  font-family: inherit; font-size: 10px; font-weight: 600; color: var(--text-muted);
}
</style>
