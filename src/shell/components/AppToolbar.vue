<template>
  <header class="toolbar">
    <div class="toolbar-left">
      <svg class="logo" viewBox="0 0 85.81 90.51" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
        <path d="m72.02 90.31c-.17-.1-.43-.48-.57-.82-.37-.93-1.97-3.46-2.74-4.33-.66-.74-.77-.79-5.99-2.5-2.93-.96-5.52-1.85-5.77-1.98-.47-.25-.35.01-4.7-9.99-1.1-2.53-2.11-4.72-2.25-4.87-.22-.24-1.7-.26-11.7-.21-6.3.03-11.51.12-11.58.19-.11.11-2.06 4.98-4.34 10.84-.4 1.04-1.21 3.11-1.8 4.6-.58 1.49-1.52 3.88-2.08 5.32-.64 1.65-1.18 2.76-1.45 3.02l-.44.41H8.31 0l.49-1.22c4.92-12.33 8.69-21.78 9.54-23.94 1.22-3.09 4.33-10.89 6.52-16.32.82-2.03 1.72-4.3 2-5.05.28-.74 1.17-2.97 1.97-4.96 2.26-5.6 3-7.45 4.7-11.72 2.32-5.86 5.17-13 7.63-19.11 1.2-2.98 2.29-5.73 2.44-6.13.15-.4.45-.9.68-1.13l.42-.41h8.22c4.57 0 8.4.07 8.63.17.49.19.22-.38 3.81 8.22 1.57 3.77 3 7.18 3.17 7.57.73 1.72 6 14.31 7.22 17.22 1.71 4.1 5.73 13.7 6 14.34.17.4.66 1.58 1.09 2.61.43 1.04 1.63 3.94 2.68 6.46 1.05 2.51 1.9 4.63 1.9 4.71 0 .08-.14.2-.3.27-.17.07-2.89 1.13-6.05 2.37-3.16 1.23-6.39 2.5-7.17 2.81-.78.31-1.47.51-1.53.45-.06-.06-.47-1.07-.92-2.24-1.24-3.24-5.96-15.5-7.72-20.06-.86-2.23-2.45-6.33-3.52-9.11-1.07-2.78-2.93-7.6-4.14-10.73-1.2-3.12-2.4-6.25-2.67-6.94l-.48-1.26-.19.54c-.42 1.17-1.35 3.64-3.23 8.56-1.08 2.83-2.45 6.44-3.05 8.02-.6 1.59-2.24 5.89-3.65 9.56l-2.57 6.67 8.58.05 8.58.05.31.76c.17.42 1.14 2.91 2.16 5.54 6.49 16.81 6.66 17.24 6.88 17.18.08-.02 1.08-.41 2.21-.87 1.13-.46 3.45-1.39 5.15-2.06 5.12-2.03 14.4-5.73 14.68-5.85.14-.06.39-.01.55.12.32.25 2.19 4.68 2.19 5.19 0 .18-.14.48-.3.68-.27.32-5.46 2.61-10.94 4.83-4.74 1.92-6.58 2.65-7.29 2.92l-.77.29 1.94.34 1.94.34.77-.38c1.61-.79 3.36-1.45 7.27-2.71 2.22-.72 4.1-1.32 4.19-1.33.16-.02.94 1.75 2.24 5.12.41 1.04 1.36 3.49 2.13 5.45.77 1.96 1.39 3.71 1.39 3.89 0 .75-.14.76-6.94.76-4.33 0-6.64-.07-6.85-.2z" />
      </svg>

      <!-- View toggle (editor/theme/a11y/perf) -->
      <div class="view-toggle">
        <button v-for="view in viewItems" :key="view.id"
          :class="['toggle-btn', { active: shellView === view.id }]"
          @click="$emit('update:shellView', view.id)" :title="view.title">
          <span v-html="view.icon"></span>
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

      <!-- Theme view mode/layout toggles -->
      <template v-else-if="shellView === 'theme'">
        <div class="mode-toolbar">
          <button :class="['mode-btn mode-interact', { active: interactionMode === 'interact' }]"
            @click="$emit('update:interactionMode', 'interact')" title="Interact (I)">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
              <path d="M4 4l7.07 17 2.51-7.39L21 11.07z" />
            </svg>
          </button>
          <button :class="['mode-btn mode-select', { active: interactionMode === 'select' }]"
            @click="$emit('update:interactionMode', 'select')" title="Select (V)">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M7 11V4a2 2 0 1 1 4 0v5" />
              <path d="M11 9a2 2 0 1 1 4 0v2" />
              <path d="M15 11a2 2 0 1 1 4 0v4a8 8 0 0 1-8 8 7 7 0 0 1-5-2l-3.3-3.3a2 2 0 0 1 2.8-2.8L7 16" />
            </svg>
          </button>
        </div>
        <button :class="['tool-btn', { active: layoutOverlayActive }]" @click="$emit('toggle-layout-overlay')" title="Show Layout (L)">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <line x1="3" y1="9" x2="21" y2="9" />
            <line x1="9" y1="3" x2="9" y2="21" />
          </svg>
        </button>
      </template>

      <!-- A11y scan button -->
      <template v-else-if="shellView === 'a11y'">
        <button class="scan-btn" :disabled="a11yLoading" @click="$emit('scan-a11y')"
          title="Run axe-core WCAG accessibility scan on the page">
          {{ a11yLoading ? 'Scanning...' : 'Scan Page' }}
        </button>
      </template>

      <!-- Perf record/scan -->
      <template v-else-if="shellView === 'perf'">
        <template v-if="perfSection === 'vitals'">
          <button v-if="!perfRecording" class="rec-btn" @click="$emit('start-perf-recording')" title="Record a performance session">
            <span class="rec-dot"></span> Record
          </button>
          <button v-else class="rec-btn recording" @click="$emit('stop-perf-recording')" title="Stop recording">
            <span class="rec-dot active"></span> Stop
          </button>
          <button class="scan-btn" :disabled="perfScanLoading || perfRecording" @click="$emit('run-perf-scan')"
            title="Scan page performance">
            {{ perfScanLoading ? 'Scanning...' : 'Scan' }}
          </button>
        </template>
      </template>
    </div>

    <!-- Toolbar center (viewport + route input) -->
    <div class="toolbar-center">
      <ViewportSelector />
      <input class="route-input" :value="currentRoute" title="Current route — edit to navigate"
        @keydown.enter="$emit('navigate-iframe', ($event.target as HTMLInputElement).value)"
        @blur="$emit('navigate-iframe', ($event.target as HTMLInputElement).value)" />
    </div>

    <!-- Toolbar right: view-specific panel toggles + shared buttons -->
    <div class="toolbar-right">
      <!-- Editor panel toggles -->
      <template v-if="shellView === 'editor'">
        <div class="panel-toggle">
          <button :class="['toggle-btn', { active: activePanel === 'tasks' }]"
            @click="$emit('toggle-tasks-panel')" title="View and manage design tasks for your AI agent (T)">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M9 11l3 3L22 4" />
              <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
            </svg>
            Tasks
            <span v-if="routeTasksCount" class="toggle-badge">{{ routeTasksCount }}</span>
          </button>
        </div>
      </template>

      <!-- Theme panel toggles -->
      <template v-else-if="shellView === 'theme'">
        <div class="panel-toggle">
          <button :class="['toggle-btn', { active: designSection === 'tokens' && activePanel !== 'tasks' }]"
            @click="$emit('switch-design-section', 'tokens')" title="Edit design tokens">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <line x1="4" y1="21" x2="4" y2="14" /><line x1="4" y1="10" x2="4" y2="3" />
              <line x1="12" y1="21" x2="12" y2="12" /><line x1="12" y1="8" x2="12" y2="3" />
              <line x1="20" y1="21" x2="20" y2="16" /><line x1="20" y1="12" x2="20" y2="3" />
              <line x1="1" y1="14" x2="7" y2="14" /><line x1="9" y1="8" x2="15" y2="8" />
              <line x1="17" y1="16" x2="23" y2="16" />
            </svg>
            Tokens
          </button>
          <button :class="['toggle-btn', { active: designSection === 'inspector' && activePanel !== 'tasks' }]"
            @click="$emit('switch-design-section', 'inspector')" title="Inspect element styles">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            Inspector
          </button>
          <button :class="['toggle-btn', { active: activePanel === 'tasks' }]"
            @click="$emit('toggle-tasks-panel')" title="View and manage design tasks for your AI agent (T)">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M9 11l3 3L22 4" />
              <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
            </svg>
            Tasks
            <span v-if="routeTasksCount" class="toggle-badge">{{ routeTasksCount }}</span>
          </button>
        </div>
      </template>

      <!-- A11y panel toggles -->
      <template v-else-if="shellView === 'a11y'">
        <div class="panel-toggle">
          <button :class="['toggle-btn', { active: activePanel !== 'tasks' }]"
            @click="$emit('set-active-panel', 'inspector')" title="View report">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
              <line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" />
              <polyline points="10 9 9 9 8 9" />
            </svg>
            Report
          </button>
          <button :class="['toggle-btn', { active: activePanel === 'tasks' }]"
            @click="$emit('set-active-panel', 'tasks')" title="View and manage design tasks for your AI agent (T)">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M9 11l3 3L22 4" />
              <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
            </svg>
            Tasks
            <span v-if="routeTasksCount" class="toggle-badge">{{ routeTasksCount }}</span>
          </button>
        </div>
      </template>

      <!-- Perf section toggles -->
      <template v-else-if="shellView === 'perf'">
        <div class="panel-toggle">
          <button :class="['toggle-btn', { active: perfSection === 'vitals' }]"
            @click="$emit('switch-perf-section', 'vitals')" title="Web Vitals and page performance">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
            </svg>
            Audit
            <span v-if="perfFindingsCount" class="toggle-badge">{{ perfFindingsCount }}</span>
          </button>
          <button :class="['toggle-btn', { active: perfSection === 'errors' }]"
            @click="$emit('switch-perf-section', 'errors')" title="Console errors and warnings">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
              <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
            Errors
            <span v-if="totalErrorsCount" class="toggle-badge error-badge">{{ totalErrorsCount }}</span>
          </button>
          <button :class="['toggle-btn', { active: perfSection === 'tasks' }]"
            @click="$emit('switch-perf-section', 'tasks')" title="View and manage design tasks for your AI agent (T)">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M9 11l3 3L22 4" />
              <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
            </svg>
            Tasks
            <span v-if="routeTasksCount" class="toggle-badge">{{ routeTasksCount }}</span>
          </button>
        </div>
      </template>

      <!-- Shared toolbar buttons -->
      <ToolbarButtonGroup
        :show-context="showContext"
        :show-settings="showSettings"
        :show-shortcuts="showShortcuts"
        @toggle-context="$emit('toggle-context')"
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
import type { InteractionMode } from '../composables/useInteractionMode'

