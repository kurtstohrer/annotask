<script setup lang="ts">
import { ref, computed } from 'vue'
import DataTable from 'primevue/datatable'
import Column from 'primevue/column'
import InputText from 'primevue/inputtext'
import Button from 'primevue/button'
import Skeleton from 'primevue/skeleton'
import type { Planet } from '../types'

const props = defineProps<{
  planets: Planet[]
  loading: boolean
  selected: Planet | null
}>()

const emit = defineEmits<{ select: [planet: Planet] }>()

const searchQuery = ref('')
const typeFilters = ref<Set<string>>(new Set())

const planetTypes = ['Terrestrial', 'Gas Giant', 'Ice Giant'] as const

function toggleType(type: string) {
  const next = new Set(typeFilters.value)
  if (next.has(type)) next.delete(type)
  else next.add(type)
  typeFilters.value = next
}

const filtered = computed(() => {
  let result = props.planets
  if (searchQuery.value) {
    const q = searchQuery.value.toLowerCase()
    result = result.filter(
      p => p.name.toLowerCase().includes(q) || p.type.toLowerCase().includes(q)
    )
  }
  if (typeFilters.value.size > 0) {
    result = result.filter(p => typeFilters.value.has(p.type))
  }
  return result
})

function typeClass(type: string): string {
  switch (type) {
    case 'Terrestrial': return 'badge-terrestrial'
    case 'Gas Giant': return 'badge-gas-giant'
    case 'Ice Giant': return 'badge-ice-giant'
    default: return 'badge-default'
  }
}

function lightenColor(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return `rgb(${Math.min(r + 80, 255)}, ${Math.min(g + 80, 255)}, ${Math.min(b + 80, 255)})`
}

function darkenColor(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return `rgb(${Math.max(r - 60, 0)}, ${Math.max(g - 60, 0)}, ${Math.max(b - 60, 0)})`
}

function formatTemp(c: number): string {
  return `${c > 0 ? '+' : ''}${c}°C`
}

function tempClass(c: number): Record<string, boolean> {
  return { hot: c > 100, cold: c < -100 }
}
</script>

<template>
  <div class="planet-table-wrapper">
    <div class="table-header">
      <h2 class="table-title">
        <i class="pi pi-list"></i>
        All Planets
      </h2>
    </div>

    <div class="filter-bar">
      <span class="filter-label">Type:</span>
      <button
        v-for="t in planetTypes"
        :key="t"
        class="filter-chip"
        :class="[typeClass(t), { active: typeFilters.has(t) }]"
        @click="toggleType(t)"
      >
        {{ t }}
      </button>
      <div class="table-search">
        <i class="pi pi-search search-icon"></i>
        <InputText
          v-model="searchQuery"
          placeholder="Search planets..."
          class="search-input"
        />
      </div>
    </div>

    <!-- Loading state -->
    <div v-if="loading" class="loading-rows">
      <Skeleton v-for="i in 6" :key="i" height="48px" class="loading-row" />
    </div>

    <!-- Data table -->
    <DataTable
      v-else
      :value="filtered"
      :selection="selected"
      selectionMode="single"
      dataKey="id"
      @row-select="emit('select', $event.data)"
      :rowHover="true"
      :rows="10"
    >
      <Column field="name" header="Planet" sortable style="min-width: 140px">
        <template #body="{ data }">
          <div class="planet-cell">
            <span
              class="planet-dot"
              :style="{
                background: `radial-gradient(circle at 35% 35%, ${lightenColor(data.color)}, ${data.color}, ${darkenColor(data.color)})`,
                boxShadow: `0 0 6px ${data.color}55`
              }"
            ></span>
            <span class="planet-name">{{ data.name }}</span>
          </div>
        </template>
      </Column>

      <Column field="type" header="Type" sortable style="min-width: 120px">
        <template #body="{ data }">
          <span class="type-badge" :class="typeClass(data.type)">{{ data.type }}</span>
        </template>
      </Column>

      <Column field="radius_km" header="Radius" sortable style="min-width: 100px">
        <template #body="{ data }">
          <span class="mono">{{ data.radius_km.toLocaleString() }} km</span>
        </template>
      </Column>

      <Column field="gravity_ms2" header="Gravity" sortable style="min-width: 90px">
        <template #body="{ data }">
          <span class="mono">{{ data.gravity_ms2 }} m/s²</span>
        </template>
      </Column>

      <Column field="avg_temp_c" header="Temp" sortable style="min-width: 80px">
        <template #body="{ data }">
          <span class="mono" :class="tempClass(data.avg_temp_c)">
            {{ formatTemp(data.avg_temp_c) }}
          </span>
        </template>
      </Column>

      <Column field="moons" header="Moons" sortable style="min-width: 70px">
        <template #body="{ data }">
          <span class="mono">{{ data.moons }}</span>
        </template>
      </Column>

      <Column header="Actions" style="width: 80px">
        <template #body="{ data }">
          <Button
            icon="pi pi-arrow-right"
            size="small"
            text
            rounded
            :aria-label="`View ${data.name} details`"
            @click="emit('select', data)"
          />
        </template>
      </Column>
    </DataTable>

    <p v-if="!loading && filtered.length === 0" class="no-results">
      No planets match "{{ searchQuery }}"
    </p>
  </div>
