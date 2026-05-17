<script setup lang="ts">
/**
 * Conversation tab — per-task work-stream observer.
 *
 * Renders the agent's live timeline (text + tool calls + tool results) as
 * the agent works, plus persisted past turns. The composer is for steering
 * (queue for next turn), not free-form chat — happy-path users never need
 * to type here.
 */
import { ref, watch, computed, onMounted, onBeforeUnmount, nextTick } from 'vue'
import Icon from './Icon.vue'
import ConversationMessage from './ConversationMessage.vue'
import ConversationStreamBlock from './ConversationStreamBlock.vue'
import TaskAgentFeedback from './TaskAgentFeedback.vue'
import { useTaskThread, useAgentDetect, fetchAgentDetect } from '../composables/useTaskThread'
import { useEmbeddedAgent } from '../composables/useEmbeddedAgent'
import { useWorkingIndicator } from '../composables/useWorkingIndicator'
import { useProviderSettings } from '../composables/useProviderSettings'
import { consumeAutoRun } from '../composables/useAgentMode'
import { formatTokens } from '../services/embeddedAgent/pricing'
import type { Task } from '../composables/useTasks'

interface Props { task: Task }
const props = defineProps<Props>()
const emit = defineEmits<{
  (e: 'open-settings'): void
  /** Forwarded up to TaskDetailModal → App.vue → respondToAgent. Same
   *  contract as TaskAgentFeedback's `reply` event. */
  (e: 'reply', taskId: string, answers: Array<{ id: string; value: string }>): void
}>()

const thread = useTaskThread()
const agent = useEmbeddedAgent(thread)
const providerSettings = useProviderSettings()
const detect = useAgentDetect()

// Show the working indicator whenever the embedded agent is streaming OR
// the task itself is in_progress — covers CLI / external-runner flows where
// nothing streams locally but an agent is still working on the task.
const isWorking = computed(() => agent.running.value || props.task.status === 'in_progress')
const working = useWorkingIndicator(isWorking)

// Auto-load the per-task transcript whenever the bound task changes.
// If this task was queued for auto-run, fire the first turn with the task
// description here too — covers the "manually opened mid-run" case where
// the auto-run driver hasn't claimed the queue yet.
watch(
  () => props.task.id,
  async (id) => {
    if (!id) return
    await thread.open(id)
    await nextTick()
    scrollToBottom()
    if (consumeAutoRun(id) && !agent.running.value && thread.messages.value.length === 0) {
      const seed = (props.task.description ?? '').trim()
      if (seed.length > 0) {
        // Seed kick: prompt = task description. The composable also flips
        // the task into in_progress / review around this turn. Free-form
        // composer submits later DON'T set isSeed.
        agent.send(seed, { isSeed: true }).catch(() => { /* surfaced via agent.errorMessage */ })
      }
    }
  },
  { immediate: true },
)

onMounted(() => { fetchAgentDetect() })
onBeforeUnmount(() => { thread.close() })

// Token tally combines persisted history (so totals survive reload) with
// the in-flight `agent.usage` accumulator for the current turn.
const tokenSummary = computed(() => {
  let input = agent.usage.value.input
  let output = agent.usage.value.output
  for (const m of thread.messages.value) {
    if (m.usage) {
      input += m.usage.inputTokens || 0
      output += m.usage.outputTokens || 0
    }
  }
  return {
    input: formatTokens(input),
    output: formatTokens(output),
    hasUsage: input > 0 || output > 0,
  }
})

// Persona pinned to this task type wins over the global active provider —
// otherwise the header label lies when a persona overrides the provider
// (e.g. user picked opencode-local for `style_update` while the global
// active provider is still claude-local).
const taskPersona = computed(() => providerSettings.getPersonaForTaskType(props.task.type))
const activeProvider = computed(() =>
  taskPersona.value?.providerId ?? providerSettings.activeProvider.value,
)
const activeModel = computed(() => {
  const persona = taskPersona.value
  if (persona && persona.model.length > 0) return persona.model
  return providerSettings.settings.value.providers[activeProvider.value]?.model || ''
})

