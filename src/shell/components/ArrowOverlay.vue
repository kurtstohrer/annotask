<script setup lang="ts">
import type { Arrow } from '../composables/useAnnotations'

const props = defineProps<{
  arrows: Arrow[]
  selectedId: string | null
  drawingArrow: {
    fromX: number; fromY: number; toX: number; toY: number
    fromRect?: { x: number; y: number; width: number; height: number }
    toRect?: { x: number; y: number; width: number; height: number }
  } | null
}>()

const emit = defineEmits<{
  select: [id: string]
  remove: [id: string]
  'update-label': [id: string, label: string]
  commit: [id: string]
}>()

/** Compute edge-to-edge arrow path that exits from the closest edge of fromRect and enters toRect */
function edgePath(
  fromX: number, fromY: number,
  toX: number, toY: number,
  fromRect?: { x: number; y: number; width: number; height: number },
  toRect?: { x: number; y: number; width: number; height: number },
): string {
  // Find best exit point on from rect
  let sx = fromX, sy = fromY
  if (fromRect) {
    const cx = fromRect.x + fromRect.width / 2
    const cy = fromRect.y + fromRect.height / 2
    const angle = Math.atan2(toY - cy, toX - cx)
    sx = cx + Math.cos(angle) * (fromRect.width / 2 + 4)
    sy = cy + Math.sin(angle) * (fromRect.height / 2 + 4)
  }

  // Find best entry point on to rect
  let ex = toX, ey = toY
  if (toRect) {
    const cx = toRect.x + toRect.width / 2
    const cy = toRect.y + toRect.height / 2
    const angle = Math.atan2(sy - cy, sx - cx)
    ex = cx + Math.cos(angle) * (toRect.width / 2 + 4)
    ey = cy + Math.sin(angle) * (toRect.height / 2 + 4)
  }

  // Curved path
  const dx = ex - sx
  const dy = ey - sy
  const cx1 = sx + dx * 0.4
  const cy1 = sy
  const cx2 = sx + dx * 0.6
  const cy2 = ey
  return `M ${sx} ${sy} C ${cx1} ${cy1}, ${cx2} ${cy2}, ${ex} ${ey}`
}

function simplePath(fromX: number, fromY: number, toX: number, toY: number): string {
  const dx = toX - fromX
  const dy = toY - fromY
  const cx1 = fromX + dx * 0.4
  const cy1 = fromY
  const cx2 = fromX + dx * 0.6
  const cy2 = toY
  return `M ${fromX} ${fromY} C ${cx1} ${cy1}, ${cx2} ${cy2}, ${toX} ${toY}`
}

function labelPos(fromX: number, fromY: number, toX: number, toY: number) {
  return { x: (fromX + toX) / 2, y: (fromY + toY) / 2 - 10 }
}

function rectOutline(r: { x: number; y: number; width: number; height: number }) {
  return `M ${r.x} ${r.y} h ${r.width} v ${r.height} h ${-r.width} Z`
}
</script>

