<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useStyleEditor } from './composables/useStyleEditor'
import { useInteractionMode } from './composables/useInteractionMode'
import { useDesignSpec } from './composables/useDesignSpec'
import { useLayoutOverlay } from './composables/useLayoutOverlay'
import { useAnnotations } from './composables/useAnnotations'
import { useIframeManager } from './composables/useIframeManager'
import { useCanvasDrawing } from './composables/useCanvasDrawing'
import { useScreenshots } from './composables/useScreenshots'
import { useKeyboardShortcuts } from './composables/useKeyboardShortcuts'
import { useA11yScanner } from './composables/useA11yScanner'
import { usePerfMonitor } from './composables/usePerfMonitor'
import { useErrorMonitor } from './composables/useErrorMonitor'
import type { A11yViolation } from './composables/useA11yScanner'
// Annotation overlays (still used inline in canvas area)
import PinOverlay from './components/PinOverlay.vue'
import ArrowOverlay from './components/ArrowOverlay.vue'
import DrawnSectionOverlay from './components/DrawnSectionOverlay.vue'
import TextHighlightOverlay from './components/TextHighlightOverlay.vue'
import LayoutOverlay from './components/LayoutOverlay.vue'
// Panels + Overlays + Modals (extracted components)
import AppToolbar from './components/AppToolbar.vue'
import AppBanners from './components/AppBanners.vue'
import SnippingOverlay from './components/SnippingOverlay.vue'
import DesignPanel from './components/DesignPanel.vue'
import PendingTaskPanel from './components/PendingTaskPanel.vue'
import TasksPanel from './components/TasksPanel.vue'
import A11yPanel from './components/A11yPanel.vue'
import AuditPanel from './components/AuditPanel.vue'
import DataSourcesPage from './components/DataSourcesPage.vue'
import ComponentsPage from './components/ComponentsPage.vue'
import HelpOverlay from './components/HelpOverlay.vue'
import SettingsOverlay from './components/SettingsOverlay.vue'
import A11yDetailDrawer from './components/A11yDetailDrawer.vue'
import ContextMenu from './components/ContextMenu.vue'
import ReportViewer from './components/ReportViewer.vue'
import TaskDetailModal from './components/TaskDetailModal.vue'
import ConfirmDialog from './components/ConfirmDialog.vue'
import { useTasks } from './composables/useTasks'
import { useViewportPreview } from './composables/useViewportPreview'
import { useInteractionHistory } from './composables/useInteractionHistory'
import { useAnnotationRects } from './composables/useAnnotationRects'
import { useDataHighlights } from './composables/useDataHighlights'
import { useA11yHighlights } from './composables/useA11yHighlights'
import { useTabOrderOverlay } from './composables/useTabOrderOverlay'
import TabOrderOverlay from './components/TabOrderOverlay.vue'
import type { TabOrderBadge } from './composables/useTabOrderOverlay'
import { attachDataHighlights } from './composables/useDataSources'
import { attachComponentsHighlights } from './composables/useProjectComponents'
import { useSelectionModel } from './composables/useSelectionModel'
import { useTaskWorkflows } from './composables/useTaskWorkflows'
import { useShellTheme } from './composables/useShellTheme'
import { useChangeHistory } from './composables/useChangeHistory'
import { useLocalStorageRef, useLocalStorageBool } from './composables/useLocalStorageRef'
import { useShellNavigation } from './composables/useShellNavigation'
import { useOverlayToggles } from './composables/useOverlayToggles'
import { useAutoScan } from './composables/useAutoScan'
import { useBridgeEventHandlers } from './composables/useBridgeEventHandlers'
import { useShellLifecycle } from './composables/useShellLifecycle'
import { useInteractionModeSync } from './composables/useInteractionModeSync'
import { normalizeRoute } from './utils/routes'
import { navigateIframe as navigateIframeUtil, useAppUrl, useIframeStyle } from './utils/iframeNavigation'

const shellTheme = useShellTheme()

const styleEditor = useStyleEditor()

const annotations = useAnnotations()
const taskSystem = useTasks()
const viewport = useViewportPreview()
const interactionHistory = useInteractionHistory()

// ── State ──────────────────────────────────────────────
const iframeRef = ref<HTMLIFrameElement | null>(null)
const { mode: interactionMode } = useInteractionMode()
const { isInitialized: configInitialized } = useDesignSpec()
const { shellView, designSection, developSection, activePanel } = useShellNavigation({ interactionMode })
const layoutOverlay = useLayoutOverlay(iframeRef)
const iframe = useIframeManager(iframeRef)
const { currentRoute } = iframe
const arrowColor = useLocalStorageRef('annotask:arrowColor', '#ef4444')
const highlightColor = useLocalStorageRef('annotask:highlightColor', '#f59e0b')
const canvas = useCanvasDrawing(annotations, (x: number, y: number) => iframe.resolveElementAt(x, y), () => interactionMode.value, (arrowId, fromCtx, toCtx) => onArrowCreated(arrowId, fromCtx, toCtx), () => arrowColor.value, () => discardUncommittedAnnotations())
const { drawingArrow, drawingRect, hoverElement: arrowHoverElement, onCanvasPointerDown, onCanvasPointerMove, onCanvasPointerUp } = canvas

