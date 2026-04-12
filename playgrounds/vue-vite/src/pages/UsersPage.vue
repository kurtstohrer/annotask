<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import DataTable from 'primevue/datatable'
import Column from 'primevue/column'
import InputText from 'primevue/inputtext'
import Tag from 'primevue/tag'
import type { User } from '../types'

const users = ref<User[]>([])
const search = ref('')
const error = ref('')
const loading = ref(true)

onMounted(async () => {
  try {
    const res = await fetch('/api/dashboard/users')
    users.value = (await res.json()).users
  } catch {
    error.value = 'Failed to load users — is the API running on port 8888?'
  } finally {
    loading.value = false
  }
})

const filtered = computed(() => {
  const q = search.value.toLowerCase()
  if (!q) return users.value
  return users.value.filter(
    (u) =>
      u.name.toLowerCase().includes(q) ||
      u.email.toLowerCase().includes(q) ||
      u.role.toLowerCase().includes(q),
  )
})

function statusSeverity(status: string): 'success' | 'warn' | 'danger' | 'secondary' {
  switch (status) {
    case 'active':
      return 'success'
    case 'invited':
      return 'warn'
    case 'suspended':
      return 'danger'
    default:
      return 'secondary'
  }
}

function planSeverity(plan: string): 'info' | 'warn' | 'success' {
  switch (plan) {
    case 'Solo':
      return 'info'
    case 'Team':
      return 'success'
    case 'Enterprise':
      return 'warn'
    default:
      return 'info'
  }
}

function formatLastSeen(ts: string | null): string {
  if (!ts) return 'Never'
  const d = new Date(ts)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}
</script>

<template>
  <section class="users-page">
    <header class="page-header">
      <div>
        <h1 class="title">Users</h1>
        <p class="lede">{{ users.length }} accounts across all plans</p>
      </div>
      <InputText v-model="search" placeholder="Search users…" class="search" />
    </header>

    <p v-if="error" class="error-banner">{{ error }}</p>

    <DataTable
      :value="filtered"
      :loading="loading"
      striped-rows
      data-key="id"
      class="dark-table"
    >
      <Column field="name" header="Name" sortable>
        <template #body="{ data }">
          <div class="name-cell">
            <strong>{{ data.name }}</strong>
            <span class="email">{{ data.email }}</span>
          </div>
        </template>
      </Column>
      <Column field="role" header="Role" sortable />
      <Column field="status" header="Status" sortable>
        <template #body="{ data }">
          <Tag :value="data.status" :severity="statusSeverity(data.status)" />
        </template>
      </Column>
      <Column field="plan" header="Plan" sortable>
        <template #body="{ data }">
          <Tag :value="data.plan" :severity="planSeverity(data.plan)" />
        </template>
      </Column>
      <Column field="last_seen" header="Last seen" sortable>
        <template #body="{ data }">
          {{ formatLastSeen(data.last_seen) }}
        </template>
      </Column>
    </DataTable>
  </section>
</template>

<style scoped>
.users-page { display: flex; flex-direction: column; gap: 20px; }

.page-header {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
}

.title { font-size: 26px; font-weight: 700; letter-spacing: -0.02em; }
.lede { color: var(--text-muted); font-size: 14px; margin-top: 4px; }

.search { min-width: 240px; }

.name-cell { display: flex; flex-direction: column; gap: 2px; }
.email { font-size: 12px; color: var(--text-muted); }
</style>
