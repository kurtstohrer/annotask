<script setup lang="ts">
import { computed, h, onMounted, onUnmounted, ref } from 'vue'
import {
  NAlert,
  NBadge,
  NButton,
  NButtonGroup,
  NCard,
  NConfigProvider,
  NDataTable,
  NDescriptions,
  NDescriptionsItem,
  NLayout,
  NLayoutContent,
  NSpace,
  NTag,
  NText,
  darkTheme,
  type DataTableColumns,
  type GlobalTheme,
} from 'naive-ui'
import type { Health, Product, Workflow, WorkflowStatus } from '@annotask/stress-contracts'
import { products, workflows as seedWorkflows } from '@annotask/stress-fixtures'
import { getTheme, onThemeChange, type StressTheme } from '@annotask/stress-ui-tokens'
import HealthDashboard from './HealthDashboard.vue'

const API_BASE = 'http://localhost:4320'

const currentHash = ref(typeof window === 'undefined' ? '' : window.location.hash || '')
function onHashChange() {
  currentHash.value = window.location.hash || ''
}
const view = computed<'health' | 'data-lab'>(() =>
  currentHash.value.startsWith('#/vue/health') ? 'health' : 'data-lab',
)

const health = ref<Health | null>(null)
const healthError = ref<string | null>(null)
const loading = ref(true)
const rows = ref<Workflow[]>(seedWorkflows)
const statusFilter = ref<WorkflowStatus | 'all'>('all')
const transitioning = ref<string | null>(null)
const lastTransition = ref<string | null>(null)

const stressTheme = ref<StressTheme>(getTheme())
const naiveTheme = computed<GlobalTheme | null>(() =>
  stressTheme.value === 'dark' ? darkTheme : null,
)
let unsubscribeTheme: (() => void) | null = null

async function loadHealth() {
  loading.value = true
  healthError.value = null
  try {
    const res = await fetch(`${API_BASE}/api/health`)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    health.value = (await res.json()) as Health
  } catch (err) {
    healthError.value = err instanceof Error ? err.message : String(err)
  } finally {
    loading.value = false
  }
}

async function loadWorkflows() {
  const url = new URL(`${API_BASE}/api/workflows`)
  if (statusFilter.value !== 'all') url.searchParams.set('status', statusFilter.value)
  try {
    const res = await fetch(url)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const body = (await res.json()) as Workflow[]
    rows.value = body
  } catch {
    // keep seed data if fastapi is down
  }
}

async function setFilter(next: WorkflowStatus | 'all') {
  statusFilter.value = next
  await loadWorkflows()
}

const NEXT_STATUS: Record<WorkflowStatus, WorkflowStatus | null> = {
  pending: 'in_progress',
  in_progress: 'review',
  review: 'accepted',
  accepted: null,
  denied: null,
}

async function advance(wf: Workflow) {
  const next = NEXT_STATUS[wf.status]
  if (!next) return
  transitioning.value = wf.id
  try {
    const res = await fetch(
      `${API_BASE}/api/workflows/${wf.id}/transitions?to=${next}`,
      { method: 'POST' },
    )
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const body = (await res.json()) as { transition_id: string; status: WorkflowStatus }
    lastTransition.value = `${wf.id} → ${body.status} (${body.transition_id.slice(0, 8)})`
    await loadWorkflows()
  } catch (err) {
    lastTransition.value = `${wf.id} transition failed: ${err instanceof Error ? err.message : err}`
  } finally {
    transitioning.value = null
  }
}

onMounted(() => {
  unsubscribeTheme = onThemeChange((t) => (stressTheme.value = t))
  window.addEventListener('hashchange', onHashChange)
  loadHealth()
  loadWorkflows()
})
onUnmounted(() => {
  unsubscribeTheme?.()
  window.removeEventListener('hashchange', onHashChange)
})

const statusTone: Record<WorkflowStatus, 'default' | 'info' | 'success' | 'warning' | 'error'> = {
  pending: 'warning',
  in_progress: 'info',
  review: 'info',
  accepted: 'success',
  denied: 'error',
}

const workflowColumns = computed<DataTableColumns<Workflow>>(() => [
  { title: 'ID', key: 'id', width: 80, render: (row) => h('code', {}, row.id) },
  { title: 'Title', key: 'title' },
  { title: 'Owner', key: 'owner', width: 110 },
  {
    title: 'Status',
    key: 'status',
    width: 130,
    render: (row) => h(NTag, { type: statusTone[row.status] ?? 'default', size: 'small', round: true }, () => row.status),
  },
  {
    title: 'Action',
    key: 'action',
    width: 140,
    render: (row) => {
      const next = NEXT_STATUS[row.status]
      if (!next) return h(NText, { depth: 3 }, () => '—')
      return h(
        NButton,
        {
          size: 'tiny',
          type: 'primary',
          loading: transitioning.value === row.id,
          onClick: () => advance(row),
        },
        () => `→ ${next}`,
      )
    },
  },
])