type ShellView = 'editor' | 'theme' | 'a11y' | 'perf'
type PerfSection = 'vitals' | 'errors' | 'tasks'

interface Props {
  shellView: ShellView
  interactionMode: InteractionMode
  arrowColor: string
  highlightColor: string
  activePanel: 'tasks' | 'inspector'
  designSection: 'tokens' | 'inspector'
  perfSection: PerfSection
  currentRoute: string
  layoutOverlayActive: boolean
  a11yLoading: boolean
  a11yViolationsCount: number
  perfRecording: boolean
  perfScanLoading: boolean
  perfFindingsCount: number
  errorCount: number
  warnCount: number
  routeTasksCount: number
  showContext: boolean
  showSettings: boolean
  showShortcuts: boolean
}

const props = defineProps<Props>()
defineEmits<{
  (e: 'update:shellView', value: ShellView): void
  (e: 'update:interactionMode', value: InteractionMode): void
  (e: 'update:arrowColor', value: string): void
  (e: 'update:highlightColor', value: string): void
  (e: 'set-active-panel', value: 'tasks' | 'inspector'): void
  (e: 'toggle-tasks-panel'): void
  (e: 'switch-design-section', value: 'tokens' | 'inspector'): void
  (e: 'switch-perf-section', value: PerfSection): void
  (e: 'toggle-layout-overlay'): void
  (e: 'scan-a11y'): void
  (e: 'start-perf-recording'): void
  (e: 'stop-perf-recording'): void
  (e: 'run-perf-scan'): void
  (e: 'navigate-iframe', route: string): void
  (e: 'toggle-context'): void
  (e: 'toggle-settings'): void
  (e: 'toggle-shortcuts'): void
}>()

