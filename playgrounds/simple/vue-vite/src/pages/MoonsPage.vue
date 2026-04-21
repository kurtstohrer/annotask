<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import MoonDetail from '../components/MoonDetail.vue'
import type { Moon } from '../types'

const moons = ref<Moon[]>([])
const selected = ref<Moon | null>(null)
const loading = ref(true)
const error = ref('')

const search = ref('')
const planetFilter = ref('')

onMounted(async () => {
  try {
    const res = await fetch('/api/solar/moons')
    if (!res.ok) throw new Error('api')
    const data = await res.json()
    moons.value = data.moons ?? []
  } catch {
    error.value = 'Failed to load moons — is the API running on port 8888?'
  } finally {
    loading.value = false
  }
})

const planetsWithMoons = computed(() => {
  const set = new Set(moons.value.map((m) => m.planet))
  return Array.from(set).sort()
})

const filtered = computed(() => {
  let out = [...moons.value]
  if (planetFilter.value) out = out.filter((m) => m.planet === planetFilter.value)
  if (search.value.trim()) {
    const q = search.value.toLowerCase()
    out = out.filter((m) => m.name.toLowerCase().includes(q))
  }
  return out
})

const grouped = computed(() => {
  const groups: Record<string, Moon[]> = {}
  for (const m of filtered.value) {
    if (!groups[m.planet]) groups[m.planet] = []
    groups[m.planet].push(m)
  }
  return Object.entries(groups).sort((a, b) => a[0].localeCompare(b[0]))
})
</script>

<template>
  <section class="moons-page">
    <header class="page-header">
      <div>
        <h1 class="title">Moons</h1>
        <p class="lede">Natural satellites orbiting the planets of our Solar System.</p>
      </div>
    </header>

    <p v-if="error" class="error-banner">{{ error }}</p>

    <div class="toolbar">
      <div class="field">
        <i class="pi pi-search"></i>
        <input v-model="search" type="search" placeholder="Search moons…" aria-label="Search moons" />
      </div>
      <label class="select">
        Planet
        <select v-model="planetFilter" aria-label="Filter by planet">
          <option value="">All planets</option>
          <option v-for="p in planetsWithMoons" :key="p" :value="p">{{ p }}</option>
        </select>
      </label>
    </div>

    <div class="layout">
      <div class="moon-groups">
        <p v-if="loading" class="loading">Loading moons…</p>
        <p v-else-if="!filtered.length" class="empty">No moons match your filters.</p>
        <template v-else>
          <section v-for="[planet, list] in grouped" :key="planet" class="moon-group">
            <h3 class="group-title">
              <i class="pi pi-globe"></i>
              {{ planet }}
              <span class="group-count">{{ list.length }}</span>
            </h3>
            <ul class="moon-list">
              <li
                v-for="moon in list"
                :key="moon.id"
                class="moon-row"
                :class="{ active: selected?.id === moon.id }"
                @click="selected = moon"
                role="button"
                tabindex="0"
                @keyup.enter="selected = moon"
              >
                <span class="moon-orb" :style="{ background: moon.color }"></span>
                <span class="moon-name">{{ moon.name }}</span>
                <span class="moon-size">{{ moon.radius_km.toLocaleString() }} km</span>
                <span class="moon-period">{{ moon.orbital_period_days }} d</span>
              </li>
            </ul>
          </section>
        </template>
      </div>
      <MoonDetail v-if="selected" :moon="selected" @close="selected = null" />
    </div>
  </section>
</template>

<style scoped>
.moons-page { display: flex; flex-direction: column; gap: 20px; }

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

.layout { display: flex; gap: 20px; align-items: flex-start; }
.moon-groups { flex: 1; display: flex; flex-direction: column; gap: 18px; min-width: 0; }

.moon-group {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 12px;
  overflow: hidden;
}

.group-title {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 16px;
  font-size: 13px;
  font-weight: 700;
  color: var(--text);
  background: var(--surface-alt);
  border-bottom: 1px solid var(--border);
}

.group-title i { color: var(--text-muted); font-size: 12px; }

.group-count {
  margin-left: auto;
  font-size: 11px;
  font-weight: 600;
  color: var(--text-muted);
  padding: 2px 8px;
  background: var(--surface);
  border-radius: 999px;
  border: 1px solid var(--border);
}

.moon-list { list-style: none; }

.moon-row {
  display: grid;
  grid-template-columns: 16px 1fr auto auto;
  align-items: center;
  gap: 14px;
  padding: 10px 16px;
  cursor: pointer;
  transition: background 0.12s;
  border-top: 1px solid var(--border);
  font-variant-numeric: tabular-nums;
}

.moon-row:first-child { border-top: none; }
.moon-row:hover { background: var(--surface-alt); }
.moon-row.active { background: var(--surface-alt); }
.moon-row:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }

.moon-orb {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  box-shadow: 0 0 10px currentColor;
}

.moon-name { font-size: 14px; font-weight: 600; color: var(--text); }
.moon-size { font-size: 12px; color: var(--text-muted); }
.moon-period { font-size: 12px; color: var(--text-muted); min-width: 60px; text-align: right; }

.loading, .empty {
  padding: 40px;
  text-align: center;
  color: var(--text-muted);
  font-size: 13px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 12px;
}

@media (max-width: 900px) {
  .layout { flex-direction: column; }
}
</style>