const localCliBlocked = computed(() => {
  const id = activeProvider.value
  if (id !== 'claude-local' && id !== 'codex-local' && id !== 'opencode-local' && id !== 'copilot-local') return null
  const snap = detect.snapshot.value
  if (!snap) return null
  const status = snap[id]
  if (!status.found) return `${id} CLI not installed on PATH`
  if (!status.loggedIn) return `${id} CLI is installed but not logged in`
  return null
})

const composer = ref('')
const scrollerEl = ref<HTMLElement | null>(null)

function scrollToBottom() {
  const el = scrollerEl.value
  if (!el) return
  el.scrollTop = el.scrollHeight
}

// Auto-scroll on three signals: new persisted messages, in-flight block
// growth, and queued-message changes. Block-list length is a cheap proxy
// for "something happened" without watching deep into each block.
watch(
  () => [
    thread.messages.value.length,
    agent.currentBlocks.value.length,
    agent.queuedMessages.value.length,
  ],
  async () => { await nextTick(); scrollToBottom() },
)

async function onSubmit() {
  const text = composer.value
  if (!text.trim()) return
  composer.value = ''
  // The composable handles the queue/idle branch internally. We don't await
  // so the composer stays interactive even when a turn is already running.
  agent.send(text).catch(() => { /* surfaced via agent.errorMessage */ })
}

function onComposerKey(e: KeyboardEvent) {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault()
    onSubmit()
  }
}

const composerDisabled = computed(() => !!localCliBlocked.value)

/**
 * The task transitioned to `needs_info` and there's an unanswered
 * `agent_feedback` entry. While in this state the composer swaps to the
 * inline answer form (TaskAgentFeedback) and the regular chat composer
 * is hidden — answering is the only useful action and routes through the
 * existing `respondToAgent` flow.
 */
const pendingFeedbackEntry = computed(() => {
  if (props.task.status !== 'needs_info') return null
  const fb = props.task.agent_feedback ?? []
  if (fb.length === 0) return null
  const last = fb[fb.length - 1]
  return last.answered_at ? null : last
})

const inAnswerMode = computed(() => pendingFeedbackEntry.value !== null)

/** Synthetic block surfaced inline so the work-stream shows the pause. */
const agentQuestionBlock = computed(() => {
  const entry = pendingFeedbackEntry.value
  if (!entry) return null
  const fb = props.task.agent_feedback ?? []
  const entryIndex = fb.length - 1
  // Prefer the entry's `message`; fall back to the first question text so
  // the inline label is never empty.
  const label =
    (typeof entry.message === 'string' && entry.message.trim())
    || entry.questions[0]?.text
    || 'Agent needs more info.'
  return { kind: 'agent_question' as const, entryIndex, label }
})

function onReply(answers: Array<{ id: string; value: string }>) {
  emit('reply', props.task.id, answers)
}
</script>

