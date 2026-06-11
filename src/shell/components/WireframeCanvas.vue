<script setup lang="ts">
import { ref, computed, nextTick } from 'vue'
import ConfirmDialog from './ConfirmDialog.vue'
import DataBindingPicker from './DataBindingPicker.vue'
import GenerateComponentPanel from './GenerateComponentPanel.vue'
import Icon from './Icon.vue'
import { computeSnap, type SnapGuide } from '../utils/wireframeSnap'
import { safeMd } from '../utils/safeMd'
import type { useComponentGenerator } from '../composables/useComponentGenerator'
import type { WireframeBlock, WireframeCanvasState, WireframeDataBinding } from '../../shared/wireframe-types'
import type { WireframeCaptureProgress } from '../../shared/bridge-types'

const props = defineProps<{
  canvas: WireframeCanvasState | null
  capturing: boolean
  progress: WireframeCaptureProgress | null
  error: string | null
  /** Resolves a block's image (session dataUrl → sidecar file → null). */
  imageSrc: (block: WireframeBlock) => string | null
  deletedBlocks: WireframeBlock[]
  /** Locked: a wireframe_apply task is implementing this sketch right now. */
  building: boolean
  implementing: boolean
  /** Generate-component session (pick → settings → datasource → generate →
   *  place). Null when the host view doesn't offer the flow. */
  generator?: ReturnType<typeof useComponentGenerator> | null
}>()

const emit = defineEmits<{
  exit: []
  recapture: []
  implement: []
  'undo-implementation': []
  'explode-block': [id: string]
  'update-rect': [id: string, rect: { x: number; y: number; width: number; height: number }]
  'bring-to-front': [id: string]
  'delete-block': [id: string]
  'undelete-block': [id: string]
  'duplicate-block': [id: string]
  'set-note': [id: string, note: string]
  'set-md': [id: string, md: string]
  'set-data': [id: string, data: WireframeDataBinding | null]
  'configure-block': [id: string]
  'palette-drop': [at: { x: number; y: number }]
  'add-placeholder': [rect: { x: number; y: number; width: number; height: number }, label: string]
}>()

const rootRef = ref<HTMLElement | null>(null)
const stageRef = ref<HTMLElement | null>(null)
const confirmRecapture = ref(false)
const showDeleted = ref(false)

const visibleBlocks = computed(() =>
  (props.canvas?.blocks ?? [])
    .filter((b) => !b.deleted)
    .slice()
    .sort((a, b) => a.z - b.z),
)

function blockLabel(b: WireframeBlock): string {
  if (b.kind === 'placeholder') return b.label ?? 'placeholder'
  if (b.kind === 'palette') return b.component?.componentName ?? b.component?.tag ?? 'component'
  // Same priority as direction labels: class beats the shared page component.
  return b.anchor?.cssClass || b.anchor?.sourceTag || b.anchor?.tag || b.anchor?.component || 'block'
}

function anchorChip(b: WireframeBlock): string | null {
  if (b.kind !== 'captured' || !b.anchor?.file) return null
  return `${b.anchor.file}:${b.anchor.line}`
}

// ── Selection (multi via shift-click / marquee) ───────────

const selectedIds = ref<string[]>([])
const primaryBlock = computed(() => {
  const id = selectedIds.value[selectedIds.value.length - 1]
  return props.canvas?.blocks.find((b) => b.id === id && !b.deleted) ?? null
})
const isSelected = (id: string) => selectedIds.value.includes(id)

function select(id: string | null, additive = false): void {
  noteEditing.value = false
  mdEditing.value = false // the editor unmounts with the selection — never leave the flag set (it gates ALL canvas keys)
  if (id === null) {
    selectedIds.value = []
    return
  }
  if (additive) {
    selectedIds.value = isSelected(id)
      ? selectedIds.value.filter((x) => x !== id)
      : [...selectedIds.value, id]
  } else if (!isSelected(id)) {
    selectedIds.value = [id]
  } else {
    // Re-click inside a multi-selection keeps the group; promote to primary.
    selectedIds.value = [...selectedIds.value.filter((x) => x !== id), id]
  }
  rootRef.value?.focus()
}

function selectedBlocks(): WireframeBlock[] {
  return (props.canvas?.blocks ?? []).filter((b) => isSelected(b.id) && !b.deleted)
}

// ── Keyboard: delete / duplicate / Escape / arrow nudge ───

function onKeydown(e: KeyboardEvent): void {
  // Typing/picking — keys belong to the inputs, never to block ops. The
  // target check covers inputs that bubble from INSIDE the canvas root
  // (GenerateComponentPanel, its embedded picker) — without it, Backspace in
  // a prop field deletes the selected block.
  const tag = (e.target as HTMLElement)?.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
  if (noteEditing.value || labelDraft.value !== null || mdEditing.value || dataPickerFor.value !== null) return
  if (e.key === 'Escape' && placing.value) { props.generator?.cancelPlace(); return }
  if (e.key === 'Escape') { select(null); drawMode.value = false; return }
  if (props.building) return // sketch is locked while the agent implements it
  const blocks = selectedBlocks()
  if (blocks.length === 0) return
  if (e.key === 'Delete' || e.key === 'Backspace') {
    e.preventDefault()
    for (const b of blocks) emit('delete-block', b.id)
    select(null)
  } else if ((e.ctrlKey || e.metaKey) && (e.key === 'd' || e.key === 'D')) {
    e.preventDefault()
    for (const b of blocks) emit('duplicate-block', b.id)
  } else if (e.key.startsWith('Arrow')) {
    e.preventDefault()
    const step = e.shiftKey ? 10 : 1
    const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0
    const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0
    for (const b of blocks) {
      emit('update-rect', b.id, {
        x: Math.max(0, b.rect.x + dx), y: Math.max(0, b.rect.y + dy),
        width: b.rect.width, height: b.rect.height,
      })
    }
  }
}

