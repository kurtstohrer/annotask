<script setup lang="ts">
import { ref, computed } from 'vue'
import LayoutControls from './LayoutControls.vue'
import SpacingControls from './SpacingControls.vue'
import SizeControls from './SizeControls.vue'
import AppearanceControls from './AppearanceControls.vue'
import type { SelectionData } from '../composables/useSelectionModel'
import type { ElementRole } from '../composables/useElementClassification'
import type { ChangeRecord, ClassChangeRecord, StyleChangeRecord } from '../composables/useStyleEditor'

const props = defineProps<{
  primarySelection: SelectionData
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

const activeTab = ref<'layout' | 'spacing' | 'size' | 'style' | 'classes'>('layout')

type StyleOrClassChange = StyleChangeRecord | ClassChangeRecord

const styleClassChanges = computed<StyleOrClassChange[]>(() =>
  props.changes.filter((c): c is StyleOrClassChange => c.type === 'style_update' || c.type === 'class_update')
)

function onStyleChange(property: string, value: string, tokenRole?: string) {
  emit('style-change', property, value, tokenRole)
}

function onClassBlur() {
  emit('class-change')
}

const localClasses = computed({
  get: () => props.editingClasses,
  set: (v: string) => emit('update:editingClasses', v),
})

const localApplyToGroup = computed({
  get: () => props.applyToGroup,
  set: (v: boolean) => emit('update:applyToGroup', v),
})
</script>

<template>
  <div class="element-style-editor">
    <div class="panel-source">
      <code class="source-path">{{ primarySelection.file }}:{{ primarySelection.line }}</code>
      <span class="component-badge">{{ primarySelection.component }}</span>
      <span v-if="selectedElementRole" class="role-badge" :class="selectedElementRole">{{ selectedElementRole }}</span>
    </div>

    <div v-if="selectionSummary" class="panel-group-bar">
      <span class="group-summary">{{ selectionSummary }}</span>
      <label v-if="templateGroupEids.length > 1 && selectedEids.length <= 1" class="group-toggle" title="Apply style changes to all instances of this element in the template">
        <input type="checkbox" v-model="localApplyToGroup" />
        <span class="toggle-label">Apply to all {{ templateGroupEids.length }}</span>
      </label>
    </div>

    <div class="panel-tabs">
      <button :class="['tab', { active: activeTab === 'layout' }]" @click="activeTab = 'layout'" title="Edit display, flex, and grid properties">Layout</button>
      <button :class="['tab', { active: activeTab === 'spacing' }]" @click="activeTab = 'spacing'" title="Edit padding and margin">Spacing</button>
      <button :class="['tab', { active: activeTab === 'size' }]" @click="activeTab = 'size'" title="Edit width, height, and constraints">Size</button>
      <button :class="['tab', { active: activeTab === 'style' }]" @click="activeTab = 'style'" title="Edit colors, typography, and appearance">Style</button>
      <button :class="['tab', { active: activeTab === 'classes' }]" @click="activeTab = 'classes'" title="Edit CSS classes directly">Classes</button>
    </div>

    <div class="tab-content">
      <LayoutControls v-if="activeTab === 'layout'" :computedStyles="liveStyles" @change="onStyleChange" />
      <SpacingControls v-if="activeTab === 'spacing'" :computedStyles="liveStyles" @change="onStyleChange" />
      <SizeControls v-if="activeTab === 'size'" :computedStyles="liveStyles" @change="onStyleChange" />
      <AppearanceControls v-if="activeTab === 'style'" :computedStyles="liveStyles" @change="onStyleChange" />
      <div v-if="activeTab === 'classes'" class="classes-tab">
        <textarea v-model="localClasses" class="class-editor" rows="4" @blur="onClassBlur" @keydown.enter.ctrl="onClassBlur" placeholder="Edit CSS classes..." />
        <p class="hint">Ctrl+Enter or blur to apply</p>
      </div>
    </div>

    <div v-if="styleClassChanges.length" class="changes-footer">
      <div class="changes-list">
        <div v-for="ch in styleClassChanges" :key="ch.id" class="change-item">
          <template v-if="ch.type === 'style_update'">
            <code class="change-prop">{{ ch.property }}</code>
            <span class="change-arrow">&rarr;</span>
            <code class="change-val">{{ ch.after }}</code>
          </template>
          <template v-else-if="ch.type === 'class_update'">
            <code class="change-prop">classes</code>
            <span class="change-arrow">&rarr;</span>
            <code class="change-val">{{ ch.after.classes.substring(0, 30) }}</code>
          </template>
        </div>
      </div>
      <div class="changes-actions">
        <span class="changes-count">{{ styleClassChanges.length }} change{{ styleClassChanges.length === 1 ? '' : 's' }}</span>
        <button class="changes-commit" @click="emit('commit')" title="Save these visual changes as a task for your AI agent to apply to source code">Commit to Task</button>
        <button class="changes-discard" @click="emit('discard')" title="Undo all visual changes (does not affect source code)">Discard</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.element-style-editor {
  display: flex;
  flex-direction: column;
  overflow: hidden;
  flex: 1;
}

.tab-content {
  flex: 1;
  overflow-y: auto;
  padding: 8px 12px;
}
</style>