</template>

<style scoped>
.planet-table-wrapper { flex: 1; min-width: 0; }

.table-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 14px;
}

.table-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 16px;
  font-weight: 600;
  color: var(--text);
}

.table-title i { color: var(--text-muted); font-size: 14px; }

.table-search { position: relative; margin-left: auto; }
.search-icon {
  position: absolute;
  left: 12px;
  top: 50%;
  transform: translateY(-50%);
  color: var(--text-muted);
  font-size: 13px;
  z-index: 1;
}
.search-input { padding-left: 34px; width: 220px; font-size: 13px; background-color: #212121; }

.planet-cell { display: flex; align-items: center; gap: 10px; }
.planet-dot { width: 14px; height: 14px; border-radius: 50%; flex-shrink: 0; }
.planet-name { font-weight: 600; font-size: 14px; }

.mono { font-variant-numeric: tabular-nums; font-size: 13px; color: #ffffff; }
.hot { color: #f97316; }
.cold { color: #38bdf8; }

.loading-rows { display: flex; flex-direction: column; gap: 4px; }
.loading-row { border-radius: 6px; }

.no-results { text-align: center; color: var(--text-muted); margin-top: 24px; font-size: 14px; }

.filter-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
}
.filter-label {
  font-size: 12px;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  font-weight: 600;
}
.filter-chip {
  padding: 3px 12px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 600;
  border: 1px solid var(--border);
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  transition: all 0.15s;
}
.filter-chip.badge-terrestrial { border-color: #047857; color: #a7f3d0; background: transparent; }
.filter-chip.badge-gas-giant { border-color: #e11d48; color: #fbbf24; background: transparent; }
.filter-chip.badge-ice-giant { border-color: #6366f1; color: #67e8f9; background: transparent; }
.filter-chip:hover { filter: brightness(1.2); }
.filter-chip:active { transform: scale(0.95); }
.filter-chip.active {
  color: #000;
  border-color: transparent;
}
.filter-chip.active:hover { filter: brightness(1.15); }
.filter-chip.active:active { filter: brightness(0.9); transform: scale(0.95); }
.filter-chip.active.badge-terrestrial { background: linear-gradient(135deg, #a7f3d0, #047857); }
.filter-chip.active.badge-gas-giant { background: linear-gradient(135deg, #fbbf24, #e11d48); }
.filter-chip.active.badge-ice-giant { background: linear-gradient(135deg, #67e8f9, #6366f1); }

.type-badge {
  display: inline-block;
  padding: 4px 12px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 600;
  color: #000;
  letter-spacing: 0.02em;
}
.badge-terrestrial { background: linear-gradient(135deg, #a7f3d0, #047857); }
.badge-gas-giant { background: linear-gradient(135deg, #fbbf24, #e11d48); }
.badge-ice-giant { background: linear-gradient(135deg, #67e8f9, #6366f1); }
.badge-default { background: linear-gradient(135deg, #a5b4fc, #6b7280); }

:deep(.p-datatable-thead > tr > th) {
  background-color: #3b3b3b !important;
  color: #aaaaaa !important;
}
</style>