// ── Move / resize (window-level listeners) + snap guides ──

const snapGuides = ref<SnapGuide[]>([])
const dragState = ref<{
  mode: 'move' | 'resize'
  handle?: string
  startX: number; startY: number
  grabbedId: string
  items: Array<{ id: string; origX: number; origY: number; origW: number; origH: number }>
  moved: boolean
} | null>(null)

function beginDrag(e: PointerEvent, b: WireframeBlock, mode: 'move' | 'resize', handle?: string): void {
  e.preventDefault()
  e.stopPropagation()
  // Ghost placement wins over every block gesture: clicking anywhere on the
  // canvas (including over an existing block) places the generated image.
  if (placing.value) { void props.generator?.placeAt(stagePoint(e)); return }
  select(b.id, e.shiftKey)
  if (props.building) return // selection only — the sketch is locked
  if (e.shiftKey) return // shift-click is selection surgery, never a drag
  if (mode === 'move') emit('bring-to-front', b.id)
  const group = mode === 'move' ? selectedBlocks() : [b]
  dragState.value = {
    mode, handle,
    startX: e.clientX, startY: e.clientY,
    grabbedId: b.id,
    items: group.map((g) => ({ id: g.id, origX: g.rect.x, origY: g.rect.y, origW: g.rect.width, origH: g.rect.height })),
    moved: false,
  }
  window.addEventListener('pointermove', onDragMove)
  window.addEventListener('pointerup', onDragUp)
}

function onDragMove(e: PointerEvent): void {
  const d = dragState.value
  if (!d) return
  let dx = e.clientX - d.startX
  let dy = e.clientY - d.startY
  // 3px threshold separates click-to-select from an actual drag.
  if (!d.moved && Math.abs(dx) + Math.abs(dy) < 3) return
  d.moved = true

  if (d.mode === 'move') {
    // Snap by the GRABBED block against everything outside the moving group
    // (Alt disables); the whole group follows the adjusted delta.
    const grabbed = d.items.find((i) => i.id === d.grabbedId)!
    const proposed = { x: grabbed.origX + dx, y: grabbed.origY + dy, width: grabbed.origW, height: grabbed.origH }
    if (!e.altKey) {
      const groupIds = new Set(d.items.map((i) => i.id))
      const others = visibleBlocks.value.filter((b) => !groupIds.has(b.id)).map((b) => b.rect)
      const snapped = computeSnap(proposed, others)
      dx += snapped.x - proposed.x
      dy += snapped.y - proposed.y
      snapGuides.value = snapped.guides
    } else {
      snapGuides.value = []
    }
    for (const item of d.items) {
      emit('update-rect', item.id, {
        x: Math.max(0, item.origX + dx), y: Math.max(0, item.origY + dy),
        width: item.origW, height: item.origH,
      })
    }
    return
  }

  const item = d.items[0]
  let x = item.origX, y = item.origY, w = item.origW, h = item.origH
  const handle = d.handle || ''
  if (handle.includes('e')) w = Math.max(24, item.origW + dx)
  if (handle.includes('s')) h = Math.max(24, item.origH + dy)
  if (handle.includes('w')) { w = Math.max(24, item.origW - dx); x = item.origX + item.origW - w }
  if (handle.includes('n')) { h = Math.max(24, item.origH - dy); y = item.origY + item.origH - h }
  emit('update-rect', item.id, { x: Math.max(0, x), y: Math.max(0, y), width: w, height: h })
}

function onDragUp(): void {
  dragState.value = null
  snapGuides.value = []
  window.removeEventListener('pointermove', onDragMove)
  window.removeEventListener('pointerup', onDragUp)
}

// ── Explode (double-click a captured block one level deeper) ──

function onBlockDblClick(b: WireframeBlock): void {
  if (props.building || b.kind !== 'captured' || b.shell) return
  emit('explode-block', b.id)
}

// ── Notes ─────────────────────────────────────────────────

const noteEditing = ref(false)
const noteDraft = ref('')
const noteInputRef = ref<HTMLTextAreaElement | null>(null)

function openNote(): void {
  if (!primaryBlock.value) return
  noteDraft.value = primaryBlock.value.note ?? ''
  noteEditing.value = true
  void nextTick(() => noteInputRef.value?.focus())
}

function commitNote(): void {
  if (!noteEditing.value || !primaryBlock.value) return
  emit('set-note', primaryBlock.value.id, noteDraft.value)
  noteEditing.value = false
}

// ── Section markdown + data binding (drawn sections) ─────

