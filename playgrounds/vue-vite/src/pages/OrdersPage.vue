<script setup lang="ts">
import { ref, onMounted } from 'vue'
import DataTable from 'primevue/datatable'
import Column from 'primevue/column'
import Tag from 'primevue/tag'
import type { Order } from '../types'

const orders = ref<Order[]>([])
const loading = ref(true)
const error = ref('')

onMounted(async () => {
  try {
    const res = await fetch('/api/dashboard/orders')
    orders.value = (await res.json()).orders
  } catch {
    error.value = 'Failed to load orders — is the API running on port 8888?'
  } finally {
    loading.value = false
  }
})

function statusSeverity(s: string): 'success' | 'warn' | 'danger' | 'info' {
  switch (s) {
    case 'paid':
      return 'success'
    case 'pending':
      return 'warn'
    case 'refunded':
      return 'danger'
    case 'free':
      return 'info'
    default:
      return 'info'
  }
}

function formatDate(ts: string): string {
  return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}
</script>

<template>
  <section class="orders-page">
    <header class="page-header">
      <h1 class="title">Orders</h1>
      <p class="lede">{{ orders.length }} recent orders</p>
    </header>

    <p v-if="error" class="error-banner">{{ error }}</p>

    <DataTable
      :value="orders"
      :loading="loading"
      striped-rows
      data-key="id"
      class="dark-table"
    >
      <Column field="id" header="ID" sortable />
      <Column field="customer" header="Customer" sortable />
      <Column field="plan" header="Plan" sortable />
      <Column field="seats" header="Seats" sortable />
      <Column field="amount_usd" header="Amount" sortable>
        <template #body="{ data }">
          <span class="amount">${{ data.amount_usd.toLocaleString() }}</span>
        </template>
      </Column>
      <Column field="status" header="Status" sortable>
        <template #body="{ data }">
          <Tag :value="data.status" :severity="statusSeverity(data.status)" />
        </template>
      </Column>
      <Column field="created" header="Created" sortable>
        <template #body="{ data }">{{ formatDate(data.created) }}</template>
      </Column>
    </DataTable>
  </section>
</template>

<style scoped>
.orders-page { display: flex; flex-direction: column; gap: 20px; }
.page-header { display: flex; flex-direction: column; gap: 6px; }
.title { font-size: 26px; font-weight: 700; letter-spacing: -0.02em; }
.lede { color: var(--text-muted); font-size: 14px; }
.amount { font-variant-numeric: tabular-nums; font-weight: 600; color: #4ade80; }
</style>
