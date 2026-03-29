<script setup lang="ts">
import { ref, onMounted } from 'vue'
import PlanetTable from '../components/PlanetTable.vue'
import PlanetDetail from '../components/PlanetDetail.vue'
import type { Planet } from '../types'

const planets = ref<Planet[]>([])
const selectedPlanet = ref<Planet | null>(null)
const loading = ref(true)
const error = ref('')

async function fetchPlanets() {
  try {
    const res = await fetch('/api/planets')
    const data = await res.json()
    planets.value = data.planets
  } catch {
    error.value = 'Failed to connect to API. Is the server running on :8000?'
  } finally {
    loading.value = false
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
    <PlanetTable
      :planets="planets"
      :loading="loading"
      :selected="selectedPlanet"
      @select="selectedPlanet = $event"
    />
    <PlanetDetail
      v-if="selectedPlanet"
      :planet="selectedPlanet"
      @close="selectedPlanet = null"
    />
  </div>
</template>
