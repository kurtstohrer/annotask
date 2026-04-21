<script lang="ts">
import { ref } from 'vue'

type OpenPanel = 'none' | 'tokens' | 'custom'

// Module-level shared state: only one picker popover is open at a time
// across all instances.
const sharedActivePicker = ref<{ id: symbol; panel: OpenPanel } | null>(null)
</script>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, nextTick, watch } from 'vue'
import { useColorPalette, type ColorSwatch } from '../composables/useColorPalette'
import { useDesignSpec } from '../composables/useDesignSpec'
import CustomColorPicker from './CustomColorPicker.vue'
import Icon from './Icon.vue'

const props = withDefaults(defineProps<{
  modelValue: string
  /** Whether to show the design-tokens palette button. Default true. */
  showTokens?: boolean
}>(), { showTokens: true })

const emit = defineEmits<{
  'update:modelValue': [value: string]
  /** Emitted when user picks a design token. Receives the token role (e.g. 'primary'). */
  'token-select': [role: string, value: string]
}>()

// User-selected theme variant for the palette. null = follow the iframe's
// active variant. Each picker instance has its own local override so one
// open popover doesn't change sibling pickers.
const themeOverride = ref<string | null>(null)
const { tokenCategory, activeThemeId } = useColorPalette(themeOverride)
const { designSpec } = useDesignSpec()
const paletteThemes = computed(() => {
  const themes = designSpec.value?.themes
  return Array.isArray(themes) ? themes : []
})
const showVariantTabs = computed(() => paletteThemes.value.length > 1)
function selectVariant(id: string) {
  themeOverride.value = themeOverride.value === id ? null : id
}

const instanceId = Symbol('picker')

const openPanel = computed<OpenPanel>(() =>
  sharedActivePicker.value?.id === instanceId ? sharedActivePicker.value.panel : 'none'
)

const popoverRef = ref<HTMLElement | null>(null)
const triggerRef = ref<HTMLElement | null>(null)

// Popover placement offsets (px). Adjusted after opening to keep it on-screen.
const popoverTop = ref(0)
const popoverLeft = ref(0)

function setPanel(panel: OpenPanel) {
  sharedActivePicker.value = panel === 'none' ? null : { id: instanceId, panel }
}

function toggleTokens() {
  setPanel(openPanel.value === 'tokens' ? 'none' : 'tokens')
}

function toggleCustom() {
  setPanel(openPanel.value === 'custom' ? 'none' : 'custom')
}

function selectToken(swatch: ColorSwatch) {
  emit('update:modelValue', swatch.value)
  if (swatch.role) emit('token-select', swatch.role, swatch.value)
  setPanel('none')
}

function onCustomChange(hex: string) {
  emit('update:modelValue', hex)
}

function onClickOutside(e: MouseEvent) {
  if (openPanel.value === 'none') return
  const target = e.target as Node
  if (popoverRef.value?.contains(target) || triggerRef.value?.contains(target)) return
  setPanel('none')
}

/** After the popover is rendered, measure it and flip/clamp so it stays in the viewport. */
async function positionPopover() {
  if (openPanel.value === 'none') return
  await nextTick()
  const trigger = triggerRef.value
  const pop = popoverRef.value
  if (!trigger || !pop) return

  const triggerRect = trigger.getBoundingClientRect()
  const popRect = pop.getBoundingClientRect()
  const vw = window.innerWidth
  const vh = window.innerHeight
  const margin = 8

  // Default: below + left-aligned to trigger.
  let top = triggerRect.height + 6 // 6px gap
  let left = 0

  // If popover bottom would overflow, flip above the trigger.
  const popBottom = triggerRect.bottom + 6 + popRect.height
  if (popBottom > vh - margin) {
    const above = -popRect.height - 6
    // Only flip if there's more room above than the overflow below
    const overflowBelow = popBottom - (vh - margin)
    const overflowAbove = -(triggerRect.top - margin - popRect.height - 6)
    if (overflowAbove <= 0 || overflowAbove < overflowBelow) {
      top = above
    }
  }

  // Clamp horizontally — shift left if overflows right edge.
  const popRight = triggerRect.left + popRect.width
  if (popRight > vw - margin) {
    left = (vw - margin) - popRight
  }
  // Shift right if overflows left edge.
  if (triggerRect.left + left < margin) {
    left = margin - triggerRect.left
  }

  popoverTop.value = top
  popoverLeft.value = left
}

// Re-position whenever the panel opens or on resize while open.
watch(openPanel, (v) => { if (v !== 'none') positionPopover() })

function onResize() { if (openPanel.value !== 'none') positionPopover() }

const currentMatch = computed(() => {
  const v = props.modelValue?.toLowerCase()
  if (!v) return null
  const match = tokenCategory.value?.swatches.find((s) => s.value.toLowerCase() === v)
  return match?.label ?? null
})