const showWarning = ref(false)
const showReportPanel = ref(false)
const annotaskVersion = typeof __ANNOTASK_VERSION__ !== 'undefined' ? __ANNOTASK_VERSION__ : 'dev'
// Markup visibility toggles
const showMarkup = ref({ pins: true, arrows: true, sections: true, highlights: true, inspector: true })
const includeHistory = useLocalStorageBool('annotask:includeHistory', false)
const includeElementContext = useLocalStorageBool('annotask:includeElementContext', false)
const includeDataContext = useLocalStorageBool('annotask:includeDataContext', false)
const screenshots = useScreenshots(iframe)
const { snipActive, snipRect, pendingScreenshot, startSnip, onSnipDown, onSnipMove, onSnipUp, cancelSnip, removeScreenshot } = screenshots
const showThemeEditor = ref(false)
const helpSection = ref<'overview' | 'annotate' | 'design' | 'audit' | 'context' | 'tasks' | 'agent' | 'skills' | 'apply-skill' | 'init-skill' | 'settings'>('overview')
const {
  showShortcuts, showSettings,
  toggleShortcuts, toggleSettings,
} = useOverlayToggles()



// ── Selection Model ────────────────────────────────────
const selection = useSelectionModel(iframe, styleEditor)
const {
  primarySelection, selectedEids, templateGroupEids, applyToGroup,
  selectionRects, groupRects,
  selectionSummary, selectedElementRole,
  liveStyles, editingClasses,
  hoverRect, hoverInfo,
  readLiveStyles, refreshRects, refreshElementRole,
  onStyleChange, applyClassChange,
  clearSelection,
} = selection

watch(primarySelection, (sel, old) => {
  // Only auto-toggle between tokens and inspector. Components sub-section is
  // user-driven and shouldn't be hijacked by a selection change.
  if (shellView.value === 'design' && designSection.value !== 'components') {
    if (sel && !old) designSection.value = 'inspector'
    if (!sel && old) designSection.value = 'tokens'
  }
})

// Hover/selection label formatting. A PascalCase component gets shown in
// angle brackets (e.g. `<Button>`) with its enclosing component as the
// suffix (`<Button> · App`). Plain HTML elements inside a regular template
// fall back to the tag form (`<span> · App`).
function formatElementLabel(info: { tag: string; component: string; source_tag?: string; parent_component?: string } | null): { bracket: string; suffix: string } {
  if (!info) return { bracket: '', suffix: '' }
  const isPascal = (s?: string) => !!s && /^[A-Z]/.test(s)
  // Preferred: data-annotask-source-tag is the JSX/template tag name as written
  // in source — "Button", "Flex", "PlanetCard". When it's PascalCase it identifies
  // a component invocation, even in frameworks (like React) where the rendered
  // DOM element doesn't carry a distinct data-annotask-component.
  if (isPascal(info.source_tag) && info.source_tag !== info.tag) {
    return { bracket: info.source_tag as string, suffix: info.component || '' }
  }
  // Fallback: element is the root of a custom component in frameworks that
  // forward attrs across component boundaries (Vue). Recognize by a different
  // PascalCase component on the ancestor chain.
  if (isPascal(info.component) && isPascal(info.parent_component) && info.parent_component !== info.component) {
    return { bracket: info.component, suffix: info.parent_component as string }
  }
  return { bracket: info.tag, suffix: info.component || '' }
}

const hoverLabel = computed(() => formatElementLabel(hoverInfo.value))
const selectLabel = computed(() => {
  const s = primarySelection.value
  return s ? formatElementLabel({ tag: s.tagName, component: s.component, source_tag: s.sourceTag, parent_component: s.parentComponent }) : { bracket: '', suffix: '' }
})

// ── Data context probe on selection change ─────────────
// When the selected element lives in a file that references data (hooks,
// stores, fetch calls, etc.), we expose the "Include data context" toggle
// and auto-check it. When no data is detected, the toggle is hidden.
import { probeForSelection, type DataContextProbeResult } from './services/dataContextClient'
const dataContextProbe = ref<DataContextProbeResult | null>(null)
let dataContextProbeTimer: ReturnType<typeof setTimeout> | null = null
let dataContextProbeToken = 0
let lastProbedFile: string | null = null
watch(primarySelection, (sel) => {
  const file = sel?.file || ''
  if (!file) {
    if (dataContextProbeTimer) { clearTimeout(dataContextProbeTimer); dataContextProbeTimer = null }
    dataContextProbe.value = null
    lastProbedFile = null
    return
  }
  // Dedupe: clicking different elements in the same file should not re-probe.
  // The server also caches by (file, mtime), but skipping the round-trip keeps
  // the UX snappier and avoids filling the devtools network log with noise.
  if (file === lastProbedFile) return
  if (dataContextProbeTimer) clearTimeout(dataContextProbeTimer)
  const token = ++dataContextProbeToken
  dataContextProbeTimer = setTimeout(async () => {
    const result = await probeForSelection(file)
    if (token !== dataContextProbeToken) return  // selection moved on while probing
    lastProbedFile = file
    dataContextProbe.value = result
    // Auto-check on transition to hasData:true; only auto-uncheck when it
    // transitions to hasData:false (respects an explicit user uncheck within
    // the same truthy window).
    if (result?.hasData) {
      if (!includeDataContext.value) includeDataContext.value = true
    } else {
      includeDataContext.value = false
    }
  }, 150)
})

// A11y scanner (needs primarySelection and currentRoute)
const a11yScanner = useA11yScanner(iframe, taskSystem, primarySelection as any, currentRoute)
const { a11yViolations, a11yLoading, a11yError, a11yScanned, a11yTaskRules, scanA11y, createA11yTask } = a11yScanner
const detailA11yViolation = ref<A11yViolation | null>(null)
function onCreateA11yTask(v: A11yViolation) { createA11yTask(v); detailA11yViolation.value = null }

