<script setup lang="ts">
import { ref, watch, nextTick } from 'vue'
import { marked } from 'marked'
import type { DrawnSection } from '../composables/useAnnotations'

const props = defineProps<{
  sections: DrawnSection[]
  selectedId: string | null
  drawingRect: { x: number; y: number; width: number; height: number } | null
  sectionTaskMap: Record<string, string>
}>()

const emit = defineEmits<{
  select: [id: string]
  remove: [id: string]
  'update-prompt': [id: string, prompt: string]
  'update-rect': [id: string, rect: { x: number; y: number; width: number; height: number }]
  submit: [id: string]
}>()

const editingId = ref<string | null>(null)
const textareaRef = ref<HTMLTextAreaElement | null>(null)

// ── Drag / resize state ──
const dragState = ref<{
  id: string
  mode: 'move' | 'resize'
  handle?: string
  startX: number; startY: number
  origX: number; origY: number; origW: number; origH: number
} | null>(null)

function hasTask(id: string): boolean {
  return !!props.sectionTaskMap[id]
}

function renderMd(text: string): string {
  if (!text) return ''
  return marked.parse(text, { breaks: true, gfm: true }) as string
}

function startEditing(id: string) {
  editingId.value = id
  nextTick(() => textareaRef.value?.focus())
}

function onTextareaBlur(e: FocusEvent, id: string) {
  const section = (e.target as HTMLElement).closest('.drawn-section')
  if (section && section.contains(e.relatedTarget as Node)) return
  editingId.value = null
}

// ── Move (drag header) ──
function onMoveDown(e: PointerEvent, section: DrawnSection) {
  e.preventDefault()
  e.stopPropagation()
  dragState.value = {
    id: section.id, mode: 'move',
    startX: e.clientX, startY: e.clientY,
    origX: section.x, origY: section.y, origW: section.width, origH: section.height,
  }
  window.addEventListener('pointermove', onDragMove)
  window.addEventListener('pointerup', onDragUp)
}

// ── Resize ──
function onResizeDown(e: PointerEvent, section: DrawnSection, handle: string) {
  e.preventDefault()
  e.stopPropagation()
  dragState.value = {
    id: section.id, mode: 'resize', handle,
    startX: e.clientX, startY: e.clientY,
    origX: section.x, origY: section.y, origW: section.width, origH: section.height,
  }
  window.addEventListener('pointermove', onDragMove)
  window.addEventListener('pointerup', onDragUp)
}

function onDragMove(e: PointerEvent) {
  const d = dragState.value
  if (!d) return
  const dx = e.clientX - d.startX
  const dy = e.clientY - d.startY

  if (d.mode === 'move') {
    emit('update-rect', d.id, { x: d.origX + dx, y: d.origY + dy, width: d.origW, height: d.origH })
    return
  }

  let x = d.origX, y = d.origY, w = d.origW, h = d.origH
  const handle = d.handle || ''
  if (handle.includes('e')) w = Math.max(60, d.origW + dx)
  if (handle.includes('s')) h = Math.max(60, d.origH + dy)
  if (handle.includes('w')) { w = Math.max(60, d.origW - dx); x = d.origX + d.origW - w }
  if (handle.includes('n')) { h = Math.max(60, d.origH - dy); y = d.origY + d.origH - h }
  emit('update-rect', d.id, { x, y, width: w, height: h })
}

