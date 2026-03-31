import { ref, computed, watch } from 'vue'

export interface ViewportPreset {
  id: string
  label: string
  width: number
  height: number
  category: 'phone' | 'tablet' | 'desktop'
}

export const VIEWPORT_PRESETS: ViewportPreset[] = [
  { id: 'iphone-se', label: 'iPhone SE', width: 375, height: 667, category: 'phone' },
  { id: 'iphone-14-pro', label: 'iPhone 14 Pro', width: 393, height: 852, category: 'phone' },
  { id: 'iphone-16-pro-max', label: 'iPhone 16 Pro Max', width: 440, height: 956, category: 'phone' },
  { id: 'pixel-7', label: 'Pixel 7', width: 412, height: 915, category: 'phone' },
  { id: 'ipad', label: 'iPad', width: 768, height: 1024, category: 'tablet' },
  { id: 'ipad-pro', label: 'iPad Pro 12.9"', width: 1024, height: 1366, category: 'tablet' },
  { id: 'laptop', label: 'Laptop', width: 1366, height: 768, category: 'desktop' },
  { id: 'desktop', label: 'Desktop', width: 1440, height: 900, category: 'desktop' },
  { id: 'desktop-xl', label: 'Desktop XL', width: 1920, height: 1080, category: 'desktop' },
]

export interface EffectiveViewport {
  width: number | null
  height: number | null
  label: string
}

// Singleton state
const activePresetId = ref<string | null>(null)
const customWidth = ref<number | null>(null)
const customHeight = ref<number | null>(null)
const rotated = ref(false)

// Restore from localStorage
try {
  const stored = localStorage.getItem('annotask:viewport')
  if (stored) {
    const parsed = JSON.parse(stored)
    activePresetId.value = parsed.presetId ?? null
    customWidth.value = parsed.customWidth ?? null
    customHeight.value = parsed.customHeight ?? null
    rotated.value = parsed.rotated ?? false
  }
} catch {}

function persist() {
  localStorage.setItem('annotask:viewport', JSON.stringify({
    presetId: activePresetId.value,
    customWidth: customWidth.value,
    customHeight: customHeight.value,
    rotated: rotated.value,
  }))
}

watch([activePresetId, customWidth, customHeight, rotated], persist)

export function useViewportPreview() {
  const activePreset = computed(() =>
    activePresetId.value ? VIEWPORT_PRESETS.find(p => p.id === activePresetId.value) ?? null : null
  )

  const isFullWidth = computed(() => !activePresetId.value && !customWidth.value && !customHeight.value)

  const effectiveViewport = computed<EffectiveViewport>(() => {
    const preset = activePreset.value
    if (preset) {
      const w = rotated.value ? preset.height : preset.width
      const h = rotated.value ? preset.width : preset.height
      return { width: w, height: h, label: preset.label }
    }
    if (customWidth.value || customHeight.value) {
      return { width: customWidth.value, height: customHeight.value, label: 'Custom' }
    }
    return { width: null, height: null, label: 'Full Width' }
  })

  function selectPreset(preset: ViewportPreset | null) {
    activePresetId.value = preset?.id ?? null
    customWidth.value = null
    customHeight.value = null
    rotated.value = false
  }

  function setCustomDimensions(w: number | null, h: number | null) {
    activePresetId.value = null
    customWidth.value = w
    customHeight.value = h
    rotated.value = false
  }

  function toggleRotate() {
    rotated.value = !rotated.value
  }

  return {
    activePreset,
    activePresetId,
    customWidth,
    customHeight,
    rotated,
    effectiveViewport,
    isFullWidth,
    selectPreset,
    setCustomDimensions,
    toggleRotate,
    VIEWPORT_PRESETS,
  }
}