// A11y violation overlays — only render when the user is on the Audit > A11y view.
// Lifecycle is tied to the scan: when violations clear (rescan / route change /
// panel reset), the overlays clear automatically via the composable's watchers.
const a11yHighlightActive = computed(() => shellView.value === 'develop' && developSection.value === 'a11y')
const a11yFocusedRule = ref<string | null>(null)
const a11yHighlights = useA11yHighlights({ iframe, violations: a11yViolations, active: a11yHighlightActive, focusedRule: a11yFocusedRule })
function onSelectA11yViolation(v: A11yViolation) {
  detailA11yViolation.value = v
  // Pull the user's eye to where the violation lives. We pick the first
  // resolved overlay rect for this rule; if the rect loop hasn't caught up
  // yet, the panel hover already set focusedRule so the user can locate it.
  const hit = a11yHighlights.rects.value.find(r => r.ruleId === v.id)
  if (hit) iframe.scrollIntoView(hit.eid)
}
// Clear focus when leaving the panel so dim/focused state doesn't leak into
// the next scan.
watch(a11yHighlightActive, (v) => { if (!v) a11yFocusedRule.value = null })

// Tab/focus order overlay — opt-in, toggled from the A11y panel header.
const tabOrder = useTabOrderOverlay({ iframe, active: a11yHighlightActive })
async function createTabOrderTask(b: TabOrderBadge) {
  const colorScheme = await iframe.getColorScheme()
  const elementContext = await iframe.getElementContext(b.eid)
  await taskSystem.createTask({
    type: 'a11y_fix',
    description: `Fix tab order: ${b.reason || 'tab/visual order mismatch'}`,
    file: '',
    line: 0,
    component: '',
    route: currentRoute.value,
    ...(colorScheme ? { color_scheme: colorScheme } : {}),
    ...(elementContext ? { element_context: elementContext } : {}),
    context: {
      rule: 'tab-order',
      impact: b.flag === 'positive' ? 'serious' : 'moderate',
      description: 'Synthetic finding from Annotask tab-order overlay (not from axe).',
      help: b.reason || 'Tab order does not match expected DOM/visual flow.',
      helpUrl: 'https://www.w3.org/WAI/WCAG21/Understanding/focus-order.html',
      affected_elements: 1,
      tab_order: { index: b.index, tabindex: b.tabindex, flag: b.flag, dom_order: b.domOrder },
      elements: [{
        html: '',
        selector: '',
        fix: b.reason,
        a11y: {
          eid: b.eid,
          tag: b.tag,
          accessible_name: b.accessible_name,
          name_source: 'text',
          role: b.role,
          role_source: 'implicit',
          tabindex: b.tabindex,
          focusable: true,
          focus_indicator: 'unknown',
          aria_attrs: [],
        },
      }],
    },
  })
}

const errorMonitor = useErrorMonitor(iframe, taskSystem, currentRoute)
const { errorCount, warnCount, paused: errorsPaused, clearErrors, createErrorTask } = errorMonitor

const perfMonitor = usePerfMonitor(iframe, taskSystem, currentRoute)
const { recording: perfRecording, scanLoading: perfScanLoading, perfFindings,
        startRecording, stopRecording: stopPerfRecording, scanPerf: runPerfScan, createPerfTask } = perfMonitor
function startPerfRecording() {
  interactionMode.value = 'interact'
  startRecording()
}

// ── Auto-scan on navigation ──────────────────────────
const { scheduleAutoScan } = useAutoScan({ shellView, developSection, perfRecording, runPerfScan })

// ── Annotation rect refresh loop ──
const { taskElementRects, startAnnotationLoop } = useAnnotationRects({ iframe, annotations, taskSystem, normalizeRoute })

// ── Data view highlights ──
// Active on Develop > Data and Design > Components — both surfaces overlay the
// iframe with source-coloured rectangles driven by the shared attach adapters.
const dataHighlightActive = computed(() =>
  (shellView.value === 'develop' && developSection.value === 'data') ||
  (shellView.value === 'design' && designSection.value === 'components'))
const dataHighlights = useDataHighlights({ iframe, active: dataHighlightActive })

function rectClass(h: { eid: string; sourceName: string }) {
  const fEid = dataHighlights.focusedEid.value
  const fName = dataHighlights.focusedName.value
  const isFocused = fEid ? fEid === h.eid : fName === h.sourceName
  const hasFocus = !!(fEid || fName)
  return {
    focused: isFocused,
    dimmed: hasFocus && !isFocused,
    'hover-only': shellView.value === 'design' && designSection.value === 'components',
  }
}
const sharedAdapter = {
  setSources: dataHighlights.setSources,
  setFocus: dataHighlights.setFocus,
  clear: dataHighlights.clear,
}
attachDataHighlights(sharedAdapter)
attachComponentsHighlights(sharedAdapter)

// Iframe-hover tooltip for the Data view. The iframe's client script emits
// `data:hover` events (gated by a `data:watch` toggle the shell sends). This
// avoids direct contentDocument access and survives iframe navigations.
const dataTooltip = ref<{ x: number; y: number; label: string; color: string } | null>(null)

interface DataHoverPayload { file: string; line: string | number; tag?: string; clientX: number; clientY: number }

