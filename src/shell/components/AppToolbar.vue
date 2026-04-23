<template>
  <header class="toolbar">
    <div class="toolbar-left">
      <svg class="logo" viewBox="0 0 85.81 90.51" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
        <path d="m72.02 90.31c-.17-.1-.43-.48-.57-.82-.37-.93-1.97-3.46-2.74-4.33-.66-.74-.77-.79-5.99-2.5-2.93-.96-5.52-1.85-5.77-1.98-.47-.25-.35.01-4.7-9.99-1.1-2.53-2.11-4.72-2.25-4.87-.22-.24-1.7-.26-11.7-.21-6.3.03-11.51.12-11.58.19-.11.11-2.06 4.98-4.34 10.84-.4 1.04-1.21 3.11-1.8 4.6-.58 1.49-1.52 3.88-2.08 5.32-.64 1.65-1.18 2.76-1.45 3.02l-.44.41H8.31 0l.49-1.22c4.92-12.33 8.69-21.78 9.54-23.94 1.22-3.09 4.33-10.89 6.52-16.32.82-2.03 1.72-4.3 2-5.05.28-.74 1.17-2.97 1.97-4.96 2.26-5.6 3-7.45 4.7-11.72 2.32-5.86 5.17-13 7.63-19.11 1.2-2.98 2.29-5.73 2.44-6.13.15-.4.45-.9.68-1.13l.42-.41h8.22c4.57 0 8.4.07 8.63.17.49.19.22-.38 3.81 8.22 1.57 3.77 3 7.18 3.17 7.57.73 1.72 6 14.31 7.22 17.22 1.71 4.1 5.73 13.7 6 14.34.17.4.66 1.58 1.09 2.61.43 1.04 1.63 3.94 2.68 6.46 1.05 2.51 1.9 4.63 1.9 4.71 0 .08-.14.2-.3.27-.17.07-2.89 1.13-6.05 2.37-3.16 1.23-6.39 2.5-7.17 2.81-.78.31-1.47.51-1.53.45-.06-.06-.47-1.07-.92-2.24-1.24-3.24-5.96-15.5-7.72-20.06-.86-2.23-2.45-6.33-3.52-9.11-1.07-2.78-2.93-7.6-4.14-10.73-1.2-3.12-2.4-6.25-2.67-6.94l-.48-1.26-.19.54c-.42 1.17-1.35 3.64-3.23 8.56-1.08 2.83-2.45 6.44-3.05 8.02-.6 1.59-2.24 5.89-3.65 9.56l-2.57 6.67 8.58.05 8.58.05.31.76c.17.42 1.14 2.91 2.16 5.54 6.49 16.81 6.66 17.24 6.88 17.18.08-.02 1.08-.41 2.21-.87 1.13-.46 3.45-1.39 5.15-2.06 5.12-2.03 14.4-5.73 14.68-5.85.14-.06.39-.01.55.12.32.25 2.19 4.68 2.19 5.19 0 .18-.14.48-.3.68-.27.32-5.46 2.61-10.94 4.83-4.74 1.92-6.58 2.65-7.29 2.92l-.77.29 1.94.34 1.94.34.77-.38c1.61-.79 3.36-1.45 7.27-2.71 2.22-.72 4.1-1.32 4.19-1.33.16-.02.94 1.75 2.24 5.12.41 1.04 1.36 3.49 2.13 5.45.77 1.96 1.39 3.71 1.39 3.89 0 .75-.14.76-6.94.76-4.33 0-6.64-.07-6.85-.2z" />
      </svg>

      <!-- Top-level view toggle (Annotate / Design / Audit) -->
      <div class="view-toggle" data-testid="shell-view-toggle">
        <button v-for="view in viewItems" :key="view.id"
          :data-testid="view.testid"
          :class="['toggle-btn', { active: shellView === view.id }]"
          @click="$emit('update:shellView', view.id)" :title="view.title">
          <Icon :name="view.icon" :size="12" />
          {{ view.label }}
          <span v-if="view.badge && view.badgeCount" class="toggle-badge">{{ view.badgeCount }}</span>
        </button>
      </div>

      <!-- Editor toolbar -->
      <template v-if="shellView === 'editor'">
        <ModeToolbar :modelValue="interactionMode" @update:modelValue="$emit('update:interactionMode', $event)" />
        <ArrowColorPicker v-if="interactionMode === 'arrow'" :modelValue="arrowColor" @update:modelValue="$emit('update:arrowColor', $event)" />
        <ArrowColorPicker v-if="interactionMode === 'highlight'" :modelValue="highlightColor" @update:modelValue="$emit('update:highlightColor', $event)" />
      </template>

      <!-- Design view mode/layout toggles -->
      <template v-else-if="shellView === 'design'">
        <div class="mode-toolbar">
          <button :class="['mode-btn mode-interact', { active: interactionMode === 'interact' }]"
            @click="$emit('update:interactionMode', 'interact')" title="Interact (I)">
            <Icon name="mouse-pointer" :stroke-width="2.5" />
          </button>
          <button :class="['mode-btn mode-select', { active: interactionMode === 'select' }]"
            @click="onInspectClick" title="Inspect (V)">
            <Icon name="search" />
          </button>
        </div>
        <button v-if="designSection !== 'components'"
          :class="['tool-btn', { active: layoutOverlayActive }]" @click="$emit('toggle-layout-overlay')" title="Show Layout (L)">
          <Icon name="layout-dashboard" />
        </button>
      </template>

      <!-- Audit > A11y scan button -->
      <template v-else-if="shellView === 'develop' && developSection === 'a11y'">
        <button data-testid="btn-scan-a11y" class="tool-btn" :disabled="a11yLoading" @click="$emit('scan-a11y')"
          title="Run axe-core WCAG accessibility scan on the page">
          {{ a11yLoading ? 'Scanning...' : '⟳ Scan page' }}
        </button>
        <button
          data-testid="btn-tab-order"
          class="tool-btn"
          :class="{ active: tabOrderEnabled }"
          :disabled="tabOrderLoading"
          @click="$emit('toggle-tab-order')"
          :title="tabOrderEnabled ? 'Hide tab order' : 'Show numbered tab order on page'"
        >
          {{ tabOrderEnabled ? '✕ Tab order' : '⌨ Tab order' }}
        </button>
      </template>

      <!-- Audit > Performance record/scan -->
      <template v-else-if="shellView === 'develop' && developSection === 'perf'">
        <button v-if="!perfRecording" data-testid="btn-record-perf" class="rec-btn" @click="$emit('start-perf-recording')" title="Record a performance session">
          <span class="rec-dot"></span> Record
        </button>
        <button v-else data-testid="btn-stop-perf" class="rec-btn recording" @click="$emit('stop-perf-recording')" title="Stop recording">
          <span class="rec-dot active"></span> Stop
        </button>
        <button data-testid="btn-scan-perf" class="scan-btn" :disabled="perfScanLoading || perfRecording" @click="$emit('run-perf-scan')"
          title="Scan page performance">
          {{ perfScanLoading ? 'Scanning...' : 'Scan' }}
        </button>
      </template>
    </div>

    <!-- Toolbar center (viewport + route input) -->
    <div class="toolbar-center">
      <ViewportSelector />
      <input data-testid="input-route" class="route-input" :value="currentRoute" title="Current route — edit to navigate"
        @keydown.enter="$emit('navigate-iframe', ($event.target as HTMLInputElement).value)"
        @blur="$emit('navigate-iframe', ($event.target as HTMLInputElement).value)" />
    </div>

    <!-- Toolbar right: view-specific sub-section switchers + Tasks + shared buttons -->
    <div class="toolbar-right">
      <!-- Editor panel toggles -->
      <template v-if="shellView === 'editor'">
        <div class="panel-toggle">
          <button data-testid="btn-tasks-panel" :class="['toggle-btn', { active: activePanel === 'tasks' }]"
            @click="$emit('toggle-tasks-panel')" title="View and manage design tasks for your AI agent (T)">
            <Icon name="clipboard-check" :size="12" />
            Tasks
            <span v-if="routeTasksCount" class="toggle-badge">{{ routeTasksCount }}</span>
          </button>
        </div>
      </template>

      <!-- Design sub-section: Tokens / Inspector / Components + Tasks -->
      <template v-else-if="shellView === 'design'">
        <div class="panel-toggle">
          <button data-testid="design-tokens" :class="['toggle-btn', { active: designSection === 'tokens' && activePanel !== 'tasks' }]"
            @click="$emit('switch-design-section', 'tokens')" title="Edit design tokens">
            <Icon name="sliders-horizontal" :size="12" />
            Tokens
          </button>
          <button data-testid="design-inspector" :class="['toggle-btn', { active: designSection === 'inspector' && activePanel !== 'tasks' }]"
            @click="$emit('switch-design-section', 'inspector')" title="Inspect element styles">
            <Icon name="search" :size="12" />
            Inspector
          </button>
          <button data-testid="design-components" :class="['toggle-btn', { active: designSection === 'components' && activePanel !== 'tasks' }]"
            @click="$emit('switch-design-section', 'components')" title="Browse project components">
            <Icon name="grid-2x2" :size="12" />
            Components
          </button>
          <button data-testid="btn-tasks-panel" :class="['toggle-btn', { active: activePanel === 'tasks' }]"
            @click="$emit('toggle-tasks-panel')" title="View and manage design tasks for your AI agent (T)">
            <Icon name="clipboard-check" :size="12" />
            Tasks
            <span v-if="routeTasksCount" class="toggle-badge">{{ routeTasksCount }}</span>
          </button>
        </div>
      </template>

      <!-- Audit sub-section: Accessibility / Data / Libraries / Performance / Errors + Tasks -->
      <template v-else-if="shellView === 'develop'">
        <div class="panel-toggle">
          <button data-testid="audit-a11y" :class="['toggle-btn', { active: developSection === 'a11y' && activePanel !== 'tasks' }]"
            @click="$emit('switch-develop-section', 'a11y')" title="Run accessibility checks (axe-core WCAG)">
            <Icon name="accessibility" :size="12" />
            Accessibility
            <span v-if="a11yViolationsCount" class="toggle-badge">{{ a11yViolationsCount }}</span>
          </button>
          <button data-testid="audit-data" :class="['toggle-btn', { active: developSection === 'data' && activePanel !== 'tasks' }]"
            @click="$emit('switch-develop-section', 'data')" title="Browse data sources and API schemas">
            <Icon name="database" :size="12" />
            Data
          </button>
          <button data-testid="audit-libraries" :class="['toggle-btn', { active: developSection === 'libraries' && activePanel !== 'tasks' }]"
            @click="$emit('switch-develop-section', 'libraries')" title="Browse detected data-fetching and state libraries">
            <Icon name="library" :size="12" />
            Libraries
          </button>
          <button data-testid="audit-perf" :class="['toggle-btn', { active: developSection === 'perf' && activePanel !== 'tasks' }]"
            @click="$emit('switch-develop-section', 'perf')" title="Web Vitals and page performance">
            <Icon name="activity" :size="12" />
            Performance
            <span v-if="perfFindingsCount" class="toggle-badge">{{ perfFindingsCount }}</span>
          </button>
          <button data-testid="audit-errors" :class="['toggle-btn', { active: developSection === 'errors' && activePanel !== 'tasks' }]"
            @click="$emit('switch-develop-section', 'errors')" title="Console errors and warnings">
            <Icon name="triangle-alert" :size="12" />
            Errors
            <span v-if="totalErrorsCount" class="toggle-badge error-badge">{{ totalErrorsCount }}</span>
          </button>
          <button data-testid="btn-tasks-panel" :class="['toggle-btn', { active: activePanel === 'tasks' }]"
            @click="$emit('toggle-tasks-panel')" title="View and manage design tasks for your AI agent (T)">
            <Icon name="clipboard-check" :size="12" />
            Tasks
            <span v-if="routeTasksCount" class="toggle-badge">{{ routeTasksCount }}</span>
          </button>
        </div>
      </template>

      <!-- Shared toolbar buttons -->
      <ToolbarButtonGroup
        :show-settings="showSettings"
        :show-shortcuts="showShortcuts"
        @toggle-settings="$emit('toggle-settings')"
        @toggle-shortcuts="$emit('toggle-shortcuts')"
      />
    </div>
  </header>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import ModeToolbar from './ModeToolbar.vue'
