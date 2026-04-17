<template>
  <div class="task-card" :class="task.status" @click="$emit('open-detail', task.id)">
    <div v-if="task.resolution" class="task-card-resolution">{{ task.resolution }}</div>
    <div class="task-card-header">
      <span class="task-status-dot" :class="task.status" />
      <span class="task-card-desc task-card-md" v-html="safeMd(task.description)"></span>
      <button class="task-card-close" @click.stop="$emit('confirm-delete', task.id)" title="Delete task">×</button>
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

    <!-- Review actions / Deny form -->
    <div v-if="task.status === 'review'" class="task-card-actions" @click.stop>
      <template v-if="!isDenying">
        <button class="task-accept" @click="$emit('accept', task.id)" title="Accept this change and remove the task">Accept</button>
        <button class="task-deny" @click="$emit('start-deny', task.id)" title="Reject and send feedback to the agent">Deny</button>
      </template>
      <template v-else>
        <div class="deny-form">
          <textarea
            :value="denyFeedbackText"
            @input="$emit('update:denyFeedbackText', ($event.target as HTMLTextAreaElement).value)"
            class="deny-feedback-textarea"
            rows="3"
            placeholder="What needs to change?"
            autofocus
            @keydown.enter.ctrl="$emit('submit-deny', task.id)"
            @keydown.escape="$emit('cancel-deny')"
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
          <div class="deny-form-actions">
            <button class="task-send-feedback" :disabled="!denyFeedbackText.trim()" @click="$emit('submit-deny', task.id)">
              Send Feedback
            </button>
            <button class="cancel-btn" style="padding:4px 8px;font-size:10px" @click="$emit('cancel-deny')">Cancel</button>
          </div>
        </div>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import TaskOptionsToggles from './TaskOptionsToggles.vue'
import ScreenshotUploader from './ScreenshotUploader.vue'
import { safeMd } from '../utils/safeMd'
import type { AnnotaskTask } from '../../schema'

interface Props {
  task: AnnotaskTask
  isDenying: boolean
  denyFeedbackText: string
  pendingScreenshot?: string | null
  includeHistory: boolean
  includeElementContext: boolean
}

defineProps<Props>()
defineEmits<{
  (e: 'open-detail', id: string): void
  (e: 'confirm-delete', id: string): void
  (e: 'accept', id: string): void
  (e: 'start-deny', id: string): void
  (e: 'submit-deny', id: string): void
  (e: 'cancel-deny'): void
  (e: 'update:denyFeedbackText', text: string): void
  (e: 'update:includeHistory', value: boolean): void
  (e: 'update:includeElementContext', value: boolean): void
  (e: 'start-snip'): void
  (e: 'remove-screenshot'): void
}>()
</script>
