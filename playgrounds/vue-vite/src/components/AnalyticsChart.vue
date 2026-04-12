<script setup lang="ts">
import { computed } from 'vue'
import type { AnalyticsBucket } from '../types'

const props = defineProps<{
  buckets: AnalyticsBucket[]
  metric: 'users' | 'sessions' | 'tasks'
}>()

const max = computed(() => Math.max(...props.buckets.map((b) => b[props.metric]), 0))

function pct(v: number) {
  return max.value > 0 ? (v / max.value) * 100 : 0
}
</script>

<template>
  <div class="chart">
    <div v-for="b in buckets" :key="b.day" class="bar-col">
      <div class="bar-track">
        <div class="bar" :style="{ height: pct(b[metric]) + '%' }">
          <span class="bar-value">{{ b[metric].toLocaleString() }}</span>
        </div>
      </div>
      <span class="bar-label">{{ b.day }}</span>
    </div>
  </div>
</template>

<style scoped>
.chart {
  display: flex;
  align-items: flex-end;
  gap: 12px;
  height: 240px;
  padding: 16px 0;
}

.bar-col {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  height: 100%;
}

.bar-track {
  flex: 1;
  width: 100%;
  display: flex;
  align-items: flex-end;
  justify-content: center;
}

.bar {
  width: 100%;
  max-width: 56px;
  background: linear-gradient(180deg, var(--accent), #6366f1);
  border-radius: 6px 6px 0 0;
  position: relative;
  transition: height 0.4s ease;
  min-height: 4px;
}

.bar-value {
  position: absolute;
  top: -22px;
  left: 50%;
  transform: translateX(-50%);
  font-size: 11px;
  font-weight: 600;
  color: var(--text);
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}

.bar-label {
  font-size: 12px;
  color: var(--text-muted);
  font-weight: 500;
}
</style>
