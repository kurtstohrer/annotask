<script setup lang="ts">
import { ref, onMounted } from 'vue'
import MoonTable from '../components/MoonTable.vue'
import MoonDetail from '../components/MoonDetail.vue'
import type { Moon } from '../types'

const moons = ref<Moon[]>([])
const selectedMoon = ref<Moon | null>(null)
const loading = ref(true)
const error = ref('')

async function fetchMoons() {
  try {
    const res = await fetch('/api/moons')
    const data = await res.json()
    moons.value = data.moons
  } catch {
    error.value = 'Failed to connect to API. Is the server running on :8000?'
  } finally {
    loading.value = false
  }
}

onMounted(fetchMoons)
</script>

<template>
  <div v-if="error" class="error-banner">
    <i class="pi pi-exclamation-triangle"></i>
    {{ error }}
  </div>

  <div class="layout">
    <MoonTable
      :moons="moons"
      :loading="loading"
      :selected="selectedMoon"
      @select="selectedMoon = $event"
    />
    <MoonDetail
      v-if="selectedMoon"
      :moon="selectedMoon"
      @close="selectedMoon = null"
    />
  </div>
</template>
