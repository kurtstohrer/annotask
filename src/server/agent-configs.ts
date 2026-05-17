import fsp from 'node:fs/promises'
import path from 'node:path'
import type { ProviderId, EffortLevel } from '../embedded/provider-config.js'

export interface AgentConfigEntry {
  /** Project-specific context written by the init agent, editable in settings. */
  projectDirections: string
  /** Per-agent provider override. When unset, the persona's built-in
   *  providerId from src/embedded/persona.ts applies. */
  providerId?: ProviderId
  /** Per-agent model id. Empty string means "auto" (provider default). */
  model?: string
  /** Per-agent reasoning effort. `auto` means "let the provider pick". */
  effort?: EffortLevel
}

export interface AgentConfigs {
  version: 1
  agents: Record<string, AgentConfigEntry>
}

export function createAgentConfigStore(projectRoot: string) {
  const filePath = path.join(projectRoot, '.annotask', 'agents.json')

  // No in-memory cache: the init pipeline writes agents.json directly via
  // fsp.writeFile (bypassing this store), so a cache here would go stale and
  // serve up the empty seed forever. The file is small — always read fresh.
  async function load(): Promise<AgentConfigs> {
    try {
      const raw = JSON.parse(await fsp.readFile(filePath, 'utf-8'))
      return {
        version: 1,
        agents: typeof raw.agents === 'object' && raw.agents !== null ? raw.agents : {},
      }
    } catch {
      return { version: 1, agents: {} }
    }
  }

  async function persist(data: AgentConfigs): Promise<void> {
    const dir = path.dirname(filePath)
    await fsp.mkdir(dir, { recursive: true })
    const tmp = `${filePath}.tmp.${process.pid}.${Date.now()}`
    await fsp.writeFile(tmp, JSON.stringify(data, null, 2), 'utf-8')
    await fsp.rename(tmp, filePath)
  }

  return {
    get: load,
    set: async (personaId: string, entry: Partial<AgentConfigEntry>): Promise<AgentConfigs> => {
      const current = await load()
      const existing = current.agents[personaId] ?? { projectDirections: '' }
      const next: AgentConfigs = {
        version: 1,
        agents: { ...current.agents, [personaId]: { ...existing, ...entry } },
      }
      await persist(next)
      return next
    },
    invalidate: () => { /* no-op — load() always reads fresh from disk */ },
  }
}

export type AgentConfigStore = ReturnType<typeof createAgentConfigStore>
