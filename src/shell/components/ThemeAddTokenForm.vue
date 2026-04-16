<script setup lang="ts">
import { ref, watch } from 'vue'

const props = defineProps<{
  /** Show the form (controlled by parent). */
  active: boolean
  /** Placeholder hints for each input — tuned to the specific category. */
  rolePlaceholder: string
  valuePlaceholder: string
  cssVarPlaceholder?: string
}>()

const emit = defineEmits<{
  cancel: []
  add: [token: { role: string; value: string; cssVar?: string }]
}>()

const role = ref('')
const value = ref('')
const cssVar = ref('')

function reset() {
  role.value = ''
  value.value = ''
  cssVar.value = ''
}

function confirm() {
  const r = role.value.trim()
  const v = value.value.trim()
  if (!r || !v) return
  emit('add', { role: r, value: v, cssVar: cssVar.value.trim() || undefined })
  reset()
}

// Clear the form whenever the parent flips `active` off (e.g. after cancel or successful add).
watch(() => props.active, (a) => { if (!a) reset() })
</script>

<template>
  <div v-if="active" class="add-token-form">
    <input v-model="role" class="add-input" :placeholder="rolePlaceholder" />
    <input v-model="value" class="add-input" :placeholder="valuePlaceholder" />
    <input v-model="cssVar" class="add-input" :placeholder="cssVarPlaceholder ?? 'CSS var (optional)'" />
    <div class="add-actions">
      <button class="theme-btn commit small" @click="confirm" :disabled="!role.trim() || !value.trim()">Add</button>
      <button class="theme-btn discard small" @click="emit('cancel')">Cancel</button>
    </div>
  </div>
</template>

<style scoped>
.add-token-form { display: flex; flex-direction: column; gap: 4px; padding: 8px; background: var(--surface-2); border-radius: 4px; }
.add-input {
  padding: 4px 6px; font-size: 11px; background: var(--surface); color: var(--text);
  border: 1px solid var(--border); border-radius: 3px; font-family: inherit;
}
.add-input:focus { outline: none; border-color: var(--accent); }
.add-actions { display: flex; gap: 4px; justify-content: flex-end; }
.theme-btn {
  padding: 3px 10px; font-size: 10px; font-weight: 600;
  border: 1px solid var(--border); border-radius: 4px; cursor: pointer;
}
.theme-btn.small { padding: 2px 8px; font-size: 9px; }
.theme-btn.commit { background: var(--accent); color: var(--text-on-accent); border-color: var(--accent); }
.theme-btn.commit:hover:not(:disabled) { opacity: 0.9; }
.theme-btn.commit:disabled { opacity: 0.5; cursor: default; }
.theme-btn.discard { background: var(--surface); color: var(--text); }
.theme-btn.discard:hover { background: var(--border); }
</style>
