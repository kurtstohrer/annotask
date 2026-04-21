<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import PlanetCard from '../components/PlanetCard.vue'
import PlanetDetail from '../components/PlanetDetail.vue'
import { usePlanets } from '../composables/usePlanets'
import type { Planet, PlanetType } from '../types'

const route = useRoute()
const router = useRouter()

const { planets, loading: queryLoading } = usePlanets()

const selected = ref<Planet | null>(null)
const loading = ref(true)
const error = ref('')

const search = ref('')
const typeFilter = ref<PlanetType | ''>('')
const sortBy = ref<'distance_from_sun_mkm' | 'name' | 'radius_km' | 'moons' | 'avg_temp_c'>(
  'distance_from_sun_mkm',
)

onMounted(async () => {
  try {
    const res = await fetch('/api/solar/planets?sort_by=distance_from_sun_mkm')
    if (!res.ok) throw new Error('api')
    const data = await res.json()
    planets.value = data.planets ?? []
    const id = route.query.id ? Number(route.query.id) : null
    if (id) selected.value = planets.value.find((p) => p.id === id) ?? null
  } catch {
    error.value = 'Failed to load planets — is the API running on port 8888?'
  } finally {
    loading.value = false
  }
})

const filtered = computed(() => {
  let out = [...planets.value]
  if (typeFilter.value) out = out.filter((p) => p.type === typeFilter.value)
  if (search.value.trim()) {
    const q = search.value.toLowerCase()
    out = out.filter((p) => p.name.toLowerCase().includes(q))
  }
  out.sort((a, b) => {
    const av = a[sortBy.value]
    const bv = b[sortBy.value]
    if (typeof av === 'string' && typeof bv === 'string') return av.localeCompare(bv)
    return (av as number) - (bv as number)
  })
  return out
})

function select(planet: Planet) {
  selected.value = planet
  router.replace({ query: { ...route.query, id: String(planet.id) } })
}

function close() {
  selected.value = null
  const { id: _drop, ...rest } = route.query
  router.replace({ query: rest })
}

watch(
  () => route.query.id,
  (id) => {
    if (!id) selected.value = null
    else selected.value = planets.value.find((p) => p.id === Number(id)) ?? null
  },
)
</script>

<template>
  <section class="planets-page">
    <header class="page-header">
      <div>
        <h1 class="title">Planets</h1>
        <p class="lede">Click a planet card to view more info.</p>
      </div>
    </header>

    <p v-if="error" class="error-banner">{{ error }}</p>

    <div class="toolbar">
      <div class="field">
        <i class="pi pi-search"></i>
        <input
          v-model="search"
          type="search"
          placeholder="Search planets…"
          aria-label="Search planets"
        />
      </div>
      <label class="select">
        Type
        <select v-model="typeFilter" aria-label="Filter by type">
          <option value="">All</option>
          <option value="Terrestrial">Terrestrial</option>
          <option value="Gas Giant">Gas Giant</option>
          <option value="Ice Giant">Ice Giant</option>
        </select>
      </label>
      <label class="select">
        Sort
        <select v-model="sortBy" aria-label="Sort planets by">
          <option value="distance_from_sun_mkm">Distance from Sun</option>
          <option value="name">Name</option>
          <option value="radius_km">Radius</option>
          <option value="moons">Moons</option>
          <option value="avg_temp_c">Temperature</option>
        </select>
      </label>
    </div>

    <div class="layout">
      <div class="planet-list">
        <p v-if="loading" class="loading">Loading planets…</p>
        <p v-else-if="!filtered.length" class="empty">No planets match your filters.</p>
        <PlanetCard
          v-for="planet in filtered"
          v-else
          :key="planet.id"
          :planet="planet"
          :active="selected?.id === planet.id"
          @select="select"
        />
      </div>
      <PlanetDetail v-if="selected" :planet="selected" @close="close" />
    </div>
  </section>
</template>

<style scoped>
.planets-page { display: flex; flex-direction: column; gap: 20px; }

.page-header { display: flex; justify-content: space-between; align-items: flex-end; }
.title { font-size: 26px; font-weight: 700; letter-spacing: -0.02em; }
.lede { color: var(--text-muted); font-size: 14px; margin-top: 4px; }

.toolbar {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  align-items: center;
}

.field {
  position: relative;
  flex: 1;
  min-width: 220px;
}

.field i {
  position: absolute;
  left: 12px;
  top: 50%;
  transform: translateY(-50%);
  color: var(--text-muted);
  font-size: 12px;
}

.field input {
  width: 100%;
  padding: 9px 12px 9px 34px;
  font-size: 13px;
  font-family: inherit;
  background: var(--surface-alt);
  border: 1px solid var(--border);
  border-radius: 8px;
  color: var(--text);
}

.field input:focus {
  outline: none;
  border-color: var(--accent);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 25%, transparent);
}

.select {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: var(--text-muted);
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.select select {
  padding: 8px 10px;
  font-size: 13px;
  font-family: inherit;
  font-weight: 500;
  background: var(--surface-alt);
  border: 1px solid var(--border);
  border-radius: 8px;
  color: var(--text);
  text-transform: none;
  letter-spacing: 0;
  cursor: pointer;
}

.layout {
  display: flex;
  gap: 20px;
  align-items: flex-start;
}

.planet-list {
  flex: 1;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 12px;
  min-width: 0;
}

.loading, .empty {
  grid-column: 1 / -1;
  padding: 40px;
  text-align: center;
  color: var(--text-muted);
  font-size: 13px;
}

@media (max-width: 900px) {
  .layout { flex-direction: column; }
  .planet-list { grid-template-columns: 1fr; }
}
</style>
