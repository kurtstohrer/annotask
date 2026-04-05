<script setup lang="ts">
import type { InteractionMode } from '../composables/useInteractionMode'

defineProps<{ modelValue: InteractionMode }>()
const emit = defineEmits<{ 'update:modelValue': [mode: InteractionMode] }>()
</script>

<template>
  <div class="mode-toolbar">
    <button :class="['mode-btn mode-interact', { active: modelValue === 'interact' }]" @click="emit('update:modelValue', 'interact')" title="Interact (I)">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M4 4l7.07 17 2.51-7.39L21 11.07z"/></svg>
    </button>
    <span class="mode-sep" />
    <button :class="['mode-btn mode-select', { active: modelValue === 'select' }]" @click="emit('update:modelValue', 'select')" title="Select (V)">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 11V4a2 2 0 1 1 4 0v5"/><path d="M11 9a2 2 0 1 1 4 0v2"/><path d="M15 11a2 2 0 1 1 4 0v4a8 8 0 0 1-8 8 7 7 0 0 1-5-2l-3.3-3.3a2 2 0 0 1 2.8-2.8L7 16"/></svg>
    </button>
    <button :class="['mode-btn mode-pin', { active: modelValue === 'pin' }]" @click="emit('update:modelValue', 'pin')" title="Pin Note (P)">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="10" r="3"/><path d="M12 21.7C17.3 17 20 13 20 10a8 8 0 1 0-16 0c0 3 2.7 7 8 11.7z"/></svg>
    </button>
    <button :class="['mode-btn arrow', { active: modelValue === 'arrow' }]" @click="emit('update:modelValue', 'arrow')" title="Arrow (A)">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
    </button>
    <button :class="['mode-btn draw', { active: modelValue === 'draw' }]" @click="emit('update:modelValue', 'draw')" title="Draw Section (D)">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" stroke-dasharray="4 2"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>
    </button>
    <button :class="['mode-btn mode-highlight', { active: modelValue === 'highlight' }]" @click="emit('update:modelValue', 'highlight')" title="Highlight Text (H)">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
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
