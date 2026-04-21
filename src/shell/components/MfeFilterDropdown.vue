<script setup lang="ts">
import { ref, onBeforeUnmount, useTemplateRef, watch } from 'vue'
import { useWorkspace } from '../composables/useWorkspace'
import Icon from './Icon.vue'

const props = defineProps<{
  /** Used as the tooltip and accessible label — varies by page (APIs / hooks / components). */
  label?: string
}>()

const ws = useWorkspace()

const isOpen = ref(false)
const rootRef = useTemplateRef<HTMLElement>('rootRef')

function toggle() { isOpen.value = !isOpen.value }
function close() { isOpen.value = false }

function onDocMouseDown(e: MouseEvent) {
  if (!isOpen.value) return
  if (rootRef.value && !rootRef.value.contains(e.target as Node)) close()
}

watch(isOpen, (open) => {
  if (open) document.addEventListener('mousedown', onDocMouseDown, true)
  else document.removeEventListener('mousedown', onDocMouseDown, true)
})

onBeforeUnmount(() => document.removeEventListener('mousedown', onDocMouseDown, true))

function selectedCount(): number { return ws.selectedMfes.value.size }

function summaryTitle(): string {
  const n = selectedCount()
  const base = props.label ?? 'MFE filter'
  if (n === 0) return `${base}: All MFEs`
  if (n === 1) return `${base}: ${[...ws.selectedMfes.value][0]}`
  return `${base}: ${n} selected`
}
</script>

<template>
  <div ref="rootRef" class="mfe-filter-root" :class="{ active: selectedCount() > 0 }">
    <button
      type="button"
      class="mfe-filter-trigger"
      :class="{ open: isOpen }"
      :aria-expanded="isOpen"
      :title="summaryTitle()"
      @click="toggle"
    >
      <Icon name="sliders-horizontal" :size="14" :stroke-width="2" />
      <span v-if="selectedCount() > 0" class="mfe-filter-badge">{{ selectedCount() }}</span>
    </button>
    <div v-if="isOpen" class="mfe-filter-panel" role="dialog" aria-label="Filter by MFE">
      <div class="mfe-filter-head">
        <span class="mfe-filter-title">Filter by MFE</span>
        <button
          type="button"
          class="mfe-filter-clear"
          :disabled="selectedCount() === 0"
          @click="ws.clearMfes()"
        >Clear</button>
      </div>
      <ul class="mfe-filter-list">
        <li v-for="pkg in ws.mfePackages.value" :key="pkg.mfe">
          <label class="mfe-filter-row">
            <input
              type="checkbox"
              :checked="ws.selectedMfes.value.has(pkg.mfe!)"
              @change="ws.toggleMfe(pkg.mfe!)"
            />
            <span class="mfe-filter-name">{{ pkg.mfe }}</span>
            <span class="mfe-filter-dir">{{ pkg.dir }}</span>
          </label>
        </li>
      </ul>
    </div>
  </div>
</template>

<style scoped>
.mfe-filter-root {
  position: relative;
  display: inline-flex;
}
.mfe-filter-trigger {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 6px;
  background: var(--surface-2);
  border: 1px solid var(--border);
  color: var(--text-muted);
  border-radius: 4px;
  cursor: pointer;
  /* Anchor the selection-count badge as an overlay so ticking a checkbox
     doesn't change the trigger's width — keeping the popover's right:0
     anchor point stable instead of reflowing the flex-wrap header on every
     click. */
  position: relative;
}
.mfe-filter-trigger:hover { background: var(--surface-3); color: var(--text); }
.mfe-filter-trigger.open {
  background: var(--surface-3);
  color: var(--text);
  border-color: var(--focus-ring);
}
.mfe-filter-root.active .mfe-filter-trigger {
  color: var(--accent);
  border-color: color-mix(in srgb, var(--accent) 40%, transparent);
  background: color-mix(in srgb, var(--accent) 12%, transparent);
}
.mfe-filter-badge {
  position: absolute;
  top: -6px;
  right: -6px;
  font-size: 10px;
  line-height: 1;
  min-width: 14px;
  padding: 2px 4px;
  border-radius: 10px;
  background: var(--accent);
  color: var(--text-on-accent);
  font-weight: 700;
  text-align: center;
  pointer-events: none;
}

.mfe-filter-panel {
  position: absolute;
  top: calc(100% + 4px);
  right: 0;
  z-index: 1000;
  min-width: 220px;
  max-height: 320px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--surface-elevated);
  border: 1px solid var(--border);
  border-radius: 6px;
  box-shadow: 0 8px 24px var(--shadow);
  z-index: 20;
}
.mfe-filter-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  border-bottom: 1px solid var(--border);
  background: var(--surface-2);
}
.mfe-filter-title {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.mfe-filter-clear {
  margin-left: auto;
  padding: 2px 6px;
  font-size: 11px;
  background: transparent;
  border: 1px solid var(--border);
  color: var(--text-muted);
  border-radius: 3px;
  cursor: pointer;
}
.mfe-filter-clear:hover:not(:disabled) { color: var(--text); background: var(--surface-3); }
.mfe-filter-clear:disabled { opacity: 0.4; cursor: not-allowed; }

.mfe-filter-list {
  list-style: none;
  padding: 4px 0;
  margin: 0;
  overflow-y: auto;
}
.mfe-filter-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 10px;
  font-size: 12px;
  cursor: pointer;
}
.mfe-filter-row:hover { background: var(--surface-2); }
.mfe-filter-row input[type="checkbox"] {
  accent-color: var(--accent);
  flex-shrink: 0;
}
.mfe-filter-name {
  font-family: var(--font-mono, monospace);
  font-weight: 600;
  color: var(--text);
}
.mfe-filter-dir {
  margin-left: auto;
  color: var(--text-muted);
  font-size: 10px;
  font-family: var(--font-mono, monospace);
  max-width: 220px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
