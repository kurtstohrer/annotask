<script setup lang="ts">
import { ref, computed } from 'vue'
import type { Pin } from '../composables/useAnnotations'

export interface TaskItem {
  id: string; type: string; description: string; file: string; status: string; feedback?: string
}

const props = defineProps<{
  pins: Pin[]
  selectedPinId: string | null
  selectedElement: { file: string; line: string; component: string; tagName: string; classes: string } | null
  elementRole: 'container' | 'content' | 'component' | null
  tasks: TaskItem[]
  includeHistory: boolean
  includeElementContext: boolean
  pendingScreenshot: string | null
}>()

const denyFeedback = ref<Record<string, string>>({})

const emit = defineEmits<{
  'add-note': [text: string]
  'add-action': [action: string, label: string]
  'add-task': [text: string]
  'update:includeHistory': [value: boolean]
  'update:includeElementContext': [value: boolean]
  'start-snip': []
  'remove-screenshot': []
  'select-pin': [id: string]
  'accept-task': [id: string]
  'deny-task': [id: string, feedback: string]
  'cancel-task': [id: string]
  'update-note': [id: string, text: string]
  'remove-pin': [id: string]
}>()

const newNote = ref('')

const elementPins = computed(() => {
  if (!props.selectedElement) return []
  return props.pins.filter(
    p => p.file === props.selectedElement!.file && p.line === parseInt(props.selectedElement!.line)
  )
})

function submitNote() {
  const text = newNote.value.trim()
  if (!text) return
  emit('add-note', text)
  newNote.value = ''
}
</script>

<template>
  <div class="notes-tab">
    <!-- Add task -->
    <div v-if="selectedElement" class="add-note">
      <span class="section-label" title="Describe a change in plain text or markdown — your AI agent will apply it">Add Task</span>
      <textarea
        v-model="newNote"
        class="note-input"
        rows="3"
        placeholder="Describe what you want to change (supports markdown)..."
        @keydown.enter.ctrl="submitNote"
      />
      <div class="task-toggles">
        <label class="history-toggle" title="Attach your navigation path and click actions to this task"><input type="checkbox" :checked="includeHistory" @change="emit('update:includeHistory', ($event.target as HTMLInputElement).checked)" /><span>Include interaction history</span></label>
        <label class="history-toggle" title="Attach parent layout chain and DOM subtree snapshot to this task"><input type="checkbox" :checked="includeElementContext" @change="emit('update:includeElementContext', ($event.target as HTMLInputElement).checked)" /><span>Include DOM context</span></label>
      </div>
      <div v-if="pendingScreenshot" class="screenshot-preview">
        <img :src="'/__annotask/screenshots/' + pendingScreenshot" class="screenshot-thumb" />
        <button class="screenshot-remove" @click="emit('remove-screenshot')">&times;</button>
      </div>
      <button v-else class="screenshot-btn" @click="emit('start-snip')" title="Capture a screenshot — drag a region or click for full page">Add Screenshot</button>
      <div class="note-actions">
        <button class="submit-btn" :disabled="!newNote.trim()" @click="submitNote">Add Task</button>
      </div>
    </div>

    <!-- Element pins -->
    <div v-if="elementPins.length" class="element-pins">
      <span class="section-label">Notes on this element</span>
      <div v-for="pin in elementPins" :key="pin.id" class="pin-item" @click="emit('select-pin', pin.id)">
        <span class="pin-badge" :class="{ action: pin.action }">{{ pin.number }}</span>
        <div class="pin-content">
          <span v-if="pin.action" class="pin-action">{{ pin.action }}</span>
          <span v-if="pin.note" class="pin-note">{{ pin.note }}</span>
          <span v-if="!pin.note && !pin.action" class="pin-empty">No note yet</span>
        </div>
        <button class="pin-delete" @click.stop="emit('remove-pin', pin.id)">×</button>
      </div>
    </div>

    <!-- All pins -->
    <div class="all-pins">
      <span class="section-label">All Pins ({{ pins.length }})</span>
      <div v-if="pins.length === 0" class="empty-hint">
        Press P then click on the page to add pins
      </div>
      <div
        v-for="pin in pins"
        :key="pin.id"
        class="pin-item"
        :class="{ selected: pin.id === selectedPinId }"
        @click="emit('select-pin', pin.id)"
      >
        <span class="pin-badge" :class="{ action: pin.action }">{{ pin.number }}</span>
        <div class="pin-content">
          <code class="pin-file">{{ pin.file }}:{{ pin.line }}</code>
          <span v-if="pin.action" class="pin-action">{{ pin.action }}</span>
          <span v-if="pin.note" class="pin-note">{{ pin.note }}</span>
        </div>
        <button class="pin-delete" @click.stop="emit('remove-pin', pin.id)">×</button>
      </div>
    </div>

    <!-- Task review -->
    <div v-if="tasks.length > 0" class="task-review">
      <span class="section-label">Tasks ({{ tasks.length }})</span>
      <div v-for="task in tasks" :key="task.id" class="task-item" :class="task.status">
        <div class="task-header">
          <span class="task-status-badge" :class="task.status">{{ task.status }}</span>
          <span class="task-desc">{{ task.description }}</span>
        </div>
        <code class="task-file">{{ task.file }}</code>
        <div v-if="task.feedback" class="task-feedback">Feedback: {{ task.feedback }}</div>
        <div class="task-actions">
          <template v-if="task.status === 'review'">
            <button class="task-accept" @click="emit('accept-task', task.id)">Accept</button>
            <input :value="denyFeedback[task.id] || ''" @input="denyFeedback[task.id] = ($event.target as HTMLInputElement).value" class="deny-input" placeholder="Reason..." @click.stop />
            <button class="task-deny" @click="emit('deny-task', task.id, denyFeedback[task.id] || ''); delete denyFeedback[task.id]">Deny</button>
          </template>
          <button class="task-cancel" @click="emit('cancel-task', task.id)">×</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.notes-tab { display: flex; flex-direction: column; gap: 14px; }

