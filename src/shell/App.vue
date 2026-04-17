<script setup lang="ts">
import { ref, watch } from 'vue'
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
import HelpOverlay from './components/HelpOverlay.vue'
import ContextOverlay from './components/ContextOverlay.vue'
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
const { shellView, perfSection, activePanel } = useShellNavigation({ interactionMode })
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
const designSection = ref<'tokens' | 'inspector'>('tokens')
const includeHistory = useLocalStorageBool('annotask:includeHistory', false)
const includeElementContext = useLocalStorageBool('annotask:includeElementContext', false)
const screenshots = useScreenshots(iframe)
const { snipActive, snipRect, pendingScreenshot, startSnip, onSnipDown, onSnipMove, onSnipUp, cancelSnip, removeScreenshot } = screenshots
const showThemeEditor = ref(false)
const helpSection = ref<'overview' | 'annotate' | 'design' | 'a11y' | 'perf'>('overview')
const {
  showShortcuts, showContext, showSettings,
  toggleShortcuts, toggleContext, toggleSettings,
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
  if (shellView.value === 'theme') {
    if (sel && !old) designSection.value = 'inspector'
    if (!sel && old) designSection.value = 'tokens'
  }
})

// A11y scanner (needs primarySelection and currentRoute)
const a11yScanner = useA11yScanner(iframe, taskSystem, primarySelection as any, currentRoute)
const { a11yViolations, a11yLoading, a11yError, a11yScanned, a11yTaskRules, scanA11y, createA11yTask } = a11yScanner
const detailA11yViolation = ref<A11yViolation | null>(null)
function onCreateA11yTask(v: A11yViolation) { createA11yTask(v); detailA11yViolation.value = null }

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
const { scheduleAutoScan } = useAutoScan({ shellView, perfSection, perfRecording, runPerfScan })

// ── Annotation rect refresh loop ──
const { taskElementRects, startAnnotationLoop } = useAnnotationRects({ iframe, annotations, taskSystem, normalizeRoute })

// ── Context Menu ──────────────────────────────────────
const contextMenu = ref({ visible: false, x: 0, y: 0 })


// ── Task Workflows composable ────────────────────────
const taskWorkflows = useTaskWorkflows({
  iframe, annotations, taskSystem, styleEditor, screenshots, viewport, interactionHistory,
  primarySelection, selectedEids, selectionRects, taskElementRects,
  includeHistory, includeElementContext, currentRoute, activePanel,
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
  showContext,
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
      :perf-section="perfSection"
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
      :show-context="showContext"
      :show-settings="showSettings"
      :show-shortcuts="showShortcuts"
      @update:shellView="shellView = $event"
      @update:interactionMode="interactionMode = $event"
      @update:arrowColor="arrowColor = $event"
      @update:highlightColor="highlightColor = $event"
      @set-active-panel="activePanel = $event"
      @toggle-tasks-panel="activePanel = activePanel === 'tasks' ? 'inspector' : 'tasks'"
      @switch-design-section="designSection = $event; activePanel = 'inspector'"
      @switch-perf-section="perfSection = $event"
      @toggle-layout-overlay="layoutOverlay.toggle()"
      @scan-a11y="scanA11y('page')"
      @start-perf-recording="startPerfRecording"
      @stop-perf-recording="stopPerfRecording"
      @run-perf-scan="runPerfScan"
      @navigate-iframe="navigateIframe"
      @toggle-context="toggleContext"
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

        <!-- Hover + selection overlays (editor and theme modes) -->
        <template v-if="shellView === 'editor' ? showMarkup.inspector : shellView === 'theme'">
          <div v-if="hoverRect" class="highlight hover"
            :style="{ left: hoverRect.x + 'px', top: hoverRect.y + 'px', width: hoverRect.width + 'px', height: hoverRect.height + 'px' }">
            <div v-if="hoverInfo" class="hover-label">
              <span class="hover-tag">&lt;{{ hoverInfo.tag }}&gt;</span>
              <span v-if="hoverInfo.component" class="hover-comp">{{ hoverInfo.component }}</span>
            </div>
          </div>
          <div v-for="(rect, i) in groupRects" :key="'g' + i" class="highlight group"
            :style="{ left: rect.x + 'px', top: rect.y + 'px', width: rect.width + 'px', height: rect.height + 'px' }" />
          <div v-for="(rect, i) in selectionRects" :key="'s' + i" class="highlight select"
            :style="{ left: rect.x + 'px', top: rect.y + 'px', width: rect.width + 'px', height: rect.height + 'px' }">
            <div v-if="i === 0 && primarySelection" class="select-label">
              &lt;{{ primarySelection.tagName }}&gt; · {{ primarySelection.component }}
            </div>
          </div>
        </template>

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

      <!-- Design panel (theme view) -->
      <aside v-if="shellView === 'theme' && activePanel !== 'tasks'" class="theme-panel">
        <DesignPanel
          :section="designSection"
          :iframeRef="iframeRef"
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
        @update:pendingTaskText="pendingTaskText = $event"
        @update:includeHistory="includeHistory = $event"
        @update:includeElementContext="includeElementContext = $event"
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
        @update:showReportPanel="showReportPanel = $event"
        @update:newTaskText="newTaskText = $event"
        @update:denyFeedbackText="denyFeedbackText = $event"
        @update:includeHistory="includeHistory = $event"
        @update:includeElementContext="includeElementContext = $event"
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

      <!-- A11y Panel -->
      <A11yPanel v-else-if="shellView === 'a11y'"
        :a11y-violations="a11yViolations"
        :a11y-loading="a11yLoading"
        :a11y-error="a11yError"
        :a11y-scanned="a11yScanned"
        :a11y-task-rules="a11yTaskRules"
        @select-violation="detailA11yViolation = $event"
      />

      <!-- Audit Panel (perf vitals / errors) -->
      <AuditPanel v-else-if="shellView === 'perf'"
        :perf-section="perfSection"
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

      <!-- Full-screen overlays -->
      <HelpOverlay v-if="showShortcuts"
        :help-section="helpSection"
        :annotask-version="annotaskVersion"
        @update:helpSection="helpSection = $event"
      />

      <ContextOverlay v-if="showContext" @close="showContext = false" />

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
</style>
