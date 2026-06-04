<script setup lang="ts">
import { computed, ref, watch, nextTick } from 'vue'
import { safeMd } from '../utils/safeMd'
import type { Task } from '../composables/useTasks'
import ConfirmDialog from './ConfirmDialog.vue'
import TaskAgentFeedback from './TaskAgentFeedback.vue'
import TaskInteractionHistory from './TaskInteractionHistory.vue'
import TaskJsonView from './TaskJsonView.vue'
import ConversationTab from './ConversationTab.vue'
import Icon from './Icon.vue'
import { useProviderSettings } from '../composables/useProviderSettings'
import { requestAutoRun } from '../composables/useAgentMode'
import { PERMISSION_MODES, type PermissionMode } from '../../schema'

const props = defineProps<{
  task: Task
  /** Optional initial tab. Used by agent-mode auto-run to land on Conversation. */
  initialTab?: 'details' | 'conversation'
}>()

const emit = defineEmits<{
  close: []
  accept: [id: string]
  deny: [id: string]
  delete: [id: string]
  update: [id: string, fields: Record<string, unknown>]
  reply: [id: string, answers: Array<{ id: string; value: string }>]
  'open-settings': []
}>()

type ModalTab = 'details' | 'conversation'
const activeTab = ref<ModalTab>(props.initialTab ?? 'details')

// Honour late-arriving initialTab changes — App.vue may set it after the
// modal mounts (e.g. agent-mode auto-run on a task that was already opened).
// Only react to *upgrades* to 'conversation'. The auto-run queue drains
// to empty as soon as ConversationTab consumes its entry, which would
// otherwise flip the prop back to 'details' and reset state the user just
// chose via the Run-with-agent button or the tab strip.
watch(
  () => props.initialTab,
  (next) => { if (next === 'conversation') activeTab.value = next },
)

// Agent-mode gating: 'off' hides the Conversation tab entirely and steers
// the user to the terminal flow (/annotask-apply, MCP). 'manual' shows the
// tab but the agent only runs when the user clicks Run-with-agent. 'auto'
// fires on task creation (handled in useTaskWorkflows).
const providerSettings = useProviderSettings()
const agentMode = computed(() => providerSettings.settings.value.agentMode)
const agentReady = computed(() => providerSettings.ready.value)
// Embedded UI is gated on two things now: the top-level feature toggle
// (`embeddedAgentEnabled`) and the per-task aggressiveness (`agentMode`).
// When the user is in skill/MCP mode (`embeddedAgentEnabled !== true`) the
// Conversation tab and Run-with-agent button never appear, regardless of
// what `agentMode` is set to.
const embeddedAgentEnabled = computed(
  () => providerSettings.settings.value.embeddedAgentEnabled === true,
)
const showConversationTab = computed(
  () => embeddedAgentEnabled.value && agentMode.value !== 'off',
)

const canManualRun = computed(() =>
  embeddedAgentEnabled.value
  && agentMode.value === 'manual'
  && agentReady.value
  && (props.task.status === 'pending' || props.task.status === 'denied' || props.task.status === 'needs_info'),
)

function runWithAgent() {
  requestAutoRun(props.task.id, 'manual')
  activeTab.value = 'conversation'
}

// ── Per-task permission mode override ──
// Resolved at run time as `task ?? global`. Showing "Inherit" as the default
// keeps the override sparse — only set on tasks the user wants to treat
// differently from their global default.
const PERMISSION_MODE_OPTIONS: ReadonlyArray<{ id: PermissionMode; label: string }> = [
  { id: 'default', label: 'Default — ask for non-trivial actions' },
  { id: 'plan',    label: 'Plan — read-only' },
  { id: 'bypass',  label: 'Bypass — auto-approve everything' },
]
if (PERMISSION_MODE_OPTIONS.length !== PERMISSION_MODES.length) {
  // eslint-disable-next-line no-console
  console.warn('[annotask] TaskDetailModal PERMISSION_MODE_OPTIONS out of sync')
}

const taskPermissionMode = computed<string>(() => (props.task as { permissionMode?: PermissionMode }).permissionMode ?? '')

// Reflects the mode the task would run with if the user picks "Inherit".
// Mirrors the resolver: provider override beats global. Uses the persona's
// provider when one matches the task type so the dropdown shows what'll
// actually fire on a Run-with-agent click.
const inheritedPermissionMode = computed<PermissionMode>(() => {
  const persona = providerSettings.getPersonaForTaskType(props.task.type)
  const activeProviderId = persona?.providerId ?? providerSettings.activeProvider.value
  const providerCfg = providerSettings.settings.value.providers[activeProviderId]
  const providerMode = (providerCfg as { permissionMode?: PermissionMode }).permissionMode
  return providerMode ?? providerSettings.settings.value.permissionMode
})

function setTaskPermissionMode(value: string) {
  if (value === '') {
    emit('update', props.task.id, { permissionMode: null })
    return
  }
  if (!(PERMISSION_MODES as readonly string[]).includes(value)) return
  emit('update', props.task.id, { permissionMode: value })
}

const previewImage = ref<string | null>(null)
const editing = ref(false)
const editText = ref('')
const textareaRef = ref<HTMLTextAreaElement | null>(null)
const showJson = ref(false)
const showDeleteConfirm = ref(false)

const statusLabel: Record<string, string> = {
  pending: 'Pending',
  in_progress: 'In Progress',
  applied: 'Applied',
  review: 'In Review',
  accepted: 'Accepted',
  denied: 'Denied',
  needs_info: 'Needs Info',
  blocked: 'Blocked',
}

