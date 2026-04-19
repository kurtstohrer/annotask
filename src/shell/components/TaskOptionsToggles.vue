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
    <label v-if="dataContextProbe?.hasData" class="history-toggle">
      <input type="checkbox" :checked="includeDataContext" @change="$emit('update:includeDataContext', ($event.target as HTMLInputElement).checked)" />
      <span>Include data context{{ dataContextLabel }}</span>
    </label>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { DataContextProbeResult } from '../services/dataContextClient'

interface Props {
  includeHistory: boolean
  includeElementContext: boolean
  includeDataContext: boolean
  dataContextProbe: DataContextProbeResult | null
}

interface Emits {
  (e: 'update:includeHistory', value: boolean): void
  (e: 'update:includeElementContext', value: boolean): void
  (e: 'update:includeDataContext', value: boolean): void
}

const props = defineProps<Props>()
defineEmits<Emits>()

const dataContextLabel = computed(() => {
  const p = props.dataContextProbe
  if (!p?.hasData || !p.primaryName) return ''
  return ` (${p.primaryName})`
})
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