const mdEditing = ref(false)
const mdDraft = ref('')
const mdPreview = ref(false)
const mdInputRef = ref<HTMLTextAreaElement | null>(null)
/** Block id the binding picker is open for (null = closed). */
const dataPickerFor = ref<string | null>(null)

/** A placeholder with a markdown body or a binding IS a section — derived
 *  affordance, not a new block kind. */
function isSection(b: WireframeBlock): boolean {
  return b.kind === 'placeholder' && (!!b.md || !!b.data)
}

function openMd(): void {
  if (!primaryBlock.value) return
  mdDraft.value = primaryBlock.value.md ?? ''
  mdPreview.value = false
  mdEditing.value = true
  void nextTick(() => mdInputRef.value?.focus())
}

function commitMd(): void {
  if (!mdEditing.value || !primaryBlock.value) return
  emit('set-md', primaryBlock.value.id, mdDraft.value)
  mdEditing.value = false
}

function cancelMd(): void {
  mdEditing.value = false
}

function openDataPicker(id: string): void {
  dataPickerFor.value = id
}

function onBindingSelect(binding: WireframeDataBinding): void {
  if (dataPickerFor.value) emit('set-data', dataPickerFor.value, binding)
  dataPickerFor.value = null
}

function onBindingClear(): void {
  if (dataPickerFor.value) emit('set-data', dataPickerFor.value, null)
  dataPickerFor.value = null
}

const pickerInitial = computed(() =>
  dataPickerFor.value ? props.canvas?.blocks.find((b) => b.id === dataPickerFor.value)?.data ?? null : null)

// ── Placeholder draw tool + marquee selection ─────────────

const drawMode = ref(false)
const drawRect = ref<{ x: number; y: number; width: number; height: number } | null>(null)
const marqueeRect = ref<{ x: number; y: number; width: number; height: number } | null>(null)
/** Non-null while the just-drawn placeholder waits for its label. */
const labelDraft = ref<string | null>(null)
const labelRect = ref<{ x: number; y: number; width: number; height: number } | null>(null)
const labelInputRef = ref<HTMLInputElement | null>(null)
let stageStart: { x: number; y: number } | null = null
let stageGesture: 'draw' | 'marquee' | null = null
let marqueeAdditive = false

function stagePoint(e: PointerEvent | DragEvent): { x: number; y: number } {
  const stage = stageRef.value
  if (!stage) return { x: 0, y: 0 }
  const r = stage.getBoundingClientRect()
  return { x: e.clientX - r.left, y: e.clientY - r.top }
}

function onStagePointerDown(e: PointerEvent): void {
  if (placing.value) { void props.generator?.placeAt(stagePoint(e)); return }
  stageStart = stagePoint(e)
  if (drawMode.value) {
    stageGesture = 'draw'
    drawRect.value = { ...stageStart, width: 0, height: 0 }
  } else {
    stageGesture = 'marquee'
    marqueeAdditive = e.shiftKey
    marqueeRect.value = { ...stageStart, width: 0, height: 0 }
  }
  window.addEventListener('pointermove', onStageMove)
  window.addEventListener('pointerup', onStageUp)
}

function onStageMove(e: PointerEvent): void {
  if (!stageStart) return
  const p = stagePoint(e)
  const rect = {
    x: Math.min(stageStart.x, p.x),
    y: Math.min(stageStart.y, p.y),
    width: Math.abs(p.x - stageStart.x),
    height: Math.abs(p.y - stageStart.y),
  }
  if (stageGesture === 'draw') drawRect.value = rect
  else marqueeRect.value = rect
}

function onStageUp(): void {
  window.removeEventListener('pointermove', onStageMove)
  window.removeEventListener('pointerup', onStageUp)
  const gesture = stageGesture
  const draw = drawRect.value
  const marquee = marqueeRect.value
  stageStart = null
  stageGesture = null
  drawRect.value = null
  marqueeRect.value = null

  if (gesture === 'draw') {
    drawMode.value = false
    if (draw && draw.width >= 24 && draw.height >= 24) {
      labelRect.value = draw
      labelDraft.value = ''
      void nextTick(() => labelInputRef.value?.focus())
    }
    return
  }

  // Marquee: a real sweep selects every intersecting block; a click clears.
  if (marquee && marquee.width + marquee.height > 6) {
    const hit = visibleBlocks.value.filter((b) =>
      b.rect.x < marquee.x + marquee.width && b.rect.x + b.rect.width > marquee.x
      && b.rect.y < marquee.y + marquee.height && b.rect.y + b.rect.height > marquee.y,
    ).map((b) => b.id)
    // Direct selection change — same editor-flag hygiene as select().
    noteEditing.value = false
    mdEditing.value = false
    selectedIds.value = marqueeAdditive ? [...new Set([...selectedIds.value, ...hit])] : hit
    if (hit.length) rootRef.value?.focus()
  } else {
    select(null)
  }
}

function commitPlaceholder(): void {
  if (labelDraft.value === null || !labelRect.value) return
  const label = labelDraft.value.trim()
  if (label) emit('add-placeholder', labelRect.value, label)
  labelDraft.value = null
  labelRect.value = null
}

function cancelPlaceholder(): void {
  labelDraft.value = null
  labelRect.value = null
}

// ── Palette drop (native HTML5 drag — no shield needed over the canvas) ──

