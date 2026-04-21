<template>
  <div class="flow-diagram-wrap">
    <button type="button" class="flow-diagram-fs-btn" title="View larger" aria-label="View larger" @click="isOpen = true">
      <Icon name="maximize-2" :size="13" />
    </button>
    <svg class="flow-diagram" :viewBox="`0 0 ${width} ${height}`" role="img" :aria-label="label">
      <defs>
        <marker id="flow-arrow-default" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" class="arrow-head" />
        </marker>
      </defs>
      <g class="edges">
        <g v-for="(e, i) in edgePaths" :key="`e${i}`">
          <path :d="e.d" :class="['edge', `edge-${e.variant || 'muted'}`, { dashed: e.dashed }]"
            marker-end="url(#flow-arrow-default)" />
          <text v-if="e.label" :x="e.labelX" :y="e.labelY" class="edge-label" text-anchor="middle">{{ e.label }}</text>
        </g>
      </g>
      <g class="nodes">
        <g v-for="n in nodePositions" :key="n.id" :class="['node', `node-${n.variant || 'surface'}`, { 'node-pill': n.shape === 'pill' }]">
          <rect :x="n.x" :y="n.y" :width="nodeWidth" :height="nodeHeight"
            :rx="n.shape === 'pill' ? nodeHeight / 2 : 8" />
          <text :x="n.cx" :y="n.labelY" text-anchor="middle" class="node-label">{{ n.label }}</text>
          <text v-if="n.sublabel" :x="n.cx" :y="n.sublabelY" text-anchor="middle" class="node-sublabel">{{ n.sublabel }}</text>
        </g>
      </g>
    </svg>

    <Teleport to="body">
      <div v-if="isOpen" class="flow-diagram-modal" role="dialog" aria-modal="true" @click.self="isOpen = false">
        <button type="button" class="flow-diagram-modal-close" aria-label="Close" title="Close (Esc)" @click="isOpen = false">
          <Icon name="x" :size="18" />
        </button>
        <div class="flow-diagram-modal-inner" @click.self="isOpen = false">
          <svg class="flow-diagram flow-diagram-modal-svg" :viewBox="`0 0 ${width} ${height}`" role="img" :aria-label="label">
            <defs>
              <marker id="flow-arrow-modal" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                <path d="M 0 0 L 10 5 L 0 10 z" class="arrow-head" />
              </marker>
            </defs>
            <g class="edges">
              <g v-for="(e, i) in edgePaths" :key="`e${i}`">
                <path :d="e.d" :class="['edge', `edge-${e.variant || 'muted'}`, { dashed: e.dashed }]"
                  marker-end="url(#flow-arrow-modal)" />
                <text v-if="e.label" :x="e.labelX" :y="e.labelY" class="edge-label" text-anchor="middle">{{ e.label }}</text>
              </g>
            </g>
            <g class="nodes">
              <g v-for="n in nodePositions" :key="n.id" :class="['node', `node-${n.variant || 'surface'}`, { 'node-pill': n.shape === 'pill' }]">
                <rect :x="n.x" :y="n.y" :width="nodeWidth" :height="nodeHeight"
                  :rx="n.shape === 'pill' ? nodeHeight / 2 : 8" />
                <text :x="n.cx" :y="n.labelY" text-anchor="middle" class="node-label">{{ n.label }}</text>
                <text v-if="n.sublabel" :x="n.cx" :y="n.sublabelY" text-anchor="middle" class="node-sublabel">{{ n.sublabel }}</text>
              </g>
            </g>
          </svg>
          <div v-if="label" class="flow-diagram-modal-caption">{{ label }}</div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch, onBeforeUnmount } from 'vue'
import Icon from './Icon.vue'

export interface FlowNode {
  id: string
  label: string
  sublabel?: string
  col: number
  row: number
  /** Spans multiple columns (horizontal width multiplier). Default 1. */
  colSpan?: number
  variant?: 'surface' | 'accent' | 'success' | 'warning' | 'danger' | 'info' | 'purple' | 'muted'
  shape?: 'rect' | 'pill'
}

export interface FlowEdge {
  from: string
  to: string
  label?: string
  dashed?: boolean
  variant?: 'default' | 'accent' | 'success' | 'warning' | 'danger' | 'muted'
  /** Override default routing. 'straight' connects nearest edges; 'elbow' uses right-angle. */
  route?: 'straight' | 'elbow'
}

interface Props {
  nodes: FlowNode[]
  edges: FlowEdge[]
  label?: string
  /** Grid cell dimensions — each node occupies one cell. */
  nodeWidth?: number
  nodeHeight?: number
  colGap?: number
  rowGap?: number
  padding?: number
}