const isEditable = computed(() => props.task.status === 'pending' || props.task.status === 'denied')

const createdDate = computed(() => new Date(props.task.createdAt).toLocaleString())
const updatedDate = computed(() => new Date(props.task.updatedAt).toLocaleString())

const descriptionHtml = computed(() => safeMd(props.task.description))

const feedbackHtml = computed(() => safeMd(props.task.feedback || ''))

const blockedReasonHtml = computed(() => safeMd(props.task.blocked_reason || ''))

function formatTokens(n: number): string {
  if (n < 1000) return n.toString()
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`
  return `${(n / 1_000_000).toFixed(n < 10_000_000 ? 2 : 1)}M`
}

// ── Selected elements (from context) ──
interface ElementInfo {
  tag: string
  classes?: string
  component?: string
  file?: string
  line?: number
  role?: string // 'from' | 'to' for arrows
  text?: string
}

const selectedElements = computed<ElementInfo[]>(() => {
  const ctx = props.task.context as any
  if (!ctx) return []
  const elements: ElementInfo[] = []

  // Multi-element annotations
  if (ctx.elements && Array.isArray(ctx.elements)) {
    for (const e of ctx.elements) {
      elements.push({ tag: e.tag, classes: e.classes, component: e.component, file: e.file, line: e.line, text: e.text })
    }
    return elements
  }

  // Arrow: from + to elements
  if (ctx.from_element_tag) {
    elements.push({ tag: ctx.from_element_tag, classes: ctx.from_element_classes, role: 'from', text: ctx.from_element_text })
  }
  if (ctx.to_element) {
    const to = ctx.to_element
    elements.push({ tag: to.tag, classes: to.classes, component: to.component, file: to.file, line: to.line, role: 'to', text: to.text })
  }

  // Single element
  if (elements.length === 0 && ctx.element_tag) {
    elements.push({ tag: ctx.element_tag, classes: ctx.element_classes, text: ctx.element_text })
  }

  return elements
})

// ── Files involved (primary + any from elements/arrows) ──
interface FileRef {
  file: string
  line?: number
  component?: string
  label?: string
}

const fileRefs = computed<FileRef[]>(() => {
  const refs: FileRef[] = []
  if (props.task.file) {
    refs.push({ file: props.task.file, line: props.task.line, component: props.task.component })
  }
  const ctx = props.task.context as any
  if (ctx?.to_element?.file && ctx.to_element.file !== props.task.file) {
    refs.push({ file: ctx.to_element.file, line: ctx.to_element.line, component: ctx.to_element.component, label: 'to' })
  }
  if (ctx?.elements && Array.isArray(ctx.elements)) {
    for (const e of ctx.elements) {
      if (e.file && !refs.some(r => r.file === e.file && r.line === e.line)) {
        refs.push({ file: e.file, line: e.line, component: e.component })
      }
    }
  }
  return refs
})

// ── Context entries (filtered — skip element/arrow fields already shown above) ──
const contextSkipKeys = new Set(['element_tag', 'element_classes', 'element_text', 'elements', 'from_element_tag', 'from_element_classes', 'from_element_text', 'to_element', 'changes', 'selected_text'])

const contextEntries = computed(() => {
  if (!props.task.context) return []
  return Object.entries(props.task.context)
    .filter(([key]) => !contextSkipKeys.has(key))
    .map(([key, value]) => ({
      key,
      value: typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value),
      isObject: typeof value === 'object',
    }))
})

// ── Style/class changes from context ──
const styleChanges = computed(() => {
  const ctx = props.task.context as any
  if (!ctx?.changes || !Array.isArray(ctx.changes)) return []
  return ctx.changes as Array<{ property?: string; type?: string; before: string; after: string; file: string; line: number }>
})

// ── Selected text (text_edit tasks) ──
const selectedText = computed(() => (props.task.context as any)?.selected_text as string | undefined)

const screenshots = computed(() => {
  const list: string[] = []
  if (props.task.screenshot) list.push('/__annotask/screenshots/' + props.task.screenshot)
  return list
})

function onAgentReply(answers: Array<{ id: string; value: string }>) {
  emit('reply', props.task.id, answers)
}

function startEditing() {
  if (!isEditable.value) return
  editText.value = props.task.description
  editing.value = true
  nextTick(() => textareaRef.value?.focus())
}

function saveEdit() {
  const trimmed = editText.value.trim()
  if (!trimmed || trimmed === props.task.description) {
    editing.value = false
    return
  }
  emit('update', props.task.id, { description: trimmed })
  editing.value = false
}

function cancelEdit() {
  editing.value = false
}

watch(() => props.task.id, () => { editing.value = false })

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    if (editing.value) { cancelEdit(); return }
    if (previewImage.value) { previewImage.value = null; return }
    emit('close')
  }
}
</script>

<template>
  <div class="td-overlay" data-testid="task-detail-modal" @keydown="onKeydown" tabindex="-1">
    <div class="td-backdrop" @click="emit('close')" />
    <aside class="td-drawer">
      <!-- Header -->
      <header class="td-header">
        <div class="td-header-left">
          <span class="td-status" data-testid="task-detail-status" :class="task.status">{{ statusLabel[task.status] || task.status }}</span>
          <span class="td-type" data-testid="task-detail-type">{{ task.type }}</span>
          <span v-if="task.status === 'in_progress'" class="td-locked-badge">
            <Icon name="lock" :size="10" :stroke-width="2.5" />
            Locked
          </span>
        </div>
        <div class="td-header-right">
          <button data-testid="btn-modal-delete" class="td-delete-header-btn" @click="showDeleteConfirm = true" title="Delete task">
            <Icon name="trash" />
          </button>
          <button :class="['td-json-btn', { active: showJson }]" @click="showJson = !showJson" title="View JSON">
            <Icon name="code" />
          </button>
          <button class="td-close-btn" @click="emit('close')" title="Close (Esc)">
            <Icon name="x" :size="16" />
          </button>
        </div>
      </header>

      <!-- JSON view -->
      <TaskJsonView v-if="showJson" :task="task" />

      <!-- Tab strip — Details holds the existing fields; Conversation hosts
           the embedded chat scoped to this task. -->
      <nav v-else class="td-tabs" aria-label="Task detail sections">
        <button
          type="button"
          class="td-tab"
          :class="{ active: activeTab === 'details' }"
          :aria-current="activeTab === 'details' ? 'page' : undefined"
          @click="activeTab = 'details'"
        >Details</button>
        <button
          v-if="showConversationTab"
          type="button"
          class="td-tab"
          :class="{ active: activeTab === 'conversation' }"
          :aria-current="activeTab === 'conversation' ? 'page' : undefined"
          @click="activeTab = 'conversation'"
        >
          <Icon name="bot" :size="12" />
          <span>Conversation</span>
        </button>

        <!-- Manual-mode "Run with agent" — flanks the tab strip on the right
             so it reads as the primary call-to-action for this task. -->
        <button
          v-if="canManualRun"
          type="button"
          class="td-tab td-tab-run"
          data-testid="btn-modal-run-agent"
          title="Open the Conversation tab and start the agent on this task"
          @click="runWithAgent"
        >
          <Icon name="bot" :size="12" />
          <span>Run with agent</span>
        </button>
      </nav>

      <ConversationTab
        v-if="!showJson && activeTab === 'conversation' && showConversationTab"
        :task="task"
        @open-settings="emit('open-settings')"
        @reply="(taskId, answers) => emit('reply', taskId, answers)"
        @update="(taskId, fields) => emit('update', taskId, fields)"
      />

      <!-- Body -->
      <div v-else-if="!showJson" class="td-body">
        <!-- Description: rendered markdown → click to edit inline -->
        <section class="td-section">
          <div v-if="editing" class="td-editor">
            <textarea
              ref="textareaRef"
              data-testid="input-modal-edit"
              v-model="editText"
              class="td-edit-textarea"
              rows="8"
              placeholder="Describe the task (supports markdown)..."
              @keydown.ctrl.enter="saveEdit"
              @keydown.escape="cancelEdit"
            />
            <div class="td-editor-footer">
              <span class="td-edit-hint">Markdown supported. Ctrl+Enter to save.</span>
              <div class="td-edit-actions">
                <button data-testid="btn-modal-save" class="td-save-btn" :disabled="!editText.trim()" @click="saveEdit">Save</button>
                <button class="td-cancel-btn" @click="cancelEdit">Cancel</button>
              </div>
            </div>
          </div>
          <div v-else class="td-markdown" data-testid="task-detail-description" :class="{ 'td-clickable': isEditable }" v-html="descriptionHtml" @click="isEditable ? startEditing() : undefined" />
        </section>

        <!-- Permission mode override (per-task). Inherit = use persona/global. -->
        <section class="td-section td-perm-section">
          <h4 class="td-label">Permission mode</h4>
          <select
            class="td-perm-select"
            data-testid="task-permission-mode"
            :value="taskPermissionMode"
            @change="setTaskPermissionMode(($event.target as HTMLSelectElement).value)"
          >
            <option value="">Inherit ({{ inheritedPermissionMode }})</option>
            <option v-for="m in PERMISSION_MODE_OPTIONS" :key="m.id" :value="m.id">{{ m.label }}</option>
          </select>
          <p class="td-perm-hint">Controls how the agent approves actions on this task. Wins over the persona and global settings.</p>
        </section>

        <!-- Selected Elements -->
        <section v-if="selectedElements.length" class="td-section">
          <h4 class="td-label">Element{{ selectedElements.length > 1 ? 's' : '' }}</h4>
          <div class="td-elements">
            <div v-for="(el, i) in selectedElements" :key="i" class="td-element-chip">
              <span v-if="el.role" class="td-el-role">{{ el.role }}</span>
              <code class="td-el-tag">&lt;{{ el.tag }}&gt;</code>
              <span v-if="el.classes" class="td-el-classes">.{{ el.classes.split(' ').slice(0, 3).join('.') }}</span>
              <span v-if="el.text" class="td-el-text">"{{ el.text.length > 60 ? el.text.slice(0, 60) + '…' : el.text }}"</span>
              <span v-if="el.component" class="td-el-comp">{{ el.component }}</span>
            </div>
          </div>
        </section>

        <!-- Selected text (text_edit) -->
        <section v-if="selectedText" class="td-section">
          <h4 class="td-label">Selected Text</h4>
          <code class="td-selected-text">"{{ selectedText }}"</code>
        </section>

        <!-- Style/class changes -->
        <section v-if="styleChanges.length" class="td-section">
          <h4 class="td-label">Changes</h4>
          <div v-for="(ch, i) in styleChanges" :key="i" class="td-change-row">
            <code class="td-change-prop">{{ ch.type === 'class' ? 'classes' : ch.property }}</code>
            <span class="td-change-arrow">→</span>
            <code class="td-change-val">{{ ch.after }}</code>
          </div>
        </section>

        <!-- Files -->
        <section class="td-section">
          <h4 class="td-label">{{ fileRefs.length > 1 ? 'Files' : 'Source' }}</h4>
          <div v-for="(f, i) in fileRefs" :key="i" class="td-file-ref">
            <span v-if="f.label" class="td-file-label">{{ f.label }}</span>
            <code class="td-file-path">{{ f.file }}{{ f.line ? ':' + f.line : '' }}</code>
            <span v-if="f.component" class="td-file-comp">{{ f.component }}</span>
          </div>
          <div v-if="task.route" class="td-file-ref">
            <span class="td-file-label">route</span>
            <code class="td-file-path">{{ task.route }}</code>
          </div>
          <div v-if="task.mfe" class="td-file-ref">
            <span class="td-file-label">mfe</span>
            <code class="td-file-path">{{ task.mfe }}</code>
          </div>
        </section>

        <!-- Screenshots -->
        <section v-if="screenshots.length" class="td-section">
          <h4 class="td-label">Screenshots</h4>
          <div class="td-screenshots">
            <img
              v-for="(src, i) in screenshots"
              :key="i"
              :src="src"
              class="td-screenshot-thumb"
              @click="previewImage = src"
            />
          </div>
        </section>

        <!-- Agent Feedback Thread -->
        <section v-if="task.agent_feedback?.length" class="td-section">
          <h4 class="td-label">Agent Questions</h4>
          <TaskAgentFeedback
            :feedback="task.agent_feedback"
            :task-id="task.id"
            @reply="onAgentReply"
          />
        </section>

        <!-- Resolution -->
        <section v-if="task.resolution" class="td-section">
          <h4 class="td-label">Resolution</h4>
          <div class="td-resolution">{{ task.resolution }}</div>
        </section>

        <!-- Token usage -->
        <section v-if="task.tokenUsage && task.tokenUsage.turns > 0" class="td-section">
          <h4 class="td-label">Token Usage</h4>
          <div class="td-usage" data-testid="task-token-usage">
            <span class="td-usage-pill" title="Input tokens">↑ {{ formatTokens(task.tokenUsage.inputTokens) }}</span>
            <span class="td-usage-pill" title="Output tokens">↓ {{ formatTokens(task.tokenUsage.outputTokens) }}</span>
            <span
              v-if="task.tokenUsage.cacheReadTokens > 0 || task.tokenUsage.cacheCreationTokens > 0"
              class="td-usage-pill td-usage-cache"
              :title="`Cache read ${task.tokenUsage.cacheReadTokens.toLocaleString()} · write ${task.tokenUsage.cacheCreationTokens.toLocaleString()}`"
            >
              ⧉ {{ formatTokens(task.tokenUsage.cacheReadTokens + task.tokenUsage.cacheCreationTokens) }}
            </span>
            <span class="td-usage-meta">{{ task.tokenUsage.turns }} turn{{ task.tokenUsage.turns === 1 ? '' : 's' }}</span>
          </div>
        </section>

        <!-- Blocked reason -->
        <section v-if="task.blocked_reason" class="td-section">
          <h4 class="td-label">Blocked</h4>
          <div class="td-blocked">
            <div class="td-markdown" v-html="blockedReasonHtml" />
          </div>
        </section>

        <!-- Feedback (markdown) -->
        <section v-if="task.feedback" class="td-section">
          <h4 class="td-label">Feedback</h4>
          <div class="td-feedback">
            <div class="td-markdown" v-html="feedbackHtml" />
          </div>
        </section>

        <!-- Viewport -->
        <section v-if="task.viewport && (task.viewport.width || task.viewport.height)" class="td-section">
          <h4 class="td-label">Viewport</h4>
          <code class="td-meta-val">{{ task.viewport.width || 'auto' }} &times; {{ task.viewport.height || 'auto' }}</code>
        </section>

        <!-- Color scheme -->
        <section v-if="task.color_scheme" class="td-section">
          <h4 class="td-label">Color scheme</h4>
          <code class="td-meta-val">{{ task.color_scheme.scheme }}</code>
          <span class="td-meta-hint">via {{ task.color_scheme.source }}</span>
          <div v-if="task.color_scheme.marker" class="td-meta-marker">
            <template v-if="task.color_scheme.marker.kind === 'attribute'">
              &lt;{{ task.color_scheme.marker.host }} {{ task.color_scheme.marker.name }}="{{ task.color_scheme.marker.value }}"&gt;
            </template>
            <template v-else>
              &lt;{{ task.color_scheme.marker.host }} class="{{ task.color_scheme.marker.name }}"&gt;
              <span class="td-meta-hint">({{ task.color_scheme.marker.framework }})</span>
            </template>
          </div>
        </section>

        <!-- Context (remaining fields) -->
        <section v-if="contextEntries.length" class="td-section">
          <h4 class="td-label">Context</h4>
          <div v-for="entry in contextEntries" :key="entry.key" class="td-context-entry">
            <span class="td-context-key">{{ entry.key }}</span>
            <pre v-if="entry.isObject" class="td-pre">{{ entry.value }}</pre>
            <span v-else class="td-context-val">{{ entry.value }}</span>
          </div>
        </section>

        <!-- Interaction History (action log) -->
        <TaskInteractionHistory :interaction-history="task.interaction_history" />

        <!-- Timestamps -->
        <section class="td-section td-timestamps">
          <div class="td-meta-item">
            <span class="td-meta-key">Created</span>
            <span class="td-meta-val">{{ createdDate }}</span>
          </div>
          <div class="td-meta-item">
            <span class="td-meta-key">Updated</span>
            <span class="td-meta-val">{{ updatedDate }}</span>
          </div>
          <div class="td-meta-item">
            <span class="td-meta-key">ID</span>
            <code class="td-meta-val">{{ task.id }}</code>
          </div>
        </section>
      </div>

      <!-- Footer actions.
           (The needs_info reply action lives inside TaskAgentFeedback — it renders its
           own "Submit answers" button once every question has a non-empty draft.) -->
      <div v-if="task.status === 'blocked'" class="td-footer">
        <button data-testid="btn-modal-pushback" class="td-deny-btn" @click="emit('deny', task.id)">Push Back</button>
        <button data-testid="btn-modal-dismiss" class="td-dismiss-btn" @click="showDeleteConfirm = true">Dismiss</button>
      </div>
      <div v-else-if="task.status === 'review'" class="td-footer">
        <button data-testid="btn-modal-accept" class="td-accept" @click="emit('accept', task.id)">Accept</button>
        <button data-testid="btn-modal-deny" class="td-deny-btn" @click="emit('deny', task.id)">Deny</button>
      </div>
    </aside>

    <!-- Screenshot preview lightbox -->
    <div v-if="previewImage" class="td-lightbox" @click="previewImage = null">
      <img :src="previewImage" class="td-lightbox-img" @click.stop />
      <button class="td-lightbox-close" @click="previewImage = null">&times;</button>
    </div>

    <ConfirmDialog
      v-if="showDeleteConfirm"
      message="Delete this task? This cannot be undone."
      @confirm="showDeleteConfirm = false; emit('delete', task.id)"
      @cancel="showDeleteConfirm = false"
    />
  </div>
</template>

<style>
/* Overlay + drawer */
.td-overlay {
  position: fixed; inset: 0; z-index: 50000;
  display: flex; justify-content: flex-end;
}
.td-backdrop {
  position: absolute; inset: 0;
  background: rgba(0, 0, 0, 0.4);
}
.td-drawer {
  position: relative;
  width: min(560px, 85vw);
  height: 100%;
  background: var(--bg);
  border-left: 1px solid var(--border);
  display: flex; flex-direction: column;
  animation: td-slide-in 0.15s ease-out;
}
@keyframes td-slide-in {
  from { transform: translateX(100%); }
  to { transform: translateX(0); }
}

/* Header */
.td-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 14px 18px; border-bottom: 1px solid var(--border);
  background: var(--surface); flex-shrink: 0;
}
.td-header-left { display: flex; align-items: center; gap: 8px; }
.td-status {
  font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em;
  padding: 2px 8px; border-radius: 4px;
}
.td-status.pending { background: color-mix(in srgb, var(--status-pending) 20%, transparent); color: var(--text-muted); }
.td-status.in_progress { background: color-mix(in srgb, var(--status-in-progress) 15%, transparent); color: var(--info); }
.td-status.applied { background: color-mix(in srgb, var(--status-in-progress) 15%, transparent); color: var(--info); }
.td-status.review { background: color-mix(in srgb, var(--status-review) 15%, transparent); color: var(--status-review); }
.td-status.accepted { background: color-mix(in srgb, var(--status-accepted) 15%, transparent); color: var(--success); }
.td-status.denied { background: color-mix(in srgb, var(--status-denied) 15%, transparent); color: var(--syntax-null); }
.td-type {
  font-size: 11px; color: var(--text-muted); font-family: monospace;
  background: var(--surface-2); padding: 2px 6px; border-radius: 3px; border: 1px solid var(--border);
}
.td-locked-badge {
  display: flex; align-items: center; gap: 3px;
  font-size: 9px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em;
  color: var(--info); background: color-mix(in srgb, var(--status-in-progress) 10%, transparent); padding: 2px 6px; border-radius: 3px;
}
.td-header-right { display: flex; align-items: center; gap: 4px; }
.td-json-btn {
  display: flex; align-items: center; justify-content: center;
  width: 28px; height: 28px; color: var(--text-muted);
  background: transparent; border: 1px solid transparent; border-radius: 6px; cursor: pointer;
}
.td-json-btn:hover { background: var(--surface-2); color: var(--text); }
.td-json-btn.active { background: var(--surface-2); color: var(--accent); border-color: var(--border); }
.td-close-btn {
  display: flex; align-items: center; justify-content: center;
  width: 28px; height: 28px; color: var(--text-muted);
  background: transparent; border: none; border-radius: 6px; cursor: pointer;
}
.td-close-btn:hover { background: var(--surface-2); color: var(--text); }

/* Body */
.td-body { flex: 1; overflow-y: auto; padding: 20px; }
.td-section { margin-bottom: 20px; }
.td-section:last-child { margin-bottom: 0; }
.td-label {
  font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em;
  color: var(--text-muted); margin-bottom: 8px;
}

/* Permission-mode picker */
.td-perm-select {
  width: 100%;
  font: inherit;
  font-size: 12px;
  padding: 6px 10px;
  border: 1px solid var(--border);
  background: var(--surface-2);
  color: var(--text);
  border-radius: 5px;
}
.td-perm-select:focus { outline: none; border-color: var(--accent); }
.td-perm-hint {
  margin: 6px 2px 0;
  font-size: 11px;
  line-height: 1.4;
  color: var(--text-muted);
}

/* Inline editor */
.td-editor {
  border: 1px solid var(--border); border-radius: 8px; overflow: hidden;
  background: var(--bg);
}
.td-edit-textarea {
  width: 100%; min-height: 180px; padding: 12px; font-size: 13px; line-height: 1.6;
  background: transparent; border: none; color: var(--text);
  resize: vertical; font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace;
  outline: none; display: block;
}
.td-editor-footer {
  display: flex; align-items: center; justify-content: space-between;
  padding: 8px 12px; border-top: 1px solid var(--border); background: var(--surface);
}
.td-edit-hint { font-size: 10px; color: var(--text-muted); }
.td-edit-actions { display: flex; gap: 6px; }
.td-save-btn {
  padding: 5px 14px; font-size: 11px; font-weight: 600;
  background: var(--accent); color: var(--text-on-accent); border: none; border-radius: 5px; cursor: pointer;
}
.td-save-btn:disabled { opacity: 0.4; cursor: default; }
.td-save-btn:hover:not(:disabled) { opacity: 0.9; }
.td-cancel-btn {
  padding: 5px 14px; font-size: 11px;
  background: var(--surface-2); color: var(--text-muted); border: 1px solid var(--border);
  border-radius: 5px; cursor: pointer;
}
.td-cancel-btn:hover { color: var(--text); }

/* Clickable description */
.td-clickable { cursor: text; border-radius: 6px; padding: 8px 10px; margin: -8px -10px; }
.td-clickable:hover { background: var(--surface-2); }

/* Markdown rendering */
.td-markdown { font-size: 13px; line-height: 1.6; color: var(--text); }
.td-markdown p { margin: 0 0 8px; }
.td-markdown p:last-child { margin-bottom: 0; }
.td-markdown strong { color: var(--text); font-weight: 600; }
.td-markdown em { color: var(--text-muted); }
.td-markdown code {
  font-family: 'SF Mono', 'Fira Code', monospace; font-size: 11px;
  background: var(--surface-2); padding: 1px 5px; border-radius: 3px; border: 1px solid var(--border);
}
.td-markdown pre {
  background: var(--bg); border: 1px solid var(--border); border-radius: 6px;
  padding: 10px 12px; overflow-x: auto; margin: 8px 0;
}
.td-markdown pre code { background: none; border: none; padding: 0; font-size: 11px; line-height: 1.5; }
.td-markdown ul, .td-markdown ol { margin: 4px 0 8px 18px; }
.td-markdown li { margin-bottom: 2px; }
.td-markdown h1, .td-markdown h2, .td-markdown h3, .td-markdown h4 {
  margin: 12px 0 6px; font-size: 13px; font-weight: 600; color: var(--text);
}
.td-markdown blockquote {
  border-left: 3px solid var(--border); padding: 4px 12px; margin: 8px 0;
  color: var(--text-muted); font-style: italic;
}

/* Selected elements */
.td-elements { display: flex; flex-wrap: wrap; gap: 6px; }
.td-element-chip {
  display: inline-flex; align-items: center; gap: 4px;
  padding: 4px 8px; background: var(--surface-2); border: 1px solid var(--border);
  border-radius: 5px; font-size: 11px;
}
.td-el-role {
  font-size: 9px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.03em;
  color: var(--text-muted); background: var(--bg); padding: 1px 4px; border-radius: 3px;
}
.td-el-tag { color: var(--accent); font-family: monospace; }
.td-el-classes { color: var(--success); font-size: 10px; font-family: monospace; max-width: 150px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.td-el-text { color: var(--text-muted); font-size: 10px; font-style: italic; max-width: 220px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.td-el-comp { color: var(--role-component); font-size: 10px; }

/* Selected text */
.td-selected-text {
  font-size: 12px; color: var(--status-review); font-family: monospace;
  background: color-mix(in srgb, var(--warning) 8%, transparent); padding: 4px 8px; border-radius: 4px; border: 1px solid color-mix(in srgb, var(--warning) 20%, transparent);
}

/* Style/class changes */
.td-change-row {
  display: flex; align-items: center; gap: 6px; padding: 3px 0;
  font-size: 11px;
}
.td-change-prop { color: var(--text-muted); font-family: monospace; }
.td-change-arrow { color: var(--text-muted); font-size: 10px; }
.td-change-val { color: var(--success); font-family: monospace; }

/* File refs */
.td-file-ref {
  display: flex; align-items: center; gap: 6px;
  padding: 3px 0; font-size: 11px;
}
.td-file-ref + .td-file-ref { border-top: 1px solid var(--border); }
.td-file-label {
  font-size: 9px; font-weight: 600; text-transform: uppercase; color: var(--text-muted);
  background: var(--bg); padding: 1px 4px; border-radius: 3px; letter-spacing: 0.03em;
}
.td-file-path { color: var(--accent); font-family: monospace; font-size: 11px; }
.td-file-comp { color: var(--role-component); font-size: 10px; margin-left: auto; }

/* Meta grid */
.td-meta-grid { display: flex; flex-wrap: wrap; gap: 8px 20px; }
.td-meta-item { display: flex; flex-direction: column; gap: 2px; }
.td-meta-key { font-size: 10px; color: var(--text-muted); }
.td-meta-val { font-size: 12px; color: var(--text); }
.td-meta-hint { font-size: 11px; color: var(--text-muted); margin-left: 6px; }
.td-meta-marker { font-size: 11px; color: var(--text-muted); font-family: var(--font-mono, monospace); margin-top: 4px; }

/* Screenshots */
.td-screenshots { display: flex; flex-wrap: wrap; gap: 8px; }
.td-screenshot-thumb {
  width: 140px; height: 90px; object-fit: cover;
  border-radius: 6px; border: 1px solid var(--border);
  cursor: pointer; transition: border-color 0.12s, transform 0.12s;
}
.td-screenshot-thumb:hover { border-color: var(--accent); transform: scale(1.03); }

/* Screenshot lightbox */
.td-lightbox {
  position: fixed; inset: 0; z-index: 60000;
  background: rgba(0, 0, 0, 0.85);
  display: flex; align-items: center; justify-content: center;
  padding: 32px; cursor: pointer;
}
.td-lightbox-img {
  max-width: 90vw; max-height: 90vh;
  border-radius: 8px; box-shadow: 0 8px 32px rgba(0,0,0,0.6);
  cursor: default;
}
.td-lightbox-close {
  position: absolute; top: 16px; right: 16px;
  width: 36px; height: 36px; border: none; border-radius: 50%;
  background: rgba(255,255,255,0.15); color: white;
  font-size: 22px; cursor: pointer; display: flex; align-items: center; justify-content: center;
}
.td-lightbox-close:hover { background: rgba(255,255,255,0.3); }

/* Feedback */
.td-feedback {
  padding: 10px 12px; background: color-mix(in srgb, var(--danger) 6%, transparent); border-radius: 6px;
  border-left: 3px solid var(--danger);
}
.td-feedback .td-markdown { color: var(--syntax-null); }

/* Context */
.td-context-entry { margin-bottom: 8px; }
.td-context-key {
  font-size: 10px; font-weight: 600; color: var(--text-muted); display: block; margin-bottom: 2px;
}
.td-context-val { font-size: 11px; color: var(--text); }
.td-pre {
  display: block; padding: 8px 10px; background: var(--bg); border: 1px solid var(--border);
  border-radius: 5px; font-family: monospace; font-size: 10px; line-height: 1.4;
  overflow-x: auto; white-space: pre; max-height: 200px; margin: 0;
}

/* Ancestors */
.td-ancestor {
  display: flex; align-items: center; gap: 6px; padding: 4px 0;
  font-size: 11px; border-bottom: 1px solid var(--border);
}
.td-ancestor:last-child { border-bottom: none; }
.td-ancestor-tag { color: var(--accent); font-family: monospace; font-size: 11px; }
.td-ancestor-display { color: var(--text-muted); }
.td-ancestor-prop { color: var(--text-muted); font-size: 10px; }
.td-ancestor-comp { margin-left: auto; color: var(--role-component); font-size: 10px; }

/* Interaction history — action log */
.td-history-current { font-weight: 400; color: var(--accent); text-transform: none; letter-spacing: 0; font-family: monospace; }
.td-nav-path { display: flex; flex-wrap: wrap; align-items: center; gap: 2px; margin-bottom: 8px; }
.td-nav-route { font-size: 10px; font-family: monospace; color: var(--text-muted); padding: 1px 5px; background: var(--surface-2); border-radius: 3px; }
.td-nav-sep { font-size: 9px; color: var(--text-muted); }
.td-log { border: 1px solid var(--border); border-radius: 6px; overflow: hidden; }
.td-log-entry {
  display: flex; align-items: baseline; gap: 8px;
  padding: 5px 10px; font-size: 11px;
  border-bottom: 1px solid var(--border);
}
.td-log-entry:last-child { border-bottom: none; }
.td-log-entry:nth-child(odd) { background: var(--surface-2); }
.td-log-idx {
  font-size: 9px; color: var(--text-muted); font-family: monospace;
  min-width: 18px; text-align: right; flex-shrink: 0;
}
.td-log-event {
  font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.03em;
  padding: 1px 5px; border-radius: 3px; flex-shrink: 0; min-width: 60px; text-align: center;
}
.td-log-event.route_change { background: color-mix(in srgb, var(--accent) 12%, transparent); color: var(--info); }
.td-log-event.action { background: color-mix(in srgb, var(--success) 12%, transparent); color: var(--success); }
.td-log-detail { color: var(--text); font-family: monospace; font-size: 11px; word-break: break-word; }

/* Timestamps */
.td-timestamps { display: flex; flex-wrap: wrap; gap: 8px 20px; padding-top: 16px; border-top: 1px solid var(--border); }

/* Footer */
.td-footer {
  display: flex; gap: 8px; padding: 14px 18px;
  border-top: 1px solid var(--border); flex-shrink: 0; background: var(--surface);
}
.td-accept, .td-deny-btn {
  flex: 1; padding: 8px 0; font-size: 12px; font-weight: 600;
  border: none; border-radius: 6px; cursor: pointer; transition: all 0.12s;
}
.td-accept { background: color-mix(in srgb, var(--success) 15%, transparent); color: var(--success); }
.td-accept:hover { background: var(--success); color: var(--text-on-accent); }
.td-deny-btn { background: color-mix(in srgb, var(--danger) 12%, transparent); color: var(--danger); }
.td-deny-btn:hover { background: var(--danger); color: var(--text-on-accent); }
.td-tabs {
  display: flex;
  gap: 4px;
  padding: 6px 12px 0;
  border-bottom: 1px solid var(--border);
  background: var(--surface);
}
.td-tab {
  display: inline-flex; align-items: center; gap: 6px;
  background: none; border: none;
  padding: 8px 12px;
  font: inherit; font-size: 12px; font-weight: 500;
  color: var(--text-muted); cursor: pointer;
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;
}
.td-tab:hover { color: var(--text); }
.td-tab.active {
  color: var(--text);
  font-weight: 600;
  border-bottom-color: var(--accent);
}
.td-tab:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: -1px;
  border-radius: 4px;
}

/* Run-with-agent CTA — visually distinct from the regular tabs so users
   read it as an action, not a passive navigation. Pushed to the right. */
.td-tab.td-tab-run {
  margin-left: auto;
  color: var(--accent);
  font-weight: 700;
  border-bottom: none;
}
.td-tab.td-tab-run:hover {
  background: color-mix(in srgb, var(--accent) 12%, transparent);
  border-radius: 4px;
}
.td-delete-header-btn {
  width: 28px; height: 28px; display: flex; align-items: center; justify-content: center;
  border: none; border-radius: 6px; cursor: pointer; transition: all 0.12s;
  background: none; color: var(--text-muted);
}
.td-delete-header-btn:hover { background: color-mix(in srgb, var(--danger) 12%, transparent); color: var(--danger); }

/* Resolution */
.td-resolution {
  padding: 8px 12px; background: color-mix(in srgb, var(--success) 6%, transparent); border-radius: 6px;
  border-left: 3px solid var(--success); font-size: 12px; color: var(--syntax-string); line-height: 1.5;
}

/* Token usage */
.td-usage { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
.td-usage-pill {
  font-size: 11px; font-family: monospace; padding: 2px 6px; border-radius: 4px;
  background: color-mix(in srgb, var(--accent) 10%, transparent);
  color: var(--text); border: 1px solid color-mix(in srgb, var(--accent) 20%, transparent);
}
.td-usage-pill.td-usage-cache {
  background: color-mix(in srgb, var(--info) 10%, transparent);
  border-color: color-mix(in srgb, var(--info) 20%, transparent);
}
.td-usage-meta { font-size: 11px; color: var(--text-muted); }

/* Status: needs_info */
.td-status.needs_info { background: color-mix(in srgb, var(--status-needs-info) 15%, transparent); color: var(--syntax-boolean); }

/* Status: blocked */
.td-status.blocked { background: color-mix(in srgb, var(--status-blocked) 15%, transparent); color: var(--status-blocked); }

/* Blocked reason */
.td-blocked {
  padding: 10px 12px; background: color-mix(in srgb, var(--status-blocked) 6%, transparent); border-radius: 6px;
  border-left: 3px solid var(--status-blocked);
}
.td-blocked .td-markdown { color: var(--status-blocked); }

/* Dismiss button */
.td-dismiss-btn {
  flex: 1; padding: 8px 0; font-size: 12px; font-weight: 600;
  border: none; border-radius: 6px; cursor: pointer; transition: all 0.12s;
  background: color-mix(in srgb, var(--text-muted) 15%, transparent); color: var(--text-muted);
}
.td-dismiss-btn:hover { background: color-mix(in srgb, var(--text-muted) 30%, transparent); color: var(--text); }

/* Agent feedback thread */
.td-agent-exchange {
  padding: 10px 12px; border-radius: 6px; margin-bottom: 8px;
  border-left: 3px solid var(--indigo); background: color-mix(in srgb, var(--indigo) 6%, transparent);
}
.td-agent-exchange.answered { opacity: 0.7; }
.td-agent-msg {
  font-size: 12px; color: var(--text); margin-bottom: 8px; line-height: 1.5;
}
.td-agent-msg p { margin: 0 0 4px; }
.td-agent-question { margin-bottom: 10px; }
.td-agent-question:last-child { margin-bottom: 0; }
.td-agent-q-text {
  font-size: 12px; font-weight: 600; color: var(--text); margin: 0 0 6px;
}
.td-agent-options { display: flex; flex-wrap: wrap; gap: 6px; }
.td-agent-option {
  padding: 5px 12px; font-size: 11px; font-weight: 500;
  background: var(--surface-2); color: var(--text); border: 1px solid var(--border);
  border-radius: 6px; cursor: pointer; transition: all 0.12s;
}
.td-agent-option:hover { border-color: var(--indigo); color: var(--indigo); }
.td-agent-option.selected {
  background: color-mix(in srgb, var(--indigo) 20%, transparent); border-color: var(--indigo); color: var(--indigo);
}
.td-agent-answer {
  padding: 5px 10px; background: color-mix(in srgb, var(--success) 8%, transparent); border-radius: 5px;
  font-size: 11px; color: var(--syntax-string); border-left: 2px solid var(--success);
}
.td-reply-textarea {
  width: 100%; padding: 8px 10px; font-size: 12px; font-family: inherit;
  background: var(--surface-2); color: var(--text); border: 1px solid var(--border);
  border-radius: 6px; resize: vertical; outline: none; box-sizing: border-box;
}
.td-reply-textarea:focus { border-color: var(--indigo); }
.td-reply-btn {
  flex: 1; padding: 8px 0; font-size: 12px; font-weight: 600;
  border: none; border-radius: 6px; cursor: pointer; transition: all 0.12s;
  background: color-mix(in srgb, var(--indigo) 15%, transparent); color: var(--indigo);
}
.td-reply-btn:hover:not(:disabled) { background: var(--indigo); color: var(--text-on-accent); }
.td-reply-btn:disabled { opacity: 0.4; cursor: not-allowed; }
</style>