<template>
  <div class="cv-tab">
    <header class="cv-header">
      <div class="cv-header-left">
        <Icon name="bot" :size="13" />
        <span class="cv-provider">{{ activeProvider }}</span>
        <span v-if="activeModel" class="cv-model">· {{ activeModel }}</span>
        <span v-if="isWorking" class="cv-running" aria-live="polite">
          <span class="cv-running-dot" />
          <span class="cv-running-verb">
            {{ working.verb.value ?? 'Annotasking' }}<span class="cv-running-dots" aria-hidden="true" />
          </span>
          <span class="cv-running-elapsed">{{ working.seconds.value }}s</span>
        </span>
      </div>
      <div class="cv-header-right">
        <span
          v-if="tokenSummary.hasUsage || isWorking"
          class="cv-tokens"
          title="Cumulative tokens this conversation"
        >
          {{ tokenSummary.input }} in · {{ tokenSummary.output }} out
        </span>
        <button class="cv-icon-btn" @click="emit('open-settings')" title="Open AI settings">
          <Icon name="sliders-horizontal" :size="12" />
        </button>
      </div>
    </header>

    <div v-if="localCliBlocked" class="cv-banner danger">
      <Icon name="triangle-alert" :size="12" />
      <span>{{ localCliBlocked }}. Pick another provider in Settings → AI.</span>
    </div>

    <div ref="scrollerEl" class="cv-scroller">
      <div v-if="thread.status.value === 'loading'" class="cv-empty">Loading conversation…</div>
      <div v-else-if="thread.messages.value.length === 0 && agent.currentBlocks.value.length === 0" class="cv-empty">
        <Icon name="bot" :size="20" />
        <p>The agent's work shows up here. If you need to steer, type a note — it'll send after the current step.</p>
      </div>

      <!-- Persisted past turns. Each may have a rich block timeline. -->
      <ConversationMessage
        v-for="msg in thread.messages.value"
        :key="msg.id"
        :role="msg.role"
        :content="msg.content"
        :blocks="msg.blocks"
        :provider-label="msg.providerId"
        :model-label="msg.model"
        :ts="msg.ts"
      />

      <!-- In-flight turn — streams the block timeline live. -->
      <ConversationMessage
        v-if="agent.currentBlocks.value.length > 0"
        role="assistant"
        :blocks="agent.currentBlocks.value"
        :streaming="agent.running.value"
        :provider-label="activeProvider"
        :model-label="activeModel"
      />

      <!-- Agent paused for input — surface inline as a work-stream block so
           the timeline shows where the agent stopped. The actual answer
           composer lives below the queue (replaces the chat composer). -->
      <ConversationStreamBlock
        v-if="agentQuestionBlock"
        :block="agentQuestionBlock"
      />

      <div v-if="agent.errorMessage.value" class="cv-error">
        <Icon name="triangle-alert" :size="12" />
        <span>{{ agent.errorMessage.value }}</span>
      </div>
    </div>

    <!-- Queued user messages (steering). Each shows a × to cancel. -->
    <div v-if="agent.queuedMessages.value.length > 0" class="cv-queue">
      <div class="cv-queue-head">
        <Icon name="clock" :size="11" />
        <span>Queued — will send after current turn</span>
      </div>
      <div
        v-for="(msg, i) in agent.queuedMessages.value"
        :key="i"
        class="cv-queue-item"
      >
        <span class="cv-queue-text">{{ msg }}</span>
        <button
          type="button"
          class="cv-queue-cancel"
          title="Cancel queued message"
          @click="agent.cancelQueued(i)"
        ><Icon name="x" :size="11" /></button>
      </div>
    </div>

    <!-- Answer-mode: the chat composer is suppressed; the inline answer
         form takes its place and routes through `respondToAgent` (same
         backend path as the Details tab's TaskAgentFeedback). -->
    <div v-if="inAnswerMode" class="cv-answer">
      <TaskAgentFeedback
        :feedback="props.task.agent_feedback ?? []"
        :task-id="props.task.id"
        @reply="onReply"
      />
    </div>

    <form v-else class="cv-composer" @submit.prevent="onSubmit">
      <textarea
        v-model="composer"
        class="cv-input"
        rows="3"
        :placeholder="
          agent.running.value
            ? 'Type a note to steer or clarify — will queue and send after current turn'
            : 'Message the agent — Enter to send, Shift+Enter for newline'
        "
        :disabled="composerDisabled"
        @keydown="onComposerKey"
      />
      <div class="cv-composer-actions">
        <button v-if="agent.running.value" type="button" class="cv-abort" @click="agent.abort()">
          <Icon name="x" :size="12" />
          <span>Abort</span>
        </button>
        <button type="submit" class="cv-send" :disabled="composerDisabled || !composer.trim()">
          <Icon :name="agent.running.value ? 'clock' : 'arrow-right'" :size="12" />
          <span>{{ agent.running.value ? 'Queue' : 'Send' }}</span>
        </button>
      </div>
    </form>
  </div>
</template>

<style scoped>
.cv-tab {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}

.cv-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border);
  background: var(--surface);
}
.cv-header-left, .cv-header-right { display: flex; align-items: center; gap: 6px; font-size: 12px; }
.cv-provider { font-weight: 600; color: var(--text); }
.cv-model { color: var(--text-muted); }
.cv-tokens { font-variant-numeric: tabular-nums; color: var(--text-muted); font-size: 11px; }

