<script setup lang="ts">
import { ref, computed } from 'vue'
import type { Arrow, ElementRect } from '../composables/useAnnotations'
import type { HoverElement } from '../composables/useCanvasDrawing'

const props = defineProps<{
  arrows: Arrow[]
  selectedId: string | null
  drawingArrow: {
    fromX: number; fromY: number; toX: number; toY: number
    fromRect?: ElementRect; toRect?: ElementRect
    fromTag?: string; fromComponent?: string
    toTag?: string; toComponent?: string
  } | null
  drawingColor: string
  dragTargetRect: ElementRect | null
  hoverElement: HoverElement
}>()

const emit = defineEmits<{
  select: [id: string]
  remove: [id: string]
  'update-arrow': [id: string, updates: Partial<Arrow>]
  'drag-move': [x: number, y: number]
  'drag-end': [id: string, endpoint: 'from' | 'to', x: number, y: number]
}>()

// ── Endpoint drag ──
const endpointDrag = ref<{ arrowId: string; endpoint: 'from' | 'to' } | null>(null)

/** Unique arrow colors for dynamic marker generation */
const markerColors = computed(() => {
  const colors = new Set<string>()
  for (const a of props.arrows) colors.add(a.color || '#ef4444')
  if (props.drawingArrow) colors.add(props.drawingColor)
  return [...colors]
})

function markerId(color: string) {
  return `ah-${color.replace('#', '')}`
}

function darken(hex: string): string {
  const m = hex.match(/^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i)
  if (!m) return hex
  const d = (s: string) => Math.max(0, Math.round(parseInt(s, 16) * 0.8)).toString(16).padStart(2, '0')
  return `#${d(m[1])}${d(m[2])}${d(m[3])}`
}

function lighten(hex: string, amount = 0.15): string {
  const m = hex.match(/^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i)
  if (!m) return hex
  const l = (s: string) => {
    const v = parseInt(s, 16)
    return Math.min(255, Math.round(v + (255 - v) * amount)).toString(16).padStart(2, '0')
  }
  return `#${l(m[1])}${l(m[2])}${l(m[3])}`
}

/** Edge-to-edge arrow path: exits from closest edge of fromRect, enters toRect */
function edgePath(
  fromX: number, fromY: number, toX: number, toY: number,
  fromRect?: ElementRect, toRect?: ElementRect,
): string {
  // Find exit point on from-rect edge
  let sx = fromX, sy = fromY
  if (fromRect) {
    const cx = fromRect.x + fromRect.width / 2
    const cy = fromRect.y + fromRect.height / 2
    const angle = Math.atan2(toY - cy, toX - cx)
    // Clamp to rect edge
    const hw = fromRect.width / 2 + 6, hh = fromRect.height / 2 + 6
    const tanA = Math.abs(Math.tan(angle))
    if (tanA * hw <= hh) {
      sx = cx + Math.sign(Math.cos(angle)) * hw
      sy = cy + Math.sign(Math.cos(angle)) * hw * Math.tan(angle)
    } else {
      sy = cy + Math.sign(Math.sin(angle)) * hh
      sx = cx + Math.sign(Math.sin(angle)) * hh / Math.tan(angle)
    }
  }

  // Find entry point on to-rect edge
  let ex = toX, ey = toY
  if (toRect) {
    const cx = toRect.x + toRect.width / 2
    const cy = toRect.y + toRect.height / 2
    const angle = Math.atan2(sy - cy, sx - cx)
    const hw = toRect.width / 2 + 6, hh = toRect.height / 2 + 6
    const tanA = Math.abs(Math.tan(angle))
    if (tanA * hw <= hh) {
      ex = cx + Math.sign(Math.cos(angle)) * hw
      ey = cy + Math.sign(Math.cos(angle)) * hw * Math.tan(angle)
    } else {
      ey = cy + Math.sign(Math.sin(angle)) * hh
      ex = cx + Math.sign(Math.sin(angle)) * hh / Math.tan(angle)
    }
  }

  // Natural bezier curve
  const dx = ex - sx, dy = ey - sy
  const dist = Math.sqrt(dx * dx + dy * dy)
  if (dist < 1) return `M ${sx} ${sy} L ${ex} ${ey}`
  const ux = dx / dist, uy = dy / dist
  const px = -uy, py = ux
  const off = Math.min(dist * 0.15, 60)
  const cx1 = sx + dx / 3 + px * off
  const cy1 = sy + dy / 3 + py * off
  const cx2 = sx + dx * 2 / 3 + px * off
  const cy2 = sy + dy * 2 / 3 + py * off
  return `M ${sx} ${sy} C ${cx1} ${cy1}, ${cx2} ${cy2}, ${ex} ${ey}`
}