import ArrowColorPicker from './ArrowColorPicker.vue'
import ViewportSelector from './ViewportSelector.vue'
import ToolbarButtonGroup from './ToolbarButtonGroup.vue'
import Icon, { type IconName } from './Icon.vue'
import type { InteractionMode } from '../composables/useInteractionMode'
import type { ShellView, DesignSection, DevelopSection } from '../composables/useShellNavigation'

interface Props {
  shellView: ShellView
  interactionMode: InteractionMode
  arrowColor: string
  highlightColor: string
  activePanel: 'tasks' | 'inspector'
  designSection: DesignSection
  developSection: DevelopSection
  currentRoute: string
  layoutOverlayActive: boolean
  a11yLoading: boolean
  a11yViolationsCount: number
  tabOrderEnabled: boolean
  tabOrderLoading: boolean
  perfRecording: boolean
  perfScanLoading: boolean
  perfFindingsCount: number
  errorCount: number
  warnCount: number
  routeTasksCount: number
  showSettings: boolean
  showShortcuts: boolean
}

const props = defineProps<Props>()
const emit = defineEmits<{
  (e: 'update:shellView', value: ShellView): void
  (e: 'update:interactionMode', value: InteractionMode): void
  (e: 'update:arrowColor', value: string): void
  (e: 'update:highlightColor', value: string): void
  (e: 'set-active-panel', value: 'tasks' | 'inspector'): void
  (e: 'toggle-tasks-panel'): void
  (e: 'switch-design-section', value: DesignSection): void
  (e: 'switch-develop-section', value: DevelopSection): void
  (e: 'toggle-layout-overlay'): void
  (e: 'scan-a11y'): void
  (e: 'toggle-tab-order'): void
  (e: 'start-perf-recording'): void
  (e: 'stop-perf-recording'): void
  (e: 'run-perf-scan'): void
  (e: 'navigate-iframe', route: string): void
  (e: 'toggle-settings'): void
  (e: 'toggle-shortcuts'): void
}>()

function onInspectClick() {
  emit('update:interactionMode', 'select')
  if (props.shellView === 'design' && props.designSection !== 'inspector') {
    emit('switch-design-section', 'inspector')
  }
}

const totalErrorsCount = computed(() => props.errorCount + props.warnCount)

const viewItems = computed<Array<{
  id: ShellView
  label: string
  title: string
  icon: IconName
  badge: boolean
  badgeCount?: number
  testid: string
}>>(() => [
  {
    id: 'editor',
    label: 'Annotate',
    title: 'Annotate and inspect your UI',
    icon: 'pencil',
    badge: false,
    testid: 'tab-annotate',
  },
  {
    id: 'design',
    label: 'Design',
    title: 'Design tokens, element inspector, and component library',
    icon: 'palette',
    badge: false,
    testid: 'tab-design',
  },
  {
    id: 'develop',
    label: 'Audit',
    title: 'Data, performance, errors, and accessibility',
    icon: 'code',
    badge: true,
    badgeCount: props.perfFindingsCount + props.errorCount + props.warnCount + props.a11yViolationsCount,
    testid: 'tab-audit',
  },
])
</script>
