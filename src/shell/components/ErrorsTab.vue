<script setup lang="ts">
import { computed, ref } from 'vue'
import type { ErrorEntry } from '../composables/useErrorMonitor'
import FindingDrawer from './FindingDrawer.vue'

const props = defineProps<{
  errors: ErrorEntry[]
  errorCount: number
  warnCount: number
  paused: boolean
  taskErrorIds: Set<string>
}>()

const emit = defineEmits<{
  'create-task': [entry: ErrorEntry]
  'clear': []
  'toggle-pause': []
}>()

const detailEntry = ref<ErrorEntry | null>(null)
const showErrors = ref(true)
const showWarnings = ref(true)

const filteredErrors = computed(() => {
  return props.errors.filter(e => {
    if (e.level === 'warn') return showWarnings.value
    return showErrors.value
  })
})

function severityForDrawer(level: string): string {
  if (level === 'unhandled') return 'critical'
  if (level === 'error') return 'serious'
  return 'moderate'
}

function formatTime(ts: number): string {
  const d = new Date(ts)
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function truncate(msg: string, len: number): string {
  return msg.length > len ? msg.slice(0, len) + '...' : msg
}

function cleanStack(stack: string): string[] {
  if (!stack) return []
  return stack.split('\n').filter(l => l.trim()).slice(0, 8)
}

function onCreateTask(entry: ErrorEntry) {
  emit('create-task', entry)
  detailEntry.value = null
}
</script>

<template>
  <div class="errors-tab">
    <div class="errors-header">
      <div class="errors-filters">
        <button
          class="filter-btn errors"
          :class="{ active: showErrors }"
          @click="showErrors = !showErrors"
          :title="showErrors ? 'Hide errors' : 'Show errors'"
        >
          <span class="filter-dot errors-dot" />
          Errors
          <span class="filter-count">{{ errorCount }}</span>
        </button>
        <button
          class="filter-btn warns"
          :class="{ active: showWarnings }"
          @click="showWarnings = !showWarnings"
          :title="showWarnings ? 'Hide warnings' : 'Show warnings'"
        >
          <span class="filter-dot warns-dot" />
          Warnings
          <span class="filter-count">{{ warnCount }}</span>
        </button>
      </div>
      <div class="errors-actions">
        <button class="action-btn icon-only" @click="emit('toggle-pause')" :title="paused ? 'Resume capture' : 'Pause capture'">
          <svg v-if="paused" width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
          <svg v-else width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
        </button>
        <button class="action-btn icon-only" @click="emit('clear')" :disabled="errors.length === 0" title="Clear all captured errors">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
        </button>
      </div>
    </div>

    <div v-if="errors.length === 0 && !paused" class="errors-empty">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 6L9 17l-5-5"/></svg>
      No errors captured
    </div>
    <div v-else-if="errors.length === 0 && paused" class="errors-empty paused-msg">
      Capture paused
    </div>
    <div v-else-if="filteredErrors.length === 0" class="errors-empty filtered-msg">
      All entries hidden by filters
    </div>

    <div v-if="errors.length" class="errors-summary">
      <span v-if="errorCount" class="summary-errors">{{ errorCount }} error{{ errorCount === 1 ? '' : 's' }}</span>
      <span v-if="errorCount && warnCount" class="summary-sep">&middot;</span>
      <span v-if="warnCount" class="summary-warns">{{ warnCount }} warning{{ warnCount === 1 ? '' : 's' }}</span>
    </div>

    <div v-for="entry in filteredErrors" :key="entry.id" class="error-card" :class="entry.level" @click="detailEntry = entry">
      <span class="error-level" :class="entry.level">{{ entry.level === 'unhandled' ? 'uncaught' : entry.level }}</span>
      <span class="error-msg">{{ truncate(entry.message, 80) }}</span>
      <span class="error-count" v-if="entry.count > 1">{{ entry.count }}x</span>
      <span v-if="taskErrorIds.has(entry.id)" class="error-tasked-badge">tasked</span>
      <svg class="error-chevron" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg>
    </div>

    <!-- Detail Drawer -->
    <FindingDrawer
      v-if="detailEntry"
      :title="truncate(detailEntry.message, 100)"
      :severity="severityForDrawer(detailEntry.level)"
      :tasked="taskErrorIds.has(detailEntry.id)"
      @close="detailEntry = null"
      @create-task="onCreateTask(detailEntry!)"
    >
      <div class="fd-detail-section">
        <span class="fd-detail-label">Level</span>
        <span class="fd-detail-value">{{ detailEntry.level === 'unhandled' ? 'Uncaught Exception' : detailEntry.level }}</span>
      </div>
      <div class="fd-detail-section">
        <span class="fd-detail-label">Message</span>
        <p class="fd-detail-text error-message-full">{{ detailEntry.message }}</p>
      </div>
      <div class="fd-detail-section">
        <span class="fd-detail-label">Occurrences</span>
        <span class="fd-detail-value">{{ detailEntry.count }} time{{ detailEntry.count === 1 ? '' : 's' }}</span>
      </div>
      <div class="fd-detail-section">
        <span class="fd-detail-label">First seen</span>
        <span class="fd-detail-value">{{ formatTime(detailEntry.firstSeen) }}</span>
      </div>
      <div v-if="detailEntry.stack" class="fd-detail-section">
        <span class="fd-detail-label">Stack Trace</span>
        <div class="error-stack">
          <code v-for="(line, i) in cleanStack(detailEntry.stack)" :key="i" class="stack-line">{{ line }}</code>
        </div>
      </div>
    </FindingDrawer>
  </div>
</template>

<style scoped>
.errors-tab { display: flex; flex-direction: column; gap: 8px; }

.errors-header { display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap; }

.filter-btn {
  display: flex; align-items: center; gap: 5px;
  padding: 3px 8px; font-size: 10px; font-weight: 600;
  background: var(--surface-2); color: var(--text-muted);
  border: 1px solid var(--border); border-radius: 4px; cursor: pointer;
  transition: opacity 0.1s, background 0.1s, color 0.1s;
  opacity: 0.5;
}
.filter-btn:hover { background: var(--border); color: var(--text); }
.filter-btn.active { opacity: 1; color: var(--text); }
.filter-btn.errors.active { border-color: color-mix(in srgb, var(--danger) 40%, transparent); }
.filter-btn.warns.active { border-color: color-mix(in srgb, var(--warning) 40%, transparent); }
.filter-dot { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; }
.errors-dot { background: var(--danger); }
.warns-dot { background: var(--warning); }
.filter-count {
  font-size: 9px; font-weight: 700; padding: 0 4px;
  background: var(--surface); border-radius: 3px; color: var(--text-muted);
}

.errors-filters { display: flex; gap: 4px; flex-wrap: wrap; }
.errors-actions { display: flex; gap: 4px; flex-wrap: wrap; margin-left: auto; }
.action-btn {
  display: flex; align-items: center; gap: 4px;
  padding: 3px 10px; font-size: 10px; font-weight: 600;
  background: var(--surface-2); color: var(--text-muted); border: 1px solid var(--border);
  border-radius: 4px; cursor: pointer;
}
.action-btn:hover:not(:disabled) { background: var(--border); color: var(--text); }
.action-btn:disabled { opacity: 0.5; cursor: default; }
.action-btn.icon-only { padding: 4px 6px; }

.errors-empty {
  display: flex; align-items: center; gap: 6px;
  padding: 8px 10px; border-radius: 6px; font-size: 11px; font-weight: 600;
  background: color-mix(in srgb, var(--success) 12%, transparent); color: var(--success);
  border: 1px solid color-mix(in srgb, var(--success) 25%, transparent);
}
.errors-empty.paused-msg {
  background: color-mix(in srgb, var(--warning) 10%, transparent); color: var(--warning);
  border-color: color-mix(in srgb, var(--warning) 25%, transparent);
}
.errors-empty.filtered-msg {
  background: var(--surface-2); color: var(--text-muted);
  border-color: var(--border);
}

.errors-summary {
  font-size: 11px; font-weight: 600;
  padding: 6px 8px; border-radius: 5px;
  background: color-mix(in srgb, var(--danger) 8%, transparent); border: 1px solid color-mix(in srgb, var(--danger) 20%, transparent);
  display: flex; gap: 6px; align-items: center;
}
.summary-errors { color: var(--danger); }
.summary-warns { color: var(--warning); }
.summary-sep { color: var(--text-muted); }

.error-card {
  padding: 8px; border-radius: 6px; cursor: pointer;
  background: var(--surface-2); border-left: 3px solid var(--border);
  display: flex; align-items: center; gap: 6px;
  transition: background 0.1s;
}
.error-card:hover { background: var(--surface-3, var(--border)); }
.error-card.error { border-left-color: var(--danger); }
.error-card.unhandled { border-left-color: var(--severity-critical); }
.error-card.warn { border-left-color: var(--warning); }

.error-level {
  font-size: 9px; font-weight: 700; text-transform: uppercase; padding: 1px 5px;
  border-radius: 3px; color: white; flex-shrink: 0;
}
.error-level.error { background: var(--danger); }
.error-level.unhandled { background: var(--severity-critical); }
.error-level.warn { background: var(--warning); }

.error-msg {
  font-size: 11px; font-weight: 500; color: var(--text);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; flex: 1;
}

.error-count {
  font-size: 10px; font-weight: 700; color: var(--text-muted);
  background: var(--surface); padding: 1px 5px; border-radius: 3px; flex-shrink: 0;
}

.error-tasked-badge {
  font-size: 9px; font-weight: 700; text-transform: uppercase;
  color: var(--success); background: color-mix(in srgb, var(--success) 12%, transparent);
  padding: 1px 5px; border-radius: 3px; flex-shrink: 0;
}

.error-chevron { margin-left: auto; color: var(--text-muted); flex-shrink: 0; }

/* Detail drawer content */
.error-message-full {
  font-family: 'SF Mono', 'Fira Code', monospace; font-size: 12px;
  white-space: pre-wrap; word-break: break-word; line-height: 1.5;
}

.error-stack {
  display: flex; flex-direction: column; gap: 2px;
  padding: 8px; border-radius: 6px; background: rgba(0,0,0,0.3);
  overflow-x: auto;
}
.stack-line {
  font-family: 'SF Mono', 'Fira Code', monospace; font-size: 11px;
  color: var(--text-muted); white-space: pre; line-height: 1.5;
}
</style>
