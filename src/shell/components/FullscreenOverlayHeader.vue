<template>
  <div class="fullscreen-overlay-header">
    <span class="fullscreen-overlay-title">{{ title }}</span>
    <button class="fullscreen-overlay-close" @click="$emit('close')" title="Close (Esc)">Esc to close</button>
  </div>
</template>

<script setup lang="ts">
interface Props {
  title: string
}

interface Emits {
  (e: 'close'): void
}

defineProps<Props>()
defineEmits<Emits>()
</script>

<style scoped>
.fullscreen-overlay-header {
  display: flex;
  align-items: center;
  padding: 10px 16px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}

.fullscreen-overlay-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text);
}

.fullscreen-overlay-close {
  margin-left: auto;
  background: none;
  border: 1px solid var(--border);
  color: var(--text-muted);
  font-size: 11px;
  padding: 3px 10px;
  border-radius: 4px;
  cursor: pointer;
}

.fullscreen-overlay-close:hover {
  color: var(--text);
  background: var(--surface-2);
}
</style>
