import { ref } from 'vue'
import type { AnnotaskDesignSpec } from '../../schema'
import { on as wsOn } from '../services/wsClient'

interface DesignSpecState extends AnnotaskDesignSpec {
  initialized: boolean
}

const designSpec = ref<DesignSpecState | null>(null)
const isInitialized = ref(false)
const isLoading = ref(true)

let fetched = false

async function fetchDesignSpec() {
  try {
    const res = await fetch('/__annotask/api/design-spec')
    const data = await res.json()
    designSpec.value = data
    isInitialized.value = !!data.initialized
  } catch {
    designSpec.value = null
    isInitialized.value = false
  } finally {
    isLoading.value = false
  }
}

export function useDesignSpec() {
  if (!fetched) {
    fetched = true
    fetchDesignSpec()
    wsOn('designspec:updated', () => fetchDesignSpec())
  }
  return { designSpec, isInitialized, isLoading, refetch: fetchDesignSpec }
}
