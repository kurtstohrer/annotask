<script setup lang="ts">
import type { DrawnSection } from '../composables/useAnnotations'

defineProps<{
  sections: DrawnSection[]
  selectedId: string | null
  drawingRect: { x: number; y: number; width: number; height: number } | null
}>()

const emit = defineEmits<{
  select: [id: string]
  remove: [id: string]
  'update-prompt': [id: string, prompt: string]
  commit: [id: string]
}>()
</script>

<template>
  <!-- Drawing preview -->
  <div
    v-if="drawingRect && drawingRect.width > 5 && drawingRect.height > 5"
    class="section-preview"
    :style="{
      left: drawingRect.x + 'px', top: drawingRect.y + 'px',
      width: drawingRect.width + 'px', height: drawingRect.height + 'px',
    }"
  />

  <!-- Existing sections -->
  <div
    v-for="section in sections"
    :key="section.id"
    class="drawn-section"
    :class="{ selected: section.id === selectedId }"
    :style="{
      left: section.x + 'px', top: section.y + 'px',
      width: section.width + 'px', height: section.height + 'px',
    }"
    @click.stop="emit('select', section.id)"
  >
    <div class="section-header">
      <span class="section-badge">#{{ section.number }} New Section</span>
      <span v-if="section.placement" class="section-placement">{{ section.placement }}</span>
      <button class="section-delete" @click.stop="emit('remove', section.id)">×</button>
    </div>
    <textarea
      class="section-prompt"
      :value="section.prompt"
      placeholder="Describe what should go here..."
      @input="emit('update-prompt', section.id, ($event.target as HTMLTextAreaElement).value)"
      @blur="emit('commit', section.id)"
      @click.stop
    />
    <div class="section-dims">
      {{ Math.round(section.width) }}×{{ Math.round(section.height) }}px
    </div>
  </div>
</template>

<style scoped>
.section-preview {
  position: fixed;
  z-index: 10003;
  border: 2px dashed #22c55e;
  background: rgba(34, 197, 94, 0.06);
  border-radius: 6px;
  pointer-events: none;
}

.drawn-section {
  position: fixed;
  z-index: 10003;
  border: 2px dashed #22c55e;
  background: rgba(34, 197, 94, 0.04);
  border-radius: 6px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  cursor: pointer;
  transition: border-color 0.15s;
}
.drawn-section.selected {
  border-color: #16a34a;
  box-shadow: 0 0 0 2px rgba(34, 197, 94, 0.3);
}

.section-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  background: rgba(34, 197, 94, 0.1);
  border-bottom: 1px solid rgba(34, 197, 94, 0.15);
}
.section-badge { font-size: 9px; font-weight: 700; color: #16a34a; }
.section-placement { font-size: 8px; color: #22c55e; background: rgba(34,197,94,0.1); padding: 1px 4px; border-radius: 3px; }
.section-delete {
  margin-left: auto; width: 16px; height: 16px; border: none; background: none;
  color: #22c55e; font-size: 14px; cursor: pointer; padding: 0;
  display: flex; align-items: center; justify-content: center;
}
.section-delete:hover { color: #ef4444; }

.section-prompt {
  flex: 1;
  padding: 6px 8px;
  border: none;
  background: transparent;
  color: #166534;
  font-size: 11px;
  line-height: 1.4;
  resize: none;
  outline: none;
  font-family: inherit;
  min-height: 40px;
}
.section-prompt::placeholder { color: rgba(22, 101, 52, 0.4); }

.section-dims {
  padding: 2px 8px 4px;
  font-size: 8px;
  color: rgba(22, 101, 52, 0.4);
  text-align: right;
}
</style>
