<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { safeMd } from '../utils/safeMd'
import type { AgentFeedbackEntry } from '../composables/useTasks'

const props = defineProps<{
  /** All exchanges on the task. Rendered oldest-first; the last unanswered one is the active reply target. */
  feedback: AgentFeedbackEntry[]
  /** Reset draft state when the task ID changes. */
  taskId: string
}>()

const emit = defineEmits<{
  reply: [answers: Array<{ id: string; value: string }>]
}>()

const replyDraft = ref<Record<string, string>>({})

const pendingExchange = computed(() => {
  const af = props.feedback
  if (!af?.length) return null
  const last = af[af.length - 1]
  return last.answered_at ? null : last
})

function updateReply(questionId: string, value: string) {
  replyDraft.value[questionId] = value
}

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
  if (answers.some(a => !a.value)) return // every question must have an answer
  emit('reply', answers)
  replyDraft.value = {}
}

watch(() => props.taskId, () => { replyDraft.value = {} })
</script>

<template>
  <div v-for="(exchange, ei) in props.feedback" :key="ei" class="td-agent-exchange" :class="{ answered: !!exchange.answered_at }">
    <div v-if="exchange.message" class="td-agent-msg" v-html="safeMd(exchange.message)" />
    <div v-for="q in exchange.questions" :key="q.id" class="td-agent-question">
      <p class="td-agent-q-text">{{ q.text }}</p>
      <template v-if="exchange.answered_at">
        <div class="td-agent-answer">{{ exchange.answers?.find(a => a.id === q.id)?.value }}</div>
      </template>
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
          @input="updateReply(q.id, ($event.target as HTMLTextAreaElement).value)"
          placeholder="Type your answer..."
          rows="2"
        />
      </template>
    </div>
    <div v-if="pendingExchange === exchange && exchange.questions.every(q => replyDraft[q.id])" class="td-reply-actions">
      <button class="td-reply-submit" @click="submitReply">Submit answers</button>
    </div>
  </div>
</template>

<style scoped>
.td-agent-exchange { display: flex; flex-direction: column; gap: 6px; padding: 8px 10px; border-radius: 6px; background: var(--surface-2); border-left: 2px solid var(--accent); }
.td-agent-exchange.answered { opacity: 0.85; border-left-color: var(--border); }
.td-agent-msg { font-size: 12px; color: var(--text); }
.td-agent-question { display: flex; flex-direction: column; gap: 4px; }
.td-agent-q-text { font-size: 12px; color: var(--text); margin: 0; }
.td-agent-answer { font-size: 12px; color: var(--text); padding: 4px 8px; background: var(--surface); border-radius: 4px; }
.td-agent-options { display: flex; gap: 4px; flex-wrap: wrap; }
.td-agent-option { font-size: 11px; padding: 3px 8px; border-radius: 4px; border: 1px solid var(--border); background: var(--surface); color: var(--text); cursor: pointer; }
.td-agent-option:hover { background: var(--border); }
.td-agent-option.selected { background: var(--accent); color: var(--text-on-accent); border-color: var(--accent); }
.td-reply-textarea { width: 100%; min-height: 40px; padding: 6px 8px; font-family: inherit; font-size: 12px; color: var(--text); background: var(--surface); border: 1px solid var(--border); border-radius: 4px; resize: vertical; box-sizing: border-box; }
.td-reply-actions { display: flex; justify-content: flex-end; }
.td-reply-submit { font-size: 11px; font-weight: 600; padding: 4px 10px; border-radius: 4px; background: var(--accent); color: var(--text-on-accent); border: none; cursor: pointer; }
.td-reply-submit:hover { opacity: 0.9; }
</style>
