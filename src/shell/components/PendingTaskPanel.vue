<template>
  <aside class="panel">
    <div class="panel-source">
      <span class="source-path" style="color:var(--text)">Add Task</span>
    </div>
    <div class="pending-task-panel">
      <div v-if="pendingTaskCreation.kind !== 'highlight'" class="pending-task-context">
        <div class="pending-task-kind" :class="pendingTaskCreation.kind">
          <svg v-if="pendingTaskCreation.kind === 'pin'" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="10" r="3" />
            <path d="M12 21.7C17.3 17 20 13 20 10a8 8 0 1 0-16 0c0 3 2.7 7 8 11.7z" />
          </svg>
          <svg v-else-if="pendingTaskCreation.kind === 'arrow'" width="12" height="12" viewBox="0 0 24 24" fill="none"
            :stroke="(pendingTaskCreation.meta.arrowColor as string) || 'currentColor'" stroke-width="2.5">
            <line x1="5" y1="12" x2="19" y2="12" />
            <polyline points="12 5 19 12 12 19" />
          </svg>
          <svg v-else-if="pendingTaskCreation.kind === 'select'" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M7 11V4a2 2 0 1 1 4 0v5" />
            <path d="M11 9a2 2 0 1 1 4 0v2" />
            <path d="M15 11a2 2 0 1 1 4 0v4a8 8 0 0 1-8 8 7 7 0 0 1-5-2l-3.3-3.3a2 2 0 0 1 2.8-2.8L7 16" />
          </svg>
          <span v-if="pendingTaskCreation.kind === 'arrow'">{{ pendingTaskCreation.label }}</span>
          <span v-else>{{ selectedEidsCount }} element{{ selectedEidsCount === 1 ? '' : 's' }} selected</span>
        </div>
        <code class="pending-task-file">{{ pendingTaskCreation.file }}:{{ pendingTaskCreation.line }}</code>
      </div>

      <!-- Element details for select tasks -->
      <div v-if="pendingTaskCreation?.kind === 'select' && pendingTaskCreation.meta.selectedElements" class="select-element-details">
        <div v-for="(el, i) in (pendingTaskCreation.meta.selectedElements as Array<Record<string, string>>)"
          :key="el.eid || i" class="selected-element-card">
          <div class="selected-element-header">
            <code class="selected-element-tag">&lt;{{ el.tag }}&gt;</code>
            <span v-if="el.component" class="component-badge">{{ el.component }}</span>
          </div>
          <code class="selected-element-file">{{ el.file }}:{{ el.line }}</code>
          <code v-if="el.classes" class="selected-element-classes">{{ el.classes }}</code>
        </div>
      </div>

      <span v-if="pendingTaskCreation?.kind === 'highlight'" class="pending-task-title">Change text</span>

      <textarea
        :value="pendingTaskText"
        @input="$emit('update:pendingTaskText', ($event.target as HTMLTextAreaElement).value)"
        class="pending-task-input"
        rows="6"
        placeholder="Describe the change..."
        autofocus
        @keydown.enter.ctrl="$emit('submit')"
        @keydown.escape="$emit('cancel')"
      />

      <TaskOptionsToggles
        :include-history="includeHistory"
        :include-element-context="includeElementContext"
        :include-data-context="includeDataContext"
        :data-context-probe="dataContextProbe"
        @update:includeHistory="$emit('update:includeHistory', $event)"
        @update:includeElementContext="$emit('update:includeElementContext', $event)"
        @update:includeDataContext="$emit('update:includeDataContext', $event)"
      />

      <ScreenshotUploader
        :pending-screenshot="pendingScreenshot"
        @start-snip="$emit('start-snip')"
        @remove-screenshot="$emit('remove-screenshot')"
      />

      <div class="pending-task-actions">
        <button class="submit-btn" :disabled="!pendingTaskText.trim()" @click="$emit('submit')">Add Task</button>
        <button class="cancel-btn" @click="$emit('cancel')">Cancel</button>
      </div>
    </div>
  </aside>
</template>

<script setup lang="ts">
import TaskOptionsToggles from './TaskOptionsToggles.vue'
import ScreenshotUploader from './ScreenshotUploader.vue'
import type { DataContextProbeResult } from '../services/dataContextClient'

export interface PendingTaskCreation {
  kind: 'pin' | 'arrow' | 'select' | 'highlight'
  label: string
  file?: string
  line?: number | string
  component?: string
  annotationId?: string
  meta: Record<string, unknown>
}

interface Props {
  pendingTaskCreation: PendingTaskCreation
  pendingTaskText: string
  selectedEidsCount: number
  pendingScreenshot?: string | null
  includeHistory: boolean
  includeElementContext: boolean
  includeDataContext: boolean
  dataContextProbe: DataContextProbeResult | null
}

defineProps<Props>()
defineEmits<{
  (e: 'submit'): void
  (e: 'cancel'): void
  (e: 'update:pendingTaskText', value: string): void
  (e: 'update:includeHistory', value: boolean): void
  (e: 'update:includeElementContext', value: boolean): void
  (e: 'update:includeDataContext', value: boolean): void
  (e: 'start-snip'): void
  (e: 'remove-screenshot'): void
}>()
</script>
