<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import type { Planet, Moon, Stats } from '../types'
import StatCard from '../components/StatCard.vue'
import PlanetRanking from '../components/PlanetRanking.vue'

const planets = ref<Planet[]>([])
const moons = ref<Moon[]>([])
const stats = ref<Stats | null>(null)
const error = ref('')

onMounted(async () => {
  try {
    const [pRes, mRes, sRes] = await Promise.all([
      fetch('/api/planets'),
      fetch('/api/moons'),
      fetch('/api/stats'),
    ])
    planets.value = (await pRes.json()).planets
    moons.value = (await mRes.json()).moons
    stats.value = await sRes.json()
  } catch {
    error.value = 'Failed to load data — is the API running on port 8888?'
  }
})

const typeBreakdown = computed(() => {
  const counts: Record<string, number> = {}
  for (const p of planets.value) {
    counts[p.type] = (counts[p.type] || 0) + 1
  }
  return counts
})

const totalMoons = computed(() => planets.value.reduce((sum, p) => sum + p.moons, 0))
</script>

<template>
  <div class="dashboard">
    <h1 class="page-title">Mission Dashboard</h1>

    <div v-if="error" class="error">{{ error }}</div>

    <div v-else-if="stats" class="grid">
      <StatCard label="Planets" :value="stats.total_planets" icon="🪐" />
      <StatCard label="Known Moons" :value="totalMoons" icon="🌙" />
      <StatCard label="Largest" :value="stats.largest_planet" icon="📏" />
      <StatCard label="Hottest" :value="stats.hottest_planet" icon="🔥" />
    </div>

    <div v-if="planets.length" class="section">
      <h2 class="section-title">Planet Types</h2>
      <div class="type-badges">
        <div v-for="(count, type) in typeBreakdown" :key="type" class="type-badge">
          <span class="type-count">{{ count }}</span>
          <span class="type-name">{{ type }}</span>
        </div>
      </div>
    </div>

    <div v-if="planets.length" class="section">
      <h2 class="section-title">Ranking by Radius</h2>
      <PlanetRanking :planets="planets" />
    </div>
  </div>
</template>

<style scoped>
.page-title {
  font-size: 22px;
  font-weight: 700;
  margin-bottom: 20px;
}
.error {
  padding: 14px 18px;
  background: rgba(245, 91, 91, 0.1);
  border: 1px solid rgba(245, 91, 91, 0.3);
  border-radius: var(--radius);
  color: #fca5a5;
  font-size: 14px;
}
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 14px;
  margin-bottom: 28px;
}
.section { margin-bottom: 28px; }
.section-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-dim);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  margin-bottom: 12px;
}
.type-badges { display: flex; gap: 10px; flex-wrap: wrap; }
.type-badge {
  display: flex;
  align-items: center;
  gap: 8px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 10px 16px;
}
.type-count {
  font-size: 20px;
  font-weight: 700;
  color: var(--accent);
}
.type-name {
  font-size: 13px;
  color: var(--text-dim);
}
</style>
