<script setup lang="ts">
import ThemePage from './ThemePage.vue'
import ElementStyleEditor from './ElementStyleEditor.vue'
import type { SelectionData } from '../composables/useSelectionModel'
import type { ElementRole } from '../composables/useElementClassification'
import type { ChangeRecord } from '../composables/useStyleEditor'
import type { ColorSchemeInfo } from '../../schema'

defineProps<{
  section: 'tokens' | 'inspector'
  iframeRef: HTMLIFrameElement | null
  getColorScheme: () => Promise<ColorSchemeInfo | null>
  primarySelection: SelectionData | null
  selectionSummary: string | null
  selectedElementRole: ElementRole | null
  templateGroupEids: string[]
  selectedEids: string[]
  applyToGroup: boolean
  liveStyles: Record<string, string>
  editingClasses: string
  changes: ChangeRecord[]
}>()

const emit = defineEmits<{
  'style-change': [property: string, value: string, tokenRole?: string]
  'class-change': []
  'update:editingClasses': [value: string]
  'update:applyToGroup': [value: boolean]
  'commit': []
  'discard': []
}>()
</script>

<template>
  <div class="design-panel">
    <ThemePage v-if="section === 'tokens'" :iframeRef="iframeRef" :getColorScheme="getColorScheme" />
    <ElementStyleEditor
      v-else-if="section === 'inspector' && primarySelection"
      :primarySelection="primarySelection"
      :selectionSummary="selectionSummary"
      :selectedElementRole="selectedElementRole"
      :templateGroupEids="templateGroupEids"
      :selectedEids="selectedEids"
      :applyToGroup="applyToGroup"
      :liveStyles="liveStyles"
      :editingClasses="editingClasses"
      :changes="changes"
      @style-change="(p, v, role) => emit('style-change', p, v, role)"
      @class-change="emit('class-change')"
      @update:editingClasses="emit('update:editingClasses', $event)"
      @update:applyToGroup="emit('update:applyToGroup', $event)"
      @commit="emit('commit')"
      @discard="emit('discard')"
    />
    <div v-else class="empty-element">
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.3"><path d="M4 4l7.07 17 2.51-7.39L21 11.07z"/></svg>
      <p>Click an element to edit its styles</p>
    </div>
  </div>
</template>

<style scoped>
.design-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

.empty-element {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  flex: 1;
  gap: 12px;
  color: var(--text-secondary);
  font-size: 13px;
}
</style>