function onDragUp() {
  dragState.value = null
  window.removeEventListener('pointermove', onDragMove)
  window.removeEventListener('pointerup', onDragUp)
}
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
    :class="{ selected: section.id === selectedId, submitted: hasTask(section.id) }"
    :style="{
      left: section.x + 'px', top: section.y + 'px',
      width: section.width + 'px', height: section.height + 'px',
    }"
    @click.stop="emit('select', section.id)"
  >
    <!-- Collapsed view when not selected -->
    <template v-if="section.id !== selectedId">
      <div class="section-badge-float">
        <span>#{{ section.number }}</span>
        <span v-if="hasTask(section.id)" class="badge-check">&#10003;</span>
      </div>
      <div v-if="section.prompt" class="section-hint" v-html="renderMd(section.prompt)" />
    </template>

    <!-- Full UI when selected -->
    <template v-else>
      <div class="section-header" @pointerdown="onMoveDown($event, section)" style="cursor: grab;">
        <span class="section-badge">#{{ section.number }}</span>
        <span v-if="hasTask(section.id)" class="section-status">Task added</span>
        <span class="section-dims-inline">{{ Math.round(section.width) }}×{{ Math.round(section.height) }}px</span>
        <button class="section-delete" @click.stop="emit('remove', section.id)" @pointerdown.stop title="Delete section">×</button>
      </div>

      <div class="section-body">
        <textarea
          v-if="editingId === section.id"
          ref="textareaRef"
          class="section-editor"
          :value="section.prompt"
          placeholder="Describe what should go here... (supports markdown)"
          @input="emit('update-prompt', section.id, ($event.target as HTMLTextAreaElement).value)"
          @blur="onTextareaBlur($event, section.id)"
          @keydown.escape="editingId = null"
          @click.stop
        />
        <div v-else class="section-md-preview" @click.stop="startEditing(section.id)">
          <div v-if="section.prompt" class="md-content" v-html="renderMd(section.prompt)" />
          <span v-else class="md-placeholder">Click to describe what should go here...</span>
        </div>
      </div>

      <div class="section-footer">
        <span v-if="section.placement" class="section-placement">{{ section.placement }}</span>
        <button
          class="section-submit"
          :class="{ update: hasTask(section.id) }"
          :disabled="!section.prompt.trim()"
          @click.stop="emit('submit', section.id)"
          @pointerdown.stop
        >{{ hasTask(section.id) ? 'Update Task' : 'Add Task' }}</button>
      </div>

      <!-- Resize handles -->
      <div class="resize-handle rh-n" @pointerdown="onResizeDown($event, section, 'n')" />
      <div class="resize-handle rh-s" @pointerdown="onResizeDown($event, section, 's')" />
      <div class="resize-handle rh-e" @pointerdown="onResizeDown($event, section, 'e')" />
      <div class="resize-handle rh-w" @pointerdown="onResizeDown($event, section, 'w')" />
      <div class="resize-handle rh-ne" @pointerdown="onResizeDown($event, section, 'ne')" />
      <div class="resize-handle rh-nw" @pointerdown="onResizeDown($event, section, 'nw')" />
      <div class="resize-handle rh-se" @pointerdown="onResizeDown($event, section, 'se')" />
      <div class="resize-handle rh-sw" @pointerdown="onResizeDown($event, section, 'sw')" />
    </template>
  </div>
</template>

<style scoped>
.section-preview {
  position: fixed;
  z-index: 10003;
  border: 2px dashed #6b7280;
  background: rgba(0, 0, 0, 0.15);
  border-radius: 6px;
  pointer-events: none;
}

.drawn-section {
  position: fixed;
  z-index: 10003;
  border: 2px dashed rgba(107, 114, 128, 0.4);
  border-radius: 6px;
  display: flex;
  flex-direction: column;
  overflow: visible;
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s, box-shadow 0.15s;
}
.drawn-section.submitted {
  border-color: rgba(107, 114, 128, 0.6);
}
.drawn-section.selected {
  border-color: #6b7280;
  border-style: solid;
  background: rgba(24, 24, 27, 0.95);
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.25);
  cursor: default;
}