iframe.onBridgeEvent('data:hover', (payload: DataHoverPayload) => {
  if (!dataHighlightActive.value) {
    dataTooltip.value = null
    dataHighlights.setFocus(null)
    return
  }
  const file = payload?.file ?? ''
  if (!file) {
    dataTooltip.value = null
    dataHighlights.setFocus(null)
    return
  }
  const lineNum = typeof payload.line === 'number' ? payload.line : Number(payload.line) || 0
  const tag = payload?.tag ?? ''
  // Prefer tag-based match when available — multiple components can share
  // one file, so matching only on file+line (with line:0 wildcards) would
  // always pick the first-registered source. The iframe reports the hovered
  // element's `data-annotask-source-tag`, which uniquely identifies the
  // library component (or other tagged source) under the cursor.
  //
  // If a tag was reported but no source matches it, treat that as "hovering
  // something we don't track" and clear focus — don't fall back to the
  // line-match, which would otherwise light up whichever source happened to
  // be registered first in this file (the infamous "every hover = Badge").
  const rects = dataHighlights.rects.value
  let hit: typeof rects[number] | undefined
  if (tag) {
    hit = rects.find(r => r.file === file && r.sourceName === tag)
  } else {
    hit = rects.find(r => r.file === file && (r.line === lineNum || r.line === 0))
  }
  if (!hit) {
    dataTooltip.value = null
    dataHighlights.setFocus(null)
    return
  }
  const iframeEl = iframeRef.value
  const iframeRect = iframeEl?.getBoundingClientRect()
  const offX = iframeRect?.left ?? 0
  const offY = iframeRect?.top ?? 0
  dataTooltip.value = {
    x: offX + payload.clientX + 12,
    y: offY + payload.clientY + 14,
    label: hit.label,
    color: hit.color,
  }
  // Propagate focus so the matching row in the Components / Data list can
  // visually emphasize itself via `dataHighlights.focusedName`, and pin the
  // focused eid so only the specific instance under the cursor gets an
  // outline (other instances of the same component stay invisible).
  dataHighlights.setFocus(hit.sourceName, hit.eid)
})

// Toggle the iframe-side watcher whenever we enter / leave a data-highlight
// surface. Re-send on every bridgeReady (covers iframe reloads) and on every
// change to `dataHighlightActive`. Waits for bridge to be connected.
function pushDataWatch(): void {
  if (!iframe.bridgeReady.value) return
  iframe.sendBridgeMessage('data:watch', { enabled: dataHighlightActive.value })
}
watch(dataHighlightActive, (active) => {
  pushDataWatch()
  if (!active) dataTooltip.value = null
})
watch(() => iframe.bridgeReady.value, (ready) => {
  if (ready) pushDataWatch()
}, { immediate: true })

// ── Context Menu ──────────────────────────────────────
const contextMenu = ref({ visible: false, x: 0, y: 0 })


