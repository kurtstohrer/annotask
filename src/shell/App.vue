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
import { useScreenshots } from './composables/useScreenshots'
import { useKeyboardShortcuts } from './composables/useKeyboardShortcuts'
import { useA11yScanner } from './composables/useA11yScanner'
import { usePerfMonitor } from './composables/usePerfMonitor'
import PerfTab from './components/PerfTab.vue'
import LibrariesPage from './components/LibrariesPage.vue'
import FindingDrawer from './components/FindingDrawer.vue'
import type { A11yViolation } from './composables/useA11yScanner'
import type { ClickElementEvent, HoverEnterEvent, BridgeRect } from '../shared/bridge-types'
import ModeToolbar from './components/ModeToolbar.vue'
import ArrowColorPicker from './components/ArrowColorPicker.vue'
import ContextMenu from './components/ContextMenu.vue'
import PinOverlay from './components/PinOverlay.vue'
import ArrowOverlay from './components/ArrowOverlay.vue'
import DrawnSectionOverlay from './components/DrawnSectionOverlay.vue'
import NotesTab from './components/NotesTab.vue'
import TextHighlightOverlay from './components/TextHighlightOverlay.vue'
import LayoutOverlay from './components/LayoutOverlay.vue'
import ThemePage from './components/ThemePage.vue'
import ReportViewer from './components/ReportViewer.vue'
import TaskDetailModal from './components/TaskDetailModal.vue'
import ConfirmDialog from './components/ConfirmDialog.vue'
import { useTasks } from './composables/useTasks'
import { useViewportPreview } from './composables/useViewportPreview'
import { useInteractionHistory } from './composables/useInteractionHistory'
import { useAnnotationRects } from './composables/useAnnotationRects'
import { useSelectionModel } from './composables/useSelectionModel'
import { useTaskWorkflows } from './composables/useTaskWorkflows'
import ViewportSelector from './components/ViewportSelector.vue'
import { safeMd } from './utils/safeMd'

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

async function commitChangesAsTask() {
  if (changes.value.length === 0) return

  // Group changes by file:line
  const styleChanges = changes.value.filter(c => c.type === 'style_update') as import('./composables/useStyleEditor').StyleChangeRecord[]
  const classChanges = changes.value.filter(c => c.type === 'class_update') as import('./composables/useStyleEditor').ClassChangeRecord[]

  // Build a description from the changes
  const parts: string[] = []
  for (const c of styleChanges) {
    parts.push(`${c.property}: ${c.after}`)
  }
  for (const c of classChanges) {
    parts.push(`classes: ${c.after.classes}`)
  }
  const description = parts.length <= 3
    ? `Update ${parts.join(', ')}`
    : `Update ${parts.slice(0, 2).join(', ')} and ${parts.length - 2} more`

  // Use the primary selection or first change for file/line
  const file = primarySelection.value?.file || styleChanges[0]?.file || classChanges[0]?.file || ''
  const line = primarySelection.value?.line ? parseInt(primarySelection.value.line) : (styleChanges[0]?.line || classChanges[0]?.line || 0)
  const component = primarySelection.value?.component || styleChanges[0]?.component || classChanges[0]?.component || ''

  const taskChanges: Array<Record<string, unknown>> = []
  for (const c of styleChanges) {
    taskChanges.push({ property: c.property, before: c.before, after: c.after, file: c.file, line: c.line })
  }
  for (const c of classChanges) {
    taskChanges.push({ type: 'class', before: c.before.classes, after: c.after.classes, file: c.file, line: c.line })
  }

  await createRouteTask({
    type: 'style_update',
    description,
    file,
    line,
    component,
    context: { changes: taskChanges },
  })

  // Clear changes after commit
  await doClearChanges()
}
const annotations = useAnnotations()
const taskSystem = useTasks()
const viewport = useViewportPreview()
const interactionHistory = useInteractionHistory()

function normalizeRoute(path: string): string {
  if (!path) return '/'
  const base = path.split('#')[0].split('?')[0] || '/'
  const withSlash = base.startsWith('/') ? base : `/${base}`
  return withSlash.length > 1 ? withSlash.replace(/\/+$/, '') : withSlash
}

// ── State ──────────────────────────────────────────────
const iframeRef = ref<HTMLIFrameElement | null>(null)
const { mode: interactionMode } = useInteractionMode()
const { isInitialized: configInitialized } = useDesignSpec()
const shellView = ref<'editor' | 'theme' | 'libraries'>(
  (['editor', 'theme', 'libraries'].includes(localStorage.getItem('annotask:shellView') || ''))
    ? localStorage.getItem('annotask:shellView') as 'editor' | 'theme' | 'libraries'
    : 'editor'
)
watch(shellView, (v, old) => {
  localStorage.setItem('annotask:shellView', v)
  // no-op: libraries view is self-contained
})
const layoutOverlay = useLayoutOverlay(iframeRef)
const iframe = useIframeManager(iframeRef)
const { currentRoute } = iframe
const arrowColor = ref(localStorage.getItem('annotask:arrowColor') || '#ef4444')
watch(arrowColor, (v) => localStorage.setItem('annotask:arrowColor', v))
const highlightColor = ref(localStorage.getItem('annotask:highlightColor') || '#f59e0b')
watch(highlightColor, (v) => localStorage.setItem('annotask:highlightColor', v))
const canvas = useCanvasDrawing(annotations, (x: number, y: number) => iframe.resolveElementAt(x, y), () => interactionMode.value, (arrowId, fromCtx, toCtx) => onArrowCreated(arrowId, fromCtx, toCtx), () => arrowColor.value)
const { drawingArrow, drawingRect, onCanvasPointerDown, onCanvasPointerMove, onCanvasPointerUp } = canvas

// Sync mode to bridge + clear selection on interact + clean orphan annotations
watch(interactionMode, (mode) => {
  iframe.setMode(mode)
  // Cancel any pending task (removes orphan pin/arrow/highlight)
  if (pendingTaskCreation.value) cancelPendingTask()
  // Remove sections without submitted tasks
  for (const s of [...annotations.drawnSections.value]) {
    if (!sectionTaskMap.value[s.id]) annotations.removeDrawnSection(s.id)
  }
  if (mode === 'interact') {
    clearSelection()
    hoverRect.value = null
    hoverInfo.value = null
  }
  if (mode === 'select') {
    activeTab.value = 'notes'
  }
})
const showWarning = ref(false)
const showReportPanel = ref(false)
const annotaskVersion = typeof __ANNOTASK_VERSION__ !== 'undefined' ? __ANNOTASK_VERSION__ : 'dev'
const activeTab = ref<'layout' | 'spacing' | 'size' | 'style' | 'classes' | 'notes'>('notes')
// Markup visibility toggles
const showMarkup = ref({ pins: true, arrows: true, sections: true, highlights: true, inspector: true })
const activePanel = ref<'inspector' | 'tasks' | 'a11y' | 'perf'>(
  (['inspector', 'tasks', 'a11y', 'perf'].includes(localStorage.getItem('annotask:activePanel') || ''))
    ? localStorage.getItem('annotask:activePanel') as 'inspector' | 'tasks' | 'a11y' | 'perf'
    : 'inspector'
)
watch(activePanel, (v) => {
  localStorage.setItem('annotask:activePanel', v)
})
// Backward compat alias
const showTaskPanel = computed(() => activePanel.value === 'tasks')
const includeHistory = ref(localStorage.getItem('annotask:includeHistory') === 'true')
watch(includeHistory, (v) => localStorage.setItem('annotask:includeHistory', String(v)))
const includeElementContext = ref(localStorage.getItem('annotask:includeElementContext') === 'true')
const screenshots = useScreenshots(iframe)
const { snipActive, snipRect, pendingScreenshot, startSnip, onSnipDown, onSnipMove, onSnipUp, cancelSnip, removeScreenshot } = screenshots
watch(includeElementContext, (v) => localStorage.setItem('annotask:includeElementContext', String(v)))
const showShortcuts = ref(localStorage.getItem('annotask:showShortcuts') === 'true')
watch(showShortcuts, (v) => localStorage.setItem('annotask:showShortcuts', String(v)))



