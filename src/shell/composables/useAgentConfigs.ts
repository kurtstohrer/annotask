import { ref, type Ref } from 'vue'
import type { ProviderId, EffortLevel } from '../../embedded/provider-config'
import { on as wsOn } from '../services/wsClient'

export interface AgentConfigEntry {
  projectDirections: string
  providerId?: ProviderId
  model?: string
  effort?: EffortLevel
}

export interface AgentConfigs {
  version: number
  agents: Record<string, AgentConfigEntry>
}

const BASE = '/__annotask/api'

let singleton: ReturnType<typeof create> | null = null

function create() {
  const configs: Ref<Record<string, AgentConfigEntry>> = ref({})
  const loading = ref(false)
  const error: Ref<string | null> = ref(null)

  async function refresh() {
    loading.value = true
    error.value = null
    try {
      const res = await fetch(`${BASE}/agent-configs`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data: AgentConfigs = await res.json()
      configs.value = data.agents ?? {}
    } catch (e) {
      error.value = (e as Error)?.message ?? 'Failed to load agent configs'
    } finally {
      loading.value = false
    }
  }

  async function save(personaId: string, patch: Partial<AgentConfigEntry>): Promise<boolean> {
    try {
      const res = await fetch(`${BASE}/agent-configs/${encodeURIComponent(personaId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data: AgentConfigs = await res.json()
      configs.value = data.agents ?? {}
      return true
    } catch {
      return false
    }
  }

  refresh()

  // Re-fetch when init finishes (or any sub-step completes), since the
  // agent-configs step writes/rewrites .annotask/agents.json on disk and
  // the panel's cached snapshot would otherwise show empty / stale data.
  wsOn('init:progress', (data: any) => {
    const steps = Array.isArray(data?.steps) ? data.steps : []
    const ac = steps.find((s: any) => s?.id === 'agent-configs')
    if (ac && (ac.status === 'success' || ac.status === 'error')) {
      void refresh()
    }
  })

  return { configs, loading, error, save, refresh }
}

export function useAgentConfigs() {
  if (!singleton) singleton = create()
  return singleton
}