// ── Task Workflows composable ────────────────────────
const taskWorkflows = useTaskWorkflows({
  iframe, annotations, taskSystem, styleEditor, screenshots, viewport, interactionHistory,
  primarySelection, selectedEids, selectionRects, taskElementRects,
  includeHistory, includeElementContext, includeDataContext, dataContextProbe,
  currentRoute, activePanel,
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
  discardUncommittedAnnotations, removeTaskAnnotations, executeDeleteTask,
  acceptTask, submitDeny, submitNewTask,
  createRouteTask,
  onSectionSubmit,
  onArrowDragMove, onArrowDragEnd,
  describeElement, onArrowCreated,
  submitPendingTask, cancelPendingTask,
  restoreAnnotationsFromTasks, resolveSelectTaskEids,
} = taskWorkflows

// ── Change history (undo / clear / commit-as-task) ──
// Needs createRouteTask from taskWorkflows, so initialized after it.
const { selectionChanges, doUndo, doClearChanges, commitChangesAsTask } = useChangeHistory({
  styleEditor,
  iframe,
  primarySelection,
  selectedEids,
  templateGroupEids,
  selectedElementRole,
  shellView,
  readLiveStyles,
  createRouteTask,
})

// ── Bridge event handlers (needs doUndo from useChangeHistory) ──
const { setup: setupBridgeEvents } = useBridgeEventHandlers({
  iframe, iframeRef, annotations, interactionHistory, errorMonitor,
  interactionMode, shellView, highlightColor,
  primarySelection, selectedEids, templateGroupEids, applyToGroup,
  editingClasses, hoverRect, hoverInfo,
  readLiveStyles, refreshRects, refreshElementRole,
  pendingTaskCreation, pendingTaskText,
  describeElement, discardUncommittedAnnotations,
  restoreAnnotationsFromTasks, resolveSelectTaskEids,
  contextMenu, currentRoute,
  doUndo, scheduleAutoScan,
})

// ── Keyboard Shortcuts (composable handles mount/unmount) ──
useKeyboardShortcuts({
  snipActive,
  showReportPanel,
  showShortcuts,
  showSettings,
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

// ── Interaction mode sync ──────────────────────────────
// Placed here so pendingTaskCreation/pendingTaskText from useTaskWorkflows are available.
useInteractionModeSync({
  interactionMode, iframe,
  pendingTaskCreation, pendingTaskText,
  arrowHoverElement, hoverRect, hoverInfo,
  clearSelection, discardUncommittedAnnotations,
})

// ── Lifecycle (onMounted/onUnmounted) ─────────────────
useShellLifecycle({
  iframe, iframeRef, annotations, layoutOverlay, interactionMode, showWarning,
  setupBridgeEvents, restoreAnnotationsFromTasks, resolveSelectTaskEids, scheduleAutoScan,
})

// ── Iframe URL + styling ──────────────────────────────
const appUrl = useAppUrl()
const iframeStyle = useIframeStyle(viewport)
const navigateIframe = (route: string) => navigateIframeUtil(iframeRef, currentRoute, route)
</script>


<template>
  <div class="annotask-shell">
    <!-- Toolbar -->
    <AppToolbar
      :shell-view="shellView"
      :interaction-mode="interactionMode"
      :arrow-color="arrowColor"
      :highlight-color="highlightColor"
      :active-panel="activePanel"
      :design-section="designSection"
      :develop-section="developSection"
      :current-route="currentRoute"
      :layout-overlay-active="layoutOverlay.showOverlay.value"
      :a11y-loading="a11yLoading"
      :a11y-violations-count="a11yViolations.length"
      :perf-recording="perfRecording"
      :perf-scan-loading="perfScanLoading"
      :perf-findings-count="perfFindings.length"
      :error-count="errorCount"
      :warn-count="warnCount"
      :route-tasks-count="routeTasks.length"
      :show-settings="showSettings"
      :show-shortcuts="showShortcuts"
      @update:shellView="shellView = $event"
      @update:interactionMode="interactionMode = $event"
      @update:arrowColor="arrowColor = $event"
      @update:highlightColor="highlightColor = $event"
      @set-active-panel="activePanel = $event"
      @toggle-tasks-panel="activePanel = activePanel === 'tasks' ? 'inspector' : 'tasks'"
      @switch-design-section="designSection = $event; activePanel = 'inspector'"
      @switch-develop-section="developSection = $event; activePanel = 'inspector'"
      @toggle-layout-overlay="layoutOverlay.toggle()"
      @scan-a11y="activePanel = 'inspector'; scanA11y('page')"
      @start-perf-recording="startPerfRecording"
      @stop-perf-recording="stopPerfRecording"
      @run-perf-scan="runPerfScan"
      @navigate-iframe="navigateIframe"
      @toggle-settings="toggleSettings"
      @toggle-shortcuts="toggleShortcuts"
    />

    <!-- Banners -->
    <AppBanners :show-warning="showWarning" :config-initialized="configInitialized" />

    <!-- Snipping overlay -->
    <SnippingOverlay v-if="snipActive" :snip-rect="snipRect"
      @pointer-down="onSnipDown" @pointer-move="onSnipMove" @pointer-up="onSnipUp" @cancel="cancelSnip" />

    <!-- Main -->
    <div class="main">
      <!-- Canvas / iframe -->
      <div class="canvas-area" :class="{ 'viewport-active': !viewport.isFullWidth.value }"
        @pointerdown="shellView === 'editor' ? onCanvasPointerDown($event) : undefined"
        @pointermove="shellView === 'editor' ? onCanvasPointerMove($event) : undefined"
        @pointerup="shellView === 'editor' ? onCanvasPointerUp($event) : undefined">
        <iframe ref="iframeRef" :src="appUrl" class="app-iframe" :style="iframeStyle" />

        <!-- Hover + selection overlays (editor, design tokens/inspector) -->
        <template v-if="shellView === 'editor' ? showMarkup.inspector : (shellView === 'design' && designSection !== 'components')">
          <div v-if="hoverRect" class="highlight hover"
            :style="{ left: hoverRect.x + 'px', top: hoverRect.y + 'px', width: hoverRect.width + 'px', height: hoverRect.height + 'px' }">
            <div v-if="hoverInfo" class="hover-label">
              <span class="hover-tag">&lt;{{ hoverLabel.bracket }}&gt;</span>
              <span v-if="hoverLabel.suffix" class="hover-comp">{{ hoverLabel.suffix }}</span>
            </div>
          </div>
          <div v-for="(rect, i) in groupRects" :key="'g' + i" class="highlight group"
            :style="{ left: rect.x + 'px', top: rect.y + 'px', width: rect.width + 'px', height: rect.height + 'px' }" />
          <div v-for="(rect, i) in selectionRects" :key="'s' + i" class="highlight select"
            :style="{ left: rect.x + 'px', top: rect.y + 'px', width: rect.width + 'px', height: rect.height + 'px' }">
            <div v-if="i === 0 && primarySelection" class="select-label">
              &lt;{{ selectLabel.bracket }}&gt;<template v-if="selectLabel.suffix"> · {{ selectLabel.suffix }}</template>
            </div>
          </div>
        </template>

        <!-- Data/Components views: highlight elements sourced from the selected source(s).
             In the Components list, all on-page components are pre-registered
             so iframe-hover can light up list rows — but the rect itself should
             stay invisible until the user actually focuses one. The `hover-only`
             modifier flips the default opacity off for that case.

             Focus semantics:
             - `focusedEid` set   → only that specific rect is focused (iframe hover)
             - `focusedName` only → every rect with matching sourceName is focused (row hover / selection)
             - Neither             → nothing is focused, nothing is dimmed -->
        <template v-if="dataHighlightActive">
          <div v-for="h in dataHighlights.rects.value" :key="'dh-' + h.eid"
            class="highlight data-source"
            :class="rectClass(h)"
            :style="{
              left: h.rect.x + 'px', top: h.rect.y + 'px',
              width: h.rect.width + 'px', height: h.rect.height + 'px',
              '--hl-color': h.color,
            }" />
        </template>

        <!-- Audit > Accessibility: outline every violating element using the
             current scan's results. Color follows impact via --severity-* vars.
             Cleared automatically when violations reset (rescan / route change). -->
        <template v-if="a11yHighlightActive">
          <div v-for="h in a11yHighlights.rects.value" :key="'a11y-' + h.ruleId + '-' + h.eid"
            class="highlight a11y"
            :class="a11yHighlights.classFor(h)"
            :data-impact="h.impact"
            :style="{
              left: h.rect.x + 'px', top: h.rect.y + 'px',
              width: h.rect.width + 'px', height: h.rect.height + 'px',
            }" />
        </template>

        <!-- Tab/focus order overlay — numbered badges. Only rendered while
             the user has opted in via the panel toggle. -->
        <TabOrderOverlay v-if="a11yHighlightActive && tabOrder.enabled.value" :badges="tabOrder.badges.value" />

        <!-- Editor-only overlays -->
        <template v-if="shellView === 'editor'">
          <div v-if="interactionMode === 'arrow' || interactionMode === 'draw'" class="drawing-shield" :class="interactionMode" />
          <template v-if="interactionMode !== 'interact'">
            <div v-for="te in taskElementRects" :key="'te-' + te.taskId" class="highlight task-element"
              :style="{ left: te.rect.x + 'px', top: te.rect.y + 'px', width: te.rect.width + 'px', height: te.rect.height + 'px' }" />
            <PinOverlay v-if="showMarkup.pins"
              :pins="annotations.routePins.value"
              :selectedPinId="annotations.selectedPinId.value"
              :iframeOffset="{ x: iframeRef?.getBoundingClientRect()?.left || 0, y: iframeRef?.getBoundingClientRect()?.top || 0 }"
              @select-pin="id => { annotations.selectedPinId.value = id }"
              @remove-pin="annotations.removePin"
            />
            <ArrowOverlay v-if="showMarkup.arrows"
              :arrows="annotations.routeArrows.value"
              :selectedId="annotations.selectedArrowId.value"
              :drawingArrow="drawingArrow"
              :drawingColor="arrowColor"
              :hoverElement="arrowHoverElement"
              @select="annotations.selectedArrowId.value = $event"
              @remove="annotations.removeArrow"
              :dragTargetRect="arrowDragTargetRect"
              @update-arrow="(id, updates) => annotations.updateArrow(id, updates)"
              @drag-move="onArrowDragMove"
              @drag-end="onArrowDragEnd"
            />
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
            <TextHighlightOverlay v-if="showMarkup.highlights"
              :highlights="annotations.routeHighlights.value"
              :selectedId="annotations.selectedHighlightId.value"
              @select="annotations.selectedHighlightId.value = $event"
              @remove="annotations.removeHighlight"
              @update-prompt="(id, p) => annotations.updateHighlight(id, { prompt: p })"
            />
          </template>
        </template>

        <LayoutOverlay v-if="layoutOverlay.showOverlay.value" :containers="layoutOverlay.containers.value" />
      </div>

      <!-- Design panel (tokens/inspector sub-sections of the Design view) -->
      <aside v-if="shellView === 'design' && designSection !== 'components' && activePanel !== 'tasks'" class="theme-panel">
        <DesignPanel
          :section="designSection"
          :iframeRef="iframeRef"
          :iframe="iframe"
          :getColorScheme="iframe.getColorScheme"
          :primarySelection="primarySelection"
          :selectionSummary="selectionSummary"
          :selectedElementRole="selectedElementRole"
          :templateGroupEids="templateGroupEids"
          :selectedEids="selectedEids"
          :applyToGroup="applyToGroup"
          :liveStyles="liveStyles"
          :editingClasses="editingClasses"
          :changes="selectionChanges"
          @style-change="onStyleChange"
          @class-change="applyClassChange"
          @update:editingClasses="editingClasses = $event"
          @update:applyToGroup="applyToGroup = $event"
          @commit="commitChangesAsTask"
          @discard="doClearChanges"
        />
      </aside>

      <!-- Pending Task Panel (editor mode) -->
      <PendingTaskPanel v-if="shellView === 'editor' && pendingTaskCreation"
        :pending-task-creation="pendingTaskCreation"
        :pending-task-text="pendingTaskText"
        :selected-eids-count="selectedEids.length"
        :pending-screenshot="pendingScreenshot"
        :include-history="includeHistory"
        :include-element-context="includeElementContext"
        :include-data-context="includeDataContext"
        :data-context-probe="dataContextProbe"
        @update:pendingTaskText="pendingTaskText = $event"
        @update:includeHistory="includeHistory = $event"
        @update:includeElementContext="includeElementContext = $event"
        @update:includeDataContext="includeDataContext = $event"
        @submit="submitPendingTask"
        @cancel="cancelPendingTask"
        @start-snip="startSnip"
        @remove-screenshot="removeScreenshot"
      />

      <!-- Tasks Panel -->
      <TasksPanel v-else-if="activePanel === 'tasks'"
        :total-tasks="taskSystem.tasks.value.length"
        :route-tasks="routeTasks"
        :show-new-task-form="showNewTaskForm"
        :show-report-panel="showReportPanel"
        :new-task-text="newTaskText"
        :denying-task-id="denyingTaskId"
        :deny-feedback-text="denyFeedbackText"
        :pending-screenshot="pendingScreenshot"
        :include-history="includeHistory"
        :include-element-context="includeElementContext"
        :include-data-context="includeDataContext"
        :data-context-probe="dataContextProbe"
        @update:showReportPanel="showReportPanel = $event"
        @update:newTaskText="newTaskText = $event"
        @update:denyFeedbackText="denyFeedbackText = $event"
        @update:includeHistory="includeHistory = $event"
        @update:includeElementContext="includeElementContext = $event"
        @update:includeDataContext="includeDataContext = $event"
        @toggle-new-task="showNewTaskForm = !showNewTaskForm"
        @submit-new-task="submitNewTask"
        @cancel-new-task="showNewTaskForm = false; newTaskText = ''"
        @open-detail="detailTaskId = $event"
        @confirm-delete="confirmDeleteTaskId = $event"
        @accept="acceptTask"
        @start-deny="(id) => { denyingTaskId = id; denyFeedbackText = '' }"
        @submit-deny="submitDeny"
        @cancel-deny="denyingTaskId = null"
        @start-snip="startSnip"
        @remove-screenshot="removeScreenshot"
      />

      <!-- Audit > Data: sources + API schemas + api_update task creation -->
      <DataSourcesPage v-else-if="shellView === 'develop' && developSection === 'data'"
        key="data-sources-data"
        variant="data"
        :highlightRects="dataHighlights.rects.value"
      />

      <!-- Audit > Libraries: data-fetching and state libraries detected in package.json -->
      <DataSourcesPage v-else-if="shellView === 'develop' && developSection === 'libraries'"
        key="data-sources-libraries"
        variant="libraries"
        :highlightRects="dataHighlights.rects.value"
      />

      <!-- Design > Components: library components catalog -->
      <ComponentsPage v-else-if="shellView === 'design' && designSection === 'components'"
        :iframe="iframe"
        :highlightRects="dataHighlights.rects.value"
        :focusedName="dataHighlights.focusedName.value"
      />

      <!-- Audit > A11y panel -->
      <A11yPanel v-else-if="shellView === 'develop' && developSection === 'a11y'"
        :a11y-violations="a11yViolations"
        :a11y-loading="a11yLoading"
        :a11y-error="a11yError"
        :a11y-scanned="a11yScanned"
        :a11y-task-rules="a11yTaskRules"
        :focused-rule="a11yFocusedRule"
        :tab-order-enabled="tabOrder.enabled.value"
        :tab-order-loading="tabOrder.loading.value"
        :tab-order-badges="tabOrder.badges.value"
        @select-violation="onSelectA11yViolation"
        @focus-rule="a11yFocusedRule = $event"
        @toggle-tab-order="tabOrder.toggle()"
        @scroll-to="(eid) => iframe.scrollIntoView(eid)"
        @create-tab-order-task="createTabOrderTask"
      />

      <!-- Audit Panel (Develop > Performance or Errors) -->
      <AuditPanel v-else-if="shellView === 'develop' && (developSection === 'perf' || developSection === 'errors')"
        :perf-section="developSection === 'errors' ? 'errors' : 'vitals'"
        :perf-monitor="perfMonitor"
        :error-monitor="errorMonitor"
        @start-recording="startPerfRecording"
        @stop-recording="stopPerfRecording"
        @scan="runPerfScan"
        @create-perf-task="createPerfTask"
        @create-error-task="createErrorTask"
        @clear-errors="clearErrors"
        @toggle-errors-pause="errorsPaused = !errorsPaused"
      />

      <!-- Data/Components hover tooltip — shown when cursor is over a highlighted element -->
      <div v-if="dataTooltip && dataHighlightActive"
        class="data-hover-tooltip"
        :style="{
          left: dataTooltip.x + 'px',
          top: dataTooltip.y + 'px',
          '--tt-color': dataTooltip.color,
        }">
        <span class="data-hover-swatch" />
        <span class="data-hover-label">{{ dataTooltip.label }}</span>
      </div>

      <!-- Full-screen overlays -->
      <HelpOverlay v-if="showShortcuts"
        :help-section="helpSection"
        :annotask-version="annotaskVersion"
        @update:helpSection="helpSection = $event"
      />

      <SettingsOverlay v-if="showSettings"
        :shell-theme="shellTheme"
        :show-theme-editor="showThemeEditor"
        @close="showSettings = false"
        @update:showThemeEditor="showThemeEditor = $event"
      />
    </div>

    <!-- Context menu -->
    <ContextMenu v-bind="contextMenu" @close="contextMenu.visible = false" />

    <!-- Report viewer slide-out -->
    <ReportViewer v-if="showReportPanel" :tasks="taskSystem.tasks.value" @close="showReportPanel = false" />

    <!-- A11y Finding Detail -->
    <A11yDetailDrawer v-if="detailA11yViolation"
      :violation="detailA11yViolation"
      :tasked="a11yTaskRules.has(detailA11yViolation.id)"
      :iframe="iframe"
      @close="detailA11yViolation = null"
      @create-task="onCreateA11yTask(detailA11yViolation!)"
    />

    <!-- Task detail modal -->
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