function onCanvasDrop(e: DragEvent): void {
  e.preventDefault()
  if (props.building) return
  emit('palette-drop', stagePoint(e))
}

// ── Ghost placement (generate-component flow's Place step) ──

const placing = computed(() => props.generator?.session.value?.placing === true)
const ghostPos = ref<{ x: number; y: number } | null>(null)

function onStageHover(e: PointerEvent): void {
  if (!placing.value) return
  ghostPos.value = stagePoint(e)
}

function onRecaptureConfirmed(): void {
  confirmRecapture.value = false
  emit('recapture')
}
</script>

<template>
  <div ref="rootRef" class="wireframe-canvas" data-testid="wireframe-canvas" tabindex="-1" @keydown="onKeydown">
    <div class="wf-chrome">
      <span class="wf-title">
        <Icon name="frame" :size="12" />
        Wireframe
        <span class="wf-subtitle">sketch — rearranged images, not the live app</span>
      </span>
      <span v-if="canvas" class="wf-viewport" data-testid="wf-viewport"
        title="Captured at this viewport — pick a device preset before capturing to wireframe mobile">{{ canvas.viewport.width }}×{{ canvas.viewport.height }} @{{ canvas.viewport.scale }}x</span>
      <span v-if="capturing" class="wf-progress" data-testid="wf-progress">
        Capturing{{ progress ? ` ${progress.index + 1}/${progress.total} — ${progress.label}` : '…' }}
      </span>
      <span v-else-if="error" class="wf-error">{{ error }}</span>
      <span v-else-if="canvas?.truncated" class="wf-warn" title="Block discovery hit the 24-block cap — some page regions have no block">
        capture truncated
      </span>
      <span v-if="building" class="wf-building" data-testid="wf-building">
        Agent implementing — review the task in the Tasks panel
      </span>
      <span class="wf-spacer" />
      <template v-if="building">
        <button class="wf-btn" data-testid="wf-undo-implementation" @click="emit('undo-implementation')"
          title="Delete the task and restore the pre-apply bytes — the sketch unlocks for editing">
          <Icon name="rotate-ccw" :size="12" /> Undo this implementation
        </button>
      </template>
      <button v-else class="wf-btn wf-implement" data-testid="wf-implement" :disabled="capturing || implementing"
        @click="emit('implement')" title="Generate anchored directions + before/after screenshot and run the agent">
        <Icon name="wand" :size="12" /> {{ implementing ? 'Implementing…' : 'Implement this wireframe' }}
      </button>
      <button v-if="!building" :class="['wf-btn', { 'wf-btn-active': drawMode }]" data-testid="wf-draw-placeholder" :disabled="capturing"
        @click="drawMode = !drawMode" title="Draw a section — a labeled box, optionally with a markdown spec and a data binding">
        <Icon name="square-plus" :size="12" /> Section
      </button>
      <div v-if="deletedBlocks.length" class="wf-deleted-wrap">
        <button class="wf-btn" data-testid="wf-deleted-toggle" @click="showDeleted = !showDeleted"
          :title="`${deletedBlocks.length} deleted block(s) — click to restore`">
          <Icon name="trash" :size="12" /> {{ deletedBlocks.length }} deleted
        </button>
        <div v-if="showDeleted" class="wf-deleted-pop">
          <div v-for="b in deletedBlocks" :key="b.id" class="wf-deleted-row">
            <span>{{ blockLabel(b) }}</span>
            <button class="wf-btn" :data-testid="`wf-undelete-${b.id}`" @click="emit('undelete-block', b.id)">restore</button>
          </div>
        </div>
      </div>
      <button class="wf-btn" data-testid="wf-recapture" :disabled="capturing || building" @click="confirmRecapture = true"
        title="Discard this sketch and re-capture the live route">
        <Icon name="refresh-cw" :size="12" /> Recapture
      </button>
      <button class="wf-btn wf-exit" data-testid="wf-exit" @click="emit('exit')"
        title="Back to the live app (the sketch is kept)">
        <Icon name="x" :size="12" /> Exit
      </button>
    </div>

    <div v-if="capturing && !canvas" class="wf-empty">Capturing the page…</div>

    <div v-else-if="canvas" class="wf-scroll"
      @dragenter.prevent
      @dragover.prevent
      @drop="onCanvasDrop">
      <div ref="stageRef" class="wf-stage" :class="{ drawing: drawMode, placing }"
        :style="{ width: canvas.viewport.docWidth + 'px', height: canvas.viewport.docHeight + 'px' }"
        @pointerdown.self="onStagePointerDown"
        @pointermove="onStageHover">
        <div v-for="b in visibleBlocks" :key="b.id"
          class="wf-block"
          :class="{ selected: isSelected(b.id), failed: !imageSrc(b) && b.kind === 'captured', placeholder: b.kind === 'placeholder', dragging: dragState?.moved && dragState.items.some((i) => i.id === b.id) }"
          :data-block-id="b.id"
          :style="{ left: b.rect.x + 'px', top: b.rect.y + 'px', width: b.rect.width + 'px', height: b.rect.height + 'px', zIndex: b.z }"
          @pointerdown.stop="beginDrag($event, b, 'move')"
          @dblclick.stop="onBlockDblClick(b)">
          <img v-if="imageSrc(b)" :src="imageSrc(b)!" :alt="blockLabel(b)" draggable="false" />
          <div v-else-if="b.kind === 'placeholder'" class="wf-placeholder-body" :class="{ section: isSection(b) }">
            <span class="wf-placeholder-label">{{ b.label }}</span>
            <span class="wf-placeholder-tag">{{ isSection(b) ? 'section' : 'placeholder' }}</span>
            <!-- Sanitized markdown hint (clipped, non-interactive) — the
                 verbatim body rides added.md; this is just the sketch view. -->
            <div v-if="b.md" class="wf-md-hint" v-html="safeMd(b.md)" />
          </div>
          <div v-else class="wf-block-failed">
            <span>{{ b.captureError ? 'capture failed' : 'image missing' }}</span>
            <span class="wf-failed-label">{{ blockLabel(b) }}</span>
          </div>
          <div v-if="b.clipped" class="wf-clipped-note" title="Block was taller than the capture cap — only the top is shown">clipped</div>
          <div v-if="b.note && primaryBlock?.id !== b.id" class="wf-note-chip" :title="b.note">
            <Icon name="pencil" :size="9" /> note
          </div>
          <div v-if="b.kind === 'palette' && b.fidelity && b.fidelity !== 'live'" class="wf-fidelity-pill" :class="b.fidelity">
            {{ b.fidelity === 'isolated-preview' ? 'isolated preview' : 'placeholder render' }}
          </div>
          <div v-if="b.data" class="wf-data-chip" :data-testid="`wf-data-chip-${b.id}`" :title="`bound to ${b.data.name}${b.data.path ? ' → ' + b.data.path : ''} [${b.data.shape_source}]`">
            <Icon name="database" :size="9" /> {{ b.data.name }}<template v-if="b.data.path"> · {{ b.data.path }}</template>
          </div>

          <template v-if="primaryBlock?.id === b.id && selectedIds.length === 1">
            <div class="wf-block-header" @pointerdown.stop="beginDrag($event, b, 'move')">
              <span class="wf-block-name">{{ blockLabel(b) }}</span>
              <code v-if="anchorChip(b)" class="wf-anchor-chip" data-testid="wf-anchor-chip">{{ anchorChip(b) }}</code>
              <span class="wf-header-spacer" />
              <button v-if="b.kind === 'captured' && !b.shell" class="wf-hbtn" data-testid="wf-explode-btn" @pointerdown.stop @click.stop="onBlockDblClick(b)" title="Explode into child blocks (double-click)">
                <Icon name="maximize-2" :size="10" />
              </button>
              <button class="wf-hbtn" data-testid="wf-note-btn" @pointerdown.stop @click.stop="openNote()" :title="b.note ? `Note: ${b.note}` : 'Add a note for the agent'">
                <Icon name="pencil" :size="10" />
              </button>
              <button v-if="b.kind === 'palette' && generator" class="wf-hbtn" data-testid="wf-configure-btn" @pointerdown.stop @click.stop="emit('configure-block', b.id)" title="Reconfigure — props, data binding, regenerate">
                <Icon name="settings" :size="10" />
              </button>
              <button v-if="b.kind === 'placeholder'" class="wf-hbtn" data-testid="wf-md-btn" @pointerdown.stop @click.stop="openMd()" :title="b.md ? 'Edit the section\'s markdown spec' : 'Write a markdown spec for this section'">
                <Icon name="file-text" :size="10" />
              </button>
              <button v-if="b.kind === 'placeholder'" class="wf-hbtn" data-testid="wf-data-btn" @pointerdown.stop @click.stop="openDataPicker(b.id)" :title="b.data ? `Bound to ${b.data.name} — change or clear` : 'Bind a data source'">
                <Icon name="database" :size="10" />
              </button>
              <button class="wf-hbtn" data-testid="wf-duplicate-btn" @pointerdown.stop @click.stop="emit('duplicate-block', b.id)" title="Duplicate (Ctrl+D)">
                <Icon name="copy" :size="10" />
              </button>
              <button class="wf-hbtn wf-hbtn-danger" data-testid="wf-delete-btn" @pointerdown.stop @click.stop="emit('delete-block', b.id); select(null)" title="Delete (Del)">
                <Icon name="trash" :size="10" />
              </button>
            </div>
            <div v-if="noteEditing" class="wf-note-editor" @pointerdown.stop>
              <textarea ref="noteInputRef" v-model="noteDraft" rows="2" data-testid="wf-note-input"
                placeholder="Tell the agent about this block… (e.g. make this a carousel)"
                @blur="commitNote" @keydown.enter.exact.prevent="commitNote" @keydown.escape.stop="noteEditing = false" />
            </div>
            <div v-if="mdEditing" class="wf-md-editor" @pointerdown.stop @click.stop>
              <div class="wf-md-toolbar">
                <button :class="['wf-md-tab', { active: !mdPreview }]" @click="mdPreview = false">Write</button>
                <button :class="['wf-md-tab', { active: mdPreview }]" data-testid="wf-md-preview-toggle" @click="mdPreview = true">Preview</button>
                <span class="wf-md-spacer" />
                <button class="wf-md-tab" @click="cancelMd">Cancel</button>
                <button class="wf-md-tab primary" data-testid="wf-md-save" @click="commitMd">Save</button>
              </div>
              <!-- Plain Enter = newline (multi-line markdown); Ctrl/Cmd+Enter commits. -->
              <textarea v-if="!mdPreview" ref="mdInputRef" v-model="mdDraft" rows="7" data-testid="wf-md-input"
                placeholder="Describe what you want here, in markdown… (## heading, - bullets)"
                @keydown.enter.ctrl.prevent="commitMd" @keydown.enter.meta.prevent="commitMd" @keydown.escape.stop="cancelMd" />
              <div v-else class="wf-md-preview" data-testid="wf-md-rendered" v-html="safeMd(mdDraft)" />
            </div>
            <div class="resize-handle rh-n" @pointerdown.stop="beginDrag($event, b, 'resize', 'n')" />
            <div class="resize-handle rh-s" @pointerdown.stop="beginDrag($event, b, 'resize', 's')" />
            <div class="resize-handle rh-e" @pointerdown.stop="beginDrag($event, b, 'resize', 'e')" />
            <div class="resize-handle rh-w" @pointerdown.stop="beginDrag($event, b, 'resize', 'w')" />
            <div class="resize-handle rh-ne" @pointerdown.stop="beginDrag($event, b, 'resize', 'ne')" />
            <div class="resize-handle rh-nw" @pointerdown.stop="beginDrag($event, b, 'resize', 'nw')" />
            <div class="resize-handle rh-se" data-testid="wf-resize-se" @pointerdown.stop="beginDrag($event, b, 'resize', 'se')" />
            <div class="resize-handle rh-sw" @pointerdown.stop="beginDrag($event, b, 'resize', 'sw')" />
          </template>
        </div>

        <!-- Snap/align guide lines (visible mid-drag while a snap is active) -->
        <template v-for="(g, i) in snapGuides" :key="`g${i}`">
          <div v-if="g.axis === 'x'" class="wf-guide wf-guide-v" :style="{ left: g.at + 'px' }" />
          <div v-else class="wf-guide wf-guide-h" :style="{ top: g.at + 'px' }" />
        </template>

        <!-- Marquee selection preview -->
        <div v-if="marqueeRect && marqueeRect.width + marqueeRect.height > 6" class="wf-marquee"
          :style="{ left: marqueeRect.x + 'px', top: marqueeRect.y + 'px', width: marqueeRect.width + 'px', height: marqueeRect.height + 'px' }" />

        <!-- Placeholder drawing preview + label input -->
        <div v-if="drawRect && drawRect.width > 4 && drawRect.height > 4" class="wf-draw-preview"
          :style="{ left: drawRect.x + 'px', top: drawRect.y + 'px', width: drawRect.width + 'px', height: drawRect.height + 'px' }" />
        <div v-if="labelDraft !== null && labelRect" class="wf-label-input"
          :style="{ left: labelRect.x + 'px', top: labelRect.y + 'px', width: labelRect.width + 'px', height: labelRect.height + 'px' }">
          <input ref="labelInputRef" v-model="labelDraft" data-testid="wf-placeholder-label"
            placeholder="Label this placeholder… (e.g. pagination here)"
            @keydown.enter.prevent="commitPlaceholder" @keydown.escape="cancelPlaceholder" @blur="commitPlaceholder" />
        </div>

        <!-- Generated-image ghost riding the cursor during Place -->
        <img v-if="placing && ghostPos && generator?.session.value?.generated?.dataUrl"
          class="wf-ghost" data-testid="wf-ghost"
          :src="generator.session.value.generated.dataUrl"
          :style="{ left: ghostPos.x + 'px', top: ghostPos.y + 'px', width: (generator.session.value.generated.width ?? 320) + 'px' }"
          alt="" draggable="false" />
      </div>
    </div>

    <GenerateComponentPanel v-if="generator?.session.value" :generator="generator" />

    <div v-if="dataPickerFor" class="wf-picker-overlay" @pointerdown.self="dataPickerFor = null">
      <DataBindingPicker :initial="pickerInitial" @select="onBindingSelect" @clear="onBindingClear" @cancel="dataPickerFor = null" />
    </div>

    <ConfirmDialog v-if="confirmRecapture"
      message="Discard this sketch and re-capture the live route? Your rearrangement on this canvas will be lost."
      confirmLabel="Recapture"
      @confirm="onRecaptureConfirmed"
      @cancel="confirmRecapture = false" />
  </div>
