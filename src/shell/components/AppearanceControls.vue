<script setup lang="ts">
import { computed } from 'vue'
import ColorPalettePicker from './ColorPalettePicker.vue'
import { rgbToHex } from '../composables/useColorPalette'

const props = defineProps<{
  computedStyles: Record<string, string>
}>()

const emit = defineEmits<{
  change: [property: string, value: string, tokenRole?: string]
}>()

function parse(s: string): number { return parseFloat(s) || 0 }

const bgColor = computed(() => props.computedStyles['background-color'] || 'rgba(0,0,0,0)')
const textColor = computed(() => props.computedStyles['color'] || '#000')
const fontSize = computed(() => parse(props.computedStyles['font-size'] || '16'))
const fontWeight = computed(() => props.computedStyles['font-weight'] || '400')
const borderRadius = computed(() => parse(props.computedStyles['border-radius'] || '0'))
const opacity = computed(() => parse(props.computedStyles['opacity'] || '1'))

const weightOptions = ['100', '300', '400', '500', '600', '700', '900']
</script>

<template>
  <div class="appearance-controls">
    <!-- Colors -->
    <div class="control-row">
      <label class="control-label">Background</label>
      <div class="color-input-group">
        <ColorPalettePicker
          :modelValue="rgbToHex(bgColor)"
          @update:modelValue="emit('change', 'background-color', $event)"
          @token-select="(role, value) => emit('change', 'background-color', value, role)"
        />
        <span class="color-value">{{ bgColor }}</span>
      </div>
    </div>

    <div class="control-row">
      <label class="control-label">Text Color</label>
      <div class="color-input-group">
        <ColorPalettePicker
          :modelValue="rgbToHex(textColor)"
          @update:modelValue="emit('change', 'color', $event)"
          @token-select="(role, value) => emit('change', 'color', value, role)"
        />
        <span class="color-value">{{ textColor }}</span>
      </div>
    </div>

    <!-- Typography -->
    <div class="control-row">
      <label class="control-label">Font Size</label>
      <div class="num-input-group">
        <input
          type="range"
          min="8" max="72" step="1"
          :value="fontSize"
          class="range-input"
          @input="emit('change', 'font-size', ($event.target as HTMLInputElement).value + 'px')"
        />
        <span class="num-value">{{ fontSize }}px</span>
      </div>
    </div>

    <div class="control-row">
      <label class="control-label">Font Weight</label>
      <div class="button-group">
        <button
          v-for="w in weightOptions"
          :key="w"
          :class="['seg-btn', { active: fontWeight === w }]"
          @click="emit('change', 'font-weight', w)"
        >{{ w }}</button>
      </div>
    </div>

    <!-- Border Radius -->
    <div class="control-row">
      <label class="control-label">Border Radius</label>
      <div class="num-input-group">
        <input
          type="range"
          min="0" max="50" step="1"
          :value="borderRadius"
          class="range-input"
          @input="emit('change', 'border-radius', ($event.target as HTMLInputElement).value + 'px')"
        />
        <span class="num-value">{{ borderRadius }}px</span>
      </div>
    </div>

    <!-- Opacity -->
    <div class="control-row">
      <label class="control-label">Opacity</label>
      <div class="num-input-group">
        <input
          type="range"
          min="0" max="1" step="0.05"
          :value="opacity"
          class="range-input"
          @input="emit('change', 'opacity', ($event.target as HTMLInputElement).value)"
        />
        <span class="num-value">{{ (opacity * 100).toFixed(0) }}%</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.control-row { margin-bottom: 10px; }
.control-label { display: block; font-size: 11px; color: var(--text-muted); margin-bottom: 4px; text-transform: uppercase; letter-spacing: 0.04em; }
.color-input-group { display: flex; align-items: center; gap: 8px; }
.color-value { font-size: 10px; color: var(--text-muted); font-family: 'SF Mono', 'Fira Code', monospace; overflow: hidden; text-overflow: ellipsis; }
.num-input-group { display: flex; align-items: center; gap: 8px; }
.range-input { flex: 1; accent-color: var(--accent); height: 4px; }
.num-value { font-size: 11px; color: var(--text); font-variant-numeric: tabular-nums; min-width: 36px; text-align: right; }
.button-group { display: flex; gap: 1px; }
.seg-btn {
  flex: 1;
  padding: 4px 2px;
  font-size: 9px;
  background: var(--bg);
  border: 1px solid var(--border);
  color: var(--text-muted);
  cursor: pointer;
  transition: all 0.1s;
}
.seg-btn:first-child { border-radius: 5px 0 0 5px; }
.seg-btn:last-child { border-radius: 0 5px 5px 0; }
.seg-btn:hover { background: var(--surface-2); color: var(--text); }
.seg-btn.active { background: var(--accent); border-color: var(--accent); color: var(--text-on-accent); }
</style>