.section-label {
  display: block;
  font-size: 9px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--text-muted);
  margin-bottom: 6px;
}

/* Note input */
.note-input {
  width: 100%;
  padding: 8px;
  font-size: 12px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--text);
  resize: vertical;
  outline: none;
  font-family: inherit;
}
.note-input:focus { border-color: var(--accent); }
.submit-btn {
  margin-top: 4px;
  padding: 5px 12px;
  font-size: 11px;
  font-weight: 600;
  background: var(--accent);
  color: white;
  border: none;
  border-radius: 5px;
  cursor: pointer;
  transition: opacity 0.1s;
}
.submit-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.submit-btn:hover:not(:disabled) { opacity: 0.9; }

.task-toggles { display: flex; flex-direction: column; gap: 4px; margin-top: 4px; }
.note-actions { display: flex; align-items: center; gap: 8px; margin-top: 4px; }
.history-toggle { display: flex; align-items: center; gap: 4px; font-size: 10px; color: var(--text-muted); cursor: pointer; white-space: nowrap; }
.history-toggle input { margin: 0; }
.history-toggle span { user-select: none; }

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

/* Pin items */
.pin-item {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 6px 8px;
  border-radius: 5px;
  cursor: pointer;
  transition: background 0.1s;
}
.pin-item:hover { background: var(--surface-2); }
.pin-item.selected { background: var(--surface-2); border: 1px solid var(--accent); }

.pin-badge {
  width: 18px; height: 18px;
  border-radius: 50%;
  background: #3b82f6;
  color: white;
  font-size: 9px;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.pin-badge.action { background: #a855f7; }

.pin-content { flex: 1; min-width: 0; }
.pin-file { font-size: 10px; color: var(--accent); display: block; margin-bottom: 2px; }
.pin-action { font-size: 10px; color: #a855f7; font-weight: 600; display: block; }
.pin-note { font-size: 11px; color: var(--text); display: block; word-break: break-word; }
.pin-empty { font-size: 10px; color: var(--text-muted); font-style: italic; }

.pin-delete {
  width: 16px; height: 16px;
  border-radius: 50%;
  background: none;
  border: none;
  color: var(--text-muted);
  cursor: pointer;
  font-size: 12px;
  display: none;
  align-items: center;
  justify-content: center;
  padding: 0;
}
.pin-item:hover .pin-delete { display: flex; }
.pin-delete:hover { color: var(--danger, #ef4444); }

.empty-hint { font-size: 11px; color: var(--text-muted); text-align: center; padding: 12px 0; }

/* Task review */
.task-review { border-top: 1px solid var(--border, #2a2a2a); padding-top: 10px; }
.task-item { padding: 6px 8px; border-radius: 5px; margin-bottom: 4px; border: 1px solid var(--border, #2a2a2a); }
.task-item.review { border-color: #f59e0b; background: rgba(245,158,11,0.05); }
.task-item.denied { border-color: #ef4444; background: rgba(239,68,68,0.05); }
.task-item.pending { border-color: var(--border, #2a2a2a); }
.task-header { display: flex; align-items: center; gap: 6px; margin-bottom: 3px; }
.task-status-badge { font-size: 8px; font-weight: 700; padding: 1px 5px; border-radius: 3px; text-transform: uppercase; }
.task-status-badge.pending { background: rgba(113,113,122,0.2); color: #71717a; }
.task-status-badge.review { background: rgba(245,158,11,0.2); color: #f59e0b; }
.task-status-badge.denied { background: rgba(239,68,68,0.2); color: #ef4444; }
.task-desc { font-size: 11px; color: var(--text, #e4e4e7); }
.task-file { font-size: 9px; color: var(--text-muted, #71717a); display: block; margin-bottom: 3px; }
.task-feedback { font-size: 10px; color: #ef4444; font-style: italic; margin-bottom: 3px; }
.task-actions { display: flex; gap: 4px; align-items: center; margin-top: 4px; }
.task-accept {
  padding: 4px 10px; font-size: 10px; font-weight: 600;
  background: rgba(34,197,94,0.15); color: #22c55e;
  border: none; border-radius: 4px; cursor: pointer; transition: all 0.12s;
}
.task-accept:hover { background: #22c55e; color: white; }
.task-deny {
  padding: 4px 10px; font-size: 10px; font-weight: 600;
  background: rgba(239,68,68,0.12); color: #ef4444;
  border: none; border-radius: 4px; cursor: pointer; transition: all 0.12s;
}
.task-deny:hover { background: #ef4444; color: white; }
.deny-input { flex: 1; padding: 2px 6px; font-size: 10px; background: var(--bg, #0a0a0a); border: 1px solid var(--border); border-radius: 4px; color: var(--text); outline: none; }
.task-cancel { width: 18px; height: 18px; border: none; background: none; color: var(--text-muted, #71717a); font-size: 14px; cursor: pointer; padding: 0; display: flex; align-items: center; justify-content: center; margin-left: auto; border-radius: 3px; }
.task-cancel:hover { color: #ef4444; background: rgba(239,68,68,0.1); }
</style>