</template>

<style scoped>
.wireframe-canvas {
  position: absolute;
  inset: 0;
  z-index: 60; /* above iframe + shields + overlays, below modals */
  display: flex;
  flex-direction: column;
  background: var(--bg);
  outline: none;
}

.wf-chrome {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  border-bottom: 1px solid var(--border);
  background: var(--surface);
  font-size: 11px;
  flex: 0 0 auto;
}
.wf-title {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-weight: 600;
  color: var(--text);
}
.wf-subtitle { color: var(--text-muted); font-weight: 400; }
.wf-viewport {
  font-family: ui-monospace, monospace;
  font-size: 10px;
  color: var(--text-muted);
  border: 1px solid var(--border);
  border-radius: 3px;
  padding: 1px 5px;
}
.wf-progress { color: var(--info); }
.wf-error { color: var(--danger); }
.wf-warn { color: var(--warning); }
.wf-building { color: var(--status-in-progress, var(--info)); font-weight: 600; }
.wf-implement {
  background: var(--accent);
  color: var(--text-on-accent);
  border-color: var(--accent);
}
.wf-implement:hover:not(:disabled) { background: var(--accent-hover); }
.wf-spacer { flex: 1; }
.wf-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  padding: 3px 8px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--surface-2);
  color: var(--text);
  cursor: pointer;
}
.wf-btn:hover { border-color: var(--border-strong); }
.wf-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.wf-btn-active { border-color: var(--accent); color: var(--accent); }
.wf-exit { background: color-mix(in srgb, var(--accent) 12%, transparent); }

