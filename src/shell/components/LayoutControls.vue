<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  computedStyles: Record<string, string>
}>()

const emit = defineEmits<{
  change: [property: string, value: string]
}>()

const display = computed(() => props.computedStyles['display'] || 'block')
const flexDir = computed(() => props.computedStyles['flex-direction'] || 'row')
const alignItems = computed(() => props.computedStyles['align-items'] || 'stretch')
const justifyContent = computed(() => props.computedStyles['justify-content'] || 'flex-start')
const gap = computed(() => props.computedStyles['gap'] || '0px')

const displayOptions = ['block', 'flex', 'grid', 'inline-flex', 'inline', 'none']
const alignOptions = [
  { value: 'flex-start', icon: '⬆', label: 'Start' },
  { value: 'center', icon: '⬌', label: 'Center' },
  { value: 'flex-end', icon: '⬇', label: 'End' },
  { value: 'stretch', icon: '⇕', label: 'Stretch' },
]
const justifyOptions = [
  { value: 'flex-start', icon: '◧', label: 'Start' },
  { value: 'center', icon: '◫', label: 'Center' },
  { value: 'flex-end', icon: '◨', label: 'End' },
  { value: 'space-between', icon: '⟺', label: 'Between' },
  { value: 'space-around', icon: '⟷', label: 'Around' },
]

const isFlex = computed(() => display.value === 'flex' || display.value === 'inline-flex')

function parseNum(s: string): number {
  return parseFloat(s) || 0
}
</script>

<template>
  <div class="layout-controls">
    <!-- Display -->
    <div class="control-row">
      <label class="control-label">Display</label>
      <div class="button-group">
        <button
          v-for="opt in displayOptions"
          :key="opt"
          :class="['seg-btn', { active: display === opt }]"
          @click="emit('change', 'display', opt)"
        >{{ opt }}</button>
      </div>
    </div>

    <!-- Flex controls (only show when display is flex) -->
    <template v-if="isFlex">
      <div class="control-row">
        <label class="control-label">Direction</label>
        <div class="button-group">
          <button :class="['seg-btn icon-btn', { active: flexDir === 'row' }]" @click="emit('change', 'flex-direction', 'row')" title="Row">→</button>
          <button :class="['seg-btn icon-btn', { active: flexDir === 'row-reverse' }]" @click="emit('change', 'flex-direction', 'row-reverse')" title="Row Reverse">←</button>
          <button :class="['seg-btn icon-btn', { active: flexDir === 'column' }]" @click="emit('change', 'flex-direction', 'column')" title="Column">↓</button>
          <button :class="['seg-btn icon-btn', { active: flexDir === 'column-reverse' }]" @click="emit('change', 'flex-direction', 'column-reverse')" title="Column Reverse">↑</button>
        </div>
      </div>

      <div class="control-row">
        <label class="control-label">Align</label>
        <div class="button-group">
          <button
            v-for="opt in alignOptions"
            :key="opt.value"
            :class="['seg-btn', { active: alignItems === opt.value }]"
            :title="opt.label"
            @click="emit('change', 'align-items', opt.value)"
          >{{ opt.icon }}</button>
        </div>
      </div>

      <div class="control-row">
        <label class="control-label">Justify</label>
        <div class="button-group">
          <button
            v-for="opt in justifyOptions"
            :key="opt.value"
            :class="['seg-btn', { active: justifyContent === opt.value }]"
            :title="opt.label"
            @click="emit('change', 'justify-content', opt.value)"
          >{{ opt.icon }}</button>
        </div>
      </div>

      <div class="control-row">
        <label class="control-label">Gap</label>
        <div class="num-input-group">
          <input
            type="range"
            min="0" max="64" step="1"
            :value="parseNum(gap)"
            class="range-input"
            @input="emit('change', 'gap', ($event.target as HTMLInputElement).value + 'px')"
          />
          <span class="num-value">{{ parseNum(gap) }}px</span>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.control-row { margin-bottom: 10px; }
.control-label { display: block; font-size: 11px; color: var(--text-muted); margin-bottom: 4px; text-transform: uppercase; letter-spacing: 0.04em; }
.button-group { display: flex; gap: 2px; }
.seg-btn {
  flex: 1;
  padding: 4px 6px;
  font-size: 10px;
  background: var(--bg);
  border: 1px solid var(--border);
  color: var(--text-muted);
  cursor: pointer;
  transition: all 0.1s;
  white-space: nowrap;
}
.seg-btn:first-child { border-radius: 5px 0 0 5px; }
.seg-btn:last-child { border-radius: 0 5px 5px 0; }
.seg-btn:hover { background: var(--surface-2); color: var(--text); }
.seg-btn.active { background: var(--accent); border-color: var(--accent); color: var(--text-on-accent); }
.icon-btn { font-size: 14px; padding: 4px 8px; }
.num-input-group { display: flex; align-items: center; gap: 8px; }
.range-input { flex: 1; accent-color: var(--accent); height: 4px; }
.num-value { font-size: 11px; color: var(--text); font-variant-numeric: tabular-nums; min-width: 36px; text-align: right; }
</style>
