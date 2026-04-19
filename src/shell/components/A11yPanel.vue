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
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
          <path d="M20 6L9 17l-5-5" />
        </svg>
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
        <svg class="a11y-chevron" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
          <polyline points="9 18 15 12 9 6" />
        </svg>
      </div>

      <!-- Tab-order findings list (only when overlay is on AND there's something to show). -->
      <template v-if="tabOrderEnabled">
        <div class="a11y-summary tab-summary">
          <span>Tab order ({{ flaggedBadges.length }} flagged of {{ tabOrderBadges.length }})</span>
          <span class="a11y-summary-hint">numbered on page</span>
        </div>
        <div v-if="flaggedBadges.length === 0" class="a11y-pass">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <path d="M20 6L9 17l-5-5" />
          </svg>
          No tab order issues
        </div>
        <div
          v-for="b in flaggedBadges"
          :key="'tof-' + b.eid"
          class="a11y-card tab-card"
          :class="b.flag || ''"
          @click="$emit('scroll-to', b.eid)"
        >
          <span class="a11y-impact" :class="badgeImpact(b)">{{ badgeImpact(b) }}</span>
          <span class="a11y-rule">{{ flagLabel(b) }}</span>
          <span class="a11y-count">#{{ b.index === -1 ? '×' : b.index }} · {{ b.tag }}</span>
          <button class="tab-fix-btn" @click.stop="$emit('create-tab-order-task', b)">Fix</button>
        </div>
      </template>
    </div>
  </aside>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { A11yViolation } from '../composables/useA11yScanner'
import type { TabOrderBadge } from '../composables/useTabOrderOverlay'

interface Props {
  a11yViolations: A11yViolation[]
  a11yLoading: boolean
  a11yError: string | null
  a11yScanned: boolean
  a11yTaskRules: Set<string>
  focusedRule: string | null
  tabOrderEnabled: boolean
  tabOrderLoading: boolean
  tabOrderBadges: TabOrderBadge[]
}

const props = defineProps<Props>()
defineEmits<{
  (e: 'select-violation', violation: A11yViolation): void
  (e: 'focus-rule', ruleId: string | null): void
  (e: 'toggle-tab-order'): void
  (e: 'scroll-to', eid: string): void
  (e: 'create-tab-order-task', badge: TabOrderBadge): void
}>()

const flaggedBadges = computed(() => props.tabOrderBadges.filter(b => b.flag !== null))

function badgeImpact(b: TabOrderBadge): string {
  if (b.flag === 'positive') return 'serious'
  if (b.flag === 'reorder') return 'moderate'
  if (b.flag === 'unreachable') return 'serious'
  return 'minor'
}

function flagLabel(b: TabOrderBadge): string {
  if (b.flag === 'positive') return `positive tabindex (${b.tabindex})`
  if (b.flag === 'reorder') return 'tab/visual order mismatch'
  if (b.flag === 'unreachable') return 'unreachable interactive'
  return 'tab order'
}
</script>

<style scoped>
.a11y-summary { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
.a11y-summary-hint { font-size: 10px; color: var(--text-muted); font-weight: 400; }
.a11y-card { transition: background-color 0.12s ease-out, border-color 0.12s ease-out; }
.a11y-card.focused { background-color: var(--surface-2); border-color: var(--border-strong); }
.a11y-card.tasked { opacity: 0.78; }

.tab-summary { margin-top: 16px; }
.tab-card { cursor: pointer; }
.tab-fix-btn {
  margin-left: auto;
  padding: 2px 8px;
  font-size: 10px;
  font-weight: 600;
  background: var(--accent);
  color: var(--text-on-accent);
  border: none;
  border-radius: 4px;
  cursor: pointer;
}
.tab-fix-btn:hover { opacity: 0.9; }

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