.wf-deleted-wrap { position: relative; }
.wf-deleted-pop {
  position: absolute;
  top: calc(100% + 4px);
  right: 0;
  z-index: 10;
  min-width: 180px;
  background: var(--surface-elevated);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 6px;
  box-shadow: 0 4px 16px var(--shadow);
}
.wf-deleted-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 2px 4px;
  font-size: 11px;
  color: var(--text);
}

.wf-empty {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-muted);
  font-size: 12px;
}

.wf-scroll { flex: 1; overflow: auto; }
.wf-stage {
  position: relative;
  /* The sketch keeps the capture's document coordinate space. */
  background:
    repeating-linear-gradient(0deg, transparent 0 23px, color-mix(in srgb, var(--border) 35%, transparent) 23px 24px),
    repeating-linear-gradient(90deg, transparent 0 23px, color-mix(in srgb, var(--border) 35%, transparent) 23px 24px);
}
.wf-stage.drawing { cursor: crosshair; }

.wf-block {
  position: absolute;
  box-sizing: border-box;
  border: 1px solid transparent;
  background: var(--surface);
  overflow: hidden;
  cursor: grab;
}
.wf-block.dragging { cursor: grabbing; opacity: 0.92; }
.wf-block:hover { border-color: color-mix(in srgb, var(--accent) 50%, transparent); }
.wf-block.selected { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent); overflow: visible; }
.wf-block img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: fill;
  user-select: none;
  -webkit-user-drag: none;
  pointer-events: none;
}