const productColumns = computed<DataTableColumns<Product>>(() => [
  { title: 'ID', key: 'id', width: 70, render: (row) => h('code', {}, row.id) },
  { title: 'Name', key: 'name' },
  { title: 'Category', key: 'category', width: 120 },
  {
    title: 'Price',
    key: 'price_cents',
    width: 110,
    render: (row) => '$' + (row.price_cents / 100).toFixed(2),
  },
  {
    title: 'Stock',
    key: 'in_stock',
    width: 90,
    render: (row) =>
      h(NTag, { type: row.in_stock ? 'success' : 'default', size: 'small' }, () => (row.in_stock ? 'yes' : 'no')),
  },
])

const STATUS_FILTERS: Array<WorkflowStatus | 'all'> = [
  'all', 'pending', 'in_progress', 'review', 'accepted', 'denied',
]
</script>

<template>
  <HealthDashboard v-if="view === 'health'" />
  <NConfigProvider v-else :theme="naiveTheme">
    <NLayout style="background: var(--stress-bg); min-height: 100%">
      <NLayoutContent content-style="padding: 32px 40px;">
        <header class="header">
          <h1>Vue Data Lab</h1>
          <p class="sub">
            MFE <code>vue-data-lab</code> · port 4220 · backed by FastAPI on :4320 · Naive UI
          </p>
        </header>

        <NSpace vertical :size="16" style="width: 100%">
          <NCard title="What this stresses" size="small">
            <ul>
              <li>Vue composables + typed API client — FastAPI OpenAPI discovery</li>
              <li>Naive UI <code>NDataTable</code>, <code>NLayout</code> component discovery</li>
              <li>Workflow status filter + POST transitions against FastAPI</li>
              <li>Tasks routed under <code>mfe: vue-data-lab</code></li>
            </ul>
          </NCard>

          <NCard title="Upstream health" size="small">
            <template #header-extra>
              <NButton size="small" :loading="loading" @click="loadHealth">Refresh</NButton>
            </template>
            <NAlert v-if="healthError" type="error" :show-icon="false" title="FastAPI unreachable" style="margin-bottom: 8px;">
              <code>{{ healthError }}</code> — start with <code>just fastapi</code>.
            </NAlert>
            <NDescriptions v-if="health" :column="2" bordered size="small">
              <NDescriptionsItem label="status">
                <NBadge type="success" dot /> {{ health.status }}
              </NDescriptionsItem>
              <NDescriptionsItem label="service"><code>{{ health.service }}</code></NDescriptionsItem>
              <NDescriptionsItem label="port"><code>{{ health.port }}</code></NDescriptionsItem>
              <NDescriptionsItem label="version"><code>{{ health.version }}</code></NDescriptionsItem>
            </NDescriptions>
            <NText v-else-if="loading" depth="3">Loading /api/health…</NText>
          </NCard>

          <NCard title="Workflows" size="small">
            <template #header-extra>
              <NButtonGroup size="tiny">
                <NButton
                  v-for="s in STATUS_FILTERS"
                  :key="s"
                  :type="statusFilter === s ? 'primary' : 'default'"
                  @click="setFilter(s)"
                >
                  {{ s }}
                </NButton>
              </NButtonGroup>
            </template>
            <NAlert v-if="lastTransition" type="info" :show-icon="false" style="margin-bottom: 8px;">
              <code>{{ lastTransition }}</code>
            </NAlert>
            <NDataTable :columns="workflowColumns" :data="rows" size="small" :bordered="false" />
          </NCard>

          <NCard title="Products (shared-fixtures)" size="small">
            <NDataTable :columns="productColumns" :data="products" size="small" :bordered="false" />
          </NCard>
        </NSpace>
      </NLayoutContent>
    </NLayout>
  </NConfigProvider>
</template>

<style>
.page {
  min-height: 100%;
  padding: 32px 40px;
  background: var(--stress-bg);
  color: var(--stress-text);
}
.header h1 { margin: 0 0 4px; font-size: 24px; letter-spacing: -0.01em; }
.sub { color: var(--stress-text-muted); margin: 0 0 20px; font-size: 13px; }
.page code,
.n-layout code {
  font-family: var(--stress-font-mono);
  font-size: 12px;
  background: var(--stress-surface-2);
  padding: 1px 5px;
  border-radius: 4px;
  color: var(--stress-text);
}
</style>
