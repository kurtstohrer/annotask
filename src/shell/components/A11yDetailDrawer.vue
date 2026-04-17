<template>
  <FindingDrawer
    :title="violation.help"
    :severity="violation.impact"
    :tasked="tasked"
    @close="$emit('close')"
    @create-task="$emit('create-task', violation)"
  >
    <div class="fd-detail-section">
      <span class="fd-detail-label">Rule</span>
      <span class="fd-detail-value">{{ violation.id }}</span>
    </div>
    <div class="fd-detail-section">
      <span class="fd-detail-label">Impact</span>
      <span class="fd-detail-value">{{ violation.impact }}</span>
    </div>
    <div class="fd-detail-section">
      <span class="fd-detail-label">Description</span>
      <p class="fd-detail-text">{{ violation.description }}</p>
    </div>
    <div v-if="violation.elements && violation.elements.length" class="fd-detail-section">
      <span class="fd-detail-label">Affected Elements ({{ violation.nodes }})</span>
      <div v-for="(el, i) in violation.elements" :key="i" class="fd-a11y-element">
        <code class="fd-a11y-html">{{ el.html }}</code>
        <code v-if="el.target" class="fd-a11y-selector">{{ el.target }}</code>
        <p v-if="el.failureSummary" class="fd-a11y-fix">{{ el.failureSummary }}</p>
        <span v-if="el.file" class="fd-a11y-source">{{ el.file }}:{{ el.line }} &middot; {{ el.component }}</span>
      </div>
    </div>
    <div class="fd-detail-section">
      <span class="fd-detail-label">Learn More</span>
      <a :href="violation.helpUrl" target="_blank" rel="noopener" class="fd-link">{{ violation.helpUrl }}</a>
    </div>
  </FindingDrawer>
</template>

<script setup lang="ts">
import FindingDrawer from './FindingDrawer.vue'
import type { A11yViolation } from '../composables/useA11yScanner'

interface Props {
  violation: A11yViolation
  tasked: boolean
}

defineProps<Props>()
defineEmits<{
  (e: 'close'): void
  (e: 'create-task', violation: A11yViolation): void
}>()
</script>
