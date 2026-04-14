<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue'
import Prism from 'prismjs'
import 'prismjs/components/prism-json'
import 'prismjs/components/prism-yaml'
import yaml from 'js-yaml'

const props = defineProps<{
  tasks: Array<Record<string, unknown>>
}>()

const emit = defineEmits<{
  close: []
}>()

const format = ref<'json' | 'yaml'>('json')
const copied = ref(false)
const wrapLines = ref(false)

const taskData = computed(() => {
  if (!props.tasks.length) return null
  return {
    version: '1.0',
    tasks: props.tasks,
  }
})

const formatted = computed(() => {
  if (!taskData.value) return ''
  if (format.value === 'yaml') {
    return yaml.dump(taskData.value, { indent: 2, lineWidth: 120, noRefs: true })
  }
  return JSON.stringify(taskData.value, null, 2)
})

const highlighted = ref('')

watch([formatted, format], () => {
  nextTick(() => {
    const lang = format.value === 'yaml' ? 'yaml' : 'json'
    const grammar = Prism.languages[lang]
    highlighted.value = grammar ? Prism.highlight(formatted.value, grammar, lang) : escapeHtml(formatted.value)
  })
}, { immediate: true })

function escapeHtml(str: string) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function copy() {
  navigator.clipboard.writeText(formatted.value)
  copied.value = true
  setTimeout(() => (copied.value = false), 2000)
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') emit('close')
}
</script>

<template>
  <div class="report-overlay" @keydown="onKeydown" tabindex="-1">
    <div class="report-backdrop" @click="emit('close')" />
    <aside class="report-drawer">
      <header class="report-header">
        <div class="report-title">
          <span>Tasks</span>
          <span v-if="tasks.length" class="report-badge">{{ tasks.length }} task{{ tasks.length === 1 ? '' : 's' }}</span>
        </div>
        <div class="report-controls">
          <div class="format-toggle">
            <button :class="['fmt-btn', { active: format === 'json' }]" @click="format = 'json'">JSON</button>
            <button :class="['fmt-btn', { active: format === 'yaml' }]" @click="format = 'yaml'">YAML</button>
          </div>
          <button :class="['wrap-btn', { active: wrapLines }]" @click="wrapLines = !wrapLines" title="Wrap lines">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18"/><path d="M3 12h15a3 3 0 1 1 0 6h-4"/><polyline points="13 15 10 18 13 21"/><path d="M3 18h4"/></svg>
          </button>
          <button class="copy-btn" @click="copy" :disabled="!taskData">
            <svg v-if="!copied" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
            {{ copied ? 'Copied!' : 'Copy' }}
          </button>
          <button class="close-btn" @click="emit('close')" title="Close (Esc)">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
      </header>
      <div class="report-body">
        <pre v-if="taskData" :class="['report-code', { 'report-wrap-lines': wrapLines }]"><code v-html="highlighted" /></pre>
        <div v-else class="report-empty">
          <p>No tasks yet.</p>
          <p class="report-empty-hint">Pin elements, draw sections, or add annotations to create tasks for your coding agent.</p>
        </div>
      </div>
    </aside>
  </div>
</template>

<style>
.report-overlay {
  position: fixed;
  inset: 0;
  z-index: 50000;
  display: flex;
  justify-content: flex-end;
}
.report-backdrop {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
}
.report-drawer {
  position: relative;
  width: min(720px, 80vw);
  height: 100%;
  background: var(--bg);
  border-left: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  animation: slide-in 0.15s ease-out;
}
@keyframes slide-in {
  from { transform: translateX(100%); }
  to { transform: translateX(0); }
}
.report-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border);
  background: var(--surface);
  flex-shrink: 0;
}
.report-title {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 14px;
  font-weight: 600;
  color: var(--text);
}
.report-badge {
  font-size: 11px;
  font-weight: 500;
  color: var(--text-muted);
  background: var(--surface-2);
  padding: 2px 8px;
  border-radius: 4px;
  border: 1px solid var(--border);
}
.report-controls {
  display: flex;
  align-items: center;
  gap: 8px;
}
.format-toggle {
  display: flex;
  border: 1px solid var(--border);
  border-radius: 6px;
  overflow: hidden;
}
.fmt-btn {
  padding: 4px 12px;
  font-size: 11px;
  font-weight: 600;
  color: var(--text-muted);
  background: transparent;
  border: none;
  cursor: pointer;
  transition: all 0.1s;
}
.fmt-btn.active {
  background: var(--surface-2);
  color: var(--text);
}
.fmt-btn:hover:not(.active) {
  color: var(--text);
}
.wrap-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  color: var(--text-muted);
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.1s;
}
.wrap-btn:hover { color: var(--text); background: var(--border); }
.wrap-btn.active { color: var(--accent); border-color: var(--accent); }
.copy-btn {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 5px 12px;
  font-size: 12px;
  font-weight: 500;
  color: var(--text);
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.1s;
}
.copy-btn:hover { background: var(--border); }
.copy-btn:disabled { opacity: 0.4; cursor: default; }
.close-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  color: var(--text-muted);
  background: transparent;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.1s;
}
.close-btn:hover { background: var(--surface-2); color: var(--text); }

.report-body {
  flex: 1;
  overflow: auto;
}
.report-code {
  margin: 0;
  padding: 20px;
  font-size: 12px;
  line-height: 1.6;
  tab-size: 2;
  overflow: auto;
  background: transparent;
}
.report-code code {
  font-family: 'SF Mono', 'Fira Code', 'Cascadia Code', 'JetBrains Mono', 'Consolas', monospace;
}
.report-code.report-wrap-lines { white-space: pre-wrap; word-break: break-all; }
.report-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: var(--text-muted);
  font-size: 14px;
}
.report-empty-hint { font-size: 12px; margin-top: 8px; opacity: 0.6; }

/* Prism theme — dark, minimal */
.report-code .token.property { color: var(--syntax-property); }
.report-code .token.string { color: var(--syntax-string); }
.report-code .token.number { color: var(--syntax-number); }
.report-code .token.boolean { color: var(--syntax-boolean); }
.report-code .token.null { color: var(--syntax-null); }
.report-code .token.operator { color: var(--syntax-operator); }
.report-code .token.punctuation { color: var(--syntax-punctuation); }
.report-code .token.key,
.report-code .token.atrule,
.report-code .token.tag { color: var(--syntax-property); }
.report-code .token.scalar { color: var(--syntax-string); }
.report-code .token.important { color: var(--syntax-number); }
</style>