.cv-running {
  display: inline-flex;
  align-items: baseline;
  gap: 6px;
  color: var(--accent);
  font-size: 11px;
  margin-left: 4px;
  letter-spacing: 0.02em;
}
.cv-running-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--accent);
  animation: cv-running-pulse 1.2s ease-in-out infinite;
  align-self: center;
}
.cv-running-verb {
  font-weight: 600;
  animation: cv-running-verb-in 320ms ease-out;
  display: inline-flex;
  align-items: baseline;
}
.cv-running-dots::after {
  display: inline-block;
  content: '';
  width: 1.2em;
  text-align: left;
  animation: cv-running-dots 1.4s steps(4, end) infinite;
}
.cv-running-elapsed {
  color: var(--text-muted);
  font-variant-numeric: tabular-nums;
  font-weight: 500;
}
@keyframes cv-running-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }
@keyframes cv-running-verb-in {
  from { opacity: 0; transform: translateY(2px); }
  to   { opacity: 1; transform: translateY(0); }
}
@keyframes cv-running-dots {
  0%   { content: ''; }
  25%  { content: '.'; }
  50%  { content: '..'; }
  75%  { content: '...'; }
  100% { content: ''; }
}
@media (prefers-reduced-motion: reduce) {
  .cv-running-dot,
  .cv-running-verb,
  .cv-running-dots::after { animation: none; }
  .cv-running-dots::after { content: '…'; }
}

.cv-icon-btn {
  background: none;
  border: 1px solid transparent;
  color: var(--text-muted);
  border-radius: 4px;
  padding: 4px 6px;
  cursor: pointer;
}
.cv-icon-btn:hover { background: var(--surface-2); color: var(--text); }

.cv-banner {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  font-size: 12px;
  background: color-mix(in srgb, var(--danger) 12%, transparent);
  color: var(--danger);
  border-bottom: 1px solid color-mix(in srgb, var(--danger) 40%, transparent);
}

.cv-scroller {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px;
}

.cv-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  text-align: center;
  color: var(--text-muted);
  font-size: 13px;
  padding: 32px 16px;
}

.cv-error {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 10px;
  border-radius: 6px;
  background: color-mix(in srgb, var(--danger) 12%, transparent);
  color: var(--danger);
  font-size: 12px;
}

.cv-queue {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 6px 12px;
  border-top: 1px dashed var(--border);
  background: var(--surface);
}
.cv-queue-head {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-muted);
  font-weight: 700;
}
.cv-queue-item {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 6px 8px;
  border-radius: 4px;
  background: var(--surface-2);
  font-size: 12px;
}
.cv-queue-text { flex: 1; color: var(--text); white-space: pre-wrap; word-break: break-word; }
.cv-queue-cancel {
  background: none;
  border: none;
  color: var(--text-muted);
  cursor: pointer;
  padding: 2px;
  border-radius: 3px;
  display: inline-flex;
  align-items: center;
}
.cv-queue-cancel:hover { color: var(--danger); background: color-mix(in srgb, var(--danger) 10%, transparent); }

.cv-composer,
.cv-answer {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px 12px;
  border-top: 1px solid var(--border);
  background: var(--surface);
}
.cv-input {
  width: 100%;
  resize: vertical;
  min-height: 56px;
  background: var(--bg);
  color: var(--text);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 8px 10px;
  font: inherit;
  font-size: 13px;
}
.cv-input:focus { outline: 2px solid var(--accent); outline-offset: -2px; }
.cv-input:disabled { opacity: 0.6; cursor: not-allowed; }

.cv-composer-actions {
  display: flex;
  justify-content: flex-end;
  gap: 6px;
}
.cv-send, .cv-abort {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  border: none;
  border-radius: 4px;
  padding: 6px 10px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}
.cv-send { background: var(--accent); color: var(--text-on-accent); }
.cv-send:hover:not(:disabled) { background: var(--accent-hover); }
.cv-send:disabled { opacity: 0.5; cursor: not-allowed; }
.cv-abort { background: color-mix(in srgb, var(--danger) 12%, transparent); color: var(--danger); }
.cv-abort:hover { background: var(--danger); color: var(--text-on-accent); }
</style>
