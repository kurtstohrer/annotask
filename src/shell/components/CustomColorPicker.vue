<script setup lang="ts">
import { ref, watch, computed, onMounted, onUnmounted } from 'vue'

const props = defineProps<{
  modelValue: string
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()

// ── Color conversion helpers ──────────────────────────
function hexToRgb(hex: string): { r: number; g: number; b: number; a: number } {
  const h = hex.replace('#', '')
  let r = 0, g = 0, b = 0, a = 1
  if (h.length === 3) {
    r = parseInt(h[0] + h[0], 16)
    g = parseInt(h[1] + h[1], 16)
    b = parseInt(h[2] + h[2], 16)
  } else if (h.length === 4) {
    r = parseInt(h[0] + h[0], 16)
    g = parseInt(h[1] + h[1], 16)
    b = parseInt(h[2] + h[2], 16)
    a = parseInt(h[3] + h[3], 16) / 255
  } else if (h.length === 6) {
    const num = parseInt(h, 16)
    r = (num >> 16) & 255
    g = (num >> 8) & 255
    b = num & 255
  } else if (h.length === 8) {
    r = parseInt(h.slice(0, 2), 16)
    g = parseInt(h.slice(2, 4), 16)
    b = parseInt(h.slice(4, 6), 16)
    a = parseInt(h.slice(6, 8), 16) / 255
  }
  return { r, g, b, a }
}

function rgbToHex(r: number, g: number, b: number): string {
  return '#' + [r, g, b].map((c) => Math.round(c).toString(16).padStart(2, '0')).join('')
}

function rgbaToHex8(r: number, g: number, b: number, a: number): string {
  const alpha = Math.round(a * 255).toString(16).padStart(2, '0')
  return rgbToHex(r, g, b) + alpha
}

function rgbToHsv(r: number, g: number, b: number): { h: number; s: number; v: number } {
  const rn = r / 255, gn = g / 255, bn = b / 255
  const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn)
  const d = max - min
  let h = 0
  if (d !== 0) {
    if (max === rn) h = ((gn - bn) / d) % 6
    else if (max === gn) h = (bn - rn) / d + 2
    else h = (rn - gn) / d + 4
    h *= 60
    if (h < 0) h += 360
  }
  const s = max === 0 ? 0 : d / max
  const v = max
  return { h, s: s * 100, v: v * 100 }
}

function hsvToRgb(h: number, s: number, v: number): { r: number; g: number; b: number } {
  const sn = s / 100, vn = v / 100
  const c = vn * sn
  const hp = h / 60
  const x = c * (1 - Math.abs((hp % 2) - 1))
  let r = 0, g = 0, b = 0
  if (hp < 1) [r, g, b] = [c, x, 0]
  else if (hp < 2) [r, g, b] = [x, c, 0]
  else if (hp < 3) [r, g, b] = [0, c, x]
  else if (hp < 4) [r, g, b] = [0, x, c]
  else if (hp < 5) [r, g, b] = [x, 0, c]
  else [r, g, b] = [c, 0, x]
  const m = vn - c
  return { r: (r + m) * 255, g: (g + m) * 255, b: (b + m) * 255 }
}

/** Parse hex/rgb/rgba/hsl CSS color string → { r, g, b, a } */
function parseCssColor(input: string): { r: number; g: number; b: number; a: number } | null {
  const v = input.trim().toLowerCase()
  if (!v) return null
  if (v.startsWith('#')) {
    const h = v.slice(1)
    if (![3, 4, 6, 8].includes(h.length)) return null
    if (!/^[0-9a-f]+$/i.test(h)) return null
    return hexToRgb(v)
  }
  const rgbMatch = v.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)$/)
  if (rgbMatch) {
    return {
      r: parseFloat(rgbMatch[1]),
      g: parseFloat(rgbMatch[2]),
      b: parseFloat(rgbMatch[3]),
      a: rgbMatch[4] !== undefined ? parseFloat(rgbMatch[4]) : 1,
    }
  }
  return null
}

// ── HSV+Alpha state ───────────────────────────────────
const hue = ref(0)
const sat = ref(100)
const val = ref(100)
const alpha = ref(1)
const textInput = ref(props.modelValue || '#000000')

// Track if update is from internal (HSV) or external (modelValue) so we
// don't fight ourselves during sync.
let syncing = false

