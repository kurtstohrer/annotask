<template>
  <aside class="panel">
    <div class="panel-source">
      <span class="source-path" style="color:var(--text)">Accessibility</span>
      <button
        class="panel-tool-btn"
        :class="{ active: tabOrderEnabled }"
        :disabled="tabOrderLoading"
        @click="$emit('toggle-tab-order')"
        :title="tabOrderEnabled ? 'Hide tab order' : 'Show numbered tab order on page'"
      >
        {{ tabOrderEnabled ? '✕ Tab order' : '⌨ Tab order' }}
      </button>
    </div>
    <div class="tab-content">
      <div v-if="a11yError" class="a11y-error">{{ a11yError }}</div>

      <div v-if="!a11yLoading && a11yViolations.length === 0 && !a11yError && a11yScanned" class="a11y-pass">
        <Icon name="check" :stroke-width="2.5" />
        No violations found
      </div>
      <div v-else-if="!a11yLoading && a11yViolations.length === 0 && !a11yError" class="a11y-empty">
        Click Scan Page to check accessibility
      </div>

      <div v-if="a11yViolations.length" class="a11y-summary">
        {{ a11yViolations.length }} violation{{ a11yViolations.length === 1 ? '' : 's' }}
        <span class="a11y-summary-hint">hover to highlight on page</span>
      </div>

      <div
        v-for="v in a11yViolations"
        :key="v.id"
        data-testid="a11y-violation"
        :data-rule="v.id"
        :data-impact="v.impact"
        class="a11y-card"
        :class="[v.impact, { focused: focusedRule === v.id, tasked: a11yTaskRules.has(v.id) }]"
        @mouseenter="$emit('focus-rule', v.id)"
        @mouseleave="$emit('focus-rule', null)"
        @click="$emit('select-violation', v)"
      >
        <span class="a11y-impact" :class="v.impact">{{ v.impact }}</span>
        <span class="a11y-rule">{{ v.id }}</span>
        <span class="a11y-count">{{ v.nodes }} element{{ v.nodes === 1 ? '' : 's' }}</span>
        <span v-if="a11yTaskRules.has(v.id)" class="a11y-tasked-badge">tasked</span>
        <Icon class="a11y-chevron" name="chevron-right" :size="10" :stroke-width="2.5" />
      </div>
    </div>
  </aside>
</template>

<script setup lang="ts">
import Icon from './Icon.vue'
import type { A11yViolation } from '../composables/useA11yScanner'

interface Props {
  a11yViolations: A11yViolation[]
  a11yLoading: boolean
  a11yError: string | null
  a11yScanned: boolean
  a11yTaskRules: Set<string>
  focusedRule: string | null
  tabOrderEnabled: boolean
  tabOrderLoading: boolean
}

defineProps<Props>()
defineEmits<{
  (e: 'select-violation', violation: A11yViolation): void
  (e: 'focus-rule', ruleId: string | null): void
  (e: 'toggle-tab-order'): void
}>()
</script>

<style scoped>
.a11y-summary { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
.a11y-summary-hint { font-size: 10px; color: var(--text-muted); font-weight: 400; }
.a11y-card { transition: background-color 0.12s ease-out, border-color 0.12s ease-out; }
.a11y-card.focused { background-color: var(--surface-2); border-color: var(--border-strong); }
.a11y-card.tasked { opacity: 0.78; }

.panel-source {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.panel-tool-btn {
  font-size: 11px;
  padding: 3px 8px;
  background: var(--surface-2);
  color: var(--text);
  border: 1px solid var(--border);
  border-radius: 4px;
  cursor: pointer;
}
.panel-tool-btn.active {
  background: var(--accent);
  color: var(--text-on-accent);
  border-color: var(--accent);
}
.panel-tool-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.panel-tool-btn:hover:not(:disabled) { background: var(--surface-3); }
.panel-tool-btn.active:hover:not(:disabled) { background: var(--accent-hover); }
</style>