/* Collapsed badge */
.section-badge-float {
  position: absolute; top: 4px; left: 4px;
  display: flex; align-items: center; gap: 3px;
  font-size: 9px; font-weight: 700; color: #d1d5db;
  background: rgba(24, 24, 27, 0.8); padding: 1px 5px; border-radius: 3px;
  pointer-events: none;
}
.badge-check { color: #22c55e; font-size: 10px; }

/* Faint hint when collapsed */
.section-hint {
  padding: 22px 8px 4px;
  font-size: 10px; color: #9ca3af; line-height: 1.3;
  overflow: hidden; pointer-events: none;
  max-height: 100%; opacity: 0.5;
}
.section-hint :deep(*) { margin: 0; font-size: 10px; }

/* Header */
.section-header {
  display: flex; align-items: center; gap: 6px;
  padding: 4px 8px;
  background: rgba(255, 255, 255, 0.05);
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  flex-shrink: 0;
  user-select: none;
}
.section-badge { font-size: 9px; font-weight: 700; color: #d1d5db; }
.section-status { font-size: 8px; color: #22c55e; font-weight: 600; }
.section-dims-inline { font-size: 8px; color: rgba(255,255,255,0.25); margin-left: auto; }
.section-delete {
  width: 16px; height: 16px; border: none; background: none;
  color: #9ca3af; font-size: 14px; cursor: pointer; padding: 0;
  display: flex; align-items: center; justify-content: center;
}
.section-delete:hover { color: #ef4444; }

/* Body */
.section-body {
  flex: 1; min-height: 0; display: flex; flex-direction: column;
  overflow: hidden;
}

/* Editor (raw markdown) */
.section-editor {
  flex: 1; padding: 8px; border: none; background: transparent;
  color: #e4e4e7; font-size: 11px; line-height: 1.5;
  resize: none; outline: none; font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace;
  min-height: 40px;
}
.section-editor::placeholder { color: rgba(255,255,255,0.2); }

/* Preview (rendered markdown) */
.section-md-preview {
  flex: 1; padding: 8px; overflow-y: auto;
  cursor: text; min-height: 40px;
}
.md-content { font-size: 12px; line-height: 1.5; color: #e4e4e7; }
.md-content :deep(h1) { font-size: 16px; font-weight: 700; margin: 0 0 6px; color: #f4f4f5; }
.md-content :deep(h2) { font-size: 14px; font-weight: 700; margin: 0 0 4px; color: #f4f4f5; }
.md-content :deep(h3) { font-size: 13px; font-weight: 600; margin: 0 0 4px; color: #f4f4f5; }
.md-content :deep(p) { margin: 0 0 6px; }
.md-content :deep(ul), .md-content :deep(ol) { margin: 0 0 6px; padding-left: 18px; }
.md-content :deep(li) { margin: 0 0 2px; }
.md-content :deep(code) { font-size: 10px; background: rgba(255,255,255,0.08); padding: 1px 4px; border-radius: 3px; color: #a1a1aa; }
.md-content :deep(pre) { font-size: 10px; background: rgba(255,255,255,0.05); padding: 6px; border-radius: 4px; margin: 0 0 6px; overflow-x: auto; }
.md-content :deep(strong) { font-weight: 700; color: #f4f4f5; }
.md-placeholder { font-size: 11px; color: rgba(255,255,255,0.2); font-style: italic; }

/* Footer with submit */
.section-footer {
  display: flex; align-items: center; gap: 6px;
  padding: 4px 8px;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
  flex-shrink: 0;
}
.section-placement { font-size: 8px; color: #9ca3af; background: rgba(255,255,255,0.08); padding: 1px 4px; border-radius: 3px; }
.section-submit {
  margin-left: auto;
  padding: 3px 10px; border: none; border-radius: 4px;
  font-size: 10px; font-weight: 600; cursor: pointer;
  background: #3b82f6; color: white;
  transition: background 0.1s;
}
.section-submit:hover { background: #2563eb; }
.section-submit:disabled { opacity: 0.3; cursor: not-allowed; }
.section-submit.update { background: #22c55e; }
.section-submit.update:hover { background: #16a34a; }

/* ── Resize handles ── */
.resize-handle { position: absolute; z-index: 1; }
.rh-n  { top: -4px; left: 8px; right: 8px; height: 8px; cursor: n-resize; }
.rh-s  { bottom: -4px; left: 8px; right: 8px; height: 8px; cursor: s-resize; }
.rh-e  { right: -4px; top: 8px; bottom: 8px; width: 8px; cursor: e-resize; }
.rh-w  { left: -4px; top: 8px; bottom: 8px; width: 8px; cursor: w-resize; }
.rh-nw, .rh-ne, .rh-sw, .rh-se {
  width: 10px; height: 10px;
  background: #6b7280; border: 1.5px solid #d1d5db;
  border-radius: 2px;
}
.rh-nw { top: -5px; left: -5px; cursor: nw-resize; }
.rh-ne { top: -5px; right: -5px; cursor: ne-resize; }
.rh-sw { bottom: -5px; left: -5px; cursor: sw-resize; }
.rh-se { bottom: -5px; right: -5px; cursor: se-resize; }
</style>
