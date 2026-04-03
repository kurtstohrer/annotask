<script setup lang="ts">
interface DetailProp {
  name: string
  type: string | null
  required: boolean
  default?: unknown
  description?: string | null
}

interface DetailComponent {
  name: string
  module?: string
  props: DetailProp[]
}

defineProps<{
  component: DetailComponent
}>()

const emit = defineEmits<{ back: [] }>()
</script>

<template>
  <div class="comp-detail">
    <button class="back-btn" @click="emit('back')">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="15 18 9 12 15 6"/></svg>
      Back
    </button>

    <div class="detail-header">
      <h3 class="detail-name">{{ component.name }}</h3>
      <code v-if="component.module" class="detail-module">{{ component.module }}</code>
    </div>

    <div class="props-section">
      <div class="props-header">
        <span class="section-label">Props</span>
        <span class="prop-count">{{ component.props.length }}</span>
      </div>

      <div v-if="component.props.length === 0" class="no-props">No props defined</div>

      <div v-for="p in component.props" :key="p.name" class="prop-row">
        <div class="prop-top">
          <code class="prop-name">{{ p.name }}</code>
          <span v-if="p.required" class="prop-req">req</span>
          <span v-if="p.type" class="prop-type">{{ p.type }}</span>
        </div>
        <p v-if="p.description" class="prop-desc">{{ p.description }}</p>
        <span v-if="p.default != null" class="prop-default">Default: {{ p.default }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.comp-detail { display: flex; flex-direction: column; gap: 8px; }

.back-btn {
  display: flex; align-items: center; gap: 4px;
  background: none; border: none; color: var(--accent); cursor: pointer;
  font-size: 11px; font-weight: 600; padding: 2px 0; align-self: flex-start;
}
.back-btn:hover { opacity: 0.8; }

.detail-header { display: flex; flex-direction: column; gap: 2px; }
.detail-name { margin: 0; font-size: 16px; font-weight: 700; color: var(--text); }
.detail-module { font-size: 10px; color: var(--text-muted); }

.props-section { display: flex; flex-direction: column; gap: 4px; }
.props-header { display: flex; align-items: center; gap: 6px; margin-bottom: 2px; }
.section-label { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-muted); }
.prop-count { font-size: 10px; color: var(--text-muted); }
.no-props { font-size: 11px; color: var(--text-muted); font-style: italic; padding: 8px 0; }

.prop-row {
  padding: 6px 8px; border-radius: 6px; background: var(--surface-2);
  display: flex; flex-direction: column; gap: 3px;
}
.prop-top { display: flex; align-items: baseline; gap: 6px; }
.prop-name { font-size: 11px; color: #60a5fa; font-weight: 600; }
.prop-req { font-size: 8px; color: #f59e0b; font-weight: 700; text-transform: uppercase; }
.prop-type { font-size: 9px; color: var(--text-muted); margin-left: auto; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 140px; }
.prop-desc { margin: 0; font-size: 10px; color: var(--text-muted); line-height: 1.3; }
.prop-default { font-size: 9px; color: var(--text-muted); opacity: 0.8; }
</style>