/* Dark fallback — overridden at runtime by useShellTheme via style.setProperty() */
:root {
  /* Surfaces */
  --bg: #0a0a0a; --surface: #141414; --surface-2: #1e1e1e; --surface-3: #262626;
  --surface-elevated: #1a1a1a; --surface-glass: rgba(24,24,27,0.95); --surface-overlay: rgba(255,255,255,0.05);
  /* Borders */
  --border: #2a2a2a; --border-strong: #404040;
  /* Text */
  --text: #e4e4e7; --text-muted: #71717a; --text-on-accent: #fff; --text-inverse: #000; --text-link: #60a5fa;
  /* Accent */
  --accent: #3b82f6; --accent-hover: #2563eb; --accent-muted: rgba(59,130,246,0.15);
  /* Semantic */
  --danger: #ef4444; --success: #22c55e; --warning: #f59e0b; --info: #60a5fa; --focus-ring: #3b82f6;
  /* Extended palette */
  --purple: #a855f7; --orange: #f97316; --cyan: #22d3ee; --indigo: #6366f1;
  /* Utility */
  --overlay: rgba(0,0,0,0.5); --shadow: rgba(0,0,0,0.4);
  /* Status */
  --status-pending: #71717a; --status-in-progress: #3b82f6; --status-review: #f59e0b;
  --status-denied: #ef4444; --status-accepted: #22c55e; --status-needs-info: #a855f7; --status-blocked: #f97316;
  /* Severity */
  --severity-critical: #ef4444; --severity-serious: #ef4444; --severity-moderate: #f59e0b; --severity-minor: #71717a;
  /* Modes */
  --mode-interact: #6366f1; --mode-arrow: #ef4444; --mode-draw: #71717a; --mode-highlight: #f59e0b;
  /* Layout viz */
  --layout-flex: #a855f7; --layout-grid: #22c55e;
  /* Roles */
  --role-container: #22c55e; --role-content: #3b82f6; --role-component: #a855f7;
  /* Syntax */
  --syntax-property: #7dd3fc; --syntax-string: #86efac; --syntax-number: #fbbf24;
  --syntax-boolean: #c084fc; --syntax-null: #f87171; --syntax-operator: #71717a; --syntax-punctuation: #52525b;
  /* Tool overlays */
  --pin-color: #3b82f6; --highlight-color: #3b82f6;
  /* Annotations */
  --annotation-red: #ef4444; --annotation-orange: #f97316; --annotation-yellow: #eab308;
  --annotation-green: #22c55e; --annotation-blue: #3b82f6; --annotation-purple: #8b5cf6;
}

