<script setup lang="ts">
import type { InteractionMode } from '../composables/useInteractionMode'
import Icon from './Icon.vue'

defineProps<{ modelValue: InteractionMode }>()
const emit = defineEmits<{ 'update:modelValue': [mode: InteractionMode] }>()
</script>

<template>
  <div class="mode-toolbar">
    <button data-testid="tool-interact" :class="['mode-btn mode-interact', { active: modelValue === 'interact' }]" @click="emit('update:modelValue', 'interact')" title="Interact (I)">
      <Icon name="mouse-pointer" :stroke-width="2.5" />
    </button>
    <span class="mode-sep" />
    <button data-testid="tool-select" :class="['mode-btn mode-select', { active: modelValue === 'select' }]" @click="emit('update:modelValue', 'select')" title="Select (V)">
      <Icon name="wand" />
    </button>
    <button data-testid="tool-pin" :class="['mode-btn mode-pin', { active: modelValue === 'pin' }]" @click="emit('update:modelValue', 'pin')" title="Pin Note (P)">
      <Icon name="map-pin" />
    </button>
    <button data-testid="tool-arrow" :class="['mode-btn arrow', { active: modelValue === 'arrow' }]" @click="emit('update:modelValue', 'arrow')" title="Arrow (A)">
      <Icon name="arrow-right" :stroke-width="2.5" />
    </button>
    <button data-testid="tool-draw" :class="['mode-btn draw', { active: modelValue === 'draw' }]" @click="emit('update:modelValue', 'draw')" title="Draw Section (D)">
      <Icon name="square-plus" />
    </button>
    <button data-testid="tool-highlight" :class="['mode-btn mode-highlight', { active: modelValue === 'highlight' }]" @click="emit('update:modelValue', 'highlight')" title="Highlight Text (H)">
      <Icon name="highlighter" />
    </button>
  </div>
</template>

<style scoped>
.mode-toolbar { display: flex; gap: 2px; margin-left: 4px; align-items: center; }

.mode-btn {
  width: 28px; height: 28px;
  display: flex; align-items: center; justify-content: center;
  border: 1px solid var(--border);
  border-radius: 5px;
  background: var(--surface-2);
  color: var(--text-muted);
  cursor: pointer;
  transition: all 0.1s;
}
.mode-btn:hover { background: var(--border); color: var(--text); }
.mode-btn.active { background: var(--accent); border-color: var(--accent); color: var(--text-on-accent); }
.mode-btn.mode-pin.active { background: var(--pin-color); border-color: var(--pin-color); color: white; }
.mode-btn.arrow.active { background: var(--mode-arrow); border-color: var(--mode-arrow); }
.mode-btn.draw.active { background: var(--mode-draw); border-color: var(--mode-draw); }
.mode-btn.mode-highlight.active { background: var(--mode-highlight); border-color: var(--mode-highlight); }
.mode-sep { width: 1px; height: 18px; background: var(--border); margin: 0 2px; align-self: center; }
</style>