function rectPath(r: ElementRect, pad = 4): string {
  const x = r.x - pad, y = r.y - pad, w = r.width + pad * 2, h = r.height + pad * 2
  return `M ${x} ${y} h ${w} v ${h} h ${-w} Z`
}

// ── Endpoint dragging ──
function onEndpointDown(e: PointerEvent, arrowId: string, endpoint: 'from' | 'to') {
  e.stopPropagation()
  e.preventDefault()
  endpointDrag.value = { arrowId, endpoint }
  window.addEventListener('pointermove', onEndpointMove)
  window.addEventListener('pointerup', onEndpointUp)
}

function onEndpointMove(e: PointerEvent) {
  if (!endpointDrag.value) return
  const { arrowId, endpoint } = endpointDrag.value
  if (endpoint === 'from') {
    emit('update-arrow', arrowId, { fromX: e.clientX, fromY: e.clientY })
  } else {
    emit('update-arrow', arrowId, { toX: e.clientX, toY: e.clientY })
  }
  emit('drag-move', e.clientX, e.clientY)
}

function elementLabel(tag?: string, component?: string): string {
  const parts: string[] = []
  if (tag) parts.push(`<${tag}>`)
  if (component) parts.push(component)
  return parts.join(' · ')
}

function labelPos(rect: ElementRect): { x: number; y: number } {
  return { x: rect.x - 4, y: rect.y - 10 }
}

function onEndpointUp(e: PointerEvent) {
  if (endpointDrag.value) {
    const { arrowId, endpoint } = endpointDrag.value
    emit('drag-end', arrowId, endpoint, e.clientX, e.clientY)
  }
  endpointDrag.value = null
  window.removeEventListener('pointermove', onEndpointMove)
  window.removeEventListener('pointerup', onEndpointUp)
}
</script>