/* Light fallback — kept for safe first paint before JS runs */
:root.light {
  --bg: #f8f9fa; --surface: #ffffff; --surface-2: #f0f1f3; --surface-3: #e5e7eb;
  --surface-elevated: #ffffff; --surface-glass: rgba(255,255,255,0.95); --surface-overlay: rgba(0,0,0,0.04);
  --border: #d4d6db; --border-strong: #9ca3af;
  --text: #1a1a1a; --text-muted: #6b7280; --text-on-accent: #fff; --text-inverse: #fff; --text-link: #2563eb;
  --accent: #2563eb; --accent-hover: #1d4ed8; --accent-muted: rgba(37,99,235,0.12);
  --danger: #dc2626; --success: #16a34a; --warning: #d97706; --info: #2563eb; --focus-ring: #2563eb;
  --purple: #9333ea; --orange: #ea580c; --cyan: #0891b2; --indigo: #4f46e5;
  --overlay: rgba(0,0,0,0.3); --shadow: rgba(0,0,0,0.12);
  --status-pending: #6b7280; --status-in-progress: #2563eb; --status-review: #d97706;
  --status-denied: #dc2626; --status-accepted: #16a34a; --status-needs-info: #9333ea; --status-blocked: #ea580c;
  --severity-critical: #dc2626; --severity-serious: #dc2626; --severity-moderate: #d97706; --severity-minor: #6b7280;
  --mode-interact: #4f46e5; --mode-arrow: #dc2626; --mode-draw: #6b7280; --mode-highlight: #d97706;
  --layout-flex: #9333ea; --layout-grid: #16a34a;
  --role-container: #16a34a; --role-content: #2563eb; --role-component: #9333ea;
  --syntax-property: #0369a1; --syntax-string: #15803d; --syntax-number: #b45309;
  --syntax-boolean: #7e22ce; --syntax-null: #dc2626; --syntax-operator: #6b7280; --syntax-punctuation: #9ca3af;
  --pin-color: #2563eb; --highlight-color: #2563eb;
  --annotation-red: #dc2626; --annotation-orange: #ea580c; --annotation-yellow: #ca8a04;
  --annotation-green: #16a34a; --annotation-blue: #2563eb; --annotation-purple: #7c3aed;
}

