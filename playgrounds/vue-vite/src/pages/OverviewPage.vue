<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import PlanetCard from '../components/PlanetCard.vue'
import type { Planet, SolarStats } from '../types'

const router = useRouter()
const planets = ref<Planet[]>([])
const stats = ref<SolarStats | null>(null)
const error = ref('')

onMounted(async () => {
  try {
    const [pRes, sRes] = await Promise.all([
      fetch('/api/solar/planets?sort_by=distance_from_sun_mkm'),
      fetch('/api/solar/stats'),
    ])
    if (!pRes.ok || !sRes.ok) throw new Error('api')
    planets.value = (await pRes.json()).planets ?? []
    stats.value = await sRes.json()
  } catch {
    error.value = 'Failed to load solar data — is the API running on port 8888?'
  }
})

function openPlanet(planet: Planet) {
  router.push({ path: '/planets', query: { id: String(planet.id) } })
}
</script>

<template>
  <section class="overview">
    <header class="page-header">
      <h1 class="title">The Solar System</h1>
      <p class="lede">
        Eight planets, dozens of moons, one star. All facts served live from the Solar System API.
      </p>
    </header>

    <p v-if="error" class="error-banner">{{ error }}</p>

    <div v-if="stats" class="stats-grid">
      <div class="stat-card">
        <span class="stat-label">Planets</span>
        <span class="stat-value">{{ stats.total_planets }}</span>
      </div>
      <div class="stat-card">
        <span class="stat-label">Tracked Moons</span>
        <span class="stat-value">{{ stats.total_moons }}</span>
      </div>
      <div class="stat-card">
        <span class="stat-label">Largest</span>
        <span class="stat-value">{{ stats.largest_planet }}</span>
      </div>
      <div class="stat-card">
        <span class="stat-label">Smallest</span>
        <span class="stat-value">{{ stats.smallest_planet }}</span>
      </div>
      <div class="stat-card">
        <span class="stat-label">Hottest</span>
        <span class="stat-value">{{ stats.hottest_planet }}</span>
      </div>
      <div class="stat-card">
        <span class="stat-label">Coldest</span>
        <span class="stat-value">{{ stats.coldest_planet }}</span>
      </div>
    </div>

    <section class="planets-section">
      <h2 class="section-title">Planets, ordered by distance from the Sun</h2>
      <div class="planet-grid">
        <PlanetCard
          v-for="planet in planets"
          :key="planet.id"
          :planet="planet"
          @select="openPlanet"
        />
      </div>
    </section>
  </section>
</template>

<style scoped>
.overview { display: flex; flex-direction: column; gap: 28px; }

.page-header { display: flex; flex-direction: column; gap: 6px; }
.title { font-size: 28px; font-weight: 700; letter-spacing: -0.02em; }
.lede { color: var(--text-muted); font-size: 14px; max-width: 640px; }

.stats-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: 12px;
}

.stat-card {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 14px 18px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 12px;
}

.stat-label {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.stat-value {
  font-size: 20px;
  font-weight: 700;
  color: var(--text);
}

.planets-section { display: flex; flex-direction: column; gap: 12px; }

.section-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.planet-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 12px;
}
</style>
