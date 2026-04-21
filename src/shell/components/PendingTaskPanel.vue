<template>
  <aside class="panel">
    <div class="panel-source">
      <span class="source-path" style="color:var(--text)">Add Task</span>
    </div>
    <div class="pending-task-panel">
      <div v-if="pendingTaskCreation.kind !== 'highlight'" class="pending-task-context">
        <div class="pending-task-kind" :class="pendingTaskCreation.kind">
          <Icon v-if="pendingTaskCreation.kind === 'pin'" name="map-pin" :size="12" />
          <Icon v-else-if="pendingTaskCreation.kind === 'arrow'" name="arrow-right" :size="12" :stroke-width="2.5"
            :color="(pendingTaskCreation.meta.arrowColor as string) || undefined" />
          <Icon v-else-if="pendingTaskCreation.kind === 'select'" name="wand" :size="12" />
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
            <code class="selected-element-tag">&lt;{{ labelFor(el).bracket }}&gt;</code>
            <span v-if="labelFor(el).suffix" class="component-badge">{{ labelFor(el).suffix }}</span>
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
        :disabled="submitting"
        @keydown.enter.ctrl="submitting || $emit('submit')"
        @keydown.escape="$emit('cancel')"
      />

      <TaskOptionsToggles
        :include-history="includeHistory"
        :include-rendered-html="includeRenderedHtml"
        :include-data-context="includeDataContext"
        :data-context-probe="dataContextProbe"
        @update:includeHistory="$emit('update:includeHistory', $event)"
        @update:includeRenderedHtml="$emit('update:includeRenderedHtml', $event)"
        @update:includeDataContext="$emit('update:includeDataContext', $event)"
      />

      <ScreenshotUploader
        :pending-screenshot="pendingScreenshot"
        @start-snip="$emit('start-snip')"
        @remove-screenshot="$emit('remove-screenshot')"
      />

      <div class="pending-task-actions">
        <button
          class="submit-btn"
          :class="{ 'is-submitting': submitting }"
          :disabled="!pendingTaskText.trim() || submitting"
          @click="$emit('submit')"
        >
          <span v-if="submitting" class="submit-spinner" aria-hidden="true" />
          {{ submitting ? 'Adding…' : 'Add Task' }}
        </button>
        <button class="cancel-btn" :disabled="submitting" @click="$emit('cancel')">Cancel</button>
      </div>
    </div>
  </aside>
</template>

<script setup lang="ts">
import Icon from './Icon.vue'
import TaskOptionsToggles from './TaskOptionsToggles.vue'
import ScreenshotUploader from './ScreenshotUploader.vue'
import type { DataContextProbeResult } from '../services/dataContextClient'
import { formatElementLabel } from '../utils/elementLabel'

function labelFor(el: Record<string, string>) {
  return formatElementLabel({
    tag: el.tag || '',
    component: el.component || '',
    source_tag: el.source_tag,
    parent_component: el.parent_component,
  })
}

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
  includeRenderedHtml: boolean
  includeDataContext: boolean
  dataContextProbe: DataContextProbeResult | null
  submitting?: boolean
}

defineProps<Props>()
defineEmits<{
  (e: 'submit'): void
  (e: 'cancel'): void
  (e: 'update:pendingTaskText', value: string): void
  (e: 'update:includeHistory', value: boolean): void
  (e: 'update:includeRenderedHtml', value: boolean): void
  (e: 'update:includeDataContext', value: boolean): void
  (e: 'start-snip'): void
  (e: 'remove-screenshot'): void
}>()
</script>