function syncFromInput(input: string) {
  const parsed = parseCssColor(input)
  if (!parsed) return
  const hsv = rgbToHsv(parsed.r, parsed.g, parsed.b)
  syncing = true
  // Preserve hue when value/saturation is near zero (avoid hue flicker)
  if (hsv.s > 1 && hsv.v > 1) hue.value = hsv.h
  sat.value = hsv.s
  val.value = hsv.v
  alpha.value = parsed.a
  textInput.value = formatColor(parsed.r, parsed.g, parsed.b, parsed.a)
  syncing = false
}

function formatColor(r: number, g: number, b: number, a: number): string {
  // Use hex for opaque, rgba() for transparent (broad CSS support)
  if (a >= 1) return rgbToHex(r, g, b)
  return `rgba(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}, ${a.toFixed(2).replace(/\.?0+$/, '') || '0'})`
}

// Initialize from modelValue
syncFromInput(props.modelValue)

watch(() => props.modelValue, (v) => {
  if (syncing) return
  if (v !== textInput.value) syncFromInput(v)
})

const currentRgb = computed(() => hsvToRgb(hue.value, sat.value, val.value))
const currentOutput = computed(() => {
  const { r, g, b } = currentRgb.value
  return formatColor(r, g, b, alpha.value)
})
const currentOpaqueHex = computed(() => {
  const { r, g, b } = currentRgb.value
  return rgbToHex(r, g, b)
})

watch([currentOutput], ([output]) => {
  if (syncing) return
  textInput.value = output
  emit('update:modelValue', output)
})

const hueColor = computed(() => {
  const { r, g, b } = hsvToRgb(hue.value, 100, 100)
  return rgbToHex(r, g, b)
})

// ── SV area pointer handling ──────────────────────────
const svArea = ref<HTMLElement | null>(null)

function updateFromSV(ev: PointerEvent) {
  if (!svArea.value) return
  const rect = svArea.value.getBoundingClientRect()
  const x = Math.max(0, Math.min(1, (ev.clientX - rect.left) / rect.width))
  const y = Math.max(0, Math.min(1, (ev.clientY - rect.top) / rect.height))
  sat.value = x * 100
  val.value = (1 - y) * 100
}

function onSVDown(ev: PointerEvent) {
  (ev.target as HTMLElement).setPointerCapture?.(ev.pointerId)
  updateFromSV(ev)
  ev.preventDefault()
}

function onSVMove(ev: PointerEvent) {
  if (ev.buttons !== 1) return
  updateFromSV(ev)
}

// ── Hue slider pointer handling ───────────────────────
const hueSlider = ref<HTMLElement | null>(null)

function updateFromHue(ev: PointerEvent) {
  if (!hueSlider.value) return
  const rect = hueSlider.value.getBoundingClientRect()
  const x = Math.max(0, Math.min(1, (ev.clientX - rect.left) / rect.width))
  hue.value = x * 360
}

function onHueDown(ev: PointerEvent) {
  (ev.target as HTMLElement).setPointerCapture?.(ev.pointerId)
  updateFromHue(ev)
  ev.preventDefault()
}

function onHueMove(ev: PointerEvent) {
  if (ev.buttons !== 1) return
  updateFromHue(ev)
}

// ── Alpha slider pointer handling ─────────────────────
const alphaSlider = ref<HTMLElement | null>(null)

function updateFromAlpha(ev: PointerEvent) {
  if (!alphaSlider.value) return
  const rect = alphaSlider.value.getBoundingClientRect()
  const x = Math.max(0, Math.min(1, (ev.clientX - rect.left) / rect.width))
  alpha.value = x
}

function onAlphaDown(ev: PointerEvent) {
  (ev.target as HTMLElement).setPointerCapture?.(ev.pointerId)
  updateFromAlpha(ev)
  ev.preventDefault()
}

function onAlphaMove(ev: PointerEvent) {
  if (ev.buttons !== 1) return
  updateFromAlpha(ev)
}

// ── Text input ────────────────────────────────────────
function onTextInput(ev: Event) {
  const v = (ev.target as HTMLInputElement).value.trim()
  textInput.value = v
  if (parseCssColor(v)) {
    syncFromInput(v)
    emit('update:modelValue', currentOutput.value)
  }
}

// ── Keyboard cleanup ──────────────────────────────────
function onKeydown(ev: KeyboardEvent) {
  if (ev.key === 'Escape') emit('update:modelValue', props.modelValue)
}

