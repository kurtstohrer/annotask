<script setup lang="ts">
/**
 * Renders one ThreadMessage in the Conversation work-stream.
 *
 * Two surfaces:
 *   - `blocks` (preferred) → walks the work-stream timeline. Pairs each
 *     tool_call with its corresponding tool_result by id so each pair is one
 *     expandable row. Streaming turns can pass `streaming: true` to mark the
 *     tail block.
 *   - `content` fallback → legacy turns from before the work-stream existed,
 *     plus user / system / tool messages that don't have a block list.
 *     Rendered as markdown (assistant/user) or plain text (system/tool).
 */
import { computed } from 'vue'
import ConversationStreamBlock from './ConversationStreamBlock.vue'
import { safeMd } from '../utils/safeMd'
import type { WorkStreamBlock } from '../../shared/work-stream'

interface Props {
  role: 'user' | 'assistant' | 'system' | 'tool'
  /** Work-stream timeline. When provided, takes precedence over `content`. */
  blocks?: WorkStreamBlock[]
  /** Flat-text fallback for messages without blocks. */
  content?: string
  /** Tail block on an in-flight turn gets a blinking cursor. */
  streaming?: boolean
  providerLabel?: string
  modelLabel?: string
  ts?: number
}

const props = withDefaults(defineProps<Props>(), { streaming: false, content: '' })

const html = computed(() => {
  if (props.streaming) return ''
  if (props.role === 'system' || props.role === 'tool') return ''
  try { return safeMd(props.content) }
  catch { return '' }
})

const fallbackText = computed(() => {
  if (props.streaming) return props.content
  if (props.role === 'system' || props.role === 'tool') return props.content
  return ''
})

const tsLabel = computed(() => {
  if (!props.ts) return ''
  try { return new Date(props.ts).toLocaleTimeString() } catch { return '' }
})

const roleLabel = computed(() => {
  if (props.role === 'assistant') return 'Agent output'
  return props.role
})

/**
 * Walk the block list and produce a render plan: each tool_call has its
 * paired tool_result inlined; standalone results (those without a prior
 * call in the list) render on their own. Avoids two redundant rows when
 * the timeline goes call → result.
 */
const renderPlan = computed(() => {
  const blocks = props.blocks ?? []
  const resultByCallId = new Map<string, Extract<WorkStreamBlock, { kind: 'tool_result' }>>()
  for (const b of blocks) {
    if (b.kind === 'tool_result') resultByCallId.set(b.toolUseId, b)
  }
  const out: Array<{ block: WorkStreamBlock; paired?: Extract<WorkStreamBlock, { kind: 'tool_result' }>; key: string }> = []
  const consumedResults = new Set<string>()
  blocks.forEach((b, idx) => {
    if (b.kind === 'tool_call') {
      const paired = resultByCallId.get(b.id)
      if (paired) consumedResults.add(b.id)
      out.push({ block: b, paired, key: `c-${b.id}-${idx}` })
    } else if (b.kind === 'tool_result') {
      if (consumedResults.has(b.toolUseId)) return // already shown inline
      out.push({ block: b, key: `r-${b.toolUseId}-${idx}` })
    } else {
      out.push({ block: b, key: `b-${idx}` })
    }
  })
  return out
})

const lastIndex = computed(() => renderPlan.value.length - 1)
</script>

<template>
  <div class="cv-msg" :class="`role-${role}`">
    <div class="cv-msg-meta">
      <span class="cv-msg-role">{{ roleLabel }}</span>
      <span v-if="providerLabel" class="cv-msg-provider">{{ providerLabel }}</span>
      <span v-if="modelLabel" class="cv-msg-model">{{ modelLabel }}</span>
      <span v-if="tsLabel" class="cv-msg-ts">{{ tsLabel }}</span>
    </div>
    <div class="cv-msg-body">
      <!-- Preferred: render the block timeline. Each entry is a step. -->
      <template v-if="renderPlan.length > 0">
        <ConversationStreamBlock
          v-for="(entry, i) in renderPlan"
          :key="entry.key"
          :block="entry.block"
          :paired-result="entry.paired"
          :streaming="streaming && i === lastIndex && entry.block.kind === 'text'"
        />
      </template>
      <!-- Legacy fallback: a single content string. -->
      <template v-else>
        <div v-if="html" class="cv-msg-markdown" v-html="html" />
        <div v-else class="cv-msg-text">{{ fallbackText }}<span v-if="streaming" class="cv-cursor">▋</span></div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.cv-msg {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px 12px;
  border-radius: 8px;
  background: var(--surface-2);
}
.cv-msg.role-user { background: color-mix(in srgb, var(--accent) 10%, var(--surface-2)); }
.cv-msg.role-assistant { background: var(--surface-2); }
.cv-msg.role-system,
.cv-msg.role-tool { background: var(--surface); font-style: italic; }

.cv-msg-meta {
  display: flex;
  gap: 8px;
  align-items: center;
  font-size: 10px;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.cv-msg-role { font-weight: 700; color: var(--text); }
.cv-msg-provider,
.cv-msg-model,
.cv-msg-ts { font-weight: 500; }

.cv-msg-body { font-size: 13px; color: var(--text); line-height: 1.55; display: flex; flex-direction: column; gap: 8px; }
.cv-msg-text { white-space: pre-wrap; word-break: break-word; }

:deep(.cv-msg-markdown p) { margin: 0 0 8px; }
:deep(.cv-msg-markdown p:last-child) { margin-bottom: 0; }
:deep(.cv-msg-markdown pre) {
  background: var(--surface-3);
  border-radius: 4px;
  padding: 8px 10px;
  overflow-x: auto;
  font-size: 12px;
}
:deep(.cv-msg-markdown code) {
  background: var(--surface-3);
  border-radius: 3px;
  padding: 1px 4px;
  font-size: 12px;
}
:deep(.cv-msg-markdown pre code) { background: transparent; padding: 0; }

.cv-cursor {
  display: inline-block;
  margin-left: 1px;
  color: var(--accent);
  animation: cv-blink 1s steps(2) infinite;
}
@keyframes cv-blink { to { opacity: 0; } }
</style>
