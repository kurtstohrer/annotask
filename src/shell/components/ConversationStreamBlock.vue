<script setup lang="ts">
/**
 * One block in a Conversation work-stream timeline.
 *
 * Three kinds today:
 *   - `text`         → markdown bubble (assistant prose).
 *   - `tool_call`    → row with a status dot + human summary; expandable for raw input JSON.
 *   - `tool_result`  → row with a short output preview; expandable for full raw content. Tinted red on isError.
 *   - `agent_question` → read-only banner pointing to the inline answer composer.
 *
 * Tool calls auto-pair with their tool_result by `id` — the parent passes
 * the result alongside so this component can render the call's pending /
 * completed state in one row without a second component.
 */
import { computed, ref } from 'vue'
import { marked } from 'marked'
import Icon from './Icon.vue'
import type { WorkStreamBlock } from '../../shared/work-stream'

interface Props {
  block: WorkStreamBlock
  /** When true, this is the tail block on an in-flight turn (drives cursor + dot). */
  streaming?: boolean
  /** Optional paired tool_result for tool_call rendering (call/result one row). */
  pairedResult?: Extract<WorkStreamBlock, { kind: 'tool_result' }>
}

const props = withDefaults(defineProps<Props>(), { streaming: false })
const expanded = ref(false)

const markdown = computed(() => {
  if (props.block.kind !== 'text') return ''
  try { return marked.parse(props.block.text, { async: false }) as string }
  catch { return '' }
})

const toolInputJson = computed(() => {
  if (props.block.kind !== 'tool_call') return ''
  try { return JSON.stringify(props.block.input, null, 2) }
  catch { return String(props.block.input) }
})

const hasPairedResult = computed(() =>
  props.block.kind === 'tool_call' && !!props.pairedResult,
)
</script>

<template>
  <!-- TEXT — markdown prose. Streaming tail gets a blinking cursor. -->
  <div v-if="block.kind === 'text'" class="csb-text">
    <div class="csb-markdown" v-html="markdown" />
    <span v-if="streaming" class="csb-cursor">▋</span>
  </div>

  <!-- TOOL CALL — collapsed row with summary; expand to see raw JSON.
       If a tool_result has already arrived, show "complete"; else "pending". -->
  <div v-else-if="block.kind === 'tool_call'" class="csb-tool-row">
    <button
      type="button"
      class="csb-tool-head"
      :class="{ pending: !hasPairedResult, error: pairedResult?.isError }"
      :data-testid="`tool-call-${block.id}`"
      @click="expanded = !expanded"
    >
      <span class="csb-tool-dot" :class="{ pulse: !hasPairedResult }" />
      <Icon name="wand" :size="11" />
      <span class="csb-tool-summary">{{ block.summary }}</span>
      <Icon :name="expanded ? 'chevron-down' : 'chevron-right'" :size="11" class="csb-tool-chev" />
    </button>
    <div v-if="expanded" class="csb-tool-body">
      <div class="csb-tool-label">Input</div>
      <pre class="csb-tool-pre">{{ toolInputJson }}</pre>
      <template v-if="pairedResult">
        <div class="csb-tool-label">
          {{ pairedResult.isError ? 'Error' : 'Output' }}
        </div>
        <pre class="csb-tool-pre">{{ pairedResult.raw || '(empty)' }}</pre>
      </template>
    </div>
  </div>

  <!-- TOOL RESULT — only rendered when NOT already absorbed into the call row.
       Parent passes `pairedResult` to suppress, so this is a no-op when paired. -->
  <div v-else-if="block.kind === 'tool_result'" class="csb-tool-row">
    <button
      type="button"
      class="csb-tool-head"
      :class="{ error: block.isError }"
      @click="expanded = !expanded"
    >
      <span class="csb-tool-dot" :class="{ error: block.isError }" />
      <Icon name="check" :size="11" />
      <span class="csb-tool-summary">{{ block.summary }}</span>
      <Icon :name="expanded ? 'chevron-down' : 'chevron-right'" :size="11" class="csb-tool-chev" />
    </button>
    <div v-if="expanded" class="csb-tool-body">
      <pre class="csb-tool-pre">{{ block.raw || '(empty)' }}</pre>
    </div>
  </div>

  <!-- AGENT QUESTION — read-only banner that points to the inline composer. -->
  <div v-else-if="block.kind === 'agent_question'" class="csb-question">
    <Icon name="circle-help" :size="13" />
    <div>
      <div class="csb-question-label">Agent paused for input</div>
      <div class="csb-question-text">{{ block.label }}</div>
    </div>
  </div>
</template>

<style scoped>
.csb-text {
  font-size: 13px;
  color: var(--text);
  line-height: 1.55;
  word-break: break-word;
}
:deep(.csb-markdown p) { margin: 0 0 8px; }
:deep(.csb-markdown p:last-child) { margin-bottom: 0; }
:deep(.csb-markdown pre) {
  background: var(--surface-3);
  border-radius: 4px;
  padding: 8px 10px;
  overflow-x: auto;
  font-size: 12px;
}
:deep(.csb-markdown code) {
  background: var(--surface-3);
  border-radius: 3px;
  padding: 1px 4px;
  font-size: 12px;
}
:deep(.csb-markdown pre code) { background: transparent; padding: 0; }

.csb-cursor {
  display: inline-block;
  margin-left: 1px;
  color: var(--accent);
  animation: csb-blink 1s steps(2) infinite;
}
@keyframes csb-blink { to { opacity: 0; } }

.csb-tool-row {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.csb-tool-head {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 4px 8px;
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: 4px;
  cursor: pointer;
  font: inherit;
  font-size: 12px;
  color: var(--text);
  text-align: left;
}
.csb-tool-head:hover { background: var(--surface-3); }
.csb-tool-head.error {
  border-color: color-mix(in srgb, var(--danger) 60%, var(--border));
  background: color-mix(in srgb, var(--danger) 8%, var(--surface-2));
}

.csb-tool-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--success);
  flex: 0 0 auto;
}
.csb-tool-dot.error { background: var(--danger); }
.csb-tool-dot.pulse {
  background: var(--accent);
  animation: csb-pulse 1.2s ease-in-out infinite;
}
@keyframes csb-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.35; }
}

.csb-tool-summary {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.csb-tool-chev { color: var(--text-muted); flex: 0 0 auto; }

.csb-tool-body {
  padding: 6px 8px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 4px;
  margin-left: 14px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.csb-tool-label {
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-muted);
  font-weight: 600;
}
.csb-tool-pre {
  margin: 0;
  background: var(--surface-3);
  border-radius: 4px;
  padding: 8px 10px;
  font-size: 11.5px;
  line-height: 1.45;
  max-height: 320px;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-word;
}

.csb-question {
  display: flex;
  gap: 8px;
  align-items: flex-start;
  padding: 8px 10px;
  border: 1px solid color-mix(in srgb, var(--warning) 40%, var(--border));
  background: color-mix(in srgb, var(--warning) 8%, transparent);
  border-radius: 4px;
}
.csb-question-label {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--warning);
}
.csb-question-text {
  font-size: 12.5px;
  color: var(--text);
  line-height: 1.5;
  margin-top: 2px;
}
</style>
