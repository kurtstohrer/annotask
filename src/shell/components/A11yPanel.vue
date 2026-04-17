<template>
  <aside class="panel">
    <div class="panel-source">
      <span class="source-path" style="color:var(--text)">Accessibility</span>
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
      </div>

      <div
        v-for="v in a11yViolations"
        :key="v.id"
        class="a11y-card"
        :class="v.impact"
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
    </div>
  </aside>
</template>

<script setup lang="ts">
import type { A11yViolation } from '../composables/useA11yScanner'

interface Props {
  a11yViolations: A11yViolation[]
  a11yLoading: boolean
  a11yError: string | null
  a11yScanned: boolean
  a11yTaskRules: Set<string>
}

defineProps<Props>()
defineEmits<{
  (e: 'select-violation', violation: A11yViolation): void
}>()
</script>