.wf-block.failed {
  border: 1px dashed var(--border-strong);
  background: repeating-linear-gradient(45deg, var(--surface) 0 8px, color-mix(in srgb, var(--border) 40%, transparent) 8px 16px);
}
.wf-block-failed {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  gap: 4px;
  color: var(--text-muted);
  font-size: 11px;
}
.wf-failed-label { font-size: 10px; opacity: 0.8; }

.wf-block.placeholder {
  border: 2px dashed color-mix(in srgb, var(--accent) 60%, transparent);
  background: repeating-linear-gradient(45deg, transparent 0 10px, color-mix(in srgb, var(--accent) 8%, transparent) 10px 20px);
}
.wf-placeholder-body {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  gap: 4px;
}
.wf-placeholder-label { font-size: 12px; font-weight: 600; color: var(--text); }
.wf-placeholder-tag {
  font-size: 9px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--text-muted);
}
/* Section affordance: a placeholder carrying a markdown spec or a binding. */
.wf-placeholder-body.section { justify-content: flex-start; padding: 8px 10px 18px; align-items: flex-start; }
.wf-placeholder-body.section .wf-placeholder-tag { color: var(--accent); }
.wf-md-hint {
  width: 100%;
  flex: 1;
  min-height: 0;
  overflow: hidden;
  pointer-events: none;
  font-size: 10px;
  color: var(--text-muted);
  text-align: left;
}
.wf-md-hint :deep(h1), .wf-md-hint :deep(h2), .wf-md-hint :deep(h3) { font-size: 11px; margin: 2px 0; color: var(--text); }
.wf-md-hint :deep(p), .wf-md-hint :deep(ul) { margin: 2px 0; }
.wf-md-hint :deep(ul) { padding-left: 14px; }

.wf-clipped-note {
  position: absolute;
  bottom: 2px;
  right: 4px;
  font-size: 9px;
  color: var(--warning);
  background: color-mix(in srgb, var(--bg) 80%, transparent);
  padding: 0 4px;
  border-radius: 3px;
}

.wf-note-chip {
  position: absolute;
  top: 4px;
  right: 4px;
  display: inline-flex;
  align-items: center;
  gap: 3px;
  font-size: 9px;
  padding: 1px 5px;
  border-radius: 3px;
  background: color-mix(in srgb, var(--warning) 25%, var(--bg));
  color: var(--text);
  pointer-events: none;
}

.wf-fidelity-pill {
  position: absolute;
  bottom: 4px;
  left: 4px;
  font-size: 9px;
  padding: 1px 5px;
  border-radius: 3px;
  background: color-mix(in srgb, var(--warning) 30%, var(--bg));
  color: var(--text);
  pointer-events: none;
}

