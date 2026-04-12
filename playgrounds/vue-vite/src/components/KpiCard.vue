<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  label: string
  value: string | number
  changePct: number
  trend: number[]
  format?: 'number' | 'currency' | 'percent' | 'ms'
}>()

const formattedValue = computed(() => {
  const v = typeof props.value === 'string' ? Number(props.value) : props.value
  switch (props.format) {
    case 'currency':
      return `$${v.toLocaleString()}`
    case 'percent':
      return `${v}%`
    case 'ms':
      return `${v} ms`
    default:
      return v.toLocaleString()
  }
})

const isPositive = computed(() => props.changePct >= 0)

// Sparkline path
const sparklinePath = computed(() => {
  const trend = props.trend
  if (trend.length === 0) return ''
  const max = Math.max(...trend)
  const min = Math.min(...trend)
  const range = max - min || 1
  const w = 100
  const h = 24
  return trend
    .map((v, i) => {
      const x = (i / (trend.length - 1)) * w
      const y = h - ((v - min) / range) * h
      return `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`
    })
    .join(' ')
})
</script>

<template>
  <div class="kpi-card">
    <div class="kpi-header">
      <span class="kpi-label">{{ label }}</span>
      <span class="kpi-change" :class="{ positive: isPositive, negative: !isPositive }">
        {{ isPositive ? '↑' : '↓' }} {{ Math.abs(changePct).toFixed(1) }}%
      </span>
    </div>
    <div class="kpi-value">{{ formattedValue }}</div>
    <svg class="kpi-sparkline" viewBox="0 0 100 24" preserveAspectRatio="none">
      <path :d="sparklinePath" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
    </svg>
  </div>
</template>

<style scoped>
.kpi-card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 18px 20px;
}

.kpi-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}

.kpi-label {
  font-size: 12px;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  font-weight: 600;
}

.kpi-change {
  font-size: 12px;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 999px;
}

.kpi-change.positive {
  background: rgba(34, 197, 94, 0.18);
  color: #4ade80;
}

.kpi-change.negative {
  background: rgba(239, 68, 68, 0.18);
  color: #f87171;
}

.kpi-value {
  font-size: 28px;
  font-weight: 700;
  margin-bottom: 12px;
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.02em;
}

.kpi-sparkline {
  width: 100%;
  height: 28px;
  display: block;
  stroke: var(--accent);
  opacity: 0.8;
}
</style>
