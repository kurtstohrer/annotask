<script setup lang="ts">
import { computed, ref, watch, nextTick } from 'vue'
import Prism from 'prismjs'
import 'prismjs/components/prism-json'
import { safeMd } from '../utils/safeMd'
import type { Task } from '../composables/useTasks'
import ConfirmDialog from './ConfirmDialog.vue'

const props = defineProps<{
  task: Task
}>()

const emit = defineEmits<{
  close: []
  accept: [id: string]
  deny: [id: string]
  delete: [id: string]
  update: [id: string, fields: Record<string, unknown>]
  reply: [id: string, answers: Array<{ id: string; value: string }>]
}>()

const previewImage = ref<string | null>(null)
const editing = ref(false)
const editText = ref('')
const textareaRef = ref<HTMLTextAreaElement | null>(null)
const showJson = ref(false)
const jsonCopied = ref(false)
const showDeleteConfirm = ref(false)

const taskJson = computed(() => JSON.stringify(props.task, null, 2))

function escapeHtml(str: string) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

const taskJsonHighlighted = computed(() => {
  if (!showJson.value) return ''
  const grammar = Prism.languages.json
  return grammar ? Prism.highlight(taskJson.value, grammar, 'json') : escapeHtml(taskJson.value)
})

function copyJson() {
  navigator.clipboard.writeText(taskJson.value)
  jsonCopied.value = true
  setTimeout(() => (jsonCopied.value = false), 2000)
}

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

// ── Selected elements (from context) ──
interface ElementInfo {
  tag: string
  classes?: string
  component?: string
  file?: string
  line?: number
  role?: string // 'from' | 'to' for arrows
}