<template>
  <svg class="arrow-svg">
    <defs>
      <marker v-for="c in markerColors" :key="c"
        :id="markerId(c)" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
        <polygon points="0 0, 10 3.5, 0 7" :fill="c" />
      </marker>
    </defs>

    <!-- Existing arrows -->
    <g v-for="arrow in arrows" :key="arrow.id" @click.stop="emit('select', arrow.id)">
      <!-- Element outlines in arrow color -->
      <path v-if="arrow.fromRect" :d="rectPath(arrow.fromRect)"
        fill="none" :stroke="arrow.color" stroke-width="2" stroke-dasharray="4 2" opacity="0.4" rx="3" />
      <path v-if="arrow.toRect" :d="rectPath(arrow.toRect)"
        :fill="lighten(arrow.color) + '0a'" :stroke="arrow.color" stroke-width="2" stroke-dasharray="4 2" opacity="0.4" rx="3" />

      <!-- Arrow path (edge-to-edge when rects available) -->
      <path
        :d="edgePath(arrow.fromX, arrow.fromY, arrow.toX, arrow.toY, arrow.fromRect, arrow.toRect)"
        fill="none"
        :stroke="arrow.id === selectedId ? darken(arrow.color) : arrow.color"
        :stroke-width="arrow.id === selectedId ? 3 : 2"
        stroke-dasharray="6 3"
        :marker-end="`url(#${markerId(arrow.color)})`"
        class="arrow-path"
      />

      <!-- Endpoints: draggable when selected -->
      <circle v-if="arrow.id !== selectedId"
        :cx="arrow.fromX" :cy="arrow.fromY" r="5" :fill="arrow.color" opacity="0.8" />
      <circle v-if="arrow.id !== selectedId"
        :cx="arrow.toX" :cy="arrow.toY" r="5" :fill="arrow.color" opacity="0.8" />
      <circle v-if="arrow.id === selectedId"
        :cx="arrow.fromX" :cy="arrow.fromY" r="7"
        :fill="arrow.color" :stroke="darken(arrow.color)" stroke-width="2"
        class="endpoint-handle"
        @pointerdown="onEndpointDown($event, arrow.id, 'from')" />
      <circle v-if="arrow.id === selectedId"
        :cx="arrow.toX" :cy="arrow.toY" r="7"
        :fill="arrow.color" :stroke="darken(arrow.color)" stroke-width="2"
        class="endpoint-handle"
        @pointerdown="onEndpointDown($event, arrow.id, 'to')" />
      <g v-if="arrow.id === selectedId" class="arrow-delete"
        :transform="`translate(${(arrow.fromX + arrow.toX) / 2 + 20}, ${(arrow.fromY + arrow.toY) / 2 - 20})`"
        @click.stop="emit('remove', arrow.id)">
        <circle r="8" :fill="arrow.color" />
        <text text-anchor="middle" dy="3.5" fill="white" font-size="10" font-weight="bold">×</text>
      </g>
    </g>

    <!-- Element outline during endpoint drag -->
    <rect v-if="endpointDrag && dragTargetRect"
      :x="dragTargetRect.x - 4" :y="dragTargetRect.y - 4"
      :width="dragTargetRect.width + 8" :height="dragTargetRect.height + 8"
      fill="rgba(59,130,246,0.06)" stroke="#3b82f6" stroke-width="2"
      stroke-dasharray="4 2" rx="3" opacity="0.7"
    />

    <!-- Hover preview (before drawing starts) -->
    <g v-if="!drawingArrow && hoverElement" class="hover-preview">
      <rect
        :x="hoverElement.rect.x - 4" :y="hoverElement.rect.y - 4"
        :width="hoverElement.rect.width + 8" :height="hoverElement.rect.height + 8"
        :fill="drawingColor + '0c'" :stroke="drawingColor" stroke-width="2"
        stroke-dasharray="6 3" rx="3" opacity="0.8"
      />
      <g v-if="elementLabel(hoverElement.tag, hoverElement.component)"
        :transform="`translate(${labelPos(hoverElement.rect).x}, ${labelPos(hoverElement.rect).y})`">
        <rect :width="elementLabel(hoverElement.tag, hoverElement.component).length * 7 + 12" height="20"
          rx="4" :fill="drawingColor" opacity="0.85" />
        <text x="6" y="14" class="element-label" fill="white">{{ elementLabel(hoverElement.tag, hoverElement.component) }}</text>
      </g>
    </g>

    <!-- Drawing preview -->
    <g v-if="drawingArrow" opacity="0.85">
      <!-- Source element outline + label -->
      <g v-if="drawingArrow.fromRect">
        <rect
          :x="drawingArrow.fromRect.x - 4" :y="drawingArrow.fromRect.y - 4"
          :width="drawingArrow.fromRect.width + 8" :height="drawingArrow.fromRect.height + 8"
          fill="none" :stroke="drawingColor" stroke-width="2" stroke-dasharray="4 2" rx="3" opacity="0.7" />
        <g v-if="elementLabel(drawingArrow.fromTag, drawingArrow.fromComponent)"
          :transform="`translate(${labelPos(drawingArrow.fromRect).x}, ${labelPos(drawingArrow.fromRect).y})`">
          <rect :width="elementLabel(drawingArrow.fromTag, drawingArrow.fromComponent).length * 7 + 12" height="20"
            rx="4" :fill="drawingColor" opacity="0.7" />
          <text x="6" y="14" class="element-label" fill="white">{{ elementLabel(drawingArrow.fromTag, drawingArrow.fromComponent) }}</text>
        </g>
      </g>
      <!-- Target element outline + label -->
      <g v-if="drawingArrow.toRect">
        <rect
          :x="drawingArrow.toRect.x - 4" :y="drawingArrow.toRect.y - 4"
          :width="drawingArrow.toRect.width + 8" :height="drawingArrow.toRect.height + 8"
          :fill="lighten(drawingColor, 0.2) + '18'" :stroke="drawingColor" stroke-width="2"
          stroke-dasharray="4 2" rx="3" opacity="0.8" />
        <g v-if="elementLabel(drawingArrow.toTag, drawingArrow.toComponent)"
          :transform="`translate(${labelPos(drawingArrow.toRect).x}, ${labelPos(drawingArrow.toRect).y})`">
          <rect :width="elementLabel(drawingArrow.toTag, drawingArrow.toComponent).length * 7 + 12" height="20"
            rx="4" :fill="drawingColor" opacity="0.7" />
          <text x="6" y="14" class="element-label" fill="white">{{ elementLabel(drawingArrow.toTag, drawingArrow.toComponent) }}</text>
        </g>
      </g>
      <!-- Arrow line (edge-to-edge) -->
      <path
        :d="edgePath(drawingArrow.fromX, drawingArrow.fromY, drawingArrow.toX, drawingArrow.toY, drawingArrow.fromRect, drawingArrow.toRect)"
        fill="none" :stroke="drawingColor" stroke-width="2.5" stroke-dasharray="6 3"
        :marker-end="`url(#${markerId(drawingColor)})`"
      />
      <circle :cx="drawingArrow.fromX" :cy="drawingArrow.fromY" r="5" :fill="drawingColor" opacity="0.7" />
      <circle :cx="drawingArrow.toX" :cy="drawingArrow.toY" r="5" :fill="drawingColor" opacity="0.7" />
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
.arrow-delete { cursor: pointer; pointer-events: auto; }
.endpoint-handle { cursor: grab; pointer-events: auto; }
.endpoint-handle:active { cursor: grabbing; }
.element-label { font: 11px/1 system-ui, sans-serif; pointer-events: none; }
.hover-preview { transition: opacity 0.15s ease; }
</style>
