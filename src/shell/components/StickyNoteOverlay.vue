<script setup lang="ts">
import { ref } from 'vue'
import type { StickyNote } from '../composables/useAnnotations'

defineProps<{
  notes: StickyNote[]
  selectedId: string | null
}>()

const emit = defineEmits<{
  select: [id: string]
  remove: [id: string]
  update: [id: string, updates: Partial<StickyNote>]
  commit: [id: string]
}>()

// Drag state
let dragId = ''
let dragOffX = 0
let dragOffY = 0
const isDragging = ref(false)

function onDragStart(id: string, e: PointerEvent) {
  e.stopPropagation()
  const note = document.querySelector(`[data-sticky-id="${id}"]`) as HTMLElement
  if (!note) return
  dragId = id
  const rect = note.getBoundingClientRect()
  dragOffX = e.clientX - rect.left
  dragOffY = e.clientY - rect.top
  isDragging.value = true
  window.addEventListener('pointermove', onDragMove)
  window.addEventListener('pointerup', onDragEnd)
}

function onDragMove(e: PointerEvent) {
  if (!isDragging.value) return
  emit('update', dragId, { x: e.clientX - dragOffX, y: e.clientY - dragOffY })
}

function onDragEnd() {
  isDragging.value = false
  window.removeEventListener('pointermove', onDragMove)
  window.removeEventListener('pointerup', onDragEnd)
}

// Context menu for color
const colorMenu = ref<{ visible: boolean; x: number; y: number; id: string }>({ visible: false, x: 0, y: 0, id: '' })

function onContextMenu(id: string, e: MouseEvent) {
  e.preventDefault()
  e.stopPropagation()
  colorMenu.value = { visible: true, x: e.clientX, y: e.clientY, id }
}

function setColor(color: StickyNote['color']) {
  emit('update', colorMenu.value.id, { color })
  colorMenu.value.visible = false
}

function closeColorMenu() {
  colorMenu.value.visible = false
}

const colors: Record<string, { bg: string; border: string; text: string }> = {
  yellow: { bg: '#fef9c3', border: '#fde047', text: '#854d0e' },
  pink:   { bg: '#fce7f3', border: '#f9a8d4', text: '#9d174d' },
  blue:   { bg: '#dbeafe', border: '#93c5fd', text: '#1e40af' },
  green:  { bg: '#dcfce7', border: '#86efac', text: '#166534' },
}

const colorOptions: { key: StickyNote['color']; label: string }[] = [
  { key: 'yellow', label: 'Yellow' },
  { key: 'pink', label: 'Pink' },
  { key: 'blue', label: 'Blue' },
  { key: 'green', label: 'Green' },
]
</script>

<template>
  <div
    v-for="note in notes"
    :key="note.id"
    :data-sticky-id="note.id"
    class="sticky-note"
    :class="{ selected: note.id === selectedId }"
    :style="{
      left: note.x + 'px',
      top: note.y + 'px',
      background: colors[note.color]?.bg,
      borderColor: colors[note.color]?.border,
      color: colors[note.color]?.text,
    }"
    @click.stop="emit('select', note.id)"
    @contextmenu="onContextMenu(note.id, $event)"
    @pointerdown.stop="onDragStart(note.id, $event)"
  >
    <span class="sticky-number">#{{ note.number }}</span>
    <textarea
      class="sticky-text"
      :value="note.text"
      :style="{ color: colors[note.color]?.text }"
      placeholder="Note..."
      @input="emit('update', note.id, { text: ($event.target as HTMLTextAreaElement).value })"
      @blur="emit('commit', note.id)"
      @click.stop
      @pointerdown.stop
    />
    <button class="sticky-close" @click.stop="emit('remove', note.id)">×</button>
  </div>

  <!-- Color context menu -->
  <Teleport to="body">
    <div v-if="colorMenu.visible" class="color-context-menu" :style="{ left: colorMenu.x + 'px', top: colorMenu.y + 'px' }" @click.stop>
      <button
        v-for="c in colorOptions" :key="c.key"
        class="color-option"
        @click="setColor(c.key)"
      >
        <span class="color-swatch" :style="{ background: colors[c.key].bg, borderColor: colors[c.key].border }" />
        {{ c.label }}
      </button>
      <button class="color-option delete" @click="emit('remove', colorMenu.id); closeColorMenu()">Delete</button>
    </div>
    <div v-if="colorMenu.visible" class="color-menu-backdrop" @click="closeColorMenu()" />
  </Teleport>
</template>

<style scoped>
.sticky-note {
  position: fixed;
  z-index: 10004;
  width: 120px;
  height: 120px;
  border-radius: 3px;
  border: 1.5px solid;
  box-shadow: 1px 2px 6px rgba(0,0,0,0.12);
  display: flex;
  flex-direction: column;
  font-family: -apple-system, sans-serif;
  cursor: grab;
  transition: box-shadow 0.15s;
  padding: 4px;
}
.sticky-note:active { cursor: grabbing; }
.sticky-note.selected {
  box-shadow: 0 0 0 2px var(--accent, #3b82f6), 1px 2px 8px rgba(0,0,0,0.15);
}

.sticky-number {
  font-size: 8px; font-weight: 700; opacity: 0.4;
  position: absolute; top: 3px; left: 5px;
}

.sticky-close {
  position: absolute; top: 2px; right: 2px;
  width: 14px; height: 14px; border: none; background: none;
  opacity: 0; font-size: 12px; cursor: pointer; padding: 0;
  display: flex; align-items: center; justify-content: center;
  color: inherit;
}
.sticky-note:hover .sticky-close { opacity: 0.5; }
.sticky-close:hover { opacity: 1 !important; }

.sticky-text {
  flex: 1; width: 100%;
  padding: 14px 4px 2px;
  border: none; background: transparent;
  font-size: 10px; line-height: 1.3;
  resize: none; outline: none;
  font-family: inherit;
  cursor: text;
}
.sticky-text::placeholder { opacity: 0.35; }

/* Color context menu */
.color-context-menu {
  position: fixed;
  z-index: 30000;
  background: var(--surface, #141414);
  border: 1px solid var(--border, #2a2a2a);
  border-radius: 8px;
  box-shadow: 0 8px 24px rgba(0,0,0,0.5);
  padding: 4px;
  min-width: 120px;
}
.color-option {
  display: flex; align-items: center; gap: 8px;
  width: 100%; padding: 5px 10px;
  background: none; border: none; border-radius: 5px;
  color: var(--text, #e4e4e7); font-size: 11px;
  cursor: pointer;
}
.color-option:hover { background: var(--surface-2, #1e1e1e); }
.color-option.delete { color: var(--danger); margin-top: 2px; border-top: 1px solid var(--border, #2a2a2a); padding-top: 6px; }
.color-swatch { width: 14px; height: 14px; border-radius: 3px; border: 1.5px solid; flex-shrink: 0; }
.color-menu-backdrop { position: fixed; inset: 0; z-index: 29999; }
</style>