.wf-data-chip {
  position: absolute;
  bottom: 4px;
  right: 4px;
  display: inline-flex;
  align-items: center;
  gap: 3px;
  font-size: 9px;
  padding: 1px 5px;
  border-radius: 3px;
  background: color-mix(in srgb, var(--info) 25%, var(--bg));
  color: var(--text);
  pointer-events: none;
  max-width: 80%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.wf-stage.placing { cursor: copy; }

.wf-ghost {
  position: absolute;
  z-index: 10000;
  opacity: 0.7;
  pointer-events: none;
  border: 1px dashed var(--accent);
  border-radius: 2px;
}

.wf-block-header {
  position: absolute;
  top: -22px;
  left: -1px;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 2px 6px;
  height: 18px;
  font-size: 10px;
  white-space: nowrap;
  background: var(--accent);
  color: var(--text-on-accent);
  border-radius: 4px 4px 0 0;
  cursor: grab;
  user-select: none;
}
.wf-block-name { font-weight: 600; }
.wf-anchor-chip {
  font-family: ui-monospace, monospace;
  font-size: 9px;
  opacity: 0.9;
}
.wf-header-spacer { width: 6px; }
.wf-hbtn {
  display: inline-flex;
  align-items: center;
  border: none;
  background: transparent;
  color: var(--text-on-accent);
  cursor: pointer;
  padding: 1px 2px;
  opacity: 0.85;
}
.wf-hbtn:hover { opacity: 1; }
.wf-hbtn-danger:hover { color: var(--danger); }

.wf-note-editor {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  width: min(280px, 100%);
  z-index: 5;
}
.wf-note-editor textarea {
  width: 100%;
  box-sizing: border-box;
  background: var(--surface-elevated);
  border: 1px solid var(--accent);
  border-radius: 4px;
  color: var(--text);
  font-size: 11px;
  padding: 6px 8px;
  resize: vertical;
}

/* Section markdown editor — same anchored-popover pattern as the note
   editor but wider and multi-line, with a Write/Preview toggle. */
.wf-md-editor {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  width: min(440px, 90vw);
  z-index: 6;
  background: var(--surface-elevated);
  border: 1px solid var(--accent);
  border-radius: 6px;
  box-shadow: 0 8px 24px var(--shadow);
  overflow: hidden;
}
.wf-md-toolbar {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 6px;
  border-bottom: 1px solid var(--border);
}
.wf-md-spacer { flex: 1; }
.wf-md-tab {
  padding: 2px 8px;
  background: none;
  border: 1px solid transparent;
  border-radius: 4px;
  color: var(--text-muted);
  cursor: pointer;
  font-size: 11px;
}
.wf-md-tab:hover { color: var(--text); }
.wf-md-tab.active { background: var(--surface-2); color: var(--text); border-color: var(--border); }
.wf-md-tab.primary { background: var(--accent); color: var(--text-on-accent); }
.wf-md-editor textarea {
  display: block;
  width: 100%;
  box-sizing: border-box;
  background: var(--surface);
  border: none;
  color: var(--text);
  font-size: 11px;
  font-family: ui-monospace, monospace;
  padding: 8px;
  resize: vertical;
  outline: none;
}
.wf-md-preview {
  padding: 8px 10px;
  font-size: 11px;
  color: var(--text);
  max-height: 220px;
  overflow-y: auto;
  cursor: text;
}

.wf-picker-overlay {
  position: fixed;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--overlay);
  z-index: 90;
}

.wf-guide {
  position: absolute;
  background: var(--accent);
  opacity: 0.7;
  pointer-events: none;
  z-index: 9999;
}
.wf-guide-v { top: 0; bottom: 0; width: 1px; }
.wf-guide-h { left: 0; right: 0; height: 1px; }

.wf-marquee {
  position: absolute;
  border: 1px solid var(--accent);
  background: color-mix(in srgb, var(--accent) 10%, transparent);
  pointer-events: none;
  z-index: 9999;
}

.wf-draw-preview {
  position: absolute;
  border: 2px dashed var(--accent);
  background: color-mix(in srgb, var(--accent) 8%, transparent);
  pointer-events: none;
}
.wf-label-input {
  position: absolute;
  border: 2px dashed color-mix(in srgb, var(--accent) 60%, transparent);
  display: flex;
  align-items: center;
  justify-content: center;
}
.wf-label-input input {
  width: 90%;
  background: var(--surface-elevated);
  border: 1px solid var(--accent);
  border-radius: 4px;
  color: var(--text);
  font-size: 11px;
  padding: 4px 8px;
}

/* ── Resize handles (8-handle pattern) ── */
.resize-handle { position: absolute; z-index: 6; }
.rh-n  { top: -4px; left: 8px; right: 8px; height: 8px; cursor: n-resize; }
.rh-s  { bottom: -4px; left: 8px; right: 8px; height: 8px; cursor: s-resize; }
.rh-e  { right: -4px; top: 8px; bottom: 8px; width: 8px; cursor: e-resize; }
.rh-w  { left: -4px; top: 8px; bottom: 8px; width: 8px; cursor: w-resize; }
.rh-nw, .rh-ne, .rh-sw, .rh-se {
  width: 10px; height: 10px;
  background: var(--accent); border: 1.5px solid var(--text-on-accent);
  border-radius: 2px;
}
.rh-nw { top: -5px; left: -5px; cursor: nw-resize; }
.rh-ne { top: -5px; right: -5px; cursor: ne-resize; }
.rh-sw { bottom: -5px; left: -5px; cursor: sw-resize; }
.rh-se { bottom: -5px; right: -5px; cursor: se-resize; }
</style>
