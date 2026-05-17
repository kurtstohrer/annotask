/**
 * Singleton model-catalog cache for every place in the shell that picks a
 * provider model — Settings → Providers, the InitWizard agent step, and the
 * per-persona AgentDirectionsPanel.
 *
 * Why a single composable:
 * - Three components were each issuing their own `/__annotask/api/agent/models`
 *   fetch on mount. Switching tabs re-ran the probe and the opencode /
 *   Copilot calls (5s budget each) sometimes raced or stalled, leaving
 *   dropdowns stuck on "Auto" only.
 * - With one cache, the first opener pays the cost and every subsequent
 *   consumer gets the result reactively. `preload()` lets App.vue warm the
 *   cache at shell startup so the user never sees a half-loaded list.
 *
 * Caching strategy:
 * - In-memory reactive `Record<ProviderId, AgentModelCatalog | null>`.
 * - Persisted to localStorage with TTL (matches the 5-min server cache).
 * - In-flight promises are deduped by provider so concurrent ensure()
 *   calls from different components issue a single network call.
 *
 * Failure posture: no curated fallback list. If the probe fails or returns
 * nothing, the catalog comes back with only "Auto (CLI default)" plus an
 * `error` string from the server. Consumers must surface that error and
 * block selection of a specific model id — guessing causes runtime "model
 * not found" errors from the underlying CLI.
 */

import { computed, reactive, readonly } from 'vue'
import { PROVIDER_IDS, type ProviderId } from '../../embedded/provider-config'

export interface ModelOption {
  id: string
  label: string
  /** Mirror of the server-side ModelOption.source union — see
   *  src/server/agent-models.ts for what each value means. */
  source: 'auto' | 'discovered' | 'static'
}

export interface AgentModelCatalog {
  cli: ProviderId
  models: ModelOption[]
  /** true when the catalog includes live-discovered entries (vs Auto-only). */
  discovered: boolean
  /** ms since epoch the entry was fetched. */
  cachedAt: number
  /** Non-empty when the live probe couldn't return a real model list. */
  error?: string
}

const AUTO_OPTION: ModelOption = { id: '', label: 'Auto (CLI default)', source: 'auto' }

const STORAGE_KEY = 'annotask:agent:modelCatalog'
const TTL_MS = 5 * 60_000
const PROVIDER_IDS_SET = new Set<ProviderId>(PROVIDER_IDS)

interface CatalogStore {
  catalogs: Partial<Record<ProviderId, AgentModelCatalog>>
  loading: Partial<Record<ProviderId, boolean>>
  errors: Partial<Record<ProviderId, string>>
}

const state = reactive<CatalogStore>({
  catalogs: {},
  loading: {},
  errors: {},
})

// In-flight fetches deduped by provider id. Lives outside reactive state so
// concurrent callers reuse the same Promise without triggering renders.
const inflight = new Map<ProviderId, Promise<AgentModelCatalog | null>>()

let hydrated = false

function hydrateFromStorage() {
  if (hydrated || typeof window === 'undefined') return
  hydrated = true
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return
    const parsed = JSON.parse(raw) as Record<string, AgentModelCatalog>
    for (const [id, entry] of Object.entries(parsed)) {
      if (!PROVIDER_IDS_SET.has(id as ProviderId)) continue
      if (!entry || !Array.isArray(entry.models)) continue
      state.catalogs[id as ProviderId] = entry
    }
  } catch {
    // Storage may be unavailable (private mode, quota) — fall through to
    // network fetches. Never throw out of init.
  }
}

function persistToStorage() {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state.catalogs))
  } catch {
    // Quota exceeded or storage disabled. Cache stays in memory; nothing else
    // to do.
  }
}

/**
 * Catalog shown before any fetch has resolved. Holds only "Auto (CLI
 * default)" — there is intentionally no curated model list. Consumers must
 * treat `error` as a blocking condition; the empty list isn't a "loading
 * skeleton", it's the truth until the probe says otherwise.
 */
