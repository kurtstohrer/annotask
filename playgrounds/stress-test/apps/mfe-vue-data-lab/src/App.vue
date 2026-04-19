<script setup lang="ts">
import { computed, h, onMounted, ref } from 'vue'
import {
  NAlert,
  NBadge,
  NButton,
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
  type DataTableColumns,
} from 'naive-ui'
import type { Health, Product, Workflow, WorkflowStatus } from '@annotask/stress-contracts'
import { products, workflows as seedWorkflows } from '@annotask/stress-fixtures'

const health = ref<Health | null>(null)
const healthError = ref<string | null>(null)
const loading = ref(true)
const rows = ref<Workflow[]>(seedWorkflows)

async function load() {
  loading.value = true
  healthError.value = null
  try {
    const res = await fetch('/api/health')
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    health.value = (await res.json()) as Health
  } catch (err) {
    healthError.value = err instanceof Error ? err.message : String(err)
  } finally {
    loading.value = false
  }
}

onMounted(load)

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
</script>

<template>
  <NConfigProvider>
    <NLayout class="page">
      <NLayoutContent content-style="padding: 28px 32px; max-width: 900px;">
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
              <li>Naive UI <code>NDataTable</code> component discovery</li>
              <li>Tasks routed under <code>mfe: vue-data-lab</code></li>
            </ul>
          </NCard>

          <NCard title="Upstream health" size="small">
            <template #header-extra>
              <NButton size="small" :loading="loading" @click="load">Refresh</NButton>
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
            <NDataTable :columns="workflowColumns" :data="rows" size="small" :bordered="false" />
          </NCard>

          <NCard title="Products" size="small">
            <NDataTable :columns="productColumns" :data="products" size="small" :bordered="false" />
          </NCard>
        </NSpace>
      </NLayoutContent>
    </NLayout>
  </NConfigProvider>
</template>

<style>
html, body { margin: 0; font-family: var(--stress-font); color: var(--stress-text); background: var(--stress-bg); }
.page { background: var(--stress-bg); min-height: 100vh; }
.header h1 { margin: 0 0 4px; font-size: 22px; }
.sub { color: var(--stress-text-muted); margin: 0 0 16px; font-size: 13px; }
code { font-family: var(--stress-font-mono); font-size: 12px; background: var(--stress-surface-2); padding: 1px 5px; border-radius: 4px; }
</style>
