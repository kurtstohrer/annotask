<script setup lang="ts">
import { ref, computed } from 'vue'
import DataTable from 'primevue/datatable'
import Column from 'primevue/column'
import InputText from 'primevue/inputtext'
import Skeleton from 'primevue/skeleton'
import type { Moon } from '../types'

const props = defineProps<{
  moons: Moon[]
  loading: boolean
  selected: Moon | null
}>()

const emit = defineEmits<{ select: [moon: Moon] }>()

const searchQuery = ref('')
const planetFilter = ref('')

const planetColors: Record<string, string> = {
  Mercury: '#94a3b8',
  Venus: '#fbbf24',
  Earth: '#3b82f6',
  Mars: '#ef4444',
  Jupiter: '#f97316',
  Saturn: '#eab308',
  Uranus: '#06b6d4',
  Neptune: '#6366f1',
}

const planets = computed(() => {
  const set = new Set(props.moons.map(m => m.planet))
  return Array.from(set).sort()
})

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

function planetDotStyle(planet: string) {
  const color = planetColors[planet] || '#888'
  return {
    background: `radial-gradient(circle at 35% 35%, ${lightenColor(color)}, ${color}, ${darkenColor(color)})`,
    boxShadow: `0 0 6px ${color}55`
  }
}

const filtered = computed(() => {
  let result = props.moons
  if (searchQuery.value) {
    const q = searchQuery.value.toLowerCase()
    result = result.filter(
      m => m.name.toLowerCase().includes(q) || m.planet.toLowerCase().includes(q)
    )
  }
  if (planetFilter.value) {
    result = result.filter(m => m.planet === planetFilter.value)
  }
  return result
})
</script>

<template>
  <div class="moon-table-wrapper">
    <div class="table-header">
      <h2 class="table-title">
        <i class="pi pi-moon"></i>
        All Moons
      </h2>
    </div>

    <div class="filter-bar">
      <span class="filter-label">Planet:</span>
      <button
        class="filter-chip"
        :class="{ active: !planetFilter }"
        @click="planetFilter = ''"
      >
        All
      </button>
      <button
        v-for="p in planets"
        :key="p"
        class="filter-chip"
        :class="{ active: planetFilter === p }"
        @click="planetFilter = planetFilter === p ? '' : p"
      >
        <span class="planet-dot" :style="planetDotStyle(p)"></span>
        {{ p }}
      </button>
      <div class="table-search">
        <i class="pi pi-search search-icon"></i>
        <InputText
          v-model="searchQuery"
          placeholder="Search moons..."
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
      :rows="15"
    >
      <Column field="name" header="Moon" sortable style="min-width: 140px">
        <template #body="{ data }">
          <div class="moon-cell">
            <span
              class="moon-dot"
              :style="{
                background: `radial-gradient(circle at 35% 35%, ${lightenColor(data.color)}, ${data.color}, ${darkenColor(data.color)})`,
                boxShadow: `0 0 6px ${data.color}55`
              }"
            ></span>
            <span class="moon-name">{{ data.name }}</span>
          </div>
        </template>
      </Column>

      <Column field="planet" header="Planet" sortable style="min-width: 100px">
        <template #body="{ data }">
          <div class="planet-cell">
            <span class="planet-dot" :style="planetDotStyle(data.planet)"></span>
            <span class="mono">{{ data.planet }}</span>
          </div>
        </template>
      </Column>

      <Column field="radius_km" header="Radius" sortable style="min-width: 100px">
        <template #body="{ data }">
          <span class="mono">{{ data.radius_km.toLocaleString() }} km</span>
        </template>
      </Column>

      <Column field="distance_km" header="Orbit Distance" sortable style="min-width: 120px">
        <template #body="{ data }">
          <span class="mono">{{ data.distance_km.toLocaleString() }} km</span>
        </template>
      </Column>

      <Column field="orbital_period_days" header="Period" sortable style="min-width: 90px">
        <template #body="{ data }">
          <span class="mono">{{ data.orbital_period_days }}d</span>
        </template>
      </Column>

      <Column field="year_discovered" header="Discovered" sortable style="min-width: 100px">
        <template #body="{ data }">
          <span class="mono">{{ data.year_discovered ?? 'Ancient' }}</span>
        </template>
      </Column>
    </DataTable>

    <p v-if="!loading && filtered.length === 0" class="no-results">
      No moons match "{{ searchQuery }}"
    </p>
  </div>
</template>

<style scoped>
.moon-table-wrapper { flex: 1; min-width: 0; container-type: inline-size; }

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

.table-search { position: relative; margin-left: auto; flex: 0 1 220px; min-width: 120px; }
.search-icon {
  position: absolute;
  left: 12px;
  top: 50%;
  transform: translateY(-50%);
  color: var(--text-muted);
  font-size: 13px;
  z-index: 1;
}
.search-input { padding-left: 34px; width: 100%; font-size: 13px; background-color: #212121; }

.moon-cell { display: flex; align-items: center; gap: 10px; }
.moon-dot { width: 14px; height: 14px; border-radius: 50%; flex-shrink: 0; }
.moon-name { font-weight: 600; font-size: 14px; }

.planet-cell { display: flex; align-items: center; gap: 8px; }
.planet-dot { width: 12px; height: 12px; border-radius: 50%; flex-shrink: 0; }

.mono { font-variant-numeric: tabular-nums; font-size: 13px; color: #ffffff; }

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
  flex-shrink: 0;
}
.filter-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 3px 12px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 600;
  border: 1px solid var(--border);
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  transition: all 0.15s;
  flex-shrink: 0;
  white-space: nowrap;
}
.planet-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}
.filter-chip.active {
  background: var(--surface-alt);
  color: var(--text);
  border-color: var(--accent);
}

:deep(.p-datatable-thead > tr > th) {
  background-color: #3b3b3b !important;
  color: #605c5e !important;
}

@container (max-width: 600px) {
  .filter-bar {
    display: flex;
    flex-wrap: wrap;
  }
  .filter-label {
    width: 100%;
  }
  .table-search {
    width: 100%;
    margin-left: 0;
    order: -1;
    margin-bottom: 4px;
  }
  .search-input {
    width: 100%;
  }
}
</style>