onMounted(() => {
  document.addEventListener('mousedown', onClickOutside)
  window.addEventListener('resize', onResize)
  window.addEventListener('scroll', onResize, true)
})
onUnmounted(() => {
  document.removeEventListener('mousedown', onClickOutside)
  window.removeEventListener('resize', onResize)
  window.removeEventListener('scroll', onResize, true)
  // Close our panel if we're the active picker
  if (sharedActivePicker.value?.id === instanceId) sharedActivePicker.value = null
})
</script>

<template>
  <div class="color-palette-picker" ref="triggerRef">
    <div class="picker-trigger">
      <!-- Swatch button opens custom color picker -->
      <button
        class="color-swatch"
        :style="{ background: modelValue }"
        @click="toggleCustom"
        :class="{ active: openPanel === 'custom' }"
        title="Custom color"
      />
      <!-- Palette button opens token popover (hidden when showTokens=false) -->
      <button
        v-if="showTokens"
        class="palette-btn"
        @click="toggleTokens"
        :class="{ active: openPanel === 'tokens' }"
        title="Design tokens"
      >
        <Icon name="grid-2x2" :size="12" />
      </button>
      <span v-if="currentMatch && showTokens" class="color-match">{{ currentMatch }}</span>
    </div>

    <div
      v-if="openPanel !== 'none'"
      class="palette-popover"
      ref="popoverRef"
      :style="{ top: popoverTop + 'px', left: popoverLeft + 'px' }"
    >
      <!-- Design Tokens panel -->
      <template v-if="openPanel === 'tokens'">
        <div class="palette-header">
          <span class="palette-title">Design Tokens</span>
        </div>
        <div v-if="showVariantTabs" class="palette-variant-bar">
          <button
            v-for="t in paletteThemes"
            :key="t.id"
            :class="['palette-variant-tab', { active: t.id === activeThemeId }]"
            @click="selectVariant(t.id)"
            :title="t.id === activeThemeId ? 'Showing ' + t.name + ' values' : 'Show ' + t.name + ' values'"
          >{{ t.name }}</button>
        </div>
        <div class="palette-body">
          <div v-if="tokenCategory" class="var-grid">
            <button
              v-for="swatch in tokenCategory.swatches"
              :key="swatch.label"
              class="var-swatch"
              :class="{ selected: swatch.value.toLowerCase() === modelValue?.toLowerCase() }"
              @click="selectToken(swatch)"
            >
              <span class="var-color" :style="{ background: swatch.value }" />
              <span class="var-name">{{ swatch.label }}</span>
              <span class="var-hex">{{ swatch.value }}</span>
            </button>
          </div>
          <p v-else class="empty-msg">
            No design tokens available. Run <code>/annotask-init</code> to set up your project.
          </p>
        </div>
      </template>

      <!-- Custom color picker panel -->
      <CustomColorPicker
        v-else-if="openPanel === 'custom'"
        :modelValue="modelValue"
        @update:modelValue="onCustomChange"
      />
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
  transition: border-color 0.1s, box-shadow 0.1s;
}
.color-swatch:hover, .color-swatch.active {
  border-color: var(--accent);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 20%, transparent);
}

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

/* Shared popover container — position dynamically set by JS to stay on-screen */
.palette-popover {
  position: absolute;
  width: 280px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 10px;
  box-shadow: 0 8px 24px var(--shadow);
  z-index: 200;
  overflow: hidden;
}

.palette-header {
  padding: 8px 12px;
  border-bottom: 1px solid var(--border);
}

.palette-variant-bar {
  display: flex;
  gap: 2px;
  padding: 6px 8px;
  border-bottom: 1px solid var(--border);
  background: var(--surface-2);
}
.palette-variant-tab {
  flex: 1;
  padding: 4px 8px;
  background: none;
  border: 1px solid transparent;
  border-radius: 5px;
  font-size: 10px;
  font-weight: 600;
  color: var(--text-muted);
  cursor: pointer;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  transition: all 0.1s;
}
.palette-variant-tab:hover { background: var(--surface); color: var(--text); }
.palette-variant-tab.active {
  background: var(--surface);
  border-color: var(--accent);
  color: var(--text);
}
.palette-title {
  font-size: 11px;
  font-weight: 600;
  color: var(--text);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.palette-body {
  max-height: 320px;
  overflow-y: auto;
  padding: 8px;
}

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

.empty-msg { font-size: 11px; color: var(--text-muted); text-align: center; padding: 20px 0; }
.empty-msg code { font-size: 10px; background: var(--surface-2); padding: 1px 4px; border-radius: 3px; color: var(--accent); }
</style>
