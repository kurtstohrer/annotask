<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useViewportPreview, VIEWPORT_PRESETS, type ViewportPreset } from '../composables/useViewportPreview'

const viewport = useViewportPreview()
const open = ref(false)
const inputW = ref('')
const inputH = ref('')
const root = ref<HTMLElement | null>(null)

const grouped = computed(() => {
  const groups: Record<string, ViewportPreset[]> = { phone: [], tablet: [], desktop: [] }
  for (const p of VIEWPORT_PRESETS) groups[p.category].push(p)
  return groups
})

const displayLabel = computed(() => {
  const vp = viewport.effectiveViewport.value
  if (!vp.width && !vp.height) return 'Responsive'
  return `${vp.width}×${vp.height}`
})

function pick(preset: ViewportPreset | null) {
  viewport.selectPreset(preset)
  open.value = false
}

function applyCustom() {
  const w = parseInt(inputW.value) || null
  const h = parseInt(inputH.value) || null
  if (w || h) {
    viewport.setCustomDimensions(w, h)
    open.value = false
  }
}

function onDocClick(e: MouseEvent) {
  if (open.value && root.value && !root.value.contains(e.target as Node)) {
    open.value = false
  }
}

onMounted(() => document.addEventListener('click', onDocClick))
onUnmounted(() => document.removeEventListener('click', onDocClick))
</script>

<template>
  <div ref="root" class="viewport-selector">
    <button class="vp-trigger" @click="open = !open" :title="'Preview at different screen sizes — ' + (viewport.effectiveViewport.value.label || 'Responsive')">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <rect x="2" y="3" width="20" height="14" rx="2" />
        <line x1="8" y1="21" x2="16" y2="21" />
        <line x1="12" y1="17" x2="12" y2="21" />
      </svg>
      <span class="vp-label">{{ displayLabel }}</span>
      <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="6 9 12 15 18 9"/></svg>
    </button>

    <div v-if="open" class="vp-dropdown">
      <button class="vp-item" :class="{ active: viewport.isFullWidth.value }" @click="pick(null)">
        <span class="vp-item-label">Responsive</span>
        <span class="vp-item-dim">100%</span>
      </button>

      <div class="vp-group">
        <div class="vp-group-title">Phone</div>
        <button v-for="p in grouped.phone" :key="p.id" class="vp-item"
          :class="{ active: viewport.activePresetId.value === p.id }" @click="pick(p)">
          <span class="vp-item-label">{{ p.label }}</span>
          <span class="vp-item-dim">{{ p.width }}×{{ p.height }}</span>
        </button>
      </div>

      <div class="vp-group">
        <div class="vp-group-title">Tablet</div>
        <button v-for="p in grouped.tablet" :key="p.id" class="vp-item"
          :class="{ active: viewport.activePresetId.value === p.id }" @click="pick(p)">
          <span class="vp-item-label">{{ p.label }}</span>
          <span class="vp-item-dim">{{ p.width }}×{{ p.height }}</span>
        </button>
      </div>

      <div class="vp-group">
        <div class="vp-group-title">Desktop</div>
        <button v-for="p in grouped.desktop" :key="p.id" class="vp-item"
          :class="{ active: viewport.activePresetId.value === p.id }" @click="pick(p)">
          <span class="vp-item-label">{{ p.label }}</span>
          <span class="vp-item-dim">{{ p.width }}×{{ p.height }}</span>
        </button>
      </div>

      <div class="vp-custom">
        <div class="vp-group-title">Custom</div>
        <div class="vp-custom-row">
          <input v-model="inputW" type="number" placeholder="W" class="vp-input" @keydown.enter="applyCustom" />
          <span class="vp-x">×</span>
          <input v-model="inputH" type="number" placeholder="H" class="vp-input" @keydown.enter="applyCustom" />
          <button class="vp-apply" @click="applyCustom">Set</button>
        </div>
      </div>

      <button v-if="!viewport.isFullWidth.value" class="vp-item vp-rotate" @click="viewport.toggleRotate()">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/>
        </svg>
        <span class="vp-item-label">Rotate</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.viewport-selector { position: relative; }

.vp-trigger {
  display: flex; align-items: center; gap: 4px;
  padding: 3px 8px; border: 1px solid var(--border); border-radius: 5px;
  background: var(--surface-2); color: var(--text-muted);
  font-size: 11px; cursor: pointer; transition: all 0.1s;
  white-space: nowrap;
}
.vp-trigger:hover { background: var(--border); color: var(--text); }
.vp-label { font-family: monospace; font-size: 11px; }

.vp-dropdown {
  position: absolute; top: 100%; left: 50%; transform: translateX(-50%);
  margin-top: 4px; min-width: 220px;
  background: var(--surface); border: 1px solid var(--border);
  border-radius: 8px; box-shadow: 0 8px 24px rgba(0,0,0,0.4);
  padding: 4px; z-index: 100;
  max-height: 400px; overflow-y: auto;
}

.vp-group { margin-top: 2px; }
.vp-group-title {
  padding: 4px 8px 2px; font-size: 9px; font-weight: 700;
  text-transform: uppercase; letter-spacing: 0.05em;
  color: var(--text-muted); opacity: 0.6;
}

.vp-item {
  display: flex; align-items: center; justify-content: space-between;
  width: 100%; padding: 5px 8px; border: none; border-radius: 4px;
  background: transparent; color: var(--text);
  font-size: 11px; cursor: pointer; transition: background 0.1s;
}
.vp-item:hover { background: var(--surface-2); }
.vp-item.active { background: var(--accent); color: white; }
.vp-item-label { flex: 1; text-align: left; }
.vp-item-dim { font-family: monospace; font-size: 10px; color: var(--text-muted); }
.vp-item.active .vp-item-dim { color: rgba(255,255,255,0.7); }

.vp-custom { margin-top: 2px; border-top: 1px solid var(--border); padding-top: 4px; }
.vp-custom-row { display: flex; align-items: center; gap: 4px; padding: 4px 8px; }
.vp-input {
  width: 56px; padding: 3px 6px; border: 1px solid var(--border);
  border-radius: 4px; background: var(--surface-2); color: var(--text);
  font-size: 11px; font-family: monospace; text-align: center;
}
.vp-input:focus { outline: none; border-color: var(--accent); }
.vp-x { color: var(--text-muted); font-size: 10px; }
.vp-apply {
  padding: 3px 8px; border: 1px solid var(--accent);
  border-radius: 4px; background: var(--accent); color: white;
  font-size: 10px; font-weight: 600; cursor: pointer;
}
.vp-apply:hover { opacity: 0.9; }

.vp-rotate {
  margin-top: 2px; border-top: 1px solid var(--border); padding-top: 4px;
  gap: 6px;
}
</style>
