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
const shellView = ref<'editor' | 'theme'>('editor')
const layoutOverlay = useLayoutOverlay(iframeRef)
const iframe = useIframeManager(iframeRef)
const { currentRoute } = iframe
const canvas = useCanvasDrawing(annotations, (x: number, y: number) => iframe.resolveElementAt(x, y), () => interactionMode.value)
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
const copied = ref(false)
const activeTab = ref<'layout' | 'spacing' | 'size' | 'style' | 'classes' | 'notes'>('layout')
// Markup visibility toggles
const showMarkup = ref({ pins: true, arrows: true, sections: true, highlights: true })
const showTaskPanel = ref(false)
const showNewTaskForm = ref(false)
const newTaskText = ref('')
const denyingTaskId = ref<string | null>(null)
const denyFeedbackText = ref('')

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

async function refreshRects() {
  if (selectedEids.value.length > 0) {
    const rects = await iframe.getElementRects(selectedEids.value)
    selectionRects.value = rects.filter((r): r is BridgeRect => r !== null)
  } else {
    selectionRects.value = []
  }

  if (applyToGroup.value && selectedEids.value.length <= 1 && templateGroupEids.value.length > 0) {
    const otherEids = templateGroupEids.value.filter(eid => !selectedEids.value.includes(eid))
    const rects = await iframe.getElementRects(otherEids)
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

    // Pin mode: create pin
    if (interactionMode.value === 'pin') {
      const pinX = shellRect ? shellRect.x + shellRect.width / 2 : clientX
      const pinY = shellRect ? shellRect.y : clientY
      annotations.addPin(
        { file, line, component, elementTag: tagName, elementClasses: classes },
        pinX, pinY
      )
      primarySelection.value = { file, line, component, tagName, classes, eid }
      selectedEids.value = [eid]
      await readLiveStyles()
      await refreshElementRole()
      activeTab.value = 'notes'
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
  } else {
    primarySelection.value = { file, line, component, tagName, classes, eid }
    selectedEids.value = [eid]
    const group = await iframe.findTemplateGroup(file, line, tagName)
    templateGroupEids.value = group.eids
    applyToGroup.value = group.eids.length > 1
    editingClasses.value = classes
    await readLiveStyles()
    await refreshElementRole()
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
function copyReport() {
  if (!report.value) return
  navigator.clipboard.writeText(JSON.stringify(report.value, null, 2))
  copied.value = true
  setTimeout(() => (copied.value = false), 2000)
}

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
      element_tag: primary.tag, element_classes: primary.classes,
      elements: targets.map(t => ({ file: t.file, line: parseInt(t.line) || 0, tag: t.tag })),
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
      element_tag: primary.tag, element_classes: primary.classes,
      elements: targets.map(t => ({ file: t.file, line: parseInt(t.line) || 0, tag: t.tag })),
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
    context: { element_tag: h.tag, selected_text: h.text },
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

  createRouteTask({
    type: 'section_request',
    description: section.prompt.trim(),
    file: section.nearFile || '',
    line: section.nearLine || 0,
    component: section.nearComponent || '',
    prompt: section.prompt.trim(),
    placement: section.placement || '',
    visual: { kind: 'section', annotationId: section.id, x: Math.round(section.x), y: Math.round(section.y), width: Math.round(section.width), height: Math.round(section.height) },
  })
}

// ── Arrow → Task ─────────────────────────────────────
const arrowTaskIds = new Set<string>()

async function onArrowCommit(id: string) {
  const arrow = annotations.arrows.value.find(a => a.id === id)
  if (!arrow || !arrow.label.trim()) return
  if (arrowTaskIds.has(id)) return
  arrowTaskIds.add(id)

  const fromCtx = await iframe.resolveElementAt(arrow.fromX, arrow.fromY)
  const toCtx = await iframe.resolveElementAt(arrow.toX, arrow.toY)

  createRouteTask({
    type: 'annotation', action: 'relocate',
    description: arrow.label.trim(),
    file: arrow.fromFile || '',
    line: arrow.fromLine || 0,
    component: arrow.fromComponent || '',
    intent: arrow.label.trim(),
    visual: { kind: 'arrow', annotationId: arrow.id, fromX: arrow.fromX, fromY: arrow.fromY, toX: arrow.toX, toY: arrow.toY, label: arrow.label },
    context: {
      element_tag: fromCtx?.tag || '',
      reference_file: arrow.toFile || '',
      reference_line: arrow.toLine || 0,
      reference_tag: toCtx?.tag || '',
    },
  })
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
  if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
    e.preventDefault()
    doUndo()
  }
  const tag = (e.target as HTMLElement)?.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
  if (e.key === 'l' || e.key === 'L') {
    if (!e.ctrlKey && !e.metaKey) layoutOverlay.toggle()
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
        <span class="logo">Annotask</span>
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
        <button class="tool-btn" :disabled="!report" @click="copyReport">
          {{ copied ? 'Copied!' : 'Copy Report' }}
        </button>
        <button v-if="changes.length" class="tool-btn danger" @click="doClearChanges">Clear</button>
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
          @update-label="(id, label) => annotations.updateArrow(id, { label })"
          @commit="onArrowCommit"
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

      <!-- Task Panel (takes over sidebar when active) -->
      <aside class="panel" v-if="shellView === 'editor' && showTaskPanel">
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
            Notes <span v-if="annotations.routePins.value.length" class="tab-badge">{{ annotations.routePins.value.length }}</span>
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
.logo { font-weight: 700; font-size: 14px; margin-right: 12px; color: var(--accent); letter-spacing: -0.02em; }
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
</style>
