<script setup lang="ts">
import { ref, watch } from 'vue'
import SelectButton from 'primevue/selectbutton'
import AnalyticsChart from '../components/AnalyticsChart.vue'
import type { AnalyticsResponse } from '../types'

const range = ref<'7d' | '30d' | '90d'>('7d')
const metric = ref<'users' | 'sessions' | 'tasks'>('users')
const data = ref<AnalyticsResponse | null>(null)
const error = ref('')

const rangeOptions = [
  { label: 'Last 7 days', value: '7d' },
  { label: 'Last 30 days', value: '30d' },
  { label: 'Last 90 days', value: '90d' },
]

const metricOptions = [
  { label: 'Users', value: 'users' },
  { label: 'Sessions', value: 'sessions' },
  { label: 'Tasks', value: 'tasks' },
]

async function load() {
  try {
    const res = await fetch(`/api/dashboard/analytics?range=${range.value}`)
    data.value = await res.json()
  } catch {
    error.value = 'Failed to load analytics — is the API running on port 8888?'
  }
}

watch(range, load, { immediate: true })
</script>

<template>
  <section class="analytics-page">
    <header class="page-header">
      <div>
        <h1 class="title">Analytics</h1>
        <p class="lede">Trend reports across the active product window.</p>
      </div>
      <div class="controls">
        <SelectButton v-model="range" :options="rangeOptions" option-label="label" option-value="value" />
        <SelectButton v-model="metric" :options="metricOptions" option-label="label" option-value="value" />
      </div>
    </header>

    <p v-if="error" class="error-banner">{{ error }}</p>

    <div v-if="data" class="chart-card">
      <AnalyticsChart :buckets="data.buckets" :metric="metric" />
    </div>
  </section>
</template>

<style scoped>
.analytics-page { display: flex; flex-direction: column; gap: 24px; }

.page-header {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
}

.title { font-size: 26px; font-weight: 700; letter-spacing: -0.02em; }
.lede { color: var(--text-muted); font-size: 14px; margin-top: 4px; }

.controls { display: flex; gap: 12px; flex-wrap: wrap; }

.chart-card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 24px;
}
</style>
