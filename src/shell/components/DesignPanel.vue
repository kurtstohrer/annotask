<script setup lang="ts">
import ThemePage from './ThemePage.vue'
import ElementStyleEditor from './ElementStyleEditor.vue'
import AccessibilitySection from './AccessibilitySection.vue'
import Icon from './Icon.vue'
import type { SelectionData } from '../composables/useSelectionModel'
import type { ElementRole } from '../composables/useElementClassification'
import type { ChangeRecord } from '../composables/useStyleEditor'
import type { ColorSchemeInfo } from '../../schema'
import type { ColorSchemeResult } from '../../shared/bridge-types'
import type { useIframeManager } from '../composables/useIframeManager'

defineProps<{
  section: 'tokens' | 'inspector'
  iframeRef: HTMLIFrameElement | null
  iframe: ReturnType<typeof useIframeManager>
  getColorScheme: () => Promise<ColorSchemeInfo | null>
  colorScheme: ColorSchemeResult | null
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
    <ThemePage v-if="section === 'tokens'" :iframeRef="iframeRef" :getColorScheme="getColorScheme" :colorScheme="colorScheme" :activateColorScheme="iframe.activateColorScheme" />
    <template v-else-if="section === 'inspector' && primarySelection">
      <ElementStyleEditor
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
      <AccessibilitySection :iframe="iframe" :eid="primarySelection.eid" />
    </template>
    <div v-else class="empty-element">
      <Icon name="mouse-pointer" :size="32" :stroke-width="1.5" style="opacity: 0.3" />
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