const selectedElements = computed<ElementInfo[]>(() => {
  const ctx = props.task.context as any
  if (!ctx) return []
  const elements: ElementInfo[] = []

  // Multi-element annotations
  if (ctx.elements && Array.isArray(ctx.elements)) {
    for (const e of ctx.elements) {
      elements.push({ tag: e.tag, classes: e.classes, component: e.component, file: e.file, line: e.line })
    }
    return elements
  }

  // Arrow: from + to elements
  if (ctx.from_element_tag) {
    elements.push({ tag: ctx.from_element_tag, classes: ctx.from_element_classes, role: 'from' })
  }
  if (ctx.to_element) {
    const to = ctx.to_element
    elements.push({ tag: to.tag, classes: to.classes, component: to.component, file: to.file, line: to.line, role: 'to' })
  }

  // Single element
  if (elements.length === 0 && ctx.element_tag) {
    elements.push({ tag: ctx.element_tag, classes: ctx.element_classes })
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
const contextSkipKeys = new Set(['element_tag', 'element_classes', 'elements', 'from_element_tag', 'from_element_classes', 'to_element', 'changes', 'selected_text'])

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

const ancestorList = computed(() => {
  const ec = props.task.element_context as any
  if (!ec?.ancestors) return []
  return ec.ancestors
})

// ── Interaction history as action log ──
interface LogEntry {
  event: string
  route?: string
  detail: string
  data: Record<string, unknown>
}

const historyLog = computed<LogEntry[]>(() => {
  const ih = props.task.interaction_history as any
  if (!ih?.recent_actions) return []
  return ih.recent_actions.map((a: any) => {
    let detail = ''
    if (a.event === 'route_change') {
      const prev = a.data?.previousRoute
      detail = prev ? `${prev} → ${a.route || ih.current_route}` : `navigated to ${a.route || ih.current_route}`
    } else if (a.event === 'action') {
      const parts: string[] = []
      if (a.data?.tag) parts.push(`<${a.data.tag}>`)
      if (a.data?.text) parts.push(`"${String(a.data.text).slice(0, 40)}"`)
      if (a.data?.href) parts.push(`→ ${a.data.href}`)
      detail = parts.join(' ') || 'user action'
    } else {
      detail = JSON.stringify(a.data || {})
    }
    return { event: a.event, route: a.route, detail, data: a.data || {} }
  })
})

const historyRoute = computed(() => {
  const ih = props.task.interaction_history as any
  return ih?.current_route || ''
})

const historyNavPath = computed(() => {
  const ih = props.task.interaction_history as any
  return ih?.navigation_path || []
})

const screenshots = computed(() => {
  const list: string[] = []
  if (props.task.screenshot) list.push('/__annotask/screenshots/' + props.task.screenshot)
  return list
})

// ── Agent feedback ──
import type { AgentFeedbackEntry } from '../composables/useTasks'

const replyDraft = ref<Record<string, string>>({})

const pendingExchange = computed(() => {
  const af = props.task.agent_feedback
  if (!af?.length) return null
  const last = af[af.length - 1]
  return last.answered_at ? null : last
})

function selectChoice(questionId: string, value: string) {
  replyDraft.value[questionId] = value
}

function submitReply() {
  const exchange = pendingExchange.value
  if (!exchange) return
  const answers = exchange.questions.map(q => ({
    id: q.id,
    value: replyDraft.value[q.id] || '',
  }))
  if (answers.some(a => !a.value)) return // all questions must be answered
  emit('reply', props.task.id, answers)
  replyDraft.value = {}
}

watch(() => props.task.id, () => { replyDraft.value = {} })

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
  <div class="td-overlay" @keydown="onKeydown" tabindex="-1">
    <div class="td-backdrop" @click="emit('close')" />
    <aside class="td-drawer">
      <!-- Header -->
      <header class="td-header">
        <div class="td-header-left">
          <span class="td-status" :class="task.status">{{ statusLabel[task.status] || task.status }}</span>
          <span class="td-type">{{ task.type }}</span>
          <span v-if="task.status === 'in_progress'" class="td-locked-badge">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
            Locked
          </span>
        </div>
        <div class="td-header-right">
          <button class="td-delete-header-btn" @click="showDeleteConfirm = true" title="Delete task">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
          </button>
          <button :class="['td-json-btn', { active: showJson }]" @click="showJson = !showJson" title="View JSON">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>
          </button>
          <button class="td-close-btn" @click="emit('close')" title="Close (Esc)">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
      </header>

      <!-- JSON view -->
      <div v-if="showJson" class="td-body td-json-body">
        <div class="td-json-toolbar">
          <button class="td-json-copy" @click="copyJson">{{ jsonCopied ? 'Copied!' : 'Copy' }}</button>
        </div>
        <pre class="td-json-pre"><code v-html="taskJsonHighlighted" /></pre>
      </div>

      <!-- Body -->
      <div v-else class="td-body">
        <!-- Description: rendered markdown → click to edit inline -->
        <section class="td-section">
          <div v-if="editing" class="td-editor">
            <textarea
              ref="textareaRef"
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
                <button class="td-save-btn" :disabled="!editText.trim()" @click="saveEdit">Save</button>
                <button class="td-cancel-btn" @click="cancelEdit">Cancel</button>
              </div>
            </div>
          </div>
          <div v-else class="td-markdown" :class="{ 'td-clickable': isEditable }" v-html="descriptionHtml" @click="isEditable ? startEditing() : undefined" />
        </section>

        <!-- Selected Elements -->
        <section v-if="selectedElements.length" class="td-section">
          <h4 class="td-label">Element{{ selectedElements.length > 1 ? 's' : '' }}</h4>
          <div class="td-elements">
            <div v-for="(el, i) in selectedElements" :key="i" class="td-element-chip">
              <span v-if="el.role" class="td-el-role">{{ el.role }}</span>
              <code class="td-el-tag">&lt;{{ el.tag }}&gt;</code>
              <span v-if="el.classes" class="td-el-classes">.{{ el.classes.split(' ').slice(0, 3).join('.') }}</span>
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
          <div v-for="(exchange, ei) in task.agent_feedback" :key="ei" class="td-agent-exchange" :class="{ answered: !!exchange.answered_at }">
            <div v-if="exchange.message" class="td-agent-msg" v-html="safeMd(exchange.message)" />
            <div v-for="q in exchange.questions" :key="q.id" class="td-agent-question">
              <p class="td-agent-q-text">{{ q.text }}</p>
              <!-- Answered: show answer -->
              <template v-if="exchange.answered_at">
                <div class="td-agent-answer">{{ exchange.answers?.find(a => a.id === q.id)?.value }}</div>
              </template>
              <!-- Unanswered: interactive form -->
              <template v-else>
                <div v-if="q.type === 'choice' && q.options" class="td-agent-options">
                  <button
                    v-for="opt in q.options"
                    :key="opt"
                    class="td-agent-option"
                    :class="{ selected: replyDraft[q.id] === opt }"
                    @click="selectChoice(q.id, opt)"
                  >{{ opt }}</button>
                </div>
                <textarea
                  v-else
                  class="td-reply-textarea"
                  :value="replyDraft[q.id] || ''"
                  @input="replyDraft[q.id] = ($event.target as HTMLTextAreaElement).value"
                  placeholder="Type your answer..."
                  rows="2"
                />
              </template>
            </div>
          </div>
        </section>

        <!-- Resolution -->
        <section v-if="task.resolution" class="td-section">
          <h4 class="td-label">Resolution</h4>
          <div class="td-resolution">{{ task.resolution }}</div>
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

        <!-- Context (remaining fields) -->
        <section v-if="contextEntries.length" class="td-section">
          <h4 class="td-label">Context</h4>
          <div v-for="entry in contextEntries" :key="entry.key" class="td-context-entry">
            <span class="td-context-key">{{ entry.key }}</span>
            <pre v-if="entry.isObject" class="td-pre">{{ entry.value }}</pre>
            <span v-else class="td-context-val">{{ entry.value }}</span>
          </div>
        </section>

        <!-- Element Context (ancestors) -->
        <section v-if="ancestorList.length" class="td-section">
          <h4 class="td-label">Layout Ancestors</h4>
          <div v-for="(a, i) in ancestorList" :key="i" class="td-ancestor">
            <code class="td-ancestor-tag">&lt;{{ a.tag }}&gt;</code>
            <span class="td-ancestor-display">{{ a.display }}</span>
            <span v-if="a.flexDirection" class="td-ancestor-prop">flex: {{ a.flexDirection }}</span>
            <span v-if="a.gap" class="td-ancestor-prop">gap: {{ a.gap }}</span>
            <span v-if="a.component" class="td-ancestor-comp">{{ a.component }}</span>
          </div>
        </section>

        <!-- Interaction History (action log) -->
        <section v-if="historyLog.length" class="td-section">
          <h4 class="td-label">
            Interaction History
            <span v-if="historyRoute" class="td-history-current">on {{ historyRoute }}</span>
          </h4>
          <div v-if="historyNavPath.length > 1" class="td-nav-path">
            <span v-for="(p, i) in historyNavPath" :key="i" class="td-nav-step">
              <span class="td-nav-route">{{ p }}</span>
              <span v-if="i < historyNavPath.length - 1" class="td-nav-sep">→</span>
            </span>
          </div>
          <div class="td-log">
            <div v-for="(entry, i) in historyLog" :key="i" class="td-log-entry">
              <span class="td-log-idx">{{ i + 1 }}</span>
              <span :class="['td-log-event', entry.event]">{{ entry.event === 'route_change' ? 'navigate' : entry.event }}</span>
              <span class="td-log-detail">{{ entry.detail }}</span>
            </div>
          </div>
        </section>

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

      <!-- Footer actions -->
      <div v-if="task.status === 'needs_info' && pendingExchange" class="td-footer">
        <button class="td-reply-btn" :disabled="pendingExchange.questions.some(q => !replyDraft[q.id])" @click="submitReply">Reply &amp; Resume</button>
      </div>
      <div v-else-if="task.status === 'blocked'" class="td-footer">
        <button class="td-deny-btn" @click="emit('deny', task.id)">Push Back</button>
        <button class="td-dismiss-btn" @click="showDeleteConfirm = true">Dismiss</button>
      </div>
      <div v-else-if="task.status === 'review'" class="td-footer">
        <button class="td-accept" @click="emit('accept', task.id)">Accept</button>
        <button class="td-deny-btn" @click="emit('deny', task.id)">Deny</button>
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
.td-delete-header-btn {
  width: 28px; height: 28px; display: flex; align-items: center; justify-content: center;
  border: none; border-radius: 6px; cursor: pointer; transition: all 0.12s;
  background: none; color: var(--text-muted);
}
.td-delete-header-btn:hover { background: color-mix(in srgb, var(--danger) 12%, transparent); color: var(--danger); }

/* JSON view */
.td-json-body { padding: 0; display: flex; flex-direction: column; }
.td-json-toolbar {
  display: flex; justify-content: flex-end; padding: 8px 12px;
  border-bottom: 1px solid var(--border); background: var(--surface); flex-shrink: 0;
}
.td-json-copy {
  padding: 4px 12px; font-size: 11px; font-weight: 500;
  background: var(--surface-2); color: var(--text); border: 1px solid var(--border);
  border-radius: 5px; cursor: pointer;
}
.td-json-copy:hover { background: var(--border); }
.td-json-pre {
  margin: 0; padding: 16px; flex: 1; overflow: auto;
  font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace;
  font-size: 11px; line-height: 1.6; color: var(--text); tab-size: 2;
}
.td-json-pre .token.property,
.td-json-pre .token.key { color: var(--syntax-property); }
.td-json-pre .token.string { color: var(--syntax-string); }
.td-json-pre .token.number { color: var(--syntax-number); }
.td-json-pre .token.boolean { color: var(--syntax-boolean); }
.td-json-pre .token.null { color: var(--syntax-null); }
.td-json-pre .token.operator { color: var(--syntax-operator); }
.td-json-pre .token.punctuation { color: var(--syntax-punctuation); }

/* Resolution */
.td-resolution {
  padding: 8px 12px; background: color-mix(in srgb, var(--success) 6%, transparent); border-radius: 6px;
  border-left: 3px solid var(--success); font-size: 12px; color: var(--syntax-string); line-height: 1.5;
}

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