const props = withDefaults(defineProps<Props>(), {
  label: 'Flow diagram',
  nodeWidth: 150,
  nodeHeight: 52,
  colGap: 40,
  rowGap: 36,
  padding: 12,
})

const isOpen = ref(false)

function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape' && isOpen.value) {
    isOpen.value = false
  }
}

watch(isOpen, (open) => {
  if (open) {
    document.addEventListener('keydown', onKey)
    document.body.classList.add('flow-diagram-modal-open')
  } else {
    document.removeEventListener('keydown', onKey)
    document.body.classList.remove('flow-diagram-modal-open')
  }
})

onBeforeUnmount(() => {
  document.removeEventListener('keydown', onKey)
  document.body.classList.remove('flow-diagram-modal-open')
})

const nodePositions = computed(() => props.nodes.map((n) => {
  const span = n.colSpan ?? 1
  const x = props.padding + n.col * (props.nodeWidth + props.colGap)
  const y = props.padding + n.row * (props.nodeHeight + props.rowGap)
  const w = props.nodeWidth * span + props.colGap * (span - 1)
  const cx = x + w / 2
  const cy = y + props.nodeHeight / 2
  const hasSub = Boolean(n.sublabel)
  return {
    ...n,
    x, y, cx, cy,
    width: w,
    labelY: hasSub ? cy - 2 : cy + 4,
    sublabelY: cy + 13,
  }
}))

const width = computed(() => {
  const maxCol = props.nodes.reduce((m, n) => Math.max(m, n.col + (n.colSpan ?? 1) - 1), 0)
  return props.padding * 2 + (maxCol + 1) * props.nodeWidth + maxCol * props.colGap
})
const height = computed(() => {
  const maxRow = props.nodes.reduce((m, n) => Math.max(m, n.row), 0)
  return props.padding * 2 + (maxRow + 1) * props.nodeHeight + maxRow * props.rowGap
})

const nodeWidth = computed(() => props.nodeWidth)
const nodeHeight = computed(() => props.nodeHeight)

const edgePaths = computed(() => {
  const byId = new Map(nodePositions.value.map((n) => [n.id, n]))
  return props.edges.map((e) => {
    const a = byId.get(e.from)
    const b = byId.get(e.to)
    if (!a || !b) return { d: '', variant: e.variant, dashed: e.dashed, label: '', labelX: 0, labelY: 0 }

    const aRight = a.x + a.width
    const aBottom = a.y + props.nodeHeight
    const bRight = b.x + b.width
    const bBottom = b.y + props.nodeHeight

    let x1: number, y1: number, x2: number, y2: number
    // Same-row backward edge: route as a dipped arc below both nodes so it
    // doesn't overlap intermediate nodes on the row.
    if (b.y === a.y && b.x < a.x) {
      const xs = a.x
      const xe = bRight
      const dip = aBottom + Math.max(props.rowGap - 8, 24)
      const d = `M ${xs} ${aBottom - 6} C ${xs - 30} ${dip}, ${xe + 30} ${dip}, ${xe} ${bBottom - 6}`
      return { d, variant: e.variant, dashed: e.dashed, label: e.label, labelX: (xs + xe) / 2, labelY: dip + 10 }
    }
    // Pick anchors based on relative position
    if (b.y === a.y) {
      // Same row — forward horizontal
      x1 = aRight; y1 = a.cy; x2 = b.x; y2 = b.cy
    } else if (b.x === a.x && b.width === a.width) {
      // Same column — vertical
      if (b.y > a.y) { x1 = a.cx; y1 = aBottom; x2 = b.cx; y2 = b.y }
      else { x1 = a.cx; y1 = a.y; x2 = b.cx; y2 = bBottom }
    } else {
      // Diagonal — use closest sides (right/left if farther horizontally, top/bottom otherwise)
      const dx = b.cx - a.cx
      const dy = b.cy - a.cy
      if (Math.abs(dx) >= Math.abs(dy)) {
        if (dx > 0) { x1 = aRight; y1 = a.cy; x2 = b.x; y2 = b.cy }
        else { x1 = a.x; y1 = a.cy; x2 = bRight; y2 = b.cy }
      } else {
        if (dy > 0) { x1 = a.cx; y1 = aBottom; x2 = b.cx; y2 = b.y }
        else { x1 = a.cx; y1 = a.y; x2 = b.cx; y2 = bBottom }
      }
    }

    let d: string
    if ((e.route ?? 'straight') === 'elbow' || (x1 !== x2 && y1 !== y2)) {
      // Smooth bezier for diagonals
      const midX = (x1 + x2) / 2
      const midY = (y1 + y2) / 2
      const isHorizontal = Math.abs(x2 - x1) >= Math.abs(y2 - y1)
      if (isHorizontal) {
        d = `M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`
      } else {
        d = `M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}`
      }
      return { d, variant: e.variant, dashed: e.dashed, label: e.label, labelX: midX, labelY: midY - 4 }
    }
    d = `M ${x1} ${y1} L ${x2} ${y2}`
    return { d, variant: e.variant, dashed: e.dashed, label: e.label, labelX: (x1 + x2) / 2, labelY: (y1 + y2) / 2 - 4 }
  })
})
</script>