onMounted(() => window.addEventListener('keydown', onKeydown))
onUnmounted(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <div class="custom-color-picker">
    <div class="palette-header">
      <span class="palette-title">Custom Color</span>
    </div>
    <div class="picker-body">
      <!-- Saturation × Value area -->
      <div
        ref="svArea"
        class="sv-area"
        :style="{ background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, ${hueColor})` }"
        @pointerdown="onSVDown"
        @pointermove="onSVMove"
      >
        <div
          class="sv-cursor"
          :style="{
            left: sat + '%',
            top: (100 - val) + '%',
            background: currentOpaqueHex,
          }"
        />
      </div>

      <!-- Hue slider -->
      <div class="slider-row">
        <div
          ref="hueSlider"
          class="hue-slider"
          @pointerdown="onHueDown"
          @pointermove="onHueMove"
        >
          <div class="slider-cursor" :style="{ left: (hue / 360 * 100) + '%' }" />
        </div>
      </div>

      <!-- Alpha slider -->
      <div class="slider-row">
        <div
          ref="alphaSlider"
          class="alpha-slider checker-bg"
          @pointerdown="onAlphaDown"
          @pointermove="onAlphaMove"
        >
          <div
            class="alpha-gradient"
            :style="{ background: `linear-gradient(to right, transparent, ${currentOpaqueHex})` }"
          />
          <div class="slider-cursor" :style="{ left: (alpha * 100) + '%' }" />
        </div>
      </div>

      <!-- Hex/rgba input + preview -->
      <div class="output-row">
        <div class="preview-swatch checker-bg">
          <div class="preview-fill" :style="{ background: currentOutput }" />
        </div>
        <input
          type="text"
          class="hex-input"
          :value="textInput"
          spellcheck="false"
          @input="onTextInput"
        />
      </div>
    </div>
  </div>
</template>

<style scoped>
.custom-color-picker {
  display: flex;
  flex-direction: column;
}

.palette-header {
  padding: 8px 12px;
  border-bottom: 1px solid var(--border);
}

.palette-title {
  font-size: 11px;
  font-weight: 600;
  color: var(--text);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.picker-body {
  padding: 10px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

/* Saturation × Value area */
.sv-area {
  position: relative;
  width: 100%;
  height: 160px;
  border-radius: 6px;
  cursor: crosshair;
  overflow: hidden;
  touch-action: none;
}

.sv-cursor {
  position: absolute;
  width: 12px;
  height: 12px;
  border: 2px solid white;
  border-radius: 50%;
  box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.4), 0 1px 3px rgba(0, 0, 0, 0.3);
  transform: translate(-50%, -50%);
  pointer-events: none;
}

/* Shared slider styling */
.slider-row {
  position: relative;
  width: 100%;
}

.hue-slider,
.alpha-slider {
  position: relative;
  width: 100%;
  height: 14px;
  border-radius: 7px;
  cursor: ew-resize;
  touch-action: none;
  overflow: hidden;
}

.hue-slider {
  background: linear-gradient(
    to right,
    #ff0000 0%,
    #ffff00 17%,
    #00ff00 33%,
    #00ffff 50%,
    #0000ff 67%,
    #ff00ff 83%,
    #ff0000 100%
  );
}

/* Checkerboard pattern for alpha/preview backgrounds */
.checker-bg {
  background-color: #fff;
  background-image:
    linear-gradient(45deg, #ccc 25%, transparent 25%),
    linear-gradient(-45deg, #ccc 25%, transparent 25%),
    linear-gradient(45deg, transparent 75%, #ccc 75%),
    linear-gradient(-45deg, transparent 75%, #ccc 75%);
  background-size: 8px 8px;
  background-position: 0 0, 0 4px, 4px -4px, -4px 0;
}

.alpha-gradient {
  position: absolute;
  inset: 0;
  pointer-events: none;
}

.slider-cursor {
  position: absolute;
  top: 50%;
  width: 14px;
  height: 14px;
  border: 2px solid white;
  border-radius: 50%;
  box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.4), 0 1px 3px rgba(0, 0, 0, 0.3);
  transform: translate(-50%, -50%);
  pointer-events: none;
  background: transparent;
}

/* Output */
.output-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.preview-swatch {
  position: relative;
  width: 28px;
  height: 28px;
  border-radius: 5px;
  border: 1px solid var(--border);
  flex-shrink: 0;
  overflow: hidden;
}

.preview-fill {
  position: absolute;
  inset: 0;
}

.hex-input {
  flex: 1;
  padding: 5px 8px;
  font-size: 12px;
  font-family: 'SF Mono', 'Fira Code', monospace;
  background: var(--bg);
  color: var(--text);
  border: 1px solid var(--border);
  border-radius: 5px;
  outline: none;
  text-transform: lowercase;
}

.hex-input:focus {
  border-color: var(--accent);
}
</style>
