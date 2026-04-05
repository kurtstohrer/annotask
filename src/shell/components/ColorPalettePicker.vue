<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, toRef } from 'vue'
import { useColorPalette, rgbToHex } from '../composables/useColorPalette'

const props = defineProps<{
  modelValue: string
  iframeDoc: Document | null
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()

const {
  tailwindCategories,
  cssVarCategory,
  recentColors,
  ensureScanned,
  addRecentColor,
} = useColorPalette(toRef(props, 'iframeDoc'))

const isOpen = ref(false)
const activeSource = ref<'tailwind' | 'css-var' | 'recent'>('tailwind')
const popoverRef = ref<HTMLElement | null>(null)
const triggerRef = ref<HTMLElement | null>(null)

function togglePopover() {
  isOpen.value = !isOpen.value
  if (isOpen.value) ensureScanned()
}

function selectColor(hex: string) {
  emit('update:modelValue', hex)
  addRecentColor(hex)
  isOpen.value = false
}

function onClickOutside(e: MouseEvent) {
  if (!isOpen.value) return
  const target = e.target as Node
  if (popoverRef.value?.contains(target) || triggerRef.value?.contains(target)) return
  isOpen.value = false
}

const currentMatch = computed(() => {
  const v = props.modelValue?.toLowerCase()
  if (!v) return null
  // Check if it matches a tailwind color
  for (const cat of tailwindCategories.value) {
    const match = cat.swatches.find(s => s.value.toLowerCase() === v)
    if (match) return match.label
  }
  // Check CSS vars
  const varMatch = cssVarCategory.value?.swatches.find(s => s.value.toLowerCase() === v)
  if (varMatch) return varMatch.label
  return null
})

onMounted(() => {
  document.addEventListener('mousedown', onClickOutside)
})
onUnmounted(() => {
  document.removeEventListener('mousedown', onClickOutside)
})
</script>

<template>
  <div class="color-palette-picker" ref="triggerRef">
    <div class="picker-trigger">
      <input
        type="color"
        :value="modelValue"
        class="color-swatch"
        @input="$emit('update:modelValue', ($event.target as HTMLInputElement).value)"
      />
      <button class="palette-btn" @click="togglePopover" :class="{ active: isOpen }" title="Color palette">
        <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
          <rect x="0" y="0" width="7" height="7" rx="1.5" />
          <rect x="9" y="0" width="7" height="7" rx="1.5" />
          <rect x="0" y="9" width="7" height="7" rx="1.5" />
          <rect x="9" y="9" width="7" height="7" rx="1.5" />
        </svg>
      </button>
      <span v-if="currentMatch" class="color-match">{{ currentMatch }}</span>
    </div>

    <div v-if="isOpen" class="palette-popover" ref="popoverRef">
      <div class="palette-tabs">
        <button :class="['ptab', { active: activeSource === 'tailwind' }]" @click="activeSource = 'tailwind'">Tailwind</button>
        <button :class="['ptab', { active: activeSource === 'css-var' }]" @click="activeSource = 'css-var'">App Vars</button>
        <button :class="['ptab', { active: activeSource === 'recent' }]" @click="activeSource = 'recent'">Recent</button>
      </div>

      <!-- Tailwind -->
      <div v-if="activeSource === 'tailwind'" class="palette-body">
        <div v-for="cat in tailwindCategories" :key="cat.name" class="color-family">
          <span class="family-label">{{ cat.name }}</span>
          <div class="swatch-row">
            <button
              v-for="swatch in cat.swatches"
              :key="swatch.value"
              class="swatch"
              :style="{ background: swatch.value }"
              :class="{ selected: swatch.value.toLowerCase() === modelValue?.toLowerCase() }"
              :title="swatch.label"
              @click="selectColor(swatch.value)"
            />
          </div>
        </div>
      </div>

      <!-- CSS Variables -->
      <div v-if="activeSource === 'css-var'" class="palette-body">
        <div v-if="cssVarCategory" class="var-grid">
          <button
            v-for="swatch in cssVarCategory.swatches"
            :key="swatch.label"
            class="var-swatch"
            :class="{ selected: swatch.value.toLowerCase() === modelValue?.toLowerCase() }"
            @click="selectColor(swatch.value)"
          >
            <span class="var-color" :style="{ background: swatch.value }" />
            <span class="var-name">{{ swatch.label }}</span>
            <span class="var-hex">{{ swatch.value }}</span>
          </button>
        </div>
        <p v-else class="empty-msg">No color variables detected</p>
      </div>

      <!-- Recent -->
      <div v-if="activeSource === 'recent'" class="palette-body">
        <div v-if="recentColors.length" class="swatch-grid">
          <button
            v-for="swatch in recentColors"
            :key="swatch.value"
            class="swatch large"
            :style="{ background: swatch.value }"
            :class="{ selected: swatch.value.toLowerCase() === modelValue?.toLowerCase() }"
            :title="swatch.value"
            @click="selectColor(swatch.value)"
          />
        </div>
        <p v-else class="empty-msg">No colors used yet</p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.color-palette-picker { position: relative; }

.picker-trigger { display: flex; align-items: center; gap: 6px; }

.color-swatch {
  width: 28px; height: 28px;
  border: 2px solid var(--border);
  border-radius: 6px;
  cursor: pointer;
  padding: 0;
  background: none;
}
.color-swatch::-webkit-color-swatch-wrapper { padding: 0; }
.color-swatch::-webkit-color-swatch { border: none; border-radius: 4px; }

.palette-btn {
  width: 24px; height: 24px;
  display: flex; align-items: center; justify-content: center;
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: 5px;
  color: var(--text-muted);
  cursor: pointer;
  transition: all 0.1s;
}
.palette-btn:hover, .palette-btn.active { background: var(--border); color: var(--text); }

.color-match {
  font-size: 9px;
  color: var(--accent);
  font-family: 'SF Mono', 'Fira Code', monospace;
}

/* Popover */
.palette-popover {
  position: absolute;
  top: 100%;
  left: 0;
  margin-top: 6px;
  width: 280px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 10px;
  box-shadow: 0 8px 24px var(--shadow);
  z-index: 200;
  overflow: hidden;
}

.palette-tabs {
  display: flex;
  border-bottom: 1px solid var(--border);
}
.ptab {
  flex: 1;
  padding: 6px 4px;
  font-size: 10px;
  font-weight: 500;
  background: none;
  border: none;
  border-bottom: 2px solid transparent;
  color: var(--text-muted);
  cursor: pointer;
  transition: all 0.15s;
}
.ptab:hover { color: var(--text); }
.ptab.active { color: var(--accent); border-bottom-color: var(--accent); }

.palette-body {
  max-height: 320px;
  overflow-y: auto;
  padding: 8px;
}

/* Tailwind grid */
.color-family {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 3px;
}
.family-label {
  font-size: 8px;
  color: var(--text-muted);
  width: 40px;
  flex-shrink: 0;
  text-align: right;
  text-transform: lowercase;
}
.swatch-row { display: flex; gap: 2px; }

.swatch {
  width: 18px; height: 18px;
  border: 1px solid var(--border);
  border-radius: 3px;
  cursor: pointer;
  padding: 0;
  transition: transform 0.1s;
}
.swatch:hover { transform: scale(1.25); z-index: 1; border-color: var(--text); }
.swatch.selected { outline: 2px solid var(--accent); outline-offset: 1px; }
.swatch.large { width: 24px; height: 24px; border-radius: 4px; }

/* CSS var list */
.var-grid { display: flex; flex-direction: column; gap: 2px; }
.var-swatch {
  display: flex; align-items: center; gap: 8px;
  padding: 5px 6px;
  background: none;
  border: 1px solid transparent;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.1s;
}
.var-swatch:hover { background: var(--surface-2); border-color: var(--border); }
.var-swatch.selected { border-color: var(--accent); }
.var-color { width: 18px; height: 18px; border-radius: 4px; flex-shrink: 0; border: 1px solid rgba(255,255,255,0.08); }
.var-name { font-size: 11px; color: var(--text); font-family: 'SF Mono', 'Fira Code', monospace; flex: 1; text-align: left; }
.var-hex { font-size: 9px; color: var(--text-muted); font-family: 'SF Mono', 'Fira Code', monospace; }

/* Recent grid */
.swatch-grid { display: flex; flex-wrap: wrap; gap: 4px; }

.empty-msg { font-size: 11px; color: var(--text-muted); text-align: center; padding: 20px 0; }
</style>
