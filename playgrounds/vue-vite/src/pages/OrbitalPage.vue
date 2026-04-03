<script setup lang="ts">
import { ref, onMounted } from 'vue'
import OrbitalDiagram from '../components/OrbitalDiagram.vue'
import PlanetDetail from '../components/PlanetDetail.vue'
import MoonDetail from '../components/MoonDetail.vue'
import type { Planet, Moon } from '../types'

const planets = ref<Planet[]>([])
const moons = ref<Moon[]>([])
const selectedPlanet = ref<Planet | null>(null)
const selectedMoon = ref<Moon | null>(null)
const loading = ref(true)
const error = ref('')

async function fetchPlanets() {
  try {
    const [planetsRes, moonsRes] = await Promise.all([
      fetch('/api/planets'),
      fetch('/api/moons'),
    ])
    const planetsData = await planetsRes.json()
    const moonsData = await moonsRes.json()
    planets.value = planetsData.planets
    moons.value = moonsData.moons
  } catch {
    error.value = 'Failed to connect to API. Is the server running on :8000?'
  } finally {
    loading.value = false
  }
}

function onSelectPlanet(planet: Planet) {
  selectedMoon.value = null
  selectedPlanet.value = planet
}

function onSelectMoon(moonName: string, planetName: string) {
  const moon = moons.value.find(m => m.name === moonName && m.planet === planetName)
  if (moon) {
    selectedPlanet.value = null
    selectedMoon.value = moon
  }
}

onMounted(fetchPlanets)
</script>

<template>
  <div v-if="error" class="error-banner">
    <i class="pi pi-exclamation-triangle"></i>
    {{ error }}
  </div>

  <div class="layout">
    <OrbitalDiagram
      :planets="planets"
      :loading="loading"
      @select="onSelectPlanet"
      @select-moon="onSelectMoon"
    />
    <PlanetDetail
      v-if="selectedPlanet"
      :planet="selectedPlanet"
      @close="selectedPlanet = null"
    />
    <MoonDetail
      v-if="selectedMoon"
      :moon="selectedMoon"
      @close="selectedMoon = null"
    />
  </div>
</template>
