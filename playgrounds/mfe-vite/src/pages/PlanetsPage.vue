<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import type { Planet } from '../types'

const planets = ref<Planet[]>([])
const search = ref('')
const selected = ref<Planet | null>(null)
const error = ref('')

onMounted(async () => {
  try {
    const res = await fetch('/api/planets')
    planets.value = (await res.json()).planets
  } catch {
    error.value = 'Failed to load planets — is the API running on port 8888?'
  }
})

const filtered = computed(() => {
  const q = search.value.toLowerCase()
  if (!q) return planets.value
  return planets.value.filter(p => p.name.toLowerCase().includes(q) || p.type.toLowerCase().includes(q))
})

function formatTemp(t: number) {
  return t > 0 ? `+${t}°C` : `${t}°C`
}
</script>

<template>
  <div class="planets-page">
    <h1 class="page-title">Planets</h1>

    <div v-if="error" class="error">{{ error }}</div>

    <template v-else>
      <input v-model="search" class="search" type="text" placeholder="Search planets..." />

      <div class="layout">
        <table class="table">
          <thead>
            <tr>
              <th>Planet</th>
              <th>Type</th>
              <th>Radius</th>
              <th>Gravity</th>
              <th>Temp</th>
              <th>Moons</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="p in filtered" :key="p.id"
              :class="{ active: selected?.id === p.id }"
              @click="selected = p"
            >
              <td class="name-cell">
                <span class="dot" :style="{ background: p.color }"></span>
                {{ p.name }}
              </td>
              <td><span class="type-tag">{{ p.type }}</span></td>
              <td>{{ p.radius_km.toLocaleString() }} km</td>
              <td>{{ p.gravity_ms2 }} m/s²</td>
              <td :class="p.avg_temp_c > 100 ? 'hot' : p.avg_temp_c < -100 ? 'cold' : ''">
                {{ formatTemp(p.avg_temp_c) }}
              </td>
              <td>{{ p.moons }}</td>
            </tr>
          </tbody>
        </table>

        <aside v-if="selected" class="detail">
          <button class="close-btn" @click="selected = null">✕</button>
          <div class="detail-dot" :style="{ background: selected.color }"></div>
          <h2>{{ selected.name }}</h2>
          <p class="detail-type">{{ selected.type }}</p>
          <p class="detail-desc">{{ selected.description }}</p>
          <dl class="detail-grid">
            <div><dt>Distance</dt><dd>{{ selected.distance_from_sun_mkm }} Mkm</dd></div>
            <div><dt>Orbital Period</dt><dd>{{ selected.orbital_period_days.toLocaleString() }} days</dd></div>
            <div><dt>Moons</dt><dd>{{ selected.moons }}</dd></div>
            <div><dt>Avg Temp</dt><dd>{{ formatTemp(selected.avg_temp_c) }}</dd></div>
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
.search {
  width: 100%;
  padding: 10px 14px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  color: var(--text);
  font-size: 13px;
  margin-bottom: 16px;
  outline: none;
}
.search:focus { border-color: var(--accent); }
.layout { display: flex; gap: 20px; align-items: flex-start; }
.table {
  flex: 1;
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}
.table th {
  text-align: left;
  padding: 10px 12px;
  background: var(--surface);
  color: var(--text-dim);
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  border-bottom: 1px solid var(--border);
}
.table td {
  padding: 10px 12px;
  border-bottom: 1px solid var(--border);
}
.table tr { cursor: pointer; transition: background 0.1s; }
.table tbody tr:hover { background: var(--surface-hover); }
.table tr.active { background: var(--accent-dim); }
.name-cell { display: flex; align-items: center; gap: 8px; font-weight: 600; }
.dot { width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0; }
.type-tag {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 4px;
  background: var(--surface-hover);
  color: var(--text-dim);
}
.hot { color: var(--warning); }
.cold { color: var(--accent); }

.detail {
  width: 300px;
  flex-shrink: 0;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 20px;
  position: relative;
}
.close-btn {
  position: absolute;
  top: 12px;
  right: 12px;
  background: none;
  border: none;
  color: var(--text-dim);
  cursor: pointer;
  font-size: 16px;
}
.detail-dot { width: 40px; height: 40px; border-radius: 50%; margin-bottom: 12px; }
.detail h2 { font-size: 18px; margin-bottom: 4px; }
.detail-type { color: var(--text-dim); font-size: 12px; margin-bottom: 12px; }
.detail-desc { font-size: 13px; line-height: 1.5; color: var(--text-dim); margin-bottom: 16px; }
.detail-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}
.detail-grid dt { font-size: 11px; color: var(--text-dim); text-transform: uppercase; letter-spacing: 0.04em; }
.detail-grid dd { font-size: 14px; font-weight: 600; margin: 2px 0 0; }

@media (max-width: 800px) {
  .layout { flex-direction: column; }
  .detail { width: 100%; }
}
</style>
