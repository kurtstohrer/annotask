<script setup lang="ts">
import type { LayoutOverlayRect } from '../composables/useLayoutOverlay'

defineProps<{
  containers: LayoutOverlayRect[]
}>()

const emit = defineEmits<{
  'grid-line-drag': [container: LayoutOverlayRect, axis: 'col' | 'row', index: number, event: PointerEvent]
  'add-track': [container: LayoutOverlayRect, axis: 'col' | 'row']
  'add-child': [container: LayoutOverlayRect]
}>()

function directionLabel(c: LayoutOverlayRect): string {
  if (c.display === 'grid') {
    const cols = c.columns?.length || '?'
    const rows = c.rows?.length || '?'
    return `grid ${cols}×${rows}`
  }
  if (c.direction === 'row') return 'flex →'
  if (c.direction === 'row-reverse') return 'flex ←'
  if (c.direction === 'column') return 'flex ↓'
  if (c.direction === 'column-reverse') return 'flex ↑'
  return 'flex'
}

function columnLines(c: LayoutOverlayRect): { x: number; height: number }[] {
  if (!c.columns || c.columns.length <= 1) return []
  const lines: { x: number; height: number }[] = []
  let x = 0
  for (let i = 0; i < c.columns.length - 1; i++) {
    x += c.columns[i]
    if (c.columnGap) x += c.columnGap / 2
    lines.push({ x, height: c.height })
    if (c.columnGap) x += c.columnGap / 2
  }
  return lines
}

function rowLines(c: LayoutOverlayRect): { y: number; width: number }[] {
  if (!c.rows || c.rows.length <= 1) return []
  const lines: { y: number; width: number }[] = []
  let y = 0
  for (let i = 0; i < c.rows.length - 1; i++) {
    y += c.rows[i]
    if (c.rowGap) y += c.rowGap / 2
    lines.push({ y, width: c.width })
    if (c.rowGap) y += c.rowGap / 2
  }
  return lines
}

// Show add buttons for containers > 60px
function showAddButtons(c: LayoutOverlayRect): boolean {
  return c.width > 60 && c.height > 60
}

function isHorizontal(c: LayoutOverlayRect): boolean {
  return c.display === 'grid' || c.direction === 'row' || c.direction === 'row-reverse'
}
</script>

<template>
  <template v-for="(c, ci) in containers" :key="ci">
    <!-- Container outline -->
    <div
      class="layout-outline"
      :class="c.display"
      :style="{ left: c.x+'px', top: c.y+'px', width: c.width+'px', height: c.height+'px' }"
    >
      <span class="layout-label">{{ directionLabel(c) }}</span>
    </div>

    <!-- Grid column lines (draggable) -->
    <div
      v-for="(line, li) in columnLines(c)"
      :key="'col-'+ci+'-'+li"
      class="grid-line col"
      :style="{ left: (c.x + line.x) + 'px', top: c.y + 'px', height: line.height + 'px' }"
      @pointerdown.stop.prevent="emit('grid-line-drag', c, 'col', li, $event)"
    />

    <!-- Grid row lines (draggable) -->
    <div
      v-for="(line, li) in rowLines(c)"
      :key="'row-'+ci+'-'+li"
      class="grid-line row"
      :style="{ left: c.x + 'px', top: (c.y + line.y) + 'px', width: line.width + 'px' }"
      @pointerdown.stop.prevent="emit('grid-line-drag', c, 'row', li, $event)"
    />

    <!-- Add buttons -->
    <template v-if="showAddButtons(c)">
      <!-- Grid: +col on right, +row on bottom -->
      <template v-if="c.display === 'grid'">
        <button
          class="add-track-btn col"
          :style="{ left: (c.x + c.width + 4) + 'px', top: (c.y + c.height / 2 - 11) + 'px' }"
          title="Add column"
          @click.stop="emit('add-track', c, 'col')"
        >+col</button>
        <button
          class="add-track-btn row"
          :style="{ left: (c.x + c.width / 2 - 16) + 'px', top: (c.y + c.height + 4) + 'px' }"
          title="Add row"
          @click.stop="emit('add-track', c, 'row')"
        >+row</button>
      </template>

      <!-- Flex: + at end of direction -->
      <template v-else>
        <button
          v-if="isHorizontal(c)"
          class="add-child-btn"
          :style="{ left: (c.x + c.width + 4) + 'px', top: (c.y + c.height / 2 - 11) + 'px' }"
          title="Add item"
          @click.stop="emit('add-child', c)"
        >+</button>
        <button
          v-else
          class="add-child-btn"
          :style="{ left: (c.x + c.width / 2 - 11) + 'px', top: (c.y + c.height + 4) + 'px' }"
          title="Add item"
          @click.stop="emit('add-child', c)"
        >+</button>
      </template>
    </template>
  </template>
</template>

<style scoped>
.layout-outline {
  position: fixed;
  pointer-events: none;
  z-index: 9998;
  border-radius: 3px;
}
.layout-outline.flex {
  border: 1.5px dashed rgba(168, 85, 247, 0.4);
  background: rgba(168, 85, 247, 0.03);
}
.layout-outline.grid {
  border: 1.5px dashed rgba(34, 197, 94, 0.4);
  background: rgba(34, 197, 94, 0.03);
}

.layout-label {
  position: absolute;
  top: -16px;
  left: 4px;
  font-size: 9px;
  font-weight: 600;
  padding: 1px 5px;
  border-radius: 3px;
  white-space: nowrap;
  letter-spacing: 0.03em;
}
.flex .layout-label { background: rgba(168,85,247,0.15); color: #a855f7; }
.grid .layout-label { background: rgba(34,197,94,0.15); color: #22c55e; }

.grid-line {
  position: fixed;
  z-index: 9999;
  pointer-events: auto;
}
.grid-line.col {
  width: 6px;
  margin-left: -3px;
  cursor: col-resize;
  background: transparent;
}
.grid-line.col:hover, .grid-line.col:active {
  background: rgba(34, 197, 94, 0.3);
}
.grid-line.row {
  height: 6px;
  margin-top: -3px;
  cursor: row-resize;
  background: transparent;
}
.grid-line.row:hover, .grid-line.row:active {
  background: rgba(34, 197, 94, 0.3);
}

/* Add track/child buttons */
.add-track-btn, .add-child-btn {
  position: fixed;
  z-index: 9999;
  pointer-events: auto;
  border: none;
  border-radius: 4px;
  font-size: 9px;
  font-weight: 700;
  padding: 3px 6px;
  cursor: pointer;
  opacity: 0.7;
  transition: all 0.15s;
  white-space: nowrap;
}
.add-track-btn:hover, .add-child-btn:hover {
  opacity: 1;
  transform: scale(1.1);
}

.add-track-btn {
  background: rgba(34, 197, 94, 0.15);
  color: #22c55e;
  border: 1px solid rgba(34, 197, 94, 0.3);
}
.add-track-btn:hover {
  background: rgba(34, 197, 94, 0.3);
}

.add-child-btn {
  background: rgba(168, 85, 247, 0.15);
  color: #a855f7;
  border: 1px solid rgba(168, 85, 247, 0.3);
  width: 22px;
  height: 22px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  padding: 0;
}
.add-child-btn:hover {
  background: rgba(168, 85, 247, 0.3);
}
</style>
