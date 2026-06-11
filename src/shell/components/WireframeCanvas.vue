<script setup lang="ts">
import { ref, computed } from 'vue'
import ConfirmDialog from './ConfirmDialog.vue'
import Icon from './Icon.vue'
import type { WireframeBlock, WireframeCanvasState } from '../../shared/wireframe-types'
import type { WireframeCaptureProgress } from '../../shared/bridge-types'

const props = defineProps<{
  canvas: WireframeCanvasState | null
  capturing: boolean
  progress: WireframeCaptureProgress | null
  error: string | null
  /** Resolves a block's image (session dataUrl → sidecar file → null). */
  imageSrc: (block: WireframeBlock) => string | null
}>()

const emit = defineEmits<{
  exit: []
  recapture: []
}>()

const selectedId = ref<string | null>(null)
const confirmRecapture = ref(false)

const visibleBlocks = computed(() =>
  (props.canvas?.blocks ?? [])
    .filter((b) => !b.deleted)
    .slice()
    .sort((a, b) => a.z - b.z),
)

function blockLabel(b: WireframeBlock): string {
  if (b.kind === 'placeholder') return b.label ?? 'placeholder'
  if (b.kind === 'palette') return b.component?.componentName ?? b.component?.tag ?? 'component'
  return b.anchor?.component || b.anchor?.sourceTag || b.anchor?.tag || 'block'
}

function anchorChip(b: WireframeBlock): string | null {
  if (b.kind !== 'captured' || !b.anchor?.file) return null
  return `${b.anchor.file}:${b.anchor.line}`
}

function onStageClick(): void {
  selectedId.value = null
}

function onBlockClick(b: WireframeBlock): void {
  selectedId.value = b.id
}

function onRecaptureConfirmed(): void {
  confirmRecapture.value = false
  emit('recapture')
}
</script>

<template>
  <div class="wireframe-canvas" data-testid="wireframe-canvas" @keydown.escape="selectedId = null" tabindex="-1">
    <div class="wf-chrome">
      <span class="wf-title">
        <Icon name="frame" :size="12" />
        Wireframe
        <span class="wf-subtitle">sketch — rearranged images, not the live app</span>
      </span>
      <span v-if="capturing" class="wf-progress" data-testid="wf-progress">
        Capturing{{ progress ? ` ${progress.index + 1}/${progress.total} — ${progress.label}` : '…' }}
      </span>
      <span v-else-if="error" class="wf-error">{{ error }}</span>
      <span v-else-if="canvas?.truncated" class="wf-warn" title="Block discovery hit the 24-block cap — some page regions have no block">
        capture truncated
      </span>
      <span class="wf-spacer" />
      <button class="wf-btn" data-testid="wf-recapture" :disabled="capturing" @click="confirmRecapture = true"
        title="Discard this sketch and re-capture the live route">
        <Icon name="refresh-cw" :size="12" /> Recapture
      </button>
      <button class="wf-btn wf-exit" data-testid="wf-exit" @click="emit('exit')"
        title="Back to the live app (the sketch is kept)">
        <Icon name="x" :size="12" /> Exit
      </button>
    </div>

    <div v-if="capturing && !canvas" class="wf-empty">Capturing the page…</div>

    <div v-else-if="canvas" class="wf-scroll" @pointerdown.self="onStageClick">
      <div class="wf-stage" :style="{ width: canvas.viewport.docWidth + 'px', height: canvas.viewport.docHeight + 'px' }"
        @pointerdown.self="onStageClick">
        <div v-for="b in visibleBlocks" :key="b.id"
          class="wf-block" :class="{ selected: selectedId === b.id, failed: !imageSrc(b) && b.kind === 'captured' }"
          :data-block-id="b.id"
          :style="{ left: b.rect.x + 'px', top: b.rect.y + 'px', width: b.rect.width + 'px', height: b.rect.height + 'px', zIndex: b.z }"
          @pointerdown.stop="onBlockClick(b)">
          <img v-if="imageSrc(b)" :src="imageSrc(b)!" :alt="blockLabel(b)" draggable="false" />
          <div v-else class="wf-block-failed">
            <span>{{ b.captureError ? 'capture failed' : 'image missing' }}</span>
            <span class="wf-failed-label">{{ blockLabel(b) }}</span>
          </div>
          <div v-if="b.clipped" class="wf-clipped-note" title="Block was taller than the capture cap — only the top is shown">clipped</div>
          <div v-if="selectedId === b.id" class="wf-block-header">
            <span class="wf-block-name">{{ blockLabel(b) }}</span>
            <code v-if="anchorChip(b)" class="wf-anchor-chip" data-testid="wf-anchor-chip">{{ anchorChip(b) }}</code>
          </div>
        </div>
      </div>
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
.wf-progress { color: var(--info); }
.wf-error { color: var(--danger); }
.wf-warn { color: var(--warning); }
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
.wf-exit { background: color-mix(in srgb, var(--accent) 12%, transparent); }

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

.wf-block {
  position: absolute;
  box-sizing: border-box;
  border: 1px solid transparent;
  background: var(--surface);
  overflow: hidden;
  cursor: default;
}
.wf-block:hover { border-color: color-mix(in srgb, var(--accent) 50%, transparent); }
.wf-block.selected { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent); }
.wf-block img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: fill;
  user-select: none;
  -webkit-user-drag: none;
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

.wf-block-header {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 2px 6px;
  font-size: 10px;
  background: color-mix(in srgb, var(--accent) 85%, black);
  color: var(--text-on-accent);
}
.wf-block-name { font-weight: 600; }
.wf-anchor-chip {
  font-family: ui-monospace, monospace;
  font-size: 9px;
  opacity: 0.9;
}
</style>
