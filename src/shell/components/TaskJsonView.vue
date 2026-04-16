<script setup lang="ts">
import { ref, computed } from 'vue'
import Prism from 'prismjs'
import 'prismjs/components/prism-json'

const props = defineProps<{
  task: unknown
}>()

const jsonCopied = ref(false)
const jsonWrap = ref(false)

const taskJson = computed(() => JSON.stringify(props.task, null, 2))

function escapeHtml(str: string) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

const taskJsonHighlighted = computed(() => {
  const grammar = Prism.languages.json
  return grammar ? Prism.highlight(taskJson.value, grammar, 'json') : escapeHtml(taskJson.value)
})

function copyJson() {
  navigator.clipboard.writeText(taskJson.value)
  jsonCopied.value = true
  setTimeout(() => (jsonCopied.value = false), 2000)
}
</script>

<template>
  <div class="td-body td-json-body">
    <div class="td-json-toolbar">
      <button :class="['td-json-wrap', { active: jsonWrap }]" @click="jsonWrap = !jsonWrap" title="Wrap lines">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18"/><path d="M3 12h15a3 3 0 1 1 0 6h-4"/><polyline points="13 15 10 18 13 21"/><path d="M3 18h4"/></svg>
      </button>
      <button class="td-json-copy" @click="copyJson">{{ jsonCopied ? 'Copied!' : 'Copy' }}</button>
    </div>
    <pre :class="['td-json-pre', { 'td-json-wrap-lines': jsonWrap }]"><code v-html="taskJsonHighlighted" /></pre>
  </div>
</template>

<style scoped>
.td-body { flex: 1; overflow-y: auto; padding: 0; }
.td-json-body { display: flex; flex-direction: column; }
.td-json-toolbar { display: flex; justify-content: flex-end; gap: 4px; padding: 8px 14px; border-bottom: 1px solid var(--border); background: var(--surface-2); }
.td-json-wrap, .td-json-copy { padding: 3px 8px; font-size: 10px; font-weight: 600; background: var(--surface); color: var(--text); border: 1px solid var(--border); border-radius: 3px; cursor: pointer; display: flex; align-items: center; gap: 4px; }
.td-json-wrap:hover, .td-json-copy:hover { background: var(--border); }
.td-json-wrap.active { background: var(--accent); color: var(--text-on-accent); border-color: var(--accent); }
.td-json-pre { margin: 0; padding: 14px; font-size: 11px; line-height: 1.5; font-family: ui-monospace, 'SF Mono', monospace; color: var(--text); background: var(--surface); white-space: pre; overflow: auto; }
.td-json-pre.td-json-wrap-lines { white-space: pre-wrap; word-break: break-all; }
.td-json-pre :deep(.token.property) { color: var(--syntax-property); }
.td-json-pre :deep(.token.string) { color: var(--syntax-string); }
.td-json-pre :deep(.token.number) { color: var(--syntax-number); }
.td-json-pre :deep(.token.boolean) { color: var(--syntax-boolean); }
.td-json-pre :deep(.token.null) { color: var(--syntax-null); }
.td-json-pre :deep(.token.operator) { color: var(--syntax-operator); }
.td-json-pre :deep(.token.punctuation) { color: var(--syntax-punctuation); }
</style>