// ── Selection Model ────────────────────────────────────
const selection = useSelectionModel(iframe, styleEditor)
const {
  primarySelection, selectedEids, templateGroupEids, applyToGroup,
  editTargetEids, selectionRects, groupRects,
  selectionSummary, selectedElementRole,
  liveStyles, editingClasses,
  hoverRect, hoverInfo,
  readLiveStyles, refreshRects, refreshElementRole,
  onStyleChange, applyClassChange,
  clearSelection,
} = selection

// A11y scanner (needs primarySelection and currentRoute)
const a11yScanner = useA11yScanner(iframe, taskSystem, primarySelection as any, currentRoute)
const { a11yViolations, a11yLoading, a11yError, a11yScanned, a11yScanTarget, a11yTaskRules, scanA11y, createA11yTask } = a11yScanner
const detailA11yViolation = ref<A11yViolation | null>(null)
function onCreateA11yTask(v: A11yViolation) { createA11yTask(v); detailA11yViolation.value = null }

const perfMonitor = usePerfMonitor(iframe, taskSystem, currentRoute)
const { recording: perfRecording, recordingResult: perfRecordingResult, recordingError: perfRecordingError,
        scanResult: perfScanResult, scanLoading: perfScanLoading, scanError: perfScanError, hasData: perfHasData,
        timeline: perfTimeline, vitals: perfVitals, perfScore, perfFindings, perfTaskFindings,
        startRecording, stopRecording: stopPerfRecording, scanPerf: runPerfScan, createPerfTask } = perfMonitor
function startPerfRecording() {
  interactionMode.value = 'interact'
  startRecording()
}

// ── Annotation rect refresh loop ──
const { taskElementRects, startAnnotationLoop } = useAnnotationRects({ iframe, annotations, taskSystem, normalizeRoute })

// ── Event Handlers (bridge-based) ──────────────────────

