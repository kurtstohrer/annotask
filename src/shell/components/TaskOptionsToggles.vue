<template>
  <div class="task-toggles">
    <label class="history-toggle">
      <input type="checkbox" :checked="includeHistory" @change="$emit('update:includeHistory', ($event.target as HTMLInputElement).checked)" />
      <span>Include interaction history</span>
    </label>
    <label class="history-toggle">
      <input type="checkbox" :checked="includeElementContext" @change="$emit('update:includeElementContext', ($event.target as HTMLInputElement).checked)" />
      <span>Include DOM context</span>
    </label>
  </div>
</template>

<script setup lang="ts">
interface Props {
  includeHistory: boolean
  includeElementContext: boolean
}

interface Emits {
  (e: 'update:includeHistory', value: boolean): void
  (e: 'update:includeElementContext', value: boolean): void
}

defineProps<Props>()
defineEmits<Emits>()
</script>

<style scoped>
.task-toggles {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-bottom: 4px;
}

.history-toggle {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 10px;
  color: var(--text-muted);
  cursor: pointer;
  white-space: nowrap;
}

.history-toggle input {
  margin: 0;
}

.history-toggle span {
  user-select: none;
}
</style>
