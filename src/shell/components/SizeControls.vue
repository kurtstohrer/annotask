<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  computedStyles: Record<string, string>
}>()

const emit = defineEmits<{
  change: [property: string, value: string]
}>()

function parse(s: string): number { return parseFloat(s) || 0 }

const width = computed(() => props.computedStyles['width'] || 'auto')
const height = computed(() => props.computedStyles['height'] || 'auto')
const overflow = computed(() => props.computedStyles['overflow'] || 'visible')

const overflowOptions = ['visible', 'hidden', 'scroll', 'auto']
</script>

<template>
  <div class="size-controls">
    <div class="size-row">
      <div class="size-field">
        <label class="control-label">Width</label>
        <div class="size-input-group">
          <input
            class="size-input"
            :value="parse(width)"
            type="number"
            @change="emit('change', 'width', ($event.target as HTMLInputElement).value + 'px')"
          />
          <span class="size-unit">px</span>
        </div>
      </div>
      <div class="size-field">
        <label class="control-label">Height</label>
        <div class="size-input-group">
          <input
            class="size-input"
            :value="parse(height)"
            type="number"
            @change="emit('change', 'height', ($event.target as HTMLInputElement).value + 'px')"
          />
          <span class="size-unit">px</span>
        </div>
      </div>
    </div>

    <div class="control-row">
      <label class="control-label">Overflow</label>
      <div class="button-group">
        <button
          v-for="opt in overflowOptions"
          :key="opt"
          :class="['seg-btn', { active: overflow === opt }]"
          @click="emit('change', 'overflow', opt)"
        >{{ opt }}</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.size-row { display: flex; gap: 8px; margin-bottom: 10px; }
.size-field { flex: 1; }
.control-row { margin-bottom: 10px; }
.control-label { display: block; font-size: 11px; color: var(--text-muted); margin-bottom: 4px; text-transform: uppercase; letter-spacing: 0.04em; }
.size-input-group { display: flex; align-items: center; }
.size-input {
  width: 100%;
  padding: 5px 6px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 5px 0 0 5px;
  color: var(--text);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  outline: none;
}
.size-input:focus { border-color: var(--accent); }
.size-unit {
  padding: 5px 6px;
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-left: none;
  border-radius: 0 5px 5px 0;
  font-size: 10px;
  color: var(--text-muted);
}
.button-group { display: flex; gap: 2px; }
.seg-btn {
  flex: 1; padding: 4px 4px; font-size: 10px;
  background: var(--bg); border: 1px solid var(--border); color: var(--text-muted); cursor: pointer;
}
.seg-btn:first-child { border-radius: 5px 0 0 5px; }
.seg-btn:last-child { border-radius: 0 5px 5px 0; }
.seg-btn:hover { background: var(--surface-2); color: var(--text); }
.seg-btn.active { background: var(--accent); border-color: var(--accent); color: white; }
</style>