const totalErrorsCount = computed(() => props.errorCount + props.warnCount)

const viewItems = computed<Array<{
  id: ShellView
  label: string
  title: string
  icon: string
  badge: boolean
  badgeCount?: number
}>>(() => [
  {
    id: 'editor',
    label: 'Annotate',
    title: 'Annotate and inspect your UI',
    icon: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>',
    badge: false,
  },
  {
    id: 'theme',
    label: 'Design',
    title: 'Edit design tokens (colors, typography, spacing)',
    icon: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="13.5" cy="6.5" r="2.5"/><circle cx="17.5" cy="10.5" r="2.5"/><circle cx="8.5" cy="7.5" r="2.5"/><circle cx="6.5" cy="12" r="2.5"/><path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12a10 10 0 0 0 .832 4"/></svg>',
    badge: false,
  },
  {
    id: 'a11y',
    label: 'Accessibility',
    title: 'Run accessibility checks (axe-core WCAG)',
    icon: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="4.5" r="1.5" fill="currentColor" stroke="none"/><path d="M7 9h10"/><path d="M12 9v9"/><path d="M9.5 18l2.5-4 2.5 4"/></svg>',
    badge: true,
    badgeCount: props.a11yViolationsCount,
  },
  {
    id: 'perf',
    label: 'Performance',
    title: 'Performance and errors',
    icon: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>',
    badge: true,
    badgeCount: props.perfFindingsCount + props.errorCount + props.warnCount,
  },
])
</script>