<style scoped>
.flow-diagram-wrap {
  position: relative;
}

.flow-diagram {
  display: block;
  width: 100%;
  height: auto;
  max-width: 100%;
  font-family: inherit;
}

/* Fullscreen button (top-right corner of the diagram) */
.flow-diagram-fs-btn {
  position: absolute;
  top: 6px;
  right: 6px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  padding: 0;
  background: var(--surface-glass, var(--surface-2));
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--text-muted);
  cursor: pointer;
  opacity: 0;
  transition: opacity 120ms ease, color 120ms ease, border-color 120ms ease;
  z-index: 1;
}

.flow-diagram-wrap:hover .flow-diagram-fs-btn,
.flow-diagram-fs-btn:focus-visible {
  opacity: 1;
}

.flow-diagram-fs-btn:hover {
  color: var(--text);
  border-color: var(--accent);
}

/* Modal overlay */
.flow-diagram-modal {
  position: fixed;
  inset: 0;
  background: color-mix(in srgb, var(--bg) 85%, transparent);
  backdrop-filter: blur(4px);
  z-index: 20500;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 48px 56px 32px;
  animation: flow-diagram-fade-in 120ms ease;
}

@keyframes flow-diagram-fade-in {
  from { opacity: 0; }
  to   { opacity: 1; }
}

.flow-diagram-modal-close {
  position: absolute;
  top: 14px;
  right: 14px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  padding: 0;
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: 8px;
  color: var(--text);
  cursor: pointer;
}

.flow-diagram-modal-close:hover {
  border-color: var(--accent);
  color: var(--accent);
}

.flow-diagram-modal-inner {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
  width: 100%;
  height: 100%;
  max-width: 1200px;
}

.flow-diagram-modal-svg {
  max-height: calc(100vh - 140px);
  width: 100%;
  height: auto;
}

.flow-diagram-modal-caption {
  font-size: 13px;
  color: var(--text-muted);
  text-align: center;
  max-width: 720px;
}

/* Nodes */
.node rect {
  fill: var(--surface-2);
  stroke: var(--border);
  stroke-width: 1;
  transition: fill 120ms ease, stroke 120ms ease;
}
.node-label {
  fill: var(--text);
  font-size: 11px;
  font-weight: 600;
  dominant-baseline: middle;
  pointer-events: none;
}
.node-sublabel {
  fill: var(--text-muted);
  font-size: 9.5px;
  font-weight: 500;
  dominant-baseline: middle;
  pointer-events: none;
}

.node-accent rect { fill: color-mix(in srgb, var(--accent) 18%, var(--surface-2)); stroke: var(--accent); }
.node-accent .node-label { fill: var(--text); }

.node-success rect { fill: color-mix(in srgb, var(--success) 16%, var(--surface-2)); stroke: var(--success); }
.node-warning rect { fill: color-mix(in srgb, var(--warning) 16%, var(--surface-2)); stroke: var(--warning); }
.node-danger  rect { fill: color-mix(in srgb, var(--danger)  16%, var(--surface-2)); stroke: var(--danger); }
.node-info    rect { fill: color-mix(in srgb, var(--info)    16%, var(--surface-2)); stroke: var(--info); }
.node-purple  rect { fill: color-mix(in srgb, var(--purple)  18%, var(--surface-2)); stroke: var(--purple); }
.node-muted   rect { fill: var(--surface); stroke: var(--border); }
.node-muted  .node-label { fill: var(--text-muted); }

/* Edges */
.edge {
  fill: none;
  stroke: var(--border-strong);
  stroke-width: 1.5;
}
.edge.dashed { stroke-dasharray: 4 3; }
.edge-accent  { stroke: var(--accent); }
.edge-success { stroke: var(--success); }
.edge-warning { stroke: var(--warning); }
.edge-danger  { stroke: var(--danger); }
.edge-muted   { stroke: var(--border-strong); }

.arrow-head { fill: var(--border-strong); }

.edge-label {
  fill: var(--text-muted);
  font-size: 10px;
  font-weight: 500;
  paint-order: stroke;
  stroke: var(--bg);
  stroke-width: 3;
  stroke-linejoin: round;
}
</style>
