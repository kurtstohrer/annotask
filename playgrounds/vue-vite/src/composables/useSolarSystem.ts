import { ref } from 'vue'

interface SolarFacts {
  sun_temperature_k?: number
  planet_count?: number
  moon_count?: number
}

export function useSolarSystem() {
  const facts = ref<SolarFacts | null>(null)
  const loading = ref(false)

  async function load() {
    loading.value = true
    try {
      const res = await fetch('/api/solar/summary')
      if (res.ok) facts.value = await res.json()
    } finally {
      loading.value = false
    }
  }

  return { facts, loading, load }
}
