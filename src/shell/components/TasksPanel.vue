<template>
  <aside class="panel">
    <div class="panel-source">
      <span class="source-path" style="color:var(--text)">Tasks</span>
      <span class="component-badge">{{ totalTasks }}</span>
      <button :class="['new-task-toggle json-toggle', { active: showReportPanel }]"
        @click="$emit('update:showReportPanel', !showReportPanel)" title="View all tasks as JSON">
        JSON
      </button>
      <button class="new-task-toggle" @click="$emit('toggle-new-task')" title="Create a general task (not tied to an element)">
        {{ showNewTaskForm ? '−' : '+' }} New
      </button>
    </div>

    <!-- New task form (collapsible) -->
    <div v-if="showNewTaskForm" class="new-task-form">
      <textarea
        :value="newTaskText"
        @input="$emit('update:newTaskText', ($event.target as HTMLTextAreaElement).value)"
        class="new-task-input" rows="2" placeholder="Describe a change..."
        @keydown.enter.ctrl="$emit('submit-new-task')"
      />
      <TaskOptionsToggles
        :include-history="includeHistory"
        :include-element-context="includeElementContext"
        @update:includeHistory="$emit('update:includeHistory', $event)"
        @update:includeElementContext="$emit('update:includeElementContext', $event)"
      />
      <ScreenshotUploader
        :pending-screenshot="pendingScreenshot"
        @start-snip="$emit('start-snip')"
        @remove-screenshot="$emit('remove-screenshot')"
      />
      <div class="new-task-actions">
        <button class="submit-btn" :disabled="!newTaskText.trim()" @click="$emit('submit-new-task')">Add</button>
        <button class="cancel-btn" @click="$emit('cancel-new-task')">Cancel</button>
      </div>
    </div>

    <div class="tab-content">
      <div v-if="totalTasks === 0 && !showNewTaskForm" class="empty-hint" style="padding:20px 0">
        No tasks yet. Click + New to add one.
      </div>
      <TaskCard
        v-for="task in routeTasks"
        :key="task.id"
        :task="task"
        :is-denying="denyingTaskId === task.id"
        :deny-feedback-text="denyFeedbackText"
        :pending-screenshot="pendingScreenshot"
        :include-history="includeHistory"
        :include-element-context="includeElementContext"
        @open-detail="$emit('open-detail', $event)"
        @confirm-delete="$emit('confirm-delete', $event)"
        @accept="$emit('accept', $event)"
        @start-deny="$emit('start-deny', $event)"
        @submit-deny="$emit('submit-deny', $event)"
        @cancel-deny="$emit('cancel-deny')"
        @update:denyFeedbackText="$emit('update:denyFeedbackText', $event)"
        @update:includeHistory="$emit('update:includeHistory', $event)"
        @update:includeElementContext="$emit('update:includeElementContext', $event)"
        @start-snip="$emit('start-snip')"
        @remove-screenshot="$emit('remove-screenshot')"
      />
    </div>
  </aside>
</template>

<script setup lang="ts">
import TaskCard from './TaskCard.vue'
import TaskOptionsToggles from './TaskOptionsToggles.vue'
import ScreenshotUploader from './ScreenshotUploader.vue'
import type { AnnotaskTask } from '../../schema'

interface Props {
  totalTasks: number
  routeTasks: AnnotaskTask[]
  showNewTaskForm: boolean
  showReportPanel: boolean
  newTaskText: string
  denyingTaskId: string | null
  denyFeedbackText: string
  pendingScreenshot?: string | null
  includeHistory: boolean
  includeElementContext: boolean
}

defineProps<Props>()
defineEmits<{
  (e: 'update:showReportPanel', value: boolean): void
  (e: 'update:newTaskText', value: string): void
  (e: 'update:denyFeedbackText', value: string): void
  (e: 'update:includeHistory', value: boolean): void
  (e: 'update:includeElementContext', value: boolean): void
  (e: 'toggle-new-task'): void
  (e: 'submit-new-task'): void
  (e: 'cancel-new-task'): void
  (e: 'open-detail', id: string): void
  (e: 'confirm-delete', id: string): void
  (e: 'accept', id: string): void
  (e: 'start-deny', id: string): void
  (e: 'submit-deny', id: string): void
  (e: 'cancel-deny'): void
  (e: 'start-snip'): void
  (e: 'remove-screenshot'): void
}>()
</script>