<template>
  <svg class="arrow-svg">
    <defs>
      <marker id="arrowhead" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
        <polygon points="0 0, 10 3.5, 0 7" fill="#ef4444" />
      </marker>
      <marker id="arrowhead-drawing" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
        <polygon points="0 0, 10 3.5, 0 7" fill="#3b82f6" />
      </marker>
    </defs>

    <!-- Existing arrows -->
    <g v-for="arrow in arrows" :key="arrow.id" @click.stop="emit('select', arrow.id)">
      <path
        :d="simplePath(arrow.fromX, arrow.fromY, arrow.toX, arrow.toY)"
        fill="none"
        :stroke="arrow.id === selectedId ? '#dc2626' : '#ef4444'"
        :stroke-width="arrow.id === selectedId ? 3 : 2"
        stroke-dasharray="6 3"
        marker-end="url(#arrowhead)"
        class="arrow-path"
      />
      <circle :cx="arrow.fromX" :cy="arrow.fromY" r="5" fill="#ef4444" opacity="0.8" />
      <circle :cx="arrow.toX" :cy="arrow.toY" r="5" fill="#ef4444" opacity="0.8" />
      <!-- Label: editable when selected, static text otherwise -->
      <text v-if="arrow.id !== selectedId"
        :x="labelPos(arrow.fromX, arrow.fromY, arrow.toX, arrow.toY).x"
        :y="labelPos(arrow.fromX, arrow.fromY, arrow.toX, arrow.toY).y"
        text-anchor="middle" class="arrow-label"
      >{{ arrow.label }}</text>
      <foreignObject v-else
        :x="labelPos(arrow.fromX, arrow.fromY, arrow.toX, arrow.toY).x - 120"
        :y="labelPos(arrow.fromX, arrow.fromY, arrow.toX, arrow.toY).y - 18"
        width="240" height="28">
        <input
          class="arrow-label-input"
          :value="arrow.label"
          placeholder="Describe what to do..."
          @input="emit('update-label', arrow.id, ($event.target as HTMLInputElement).value)"
          @blur="emit('commit', arrow.id)"
          @click.stop
          @pointerdown.stop
        />
      </foreignObject>
      <g v-if="arrow.id === selectedId" class="arrow-delete"
        :transform="`translate(${(arrow.fromX + arrow.toX) / 2 + 20}, ${(arrow.fromY + arrow.toY) / 2 - 20})`"
        @click.stop="emit('remove', arrow.id)">
        <circle r="8" fill="#ef4444" />
        <text text-anchor="middle" dy="3.5" fill="white" font-size="10" font-weight="bold">×</text>
      </g>
    </g>

    <!-- Drawing preview -->
    <g v-if="drawingArrow">
      <!-- Source element outline -->
      <path v-if="drawingArrow.fromRect"
        :d="rectOutline(drawingArrow.fromRect)"
        fill="none" stroke="#3b82f6" stroke-width="2" stroke-dasharray="4 2" opacity="0.6"
      />
      <!-- Target element outline -->
      <path v-if="drawingArrow.toRect"
        :d="rectOutline(drawingArrow.toRect)"
        fill="rgba(59,130,246,0.08)" stroke="#3b82f6" stroke-width="2" stroke-dasharray="4 2" opacity="0.6"
      />
      <!-- Arrow line -->
      <path
        :d="edgePath(drawingArrow.fromX, drawingArrow.fromY, drawingArrow.toX, drawingArrow.toY, drawingArrow.fromRect, drawingArrow.toRect)"
        fill="none" stroke="#3b82f6" stroke-width="2.5" stroke-dasharray="6 3"
        marker-end="url(#arrowhead-drawing)" opacity="0.8"
      />
      <!-- Endpoints -->
      <circle :cx="drawingArrow.fromX" :cy="drawingArrow.fromY" r="5" fill="#3b82f6" opacity="0.6" />
    </g>
  </svg>
</template>

<style scoped>
.arrow-svg {
  position: fixed;
  inset: 0;
  width: 100%;
  height: 100%;
  z-index: 10003;
  pointer-events: none;
}
.arrow-path { pointer-events: stroke; cursor: pointer; }
.arrow-label {
  font-size: 10px;
  font-weight: 600;
  fill: #ef4444;
  pointer-events: none;
  paint-order: stroke;
  stroke: rgba(0,0,0,0.5);
  stroke-width: 3px;
}
.arrow-delete { cursor: pointer; pointer-events: auto; }
.arrow-label-input {
  width: 100%; height: 22px;
  background: rgba(0,0,0,0.75); color: white;
  border: 1px solid #ef4444; border-radius: 4px;
  font-size: 10px; font-weight: 600; text-align: center;
  outline: none; padding: 0 6px;
  pointer-events: auto;
}
</style>