html, body, #app { height: 100%; overflow: hidden; background: var(--bg); color: var(--text); font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; font-size: 13px; }

/* Custom scrollbars */
* { scrollbar-width: thin; scrollbar-color: var(--border) transparent; }
::-webkit-scrollbar { width: 6px; height: 6px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: var(--border); border-radius: 3px; }
::-webkit-scrollbar-thumb:hover { background: var(--text-muted); }
::-webkit-scrollbar-corner { background: transparent; }

.annotask-shell { display: flex; flex-direction: column; height: 100%; }

.data-hover-tooltip {
  position: fixed;
  z-index: 10001;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px 4px 6px;
  font-family: var(--font-mono, monospace);
  font-size: 11px;
  font-weight: 600;
  line-height: 14px;
  color: var(--text);
  background: var(--surface-elevated);
  border: 1.5px dashed var(--tt-color, var(--border));
  border-left: 3px solid var(--tt-color, var(--accent));
  border-radius: 4px;
  box-shadow:
    0 2px 10px var(--shadow),
    0 0 0 1px color-mix(in srgb, var(--tt-color, transparent) 30%, transparent);
  pointer-events: none;
  white-space: nowrap;
  max-width: 340px;
}
.data-hover-swatch {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 2px;
  background: var(--tt-color, var(--accent));
  flex-shrink: 0;
}
.data-hover-label {
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--tt-color, var(--text));
}
</style>
