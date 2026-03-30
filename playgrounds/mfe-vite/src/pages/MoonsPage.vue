<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import type { Moon } from '../types'

const moons = ref<Moon[]>([])
const search = ref('')
const planetFilter = ref('')
const selected = ref<Moon | null>(null)
const error = ref('')

onMounted(async () => {
  try {
    const res = await fetch('/api/moons')
    moons.value = (await res.json()).moons
  } catch {
    error.value = 'Failed to load moons — is the API running on port 8888?'
  }
})

const planetNames = computed(() => [...new Set(moons.value.map(m => m.planet))].sort())

const filtered = computed(() => {
  let list = moons.value
  if (planetFilter.value) list = list.filter(m => m.planet === planetFilter.value)
  const q = search.value.toLowerCase()
  if (q) list = list.filter(m => m.name.toLowerCase().includes(q) || m.planet.toLowerCase().includes(q))
  return list
})
</script>

<template>
  <div class="moons-page">
    <h1 class="page-title">Moons</h1>

    <div v-if="error" class="error">{{ error }}</div>

    <template v-else>
      <div class="toolbar">
        <input v-model="search" class="search" type="text" placeholder="Search moons..." />
        <div class="filters">
          <button
            class="filter-btn"
            :class="{ active: !planetFilter }"
            @click="planetFilter = ''"
          >All</button>
          <button
            v-for="name in planetNames" :key="name"
            class="filter-btn"
            :class="{ active: planetFilter === name }"
            @click="planetFilter = name"
          >{{ name }}</button>
        </div>
      </div>

      <div class="layout">
        <table class="table">
          <thead>
            <tr>
              <th>Moon</th>
              <th>Planet</th>
              <th>Radius</th>
              <th>Orbit</th>
              <th>Period</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="m in filtered" :key="m.id"
              :class="{ active: selected?.id === m.id }"
              @click="selected = m"
            >
              <td class="name-cell">
                <span class="dot" :style="{ background: m.color }"></span>
                {{ m.name }}
              </td>
              <td>{{ m.planet }}</td>
              <td>{{ m.radius_km.toLocaleString() }} km</td>
              <td>{{ m.distance_km.toLocaleString() }} km</td>
              <td>{{ m.orbital_period_days }} days</td>
            </tr>
          </tbody>
        </table>

        <aside v-if="selected" class="detail">
          <button class="close-btn" @click="selected = null">✕</button>
          <div class="detail-dot" :style="{ background: selected.color }"></div>
          <h2>{{ selected.name }}</h2>
          <p class="detail-planet">Orbiting {{ selected.planet }}</p>
          <p class="detail-desc">{{ selected.description }}</p>
          <dl class="detail-grid">
            <div><dt>Radius</dt><dd>{{ selected.radius_km.toLocaleString() }} km</dd></div>
            <div><dt>Orbit Distance</dt><dd>{{ selected.distance_km.toLocaleString() }} km</dd></div>
            <div><dt>Period</dt><dd>{{ selected.orbital_period_days }} days</dd></div>
            <div v-if="selected.year_discovered"><dt>Discovered</dt><dd>{{ selected.year_discovered }}</dd></div>
          </dl>
        </aside>
      </div>
    </template>
  </div>
</template>

<style scoped>
.page-title { font-size: 22px; font-weight: 700; margin-bottom: 16px; }
.error {
  padding: 14px 18px;
  background: rgba(245, 91, 91, 0.1);
  border: 1px solid rgba(245, 91, 91, 0.3);
  border-radius: var(--radius);
  color: #fca5a5;
  font-size: 14px;
}
.toolbar { margin-bottom: 16px; }
.search {
  width: 100%;
  padding: 10px 14px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  color: var(--text);
  font-size: 13px;
  margin-bottom: 10px;
  outline: none;
}
.search:focus { border-color: var(--accent); }
.filters { display: flex; gap: 6px; flex-wrap: wrap; }
.filter-btn {
  padding: 4px 12px;
  border-radius: 6px;
  border: 1px solid var(--border);
  background: var(--surface);
  color: var(--text-dim);
  font-size: 12px;
  cursor: pointer;
  transition: all 0.15s;
}
.filter-btn:hover { border-color: var(--accent); color: var(--text); }
.filter-btn.active { background: var(--accent-dim); border-color: var(--accent); color: var(--accent); }

.layout { display: flex; gap: 20px; align-items: flex-start; }
.table { flex: 1; width: 100%; border-collapse: collapse; font-size: 13px; }
.table th {
  text-align: left; padding: 10px 12px;
  background: var(--surface); color: var(--text-dim);
  font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em;
  border-bottom: 1px solid var(--border);
}
.table td { padding: 10px 12px; border-bottom: 1px solid var(--border); }
.table tr { cursor: pointer; transition: background 0.1s; }
.table tbody tr:hover { background: var(--surface-hover); }
.table tr.active { background: var(--accent-dim); }
.name-cell { display: flex; align-items: center; gap: 8px; font-weight: 600; }
.dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }

.detail {
  width: 300px; flex-shrink: 0;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 20px; position: relative;
}
.close-btn {
  position: absolute; top: 12px; right: 12px;
  background: none; border: none; color: var(--text-dim); cursor: pointer; font-size: 16px;
}
.detail-dot { width: 32px; height: 32px; border-radius: 50%; margin-bottom: 12px; }
.detail h2 { font-size: 18px; margin-bottom: 4px; }
.detail-planet { color: var(--text-dim); font-size: 12px; margin-bottom: 12px; }
.detail-desc { font-size: 13px; line-height: 1.5; color: var(--text-dim); margin-bottom: 16px; }
.detail-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.detail-grid dt { font-size: 11px; color: var(--text-dim); text-transform: uppercase; letter-spacing: 0.04em; }
.detail-grid dd { font-size: 14px; font-weight: 600; margin: 2px 0 0; }

@media (max-width: 800px) {
  .layout { flex-direction: column; }
  .detail { width: 100%; }
}
</style>
