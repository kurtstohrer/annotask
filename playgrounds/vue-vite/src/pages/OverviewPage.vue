<script setup lang="ts">
import { ref, onMounted } from 'vue'
import KpiCard from '../components/KpiCard.vue'
import ActivityFeed from '../components/ActivityFeed.vue'
import type { DashboardMetrics, ActivityEntry } from '../types'

const metrics = ref<DashboardMetrics | null>(null)
const activity = ref<ActivityEntry[]>([])
const error = ref('')

onMounted(async () => {
  try {
    const [m, a] = await Promise.all([
      fetch('/api/dashboard/metrics').then((r) => r.json()),
      fetch('/api/dashboard/activity').then((r) => r.json()),
    ])
    metrics.value = m
    activity.value = a
  } catch {
    error.value = 'Failed to load dashboard data — is the API running on port 8888?'
  }
})
</script>

<template>
  <section class="overview">
    <header class="page-header">
      <h1 class="title">Overview</h1>
      <p class="lede">Live view of the annotask service. Updated continuously from the dashboard API.</p>
    </header>

    <p v-if="error" class="error-banner">{{ error }}</p>

    <div v-if="metrics" class="kpi-grid">
      <KpiCard
        label="Error rate"
        :value="metrics.error_rate.value"
        :change-pct="metrics.error_rate.change_pct"
        :trend="metrics.error_rate.trend"
        format="percent"
      />
      <KpiCard
        label="MRR"
        :value="metrics.mrr.value"
        :change-pct="metrics.mrr.change_pct"
        :trend="metrics.mrr.trend"
        format="currency"
      />
      <KpiCard
        label="Active users"
        :value="metrics.active_users.value"
        :change-pct="metrics.active_users.change_pct"
        :trend="metrics.active_users.trend"
        format="number"
      />
      <KpiCard
        label="P95 latency"
        :value="metrics.p95_latency_ms.value"
        :change-pct="metrics.p95_latency_ms.change_pct"
        :trend="metrics.p95_latency_ms.trend"
        format="ms"
      />
    </div>

    <section class="activity-section">
      <h2 class="section-title">Recent activity</h2>
      <div class="activity-card">
        <ActivityFeed :entries="activity" />
      </div>
    </section>
  </section>
</template>

<style scoped>
.overview { display: flex; flex-direction: column; gap: 28px; }

.page-header { display: flex; flex-direction: column; gap: 6px; }
.title { font-size: 26px; font-weight: 700; letter-spacing: -0.02em; }
.lede { color: var(--text-muted); font-size: 14px; }

.kpi-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 16px;
}

.activity-section { display: flex; flex-direction: column; gap: 12px; }
.section-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.activity-card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 12px 20px;
}
</style>