function emptyCatalog(cli: ProviderId, error?: string): AgentModelCatalog {
  return {
    cli,
    models: [AUTO_OPTION],
    discovered: false,
    cachedAt: 0, // 0 marks "never fetched" — always considered stale.
    error,
  }
}

function isFresh(entry: AgentModelCatalog | undefined, now: number): boolean {
  if (!entry) return false
  return now - entry.cachedAt < TTL_MS
}

async function fetchCatalog(cli: ProviderId, opts: { refresh?: boolean } = {}): Promise<AgentModelCatalog | null> {
  state.loading[cli] = true
  state.errors[cli] = undefined
  try {
    const url = `/__annotask/api/agent/models?cli=${encodeURIComponent(cli)}${opts.refresh ? '&refresh=1' : ''}`
    const res = await fetch(url)
    if (!res.ok) {
      state.errors[cli] = `HTTP ${res.status}`
      return null
    }
    const data = (await res.json()) as Partial<AgentModelCatalog>
    if (!data || !Array.isArray(data.models)) {
      state.errors[cli] = 'malformed response from /api/agent/models'
      return null
    }
    // An "empty" list (just Auto, plus an error from the server) is a valid
    // response now — it tells the UI to block model selection rather than
    // serve a curated guess. Persist it like any other catalog.
    const fresh: AgentModelCatalog = {
      cli,
      models: data.models,
      discovered: !!data.discovered,
      cachedAt: Date.now(),
      error: typeof data.error === 'string' && data.error.length > 0 ? data.error : undefined,
    }
    state.catalogs[cli] = fresh
    if (fresh.error) state.errors[cli] = fresh.error
    persistToStorage()
    return fresh
  } catch (err) {
    state.errors[cli] = (err as Error).message
    return null
  } finally {
    state.loading[cli] = false
  }
}

async function ensure(cli: ProviderId, opts: { refresh?: boolean } = {}): Promise<AgentModelCatalog> {
  hydrateFromStorage()
  const existing = state.catalogs[cli]
  const now = Date.now()

  // Fresh cache → return immediately.
  if (!opts.refresh && isFresh(existing, now)) return existing as AgentModelCatalog

  // Deduplicate concurrent fetches for the same provider.
  let pending = inflight.get(cli)
  if (!pending) {
    pending = fetchCatalog(cli, opts).finally(() => inflight.delete(cli))
    inflight.set(cli, pending)
  }
  const fetched = await pending

  if (fetched) return fetched
  if (existing) return existing
  return emptyCatalog(cli, state.errors[cli])
}

function getCatalog(cli: ProviderId): AgentModelCatalog {
  hydrateFromStorage()
  return state.catalogs[cli] ?? emptyCatalog(cli, state.errors[cli])
}

function isLoading(cli: ProviderId): boolean {
  return !!state.loading[cli]
}

function lastError(cli: ProviderId): string | undefined {
  return state.errors[cli]
}

async function preload(ids: ProviderId[]): Promise<void> {
  // Fire all probes in parallel; ensure() handles dedup + cache.
  await Promise.all(ids.map((id) => ensure(id).catch(() => null)))
}

async function refresh(cli: ProviderId): Promise<AgentModelCatalog> {
  return ensure(cli, { refresh: true })
}

export function useAgentModels() {
  hydrateFromStorage()
  return {
    state: readonly(state),
    catalogFor: (cli: ProviderId) => computed(() => getCatalog(cli)),
    modelsFor: (cli: ProviderId) => computed(() => getCatalog(cli).models),
    isLoading: (cli: ProviderId) => computed(() => isLoading(cli)),
    lastError: (cli: ProviderId) => computed(() => lastError(cli)),
    ensure,
    refresh,
    preload,
  }
}

// Test hook — never used by production code.
export function __resetAgentModelsCache() {
  state.catalogs = {}
  state.loading = {}
  state.errors = {}
  inflight.clear()
  hydrated = false
  if (typeof window !== 'undefined') {
    try { window.localStorage.removeItem(STORAGE_KEY) } catch { /* ignore */ }
  }
}