async function onIframeLoad() {
  iframe.initBridgeForIframe()

  iframe.onBridgeReady(async () => {
    // Sync mode
    iframe.setMode(interactionMode.value)
    // Check source mapping
    showWarning.value = !(await iframe.checkSourceMapping())
    // Get actual route from bridge and persist it
    const route = await iframe.getCurrentRoute()
    annotations.setRoute(route)
    localStorage.setItem('annotask:lastRoute', route)
    // Re-resolve select task eids now that bridge is connected
    await resolveSelectTaskEids()
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
    const { file, line, component, mfe, tag: tagName, classes, eid, shiftKey, clientX, clientY } = data
    const shellRect = iframe.toShellRect(data.rect)

    // Pin mode: create pin at exact click position → open task creation panel
    if (interactionMode.value === 'pin') {
      const pinX = clientX
      const pinY = clientY
      const pin = annotations.addPin(
        { file, line, component, elementTag: tagName, elementClasses: classes },
        pinX, pinY
      )
      primarySelection.value = { file, line, component, mfe: mfe || '', tagName, classes, eid }
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
      primarySelection.value = { file, line, component, mfe: mfe || '', tagName, classes, eid }
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
    const { file, line, component, mfe = '', tag: tagName, classes, eid } = data
    const shellRect = iframe.toShellRect(data.rect)
    primarySelection.value = { file, line, component, mfe, tagName, classes, eid }
    selectedEids.value = [eid]
    await readLiveStyles()
    await refreshElementRole()
    contextMenu.value = {
      visible: true,
      x: shellRect ? shellRect.x + shellRect.width / 2 : data.clientX,
      y: shellRect ? shellRect.y + shellRect.height / 2 : data.clientY,
    }
  })

  iframe.onBridgeEvent('selection:text', async (data: { text: string; eid: string; file: string; line: number; component: string; tag: string; rect?: { x: number; y: number; width: number; height: number } }) => {
    // Convert iframe-local rect to viewport coords
    const iframeEl = iframeRef.value
    const offsetX = iframeEl?.getBoundingClientRect().left || 0
    const offsetY = iframeEl?.getBoundingClientRect().top || 0
    let viewportRect: { x: number; y: number; width: number; height: number } | undefined
    if (data.rect) {
      viewportRect = { x: data.rect.x + offsetX, y: data.rect.y + offsetY, width: data.rect.width, height: data.rect.height }
    }
    const hl = annotations.addHighlight(data.text, { file: data.file, line: data.line, component: data.component, elementTag: data.tag }, highlightColor.value, viewportRect, data.eid)
    // Fallback: resolve element rect by eid if bridge didn't send selection rect
    if (!viewportRect && data.eid) {
      const elRect = await iframe.getElementRect(data.eid)
      if (elRect) annotations.updateHighlight(hl.id, { rect: elRect })
    }
    pendingTaskCreation.value = {
      kind: 'highlight',
      label: `Text highlight`,
      file: data.file,
      line: data.line,
      component: data.component,
      annotationId: hl.id,
      meta: { selectedText: data.text, elementTag: data.tag },
    }
    pendingTaskText.value = data.text
  })

  iframe.onBridgeEvent('keydown', (data: { key: string; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }) => {
    if ((data.ctrlKey || data.metaKey) && data.key === 'z' && !data.shiftKey) {
      doUndo()
    }
  })

  iframe.onBridgeEvent('route:changed', (data: { path: string }) => {
    annotations.setRoute(data.path)
    localStorage.setItem('annotask:lastRoute', data.path)
    // Restore any tasks for the new route that haven't been loaded yet
    restoreAnnotationsFromTasks()
  })

  // User action tracking (interact mode — link/button clicks in the app)
  iframe.onBridgeEvent('user:action', (data: { tag: string; text: string; href: string }) => {
    interactionHistory.push('action', currentRoute.value, data)
  })

}

// ── Report ─────────────────────────────────────────────

// ── Context Menu ──────────────────────────────────────
const contextMenu = ref({ visible: false, x: 0, y: 0 })


// ── Task Workflows composable ────────────────────────
const taskWorkflows = useTaskWorkflows({
  iframe, annotations, taskSystem, styleEditor, screenshots, viewport, interactionHistory,
  primarySelection, selectedEids, selectionRects, taskElementRects,
  includeHistory, includeElementContext, currentRoute,
  clearSelection, startAnnotationLoop,
})
const {
  pendingTaskCreation, pendingTaskText,
  routeTasks,
  showNewTaskForm, newTaskText,
  denyingTaskId, denyFeedbackText,
  detailTaskId, detailTask,
  confirmDeleteTaskId,
  sectionTaskMap, arrowDragTargetRect,
  restoredTaskIds,
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
} = taskWorkflows

// ── Keyboard Shortcuts (composable handles mount/unmount) ──
useKeyboardShortcuts({
  snipActive,
  showReportPanel,
  showShortcuts,
  pendingTaskCreation,
  primarySelection,
  selectedEids,
  templateGroupEids,
  selectionRects,
  groupRects,
  activePanel,
  doUndo,
  cancelSnip,
  cancelPendingTask,
  layoutOverlayToggle: () => layoutOverlay.toggle(),
})

// ── Lifecycle ──────────────────────────────────────────
onMounted(async () => {
  // Seed route before bridge sync so restored annotations are filtered predictably.
  const savedRoute = localStorage.getItem('annotask:lastRoute') || '/'
  annotations.setRoute(savedRoute)
  // Restore annotations from persisted tasks first (bridge-independent).
  await restoreAnnotationsFromTasks()

  iframe.mountBridge()
  setupBridgeEvents()
  iframeRef.value?.addEventListener('load', onIframeLoad)
  // If iframe already loaded, trigger manually
  if (iframeRef.value?.contentWindow) onIframeLoad()
})
onUnmounted(() => {
  iframe.unmountBridge()
})

const iframeStyle = computed(() => {
  const vp = viewport.effectiveViewport.value
  if (!vp.width && !vp.height) return {}
  return {
    width: vp.width ? `${vp.width}px` : '100%',
    height: vp.height ? `${vp.height}px` : '100%',
  }
})

function navigateIframe(route: string) {
  const r = route.trim()
  if (!r || r === currentRoute.value) return
  const path = r.startsWith('/') ? r : '/' + r
  const iframeEl = iframeRef.value
  if (iframeEl?.contentWindow) {
    iframeEl.contentWindow.location.href = window.location.origin + path
  }
}

const appUrl = computed(() => {
  const params = new URLSearchParams(window.location.search)
  const base = params.get('appUrl') || window.location.origin
  const savedRoute = localStorage.getItem('annotask:lastRoute')
  return savedRoute ? base + savedRoute : base + '/'
})
</script>

<template>
  <div class="annotask-shell">
    <!-- Toolbar -->
    <header class="toolbar">
      <div class="toolbar-left">
        <svg class="logo" viewBox="0 0 85.81 90.51" fill="currentColor" xmlns="http://www.w3.org/2000/svg"><path d="m72.02 90.31c-.17-.1-.43-.48-.57-.82-.37-.93-1.97-3.46-2.74-4.33-.66-.74-.77-.79-5.99-2.5-2.93-.96-5.52-1.85-5.77-1.98-.47-.25-.35.01-4.7-9.99-1.1-2.53-2.11-4.72-2.25-4.87-.22-.24-1.7-.26-11.7-.21-6.3.03-11.51.12-11.58.19-.11.11-2.06 4.98-4.34 10.84-.4 1.04-1.21 3.11-1.8 4.6-.58 1.49-1.52 3.88-2.08 5.32-.64 1.65-1.18 2.76-1.45 3.02l-.44.41H8.31 0l.49-1.22c4.92-12.33 8.69-21.78 9.54-23.94 1.22-3.09 4.33-10.89 6.52-16.32.82-2.03 1.72-4.3 2-5.05.28-.74 1.17-2.97 1.97-4.96 2.26-5.6 3-7.45 4.7-11.72 2.32-5.86 5.17-13 7.63-19.11 1.2-2.98 2.29-5.73 2.44-6.13.15-.4.45-.9.68-1.13l.42-.41h8.22c4.57 0 8.4.07 8.63.17.49.19.22-.38 3.81 8.22 1.57 3.77 3 7.18 3.17 7.57.73 1.72 6 14.31 7.22 17.22 1.71 4.1 5.73 13.7 6 14.34.17.4.66 1.58 1.09 2.61.43 1.04 1.63 3.94 2.68 6.46 1.05 2.51 1.9 4.63 1.9 4.71 0 .08-.14.2-.3.27-.17.07-2.89 1.13-6.05 2.37-3.16 1.23-6.39 2.5-7.17 2.81-.78.31-1.47.51-1.53.45-.06-.06-.47-1.07-.92-2.24-1.24-3.24-5.96-15.5-7.72-20.06-.86-2.23-2.45-6.33-3.52-9.11-1.07-2.78-2.93-7.6-4.14-10.73-1.2-3.12-2.4-6.25-2.67-6.94l-.48-1.26-.19.54c-.42 1.17-1.35 3.64-3.23 8.56-1.08 2.83-2.45 6.44-3.05 8.02-.6 1.59-2.24 5.89-3.65 9.56l-2.57 6.67 8.58.05 8.58.05.31.76c.17.42 1.14 2.91 2.16 5.54 6.49 16.81 6.66 17.24 6.88 17.18.08-.02 1.08-.41 2.21-.87 1.13-.46 3.45-1.39 5.15-2.06 5.12-2.03 14.4-5.73 14.68-5.85.14-.06.39-.01.55.12.32.25 2.19 4.68 2.19 5.19 0 .18-.14.48-.3.68-.27.32-5.46 2.61-10.94 4.83-4.74 1.92-6.58 2.65-7.29 2.92l-.77.29 1.94.34 1.94.34.77-.38c1.61-.79 3.36-1.45 7.27-2.71 2.22-.72 4.1-1.32 4.19-1.33.16-.02.94 1.75 2.24 5.12.41 1.04 1.36 3.49 2.13 5.45.77 1.96 1.39 3.71 1.39 3.89 0 .75-.14.76-6.94.76-4.33 0-6.64-.07-6.85-.2z"/></svg>
        <div class="view-toggle">
          <button :class="['toggle-btn', { active: shellView === 'editor' }]" @click="shellView = 'editor'" title="Annotate and inspect your UI">Annotate</button>
          <button :class="['toggle-btn', { active: shellView === 'theme' }]" @click="shellView = 'theme'" title="Edit design tokens (colors, typography, spacing)">Design</button>
          <button :class="['toggle-btn', { active: shellView === 'libraries' }]" @click="shellView = 'libraries'" title="Browse installed component libraries">Libraries</button>
        </div>
        <template v-if="shellView === 'editor'">
          <ModeToolbar v-model="interactionMode" />
          <ArrowColorPicker v-if="interactionMode === 'arrow'" v-model="arrowColor" />
          <ArrowColorPicker v-if="interactionMode === 'highlight'" v-model="highlightColor" />
        </template>
      </div>
      <div v-if="shellView === 'editor'" class="toolbar-center">
        <ViewportSelector />
        <button :class="['tool-btn', { active: layoutOverlay.showOverlay.value }]" @click="layoutOverlay.toggle()" title="Show Layout (L)">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="3" x2="9" y2="21"/></svg>
        </button>
        <input
          class="route-input"
          :value="currentRoute"
          title="Current route — edit to navigate"
          @keydown.enter="navigateIframe(($event.target as HTMLInputElement).value)"
          @blur="navigateIframe(($event.target as HTMLInputElement).value)"
        />
      </div>
      <div v-else class="toolbar-center" />
      <div v-if="shellView === 'editor'" class="toolbar-right">
        <div class="panel-toggle">
          <button :class="['toggle-btn', { active: activePanel === 'inspector' }]" @click="activePanel = 'inspector'" title="Inspect element styles, layout, and classes">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            Inspector
          </button>
          <button :class="['toggle-btn', { active: activePanel === 'tasks' }]" @click="activePanel = 'tasks'" title="View and manage design tasks for your AI agent (T)">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
            Tasks
            <span v-if="routeTasks.length" class="toggle-badge">{{ routeTasks.length }}</span>
          </button>
          <button :class="['toggle-btn', { active: activePanel === 'a11y' }]" @click="activePanel = 'a11y'" title="Run accessibility checks (axe-core WCAG)">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="4" r="2"/><path d="M4 8h16M6 12l3 8M18 12l-3 8"/></svg>
            A11y
            <span v-if="a11yViolations.length" class="toggle-badge">{{ a11yViolations.length }}</span>
          </button>
          <button :class="['toggle-btn', { active: activePanel === 'perf' }]" @click="activePanel = 'perf'" title="Page performance and Web Vitals">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
            Perf
            <span v-if="perfFindings.length" class="toggle-badge">{{ perfFindings.length }}</span>
          </button>
        </div>
        <div class="visibility-toggles">
          <button :class="['vis-btn', { off: !showMarkup.inspector }]" @click="showMarkup.inspector = !showMarkup.inspector" title="Toggle Inspector Highlights">I</button>
          <button :class="['vis-btn', { off: !showMarkup.pins }]" @click="showMarkup.pins = !showMarkup.pins" title="Toggle Pins">P</button>
          <button :class="['vis-btn', { off: !showMarkup.arrows }]" @click="showMarkup.arrows = !showMarkup.arrows" title="Toggle Arrows">A</button>
          <button :class="['vis-btn', { off: !showMarkup.sections }]" @click="showMarkup.sections = !showMarkup.sections" title="Toggle Sections">D</button>
          <button :class="['vis-btn', { off: !showMarkup.highlights }]" @click="showMarkup.highlights = !showMarkup.highlights" title="Toggle Highlights">H</button>
        </div>
        <button :class="['tool-btn', { active: showShortcuts }]" @click="showShortcuts = !showShortcuts" title="Keyboard Shortcuts (?)">?</button>
      </div>
      <div v-else class="toolbar-right" />
    </header>

    <!-- Banners -->
    <div v-if="showWarning" class="warning-banner">
      Source mapping unavailable — add <code>annotask()</code> to your Vite plugins.
    </div>
    <div v-if="!configInitialized" class="setup-banner">
      Annotask not initialized — run <code>/annotask-init</code> in your AI assistant to set up project tokens and component detection.
    </div>

    <!-- Snipping overlay -->
    <div v-if="snipActive" class="snip-overlay"
      @pointerdown="onSnipDown" @pointermove="onSnipMove" @pointerup="onSnipUp" @keydown.escape="cancelSnip">
      <div class="snip-hint">Drag to select a region, or press Esc to cancel</div>
      <div v-if="snipRect && snipRect.width > 5 && snipRect.height > 5" class="snip-selection"
        :style="{ left: snipRect.x+'px', top: snipRect.y+'px', width: snipRect.width+'px', height: snipRect.height+'px' }">
        <div class="snip-size-label">{{ Math.round(snipRect.width) }} &times; {{ Math.round(snipRect.height) }}</div>
      </div>
    </div>

    <!-- Main -->
    <div class="main">
      <!-- Libraries: full-width view replacing the canvas -->
      <LibrariesPage v-if="shellView === 'libraries'" />

      <div v-else class="canvas-area" :class="{ 'viewport-active': !viewport.isFullWidth.value }"
        @pointerdown="shellView === 'editor' ? onCanvasPointerDown($event) : undefined"
        @pointermove="shellView === 'editor' ? onCanvasPointerMove($event) : undefined"
        @pointerup="shellView === 'editor' ? onCanvasPointerUp($event) : undefined"
      >
        <iframe ref="iframeRef" :src="appUrl" class="app-iframe" :style="iframeStyle" />
        <!-- Editor overlays: only in editor mode -->
        <template v-if="shellView === 'editor'">
        <!-- Drawing shield: captures pointer events for arrow/draw/sticky modes -->
        <div v-if="interactionMode === 'arrow' || interactionMode === 'draw'"
          class="drawing-shield" :class="interactionMode" />

        <template v-if="showMarkup.inspector">
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

        </template>

        <!-- Persistent task element highlights (always visible, outside inspector toggle) -->
        <div v-for="te in taskElementRects" :key="'te-'+te.taskId" class="highlight task-element"
          :style="{ left: te.rect.x+'px', top: te.rect.y+'px', width: te.rect.width+'px', height: te.rect.height+'px' }" />

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
          :drawingColor="arrowColor"
          @select="annotations.selectedArrowId.value = $event"
          @remove="annotations.removeArrow"
          :dragTargetRect="arrowDragTargetRect"
          @update-arrow="(id, updates) => annotations.updateArrow(id, updates)"
          @drag-move="onArrowDragMove"
          @drag-end="onArrowDragEnd"
        />

        <!-- Drawn sections -->
        <DrawnSectionOverlay v-if="showMarkup.sections"
          :sections="annotations.routeSections.value"
          :selectedId="annotations.selectedSectionId.value"
          :drawingRect="drawingRect"
          :sectionTaskMap="sectionTaskMap"
          @select="annotations.selectedSectionId.value = $event"
          @remove="annotations.removeDrawnSection"
          @update-prompt="(id, prompt) => annotations.updateDrawnSection(id, { prompt })"
          @update-rect="(id, rect) => annotations.updateDrawnSection(id, { x: rect.x, y: rect.y, width: rect.width, height: rect.height })"
          @submit="onSectionSubmit"
        />

        <!-- Text highlight cards -->
        <TextHighlightOverlay v-if="showMarkup.highlights"
          :highlights="annotations.routeHighlights.value"
          :selectedId="annotations.selectedHighlightId.value"
          @select="annotations.selectedHighlightId.value = $event"
          @remove="annotations.removeHighlight"
          @update-prompt="(id, p) => annotations.updateHighlight(id, { prompt: p })"
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
          <div class="shortcut-version">Annotask v{{ annotaskVersion }}</div>
        </div>
      </aside>

      <!-- Pending Task Creation Panel (after pin/arrow placement) -->
      <aside class="panel" v-else-if="shellView === 'editor' && pendingTaskCreation">
        <div class="panel-source">
          <span class="source-path" style="color:var(--text)">Add Task</span>
        </div>
        <div class="pending-task-panel">
          <div v-if="pendingTaskCreation.kind !== 'highlight'" class="pending-task-context">
            <div class="pending-task-kind" :class="pendingTaskCreation.kind">
              <svg v-if="pendingTaskCreation.kind === 'pin'" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="10" r="3"/><path d="M12 21.7C17.3 17 20 13 20 10a8 8 0 1 0-16 0c0 3 2.7 7 8 11.7z"/></svg>
              <svg v-else-if="pendingTaskCreation.kind === 'arrow'" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
              <span>{{ pendingTaskCreation.label }}</span>
            </div>
            <code class="pending-task-file">{{ pendingTaskCreation.file }}:{{ pendingTaskCreation.line }}</code>
          </div>
          <span v-if="pendingTaskCreation.kind === 'highlight'" class="pending-task-title">Change text</span>
          <textarea
            v-model="pendingTaskText"
            class="pending-task-input"
            rows="6"
            placeholder="Describe the change..."
            autofocus
            @keydown.enter.ctrl="submitPendingTask"
            @keydown.escape="cancelPendingTask"
          />
          <div class="task-toggles">
            <label class="history-toggle" title="Attach your navigation path and click actions to this task"><input type="checkbox" v-model="includeHistory" /><span>Include interaction history</span></label>
            <label class="history-toggle" title="Attach parent layout chain and DOM subtree snapshot to this task"><input type="checkbox" v-model="includeElementContext" /><span>Include DOM context</span></label>
          </div>
          <div v-if="pendingScreenshot" class="screenshot-preview">
            <img :src="'/__annotask/screenshots/' + pendingScreenshot" class="screenshot-thumb" />
            <button class="screenshot-remove" @click="removeScreenshot">&times;</button>
          </div>
          <button v-else class="screenshot-btn" @click="startSnip" title="Capture a screenshot — drag a region or click for full page">Add Screenshot</button>
          <div class="pending-task-actions">
            <button class="submit-btn" :disabled="!pendingTaskText.trim()" @click="submitPendingTask">Add Task</button>
            <button class="cancel-btn" @click="cancelPendingTask">Cancel</button>
          </div>
        </div>
      </aside>

      <!-- Task Panel -->
      <aside class="panel" v-else-if="shellView === 'editor' && activePanel === 'tasks'">
        <div class="panel-source">
          <span class="source-path" style="color:var(--text)">Tasks</span>
          <span class="component-badge">{{ taskSystem.tasks.value.length }}</span>
          <button :class="['new-task-toggle json-toggle', { active: showReportPanel }]" @click="showReportPanel = !showReportPanel" title="View all tasks as JSON">
            JSON
          </button>
          <button class="new-task-toggle" @click="showNewTaskForm = !showNewTaskForm" title="Create a general task (not tied to an element)">
            {{ showNewTaskForm ? '−' : '+' }} New
          </button>
        </div>

        <!-- New task form (collapsible) -->
        <div v-if="showNewTaskForm" class="new-task-form">
          <textarea v-model="newTaskText" class="new-task-input" rows="2" placeholder="Describe a change..." @keydown.enter.ctrl="submitNewTask" />
          <div class="task-toggles">
            <label class="history-toggle" title="Attach your navigation path and click actions to this task"><input type="checkbox" v-model="includeHistory" /><span>Include interaction history</span></label>
            <label class="history-toggle" title="Attach parent layout chain and DOM subtree snapshot to this task"><input type="checkbox" v-model="includeElementContext" /><span>Include DOM context</span></label>
          </div>
          <div v-if="pendingScreenshot" class="screenshot-preview">
            <img :src="'/__annotask/screenshots/' + pendingScreenshot" class="screenshot-thumb" />
            <button class="screenshot-remove" @click="removeScreenshot">&times;</button>
          </div>
          <button v-else class="screenshot-btn" @click="startSnip" title="Capture a screenshot — drag a region or click for full page">Add Screenshot</button>
          <div class="new-task-actions">
            <button class="submit-btn" :disabled="!newTaskText.trim()" @click="submitNewTask">Add</button>
            <button class="cancel-btn" @click="showNewTaskForm = false; newTaskText = ''">Cancel</button>
          </div>
        </div>

        <div class="tab-content">
          <div v-if="taskSystem.tasks.value.length === 0 && !showNewTaskForm" class="empty-hint" style="padding:20px 0">
            No tasks yet. Click + New to add one.
          </div>
          <div v-for="task in routeTasks" :key="task.id" class="task-card" :class="task.status" @click="detailTaskId = task.id">
            <div v-if="task.resolution" class="task-card-resolution">{{ task.resolution }}</div>
            <div class="task-card-header">
              <span class="task-status-dot" :class="task.status" />
              <span class="task-card-desc task-card-md" v-html="safeMd(task.description)"></span>
              <button class="task-card-close" @click.stop="confirmDeleteTaskId = task.id" title="Delete task">×</button>
            </div>
            <div class="task-card-meta">
              <code class="task-card-file">{{ task.file }}:{{ task.line }}</code>
              <span v-if="task.route" class="task-route-badge">{{ task.route }}</span>
            </div>
            <img v-if="task.screenshot" class="task-screenshot-thumb" :src="'/__annotask/screenshots/' + task.screenshot" />
            <div v-if="task.feedback" class="task-card-feedback">{{ task.feedback }}</div>
            <div v-if="task.status === 'needs_info' && task.agent_feedback?.length" class="task-card-agent-q">
              {{ task.agent_feedback[task.agent_feedback.length - 1].questions[0]?.text }}
            </div>
            <div v-if="task.status === 'blocked' && task.blocked_reason" class="task-card-blocked">
              {{ task.blocked_reason }}
            </div>
            <div v-if="task.status === 'review'" class="task-card-actions" @click.stop>
              <template v-if="denyingTaskId !== task.id">
                <button class="task-accept" @click="acceptTask(task.id)" title="Accept this change and remove the task">Accept</button>
                <button class="task-deny" @click="denyingTaskId = task.id; denyFeedbackText = ''" title="Reject and send feedback to the agent">Deny</button>
              </template>
              <template v-else>
                <div class="deny-form">
                  <textarea
                    v-model="denyFeedbackText"
                    class="deny-feedback-textarea"
                    rows="3"
                    placeholder="What needs to change?"
                    autofocus
                    @keydown.enter.ctrl="submitDeny(task.id)"
                    @keydown.escape="denyingTaskId = null"
                  />
                  <div class="task-toggles">
                    <label class="history-toggle" title="Attach your navigation path and click actions to this task"><input type="checkbox" v-model="includeHistory" /><span>Include interaction history</span></label>
                    <label class="history-toggle" title="Attach parent layout chain and DOM subtree snapshot to this task"><input type="checkbox" v-model="includeElementContext" /><span>Include DOM context</span></label>
                  </div>
                  <div v-if="pendingScreenshot" class="screenshot-preview">
                    <img :src="'/__annotask/screenshots/' + pendingScreenshot" class="screenshot-thumb" />
                    <button class="screenshot-remove" @click="removeScreenshot">&times;</button>
                  </div>
                  <button v-else class="screenshot-btn" @click="startSnip" title="Capture a screenshot — drag a region or click for full page">Add Screenshot</button>
                  <div class="deny-form-actions">
                    <button class="task-send-feedback" :disabled="!denyFeedbackText.trim()" @click="submitDeny(task.id)">Send Feedback</button>
                    <button class="cancel-btn" style="padding:4px 8px;font-size:10px" @click="denyingTaskId = null">Cancel</button>
                  </div>
                </div>
              </template>
            </div>
          </div>
        </div>
      </aside>

      <!-- A11y Panel -->
      <aside class="panel" v-else-if="shellView === 'editor' && activePanel === 'a11y'">
        <div class="panel-source">
          <span class="source-path" style="color:var(--text)">Accessibility</span>
          <button class="scan-btn" :disabled="a11yLoading" @click="scanA11y('page')" style="margin-left:auto" title="Run axe-core WCAG accessibility scan on the page">
            {{ a11yLoading ? 'Scanning...' : 'Scan Page' }}
          </button>
        </div>
        <div class="tab-content">
          <div v-if="a11yError" class="a11y-error">{{ a11yError }}</div>

          <div v-if="!a11yLoading && a11yViolations.length === 0 && !a11yError && a11yScanned" class="a11y-pass">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M20 6L9 17l-5-5"/></svg>
            No violations found
          </div>
          <div v-else-if="!a11yLoading && a11yViolations.length === 0 && !a11yError" class="a11y-empty">
            Click Scan Page to check accessibility
          </div>

          <div v-if="a11yViolations.length" class="a11y-summary">
            {{ a11yViolations.length }} violation{{ a11yViolations.length === 1 ? '' : 's' }}
          </div>

          <div v-for="v in a11yViolations" :key="v.id" class="a11y-card" :class="v.impact" @click="detailA11yViolation = v">
            <span class="a11y-impact" :class="v.impact">{{ v.impact }}</span>
            <span class="a11y-rule">{{ v.id }}</span>
            <span class="a11y-count">{{ v.nodes }} element{{ v.nodes === 1 ? '' : 's' }}</span>
            <span v-if="a11yTaskRules.has(v.id)" class="a11y-tasked-badge">tasked</span>
            <svg class="a11y-chevron" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg>
          </div>
        </div>
      </aside>

      <!-- Performance Panel -->
      <aside class="panel" v-else-if="shellView === 'editor' && activePanel === 'perf'">
        <div class="panel-source">
          <span class="source-path" style="color:var(--text)">Performance</span>
        </div>
        <div class="tab-content">
          <PerfTab
            :recording="perfRecording"
            :recording-result="perfRecordingResult"
            :scan-result="perfScanResult"
            :scan-loading="perfScanLoading"
            :has-data="perfHasData"
            :timeline="perfTimeline"
            :vitals="perfVitals"
            :score="perfScore"
            :findings="perfFindings"
            :task-findings="perfTaskFindings"
            :error="perfRecordingError || perfScanError"
            @start-recording="startPerfRecording"
            @stop-recording="stopPerfRecording"
            @scan="runPerfScan"
            @create-task="createPerfTask"
          />
        </div>
      </aside>



      <!-- Property Panel -->
      <aside class="panel" v-else-if="shellView === 'editor' && activePanel === 'inspector' && primarySelection">
        <div class="panel-source">
          <code class="source-path">{{ primarySelection.file }}:{{ primarySelection.line }}</code>
          <span class="component-badge">{{ primarySelection.component }}</span>
          <span v-if="selectedElementRole" class="role-badge" :class="selectedElementRole">{{ selectedElementRole }}</span>
        </div>

        <div v-if="selectionSummary" class="panel-group-bar">
          <span class="group-summary">{{ selectionSummary }}</span>
          <label v-if="templateGroupEids.length > 1 && selectedEids.length <= 1" class="group-toggle" title="Apply style changes to all instances of this element in the template">
            <input type="checkbox" v-model="applyToGroup" />
            <span class="toggle-label">Apply to all {{ templateGroupEids.length }}</span>
          </label>
        </div>

        <div class="panel-tabs">
          <button :class="['tab', { active: activeTab === 'notes' }]" @click="activeTab = 'notes'" title="Create tasks and annotations for this element">
            Task <span v-if="annotations.routePins.value.length" class="tab-badge">{{ annotations.routePins.value.length }}</span>
          </button>
          <button :class="['tab', { active: activeTab === 'layout' }]" @click="activeTab = 'layout'" title="Edit display, flex, and grid properties">Layout</button>
          <button :class="['tab', { active: activeTab === 'spacing' }]" @click="activeTab = 'spacing'" title="Edit padding and margin">Spacing</button>
          <button :class="['tab', { active: activeTab === 'size' }]" @click="activeTab = 'size'" title="Edit width, height, and constraints">Size</button>
          <button :class="['tab', { active: activeTab === 'style' }]" @click="activeTab = 'style'" title="Edit colors, typography, and appearance">Style</button>
          <button :class="['tab', { active: activeTab === 'classes' }]" @click="activeTab = 'classes'" title="Edit CSS classes directly">Classes</button>
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
            :includeHistory="includeHistory"
            :includeElementContext="includeElementContext"
            @update:includeHistory="includeHistory = $event"
            @update:includeElementContext="includeElementContext = $event"
            :pendingScreenshot="pendingScreenshot"
            @start-snip="startSnip"
            @remove-screenshot="removeScreenshot"
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
          <div class="changes-list">
            <div v-for="ch in changes" :key="ch.id" class="change-item">
              <template v-if="ch.type === 'style_update'">
                <code class="change-prop">{{ ch.property }}</code>
                <span class="change-arrow">→</span>
                <code class="change-val">{{ ch.after }}</code>
              </template>
              <template v-else-if="ch.type === 'class_update'">
                <code class="change-prop">classes</code>
                <span class="change-arrow">→</span>
                <code class="change-val">{{ ch.after.classes.substring(0, 30) }}</code>
              </template>
            </div>
          </div>
          <div class="changes-actions">
            <span class="changes-count">{{ changes.length }} change{{ changes.length === 1 ? '' : 's' }}</span>
            <button class="changes-commit" @click="commitChangesAsTask" title="Save these visual changes as a task for your AI agent to apply to source code">Commit to Task</button>
            <button class="changes-discard" @click="doClearChanges" title="Undo all visual changes (does not affect source code)">Discard</button>
          </div>
        </div>
      </aside>

      <!-- Empty state (inspector with no selection) -->
      <aside class="panel empty" v-else-if="shellView === 'editor' && activePanel === 'inspector'">
        <div class="empty-content">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.3"><path d="M4 4l7.07 17 2.51-7.39L21 11.07z"/></svg>
          <p>Click an element to inspect</p>
          <p class="empty-hint">Use the toolbar modes: Select (V), Pin (P), Arrow (A), Draw (D), Highlight (H)</p>
        </div>
      </aside>
    </div>

    <!-- Context menu -->
    <ContextMenu v-bind="contextMenu" @close="contextMenu.visible = false" />

    <!-- Report viewer slide-out -->
    <ReportViewer v-if="showReportPanel" :tasks="taskSystem.tasks.value" @close="showReportPanel = false" />

    <!-- Task detail modal -->
    <!-- A11y Finding Detail -->
    <FindingDrawer
      v-if="detailA11yViolation"
      :title="detailA11yViolation.help"
      :severity="detailA11yViolation.impact"
      :tasked="a11yTaskRules.has(detailA11yViolation.id)"
      @close="detailA11yViolation = null"
      @create-task="onCreateA11yTask(detailA11yViolation!)"
    >
      <div class="fd-detail-section"><span class="fd-detail-label">Rule</span><span class="fd-detail-value">{{ detailA11yViolation.id }}</span></div>
      <div class="fd-detail-section"><span class="fd-detail-label">Impact</span><span class="fd-detail-value">{{ detailA11yViolation.impact }}</span></div>
      <div class="fd-detail-section"><span class="fd-detail-label">Description</span><p class="fd-detail-text">{{ detailA11yViolation.description }}</p></div>
      <div v-if="detailA11yViolation.elements && detailA11yViolation.elements.length" class="fd-detail-section">
        <span class="fd-detail-label">Affected Elements ({{ detailA11yViolation.nodes }})</span>
        <div v-for="(el, i) in detailA11yViolation.elements" :key="i" class="fd-a11y-element">
          <code class="fd-a11y-html">{{ el.html }}</code>
          <code v-if="el.target" class="fd-a11y-selector">{{ el.target }}</code>
          <p v-if="el.failureSummary" class="fd-a11y-fix">{{ el.failureSummary }}</p>
          <span v-if="el.file" class="fd-a11y-source">{{ el.file }}:{{ el.line }} &middot; {{ el.component }}</span>
        </div>
      </div>
      <div class="fd-detail-section">
        <span class="fd-detail-label">Learn More</span>
        <a :href="detailA11yViolation.helpUrl" target="_blank" rel="noopener" class="fd-link">{{ detailA11yViolation.helpUrl }}</a>
      </div>
    </FindingDrawer>

    <TaskDetailModal
      v-if="detailTask"
      :task="detailTask"
      @close="detailTaskId = null"
      @accept="(id) => { acceptTask(id); detailTaskId = null }"
      @deny="(id) => { denyingTaskId = id; denyFeedbackText = ''; detailTaskId = null }"
      @delete="(id) => { removeTaskAnnotations(id); restoredTaskIds.delete(id); taskSystem.deleteTask(id); detailTaskId = null }"
      @update="(id, fields) => { taskSystem.updateTaskStatus(id, detailTask!.status, undefined, fields) }"
      @reply="(id, answers) => { taskSystem.respondToAgent(id, answers) }"
    />

    <ConfirmDialog
      v-if="confirmDeleteTaskId"
      message="Delete this task? This cannot be undone."
      @confirm="executeDeleteTask"
      @cancel="confirmDeleteTaskId = null"
    />
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
.route-input {
  font-size: 11px; color: var(--text-muted); background: var(--surface-2);
  padding: 2px 8px; border-radius: 4px; border: 1px solid var(--border);
  font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace;
  outline: none; min-width: 80px; max-width: 200px;
}
.route-input:focus { border-color: var(--accent); color: var(--text); }
.canvas-area { flex: 1; position: relative; overflow: hidden; }
.canvas-area.viewport-active {
  display: flex; align-items: flex-start; justify-content: center;
  overflow: auto; background: #0a0a0a; padding: 16px;
}
.app-iframe { width: 100%; height: 100%; border: none; }
.canvas-area.viewport-active .app-iframe {
  flex-shrink: 0;
  border-radius: 6px;
  box-shadow: 0 0 0 1px var(--border), 0 4px 24px rgba(0,0,0,0.5);
}
.drawing-shield { position: absolute; inset: 0; z-index: 9999; }
.drawing-shield.arrow { cursor: crosshair; }
.drawing-shield.draw { cursor: crosshair; }

/* Highlights */
.highlight { position: fixed; pointer-events: none; z-index: 10000; border-radius: 2px; }
.highlight.hover { background: rgba(59,130,246,0.1); border: 1.5px solid rgba(59,130,246,0.5); }
.highlight.group { background: rgba(168,85,247,0.08); border: 1.5px dashed rgba(168,85,247,0.4); }
.highlight.select { background: rgba(59,130,246,0.08); border: 2px solid var(--accent); }
.highlight.task-element { background: rgba(59,130,246,0.08); border: 2px solid rgba(59,130,246,0.5); }

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
.changes-footer { border-top: 1px solid var(--border); flex-shrink: 0; padding: 8px 14px; }
.changes-list { max-height: 120px; overflow-y: auto; margin-bottom: 6px; }
.change-item { display: flex; align-items: center; gap: 6px; padding: 2px 0; font-size: 11px; }
.change-prop { color: var(--text-muted); font-family: monospace; }
.change-arrow { color: var(--text-muted); font-size: 10px; }
.change-val { color: #22c55e; font-family: monospace; }
.changes-actions { display: flex; align-items: center; gap: 6px; }
.changes-count { font-size: 10px; color: var(--text-muted); flex: 1; }
.changes-commit {
  padding: 4px 12px; font-size: 11px; font-weight: 600;
  background: var(--accent); color: white; border: none; border-radius: 5px; cursor: pointer;
}
.changes-commit:hover { opacity: 0.9; }
.changes-discard {
  padding: 4px 12px; font-size: 11px;
  background: var(--surface-2); color: var(--text-muted);
  border: 1px solid var(--border); border-radius: 5px; cursor: pointer;
}
.changes-discard:hover { background: var(--border); color: var(--text); }

/* Task cards in sidebar */
.task-card { padding: 8px; border: 1px solid var(--border); border-radius: 6px; margin-bottom: 6px; cursor: pointer; transition: border-color 0.12s; }
.task-card:hover { border-color: var(--text-muted); }
.task-card.in_progress { border-color: #3b82f6; }
.task-card.review { border-color: #f59e0b; }
.task-card.denied { border-color: #ef4444; }
.task-card-header { display: flex; align-items: center; gap: 6px; margin-bottom: 3px; }
.task-status-dot { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; }
.task-status-dot.pending { background: #71717a; }
.task-status-dot.in_progress { background: #3b82f6; }
.task-status-dot.review { background: #f59e0b; }
.task-status-dot.denied { background: #ef4444; }
.task-status-dot.needs_info { background: #a855f7; }
.task-status-dot.blocked { background: #f97316; }
.task-card-desc { font-size: 11px; color: var(--text); flex: 1; }
.task-card-md {
  max-height: 40px; overflow: hidden; line-height: 1.4;
  -webkit-mask-image: linear-gradient(to bottom, #000 60%, transparent 100%);
  mask-image: linear-gradient(to bottom, #000 60%, transparent 100%);
}
.task-card-md p { margin: 0; }
.task-card-md pre, .task-card-md blockquote, .task-card-md ul, .task-card-md ol { margin: 2px 0; }
.task-card-md code { font-size: 10px; background: var(--surface-2); padding: 0 3px; border-radius: 2px; }
.task-card-close { width: 16px; height: 16px; border: none; background: none; color: var(--text-muted); font-size: 13px; cursor: pointer; padding: 0; display: flex; align-items: center; justify-content: center; border-radius: 3px; }
.task-card-close:hover { color: #ef4444; background: rgba(239,68,68,0.1); }
.task-card-meta { display: flex; align-items: center; gap: 6px; }
.task-card-file { font-size: 9px; color: var(--text-muted); }
.task-route-badge { font-size: 8px; padding: 1px 5px; background: rgba(59,130,246,0.12); color: #60a5fa; border-radius: 3px; font-weight: 600; }
.task-card-feedback { font-size: 10px; color: #ef4444; font-style: italic; margin-top: 3px; }
.task-card-resolution {
  font-size: 10px; color: #86efac; margin-bottom: 4px; padding: 3px 8px;
  background: rgba(34,197,94,0.08); border-radius: 4px; border-left: 2px solid #22c55e;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.task-card-agent-q {
  font-size: 10px; color: #a5b4fc; margin-top: 3px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.task-card-blocked {
  font-size: 10px; color: #fb923c; margin-top: 3px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
/* New task form */
.new-task-toggle {
  margin-left: auto; padding: 2px 8px; font-size: 10px; font-weight: 600;
  background: var(--accent); color: white; border: none; border-radius: 4px; cursor: pointer;
}
.new-task-toggle:hover { opacity: 0.9; }
.new-task-toggle.json-toggle { background: var(--surface-2); color: var(--text-muted); border: 1px solid var(--border); }
.new-task-toggle.json-toggle.active { background: var(--accent); color: white; border-color: var(--accent); }
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

.task-card-actions { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 6px; align-items: center; }
.deny-form { display: flex; flex-direction: column; gap: 6px; width: 100%; }
.deny-feedback-textarea {
  width: 100%; padding: 6px 8px; font-size: 11px;
  background: var(--bg); border: 1px solid #ef4444; border-radius: 5px;
  color: var(--text); outline: none; resize: vertical; font-family: inherit; line-height: 1.4;
}
.deny-feedback-textarea:focus { box-shadow: 0 0 0 2px rgba(239,68,68,0.2); }
.deny-form-actions { display: flex; gap: 4px; align-items: center; }
.task-card-actions .task-accept, .task-card-actions .task-deny {
  flex: 1; padding: 5px 0; font-size: 11px; font-weight: 600;
  border: none; border-radius: 5px; cursor: pointer; transition: all 0.12s;
  display: flex; align-items: center; justify-content: center; gap: 4px;
}
.task-card-actions .task-accept { background: rgba(34,197,94,0.15); color: #22c55e; }
.task-card-actions .task-accept:hover { background: #22c55e; color: white; }
.task-card-actions .task-deny { background: rgba(239,68,68,0.12); color: #ef4444; }
.task-card-actions .task-deny:hover { background: #ef4444; color: white; }
.task-send-feedback {
  flex: 1; padding: 5px 0; font-size: 11px; font-weight: 600;
  border: none; border-radius: 5px; cursor: pointer; transition: all 0.12s;
  background: rgba(161,161,170,0.15); color: #a1a1aa;
}
.task-send-feedback:hover:not(:disabled) { background: rgba(161,161,170,0.3); color: #d4d4d8; }
.task-send-feedback:disabled { opacity: 0.4; cursor: not-allowed; }

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
.pending-task-kind.highlight { color: #f59e0b; }
.pending-task-kind.highlight svg { stroke: #f59e0b; }
.pending-task-file { font-size: 11px; color: var(--text-muted); font-family: monospace; }
.pending-task-title { font-size: 11px; font-weight: 600; color: var(--text); margin-bottom: 4px; display: block; }
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

.task-toggles { display: flex; flex-direction: column; gap: 4px; margin-bottom: 4px; }

/* A11y panel */
.scan-btn { padding: 3px 10px; font-size: 10px; font-weight: 600; background: var(--accent); color: white; border: none; border-radius: 4px; cursor: pointer; }
.scan-btn:disabled { opacity: 0.5; cursor: default; }
.scan-btn:hover:not(:disabled) { opacity: 0.9; }
.a11y-error { font-size: 11px; color: #ef4444; padding: 6px 8px; background: rgba(239,68,68,0.1); border-radius: 5px; margin-bottom: 6px; }
.a11y-pass {
  display: flex; align-items: center; gap: 6px;
  padding: 8px 10px; border-radius: 6px; font-size: 11px; font-weight: 600;
  background: rgba(34, 197, 94, 0.12); color: #22c55e; border: 1px solid rgba(34, 197, 94, 0.25);
}
.a11y-empty { font-size: 11px; color: var(--text-muted); padding: 20px 0; text-align: center; }
.a11y-summary {
  font-size: 11px; font-weight: 600; color: #ef4444;
  padding: 6px 8px; border-radius: 5px; margin-bottom: 4px;
  background: rgba(239,68,68,0.08); border: 1px solid rgba(239,68,68,0.2);
}
.a11y-card {
  display: flex; align-items: center; gap: 6px;
  padding: 6px 8px; border-radius: 6px; margin-bottom: 4px;
  background: var(--surface-2); border-left: 3px solid var(--border);
  cursor: pointer; font-size: 11px;
}
.a11y-card:hover { background: var(--border); }
.a11y-card.critical { border-left-color: #dc2626; }
.a11y-card.serious { border-left-color: #ef4444; }
.a11y-card.moderate { border-left-color: #f59e0b; }
.a11y-card.minor { border-left-color: #6b7280; }
.a11y-impact {
  font-size: 9px; font-weight: 700; text-transform: uppercase; padding: 1px 5px;
  border-radius: 3px; color: white; flex-shrink: 0;
}
.a11y-impact.critical { background: #dc2626; }
.a11y-impact.serious { background: #ef4444; }
.a11y-impact.moderate { background: #f59e0b; }
.a11y-impact.minor { background: #6b7280; }
.a11y-rule { font-weight: 600; color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.a11y-count { color: var(--text-muted); font-size: 10px; flex-shrink: 0; }
.a11y-tasked-badge { font-size: 9px; color: #22c55e; margin-left: auto; flex-shrink: 0; }
.a11y-chevron { color: var(--text-muted); flex-shrink: 0; margin-left: auto; }
.a11y-tasked-badge + .a11y-chevron { margin-left: 0; }

/* Finding drawer detail styles */
.fd-detail-section { display: flex; flex-direction: column; gap: 4px; }
.fd-detail-label { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; color: #a1a1aa; }
.fd-detail-value { font-size: 13px; color: #fff; }
.fd-detail-text { font-size: 12px; color: #e4e4e7; line-height: 1.5; margin: 0; }
.fd-a11y-element { padding: 8px; background: var(--surface-2); border-radius: 6px; margin-top: 4px; display: flex; flex-direction: column; gap: 4px; }
.fd-a11y-html { font-size: 11px; color: #f59e0b; word-break: break-all; }
.fd-a11y-selector { font-size: 10px; color: #a1a1aa; }
.fd-a11y-fix { font-size: 11px; color: #fff; line-height: 1.4; margin: 0; }
.fd-a11y-source { font-size: 10px; color: var(--accent); }
.fd-link { font-size: 12px; color: var(--accent); text-decoration: none; word-break: break-all; }
.fd-link:hover { text-decoration: underline; }

/* Screenshot button and preview */
.screenshot-btn {
  width: 100%; padding: 5px; margin-top: 4px; font-size: 10px; font-weight: 600;
  background: var(--surface-2); color: var(--text-muted); border: 1px dashed var(--border);
  border-radius: 5px; cursor: pointer;
}
.screenshot-btn:hover { border-color: var(--accent); color: var(--accent); }
.screenshot-preview { position: relative; margin-top: 4px; }
.screenshot-thumb { width: 100%; border-radius: 4px; border: 1px solid var(--border); }
.screenshot-remove {
  position: absolute; top: 4px; right: 4px; width: 18px; height: 18px;
  border: none; border-radius: 50%; background: rgba(0,0,0,0.6); color: white;
  font-size: 14px; line-height: 1; cursor: pointer; display: flex; align-items: center; justify-content: center;
}
.screenshot-remove:hover { background: #ef4444; }

/* Snipping overlay — macOS-style: selected area clear, surroundings dimmed */
.snip-overlay {
  position: fixed; inset: 0; z-index: 20000;
  cursor: crosshair;
}
/* Dim the entire screen when no selection is drawn yet */
.snip-overlay:not(:has(.snip-selection)) {
  background: rgba(0, 0, 0, 0.4);
}
.snip-hint {
  position: absolute; top: 16px; left: 50%; transform: translateX(-50%);
  padding: 6px 14px; border-radius: 8px; font-size: 12px; font-weight: 600;
  background: rgba(0, 0, 0, 0.75); color: white; pointer-events: none;
  backdrop-filter: blur(4px); letter-spacing: 0.01em;
}
.snip-selection {
  position: fixed; z-index: 20001; pointer-events: none;
  border: 2px solid rgba(255, 255, 255, 0.8);
  border-radius: 2px;
  /* Giant box-shadow creates the dimmed surround — the selection stays clear */
  box-shadow: 0 0 0 9999px rgba(0, 0, 0, 0.45);
}
.snip-size-label {
  position: absolute; bottom: -24px; left: 50%; transform: translateX(-50%);
  padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 600;
  background: rgba(0, 0, 0, 0.75); color: white; white-space: nowrap;
  font-variant-numeric: tabular-nums;
}

/* Task screenshot thumbnail */
.task-screenshot-thumb {
  width: 100%; border-radius: 4px; margin-top: 6px;
  border: 1px solid var(--border);
}
.history-toggle { display: flex; align-items: center; gap: 4px; font-size: 10px; color: var(--text-muted); cursor: pointer; white-space: nowrap; }
.history-toggle input { margin: 0; }
.history-toggle span { user-select: none; }

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
.shortcut-version {
  margin-top: 12px; padding-top: 8px; border-top: 1px solid var(--border);
  font-size: 10px; color: var(--text-muted); opacity: 0.6;
}
</style>
