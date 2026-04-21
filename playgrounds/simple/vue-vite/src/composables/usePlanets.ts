import { ref } from 'vue'
import type { Planet } from '../types'

export function usePlanets() {
  const planets = ref<Planet[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)

  async function load() {
    loading.value = true
    error.value = null
    try {
      const res = await fetch('/api/solar/planets?sort_by=distance_from_sun_mkm')
      if (!res.ok) throw new Error('api')
      planets.value = (await res.json()).planets ?? []
    } catch {
      error.value = 'Failed to load solar data'
    } finally {
      loading.value = false
    }
  }

  return { planets, loading, error, load }
}
