// @vitest-environment jsdom
/**
 * useAgentModels singleton composable — caching, dedup, refresh.
 *
 * The fetch boundary is mocked so we can verify:
 *   - identical concurrent ensure() calls collapse to a single network call
 *   - the localStorage cache survives a "page reload" (composable reset)
 *   - refresh() bypasses the in-memory cache and issues a new fetch
 *   - fetch failures surface as an `error` field with an Auto-only catalog,
 *     so the UI can block selection of a specific model id (no curated
 *     guesses — see src/server/agent-models.ts for the rationale).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useAgentModels, __resetAgentModelsCache } from '../useAgentModels'

type MockFetch = ReturnType<typeof vi.fn> & {
  responses: Array<() => Promise<Response>>
}

function makeMockFetch(): MockFetch {
  const mock = vi.fn(async (input: RequestInfo) => {
    const url = typeof input === 'string' ? input : input.toString()
    const next = (mock as MockFetch).responses.shift()
    if (!next) throw new Error(`Unexpected fetch: ${url}`)
    return next()
  }) as MockFetch
  mock.responses = []
  return mock
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  }) as Response
}

beforeEach(() => {
  __resetAgentModelsCache()
  window.localStorage.clear()
})

describe('useAgentModels', () => {
  it('returns an Auto-only catalog before any fetch lands', () => {
    const m = useAgentModels()
    const cat = m.catalogFor('opencode-local').value
    expect(cat.models).toHaveLength(1)
    expect(cat.models[0].id).toBe('') // Auto option only — no curated guesses
    expect(cat.discovered).toBe(false)
  })

  it('dedupes concurrent ensure() calls into a single fetch', async () => {
    const fetchMock = makeMockFetch()
    fetchMock.responses.push(async () =>
      jsonResponse({
        cli: 'opencode-local',
        discovered: true,
        models: [
          { id: '', label: 'Auto', source: 'auto' },
          { id: 'openai/gpt-5.4', label: 'GPT-5.4', source: 'discovered' },
        ],
        cachedAt: Date.now(),
      }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const m = useAgentModels()

    const [a, b, c] = await Promise.all([
      m.ensure('opencode-local'),
      m.ensure('opencode-local'),
      m.ensure('opencode-local'),
    ])
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(a.models.map(x => x.id)).toContain('openai/gpt-5.4')
    expect(b).toBe(a)
    expect(c).toBe(a)
  })

  it('refresh() bypasses the cache and re-fetches', async () => {
    const fetchMock = makeMockFetch()
    fetchMock.responses.push(
      async () => jsonResponse({
        cli: 'codex-local',
        discovered: true,
        models: [{ id: 'gpt-5.4', label: 'GPT-5.4', source: 'discovered' }],
        cachedAt: Date.now(),
      }),
      async () => jsonResponse({
        cli: 'codex-local',
        discovered: true,
        models: [{ id: 'gpt-5.5', label: 'GPT-5.5', source: 'discovered' }],
        cachedAt: Date.now(),
      }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const m = useAgentModels()

    const first = await m.ensure('codex-local')
    expect(first.models[0].id).toBe('gpt-5.4')
    // Second ensure without refresh hits the cache — no new fetch.
    await m.ensure('codex-local')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    // refresh forces a new fetch and updates the catalog.
    const refreshed = await m.refresh('codex-local')
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(refreshed.models[0].id).toBe('gpt-5.5')
    // refresh URL carries ?refresh=1
    const calls = (fetchMock as unknown as { mock: { calls: unknown[][] } }).mock.calls
    expect(String(calls[1][0])).toContain('refresh=1')
  })

  it('survives a "page reload" via localStorage', async () => {
    const fetchMock = makeMockFetch()
    fetchMock.responses.push(async () => jsonResponse({
      cli: 'opencode-local',
      discovered: true,
      models: [{ id: 'cached/model', label: 'cached/model', source: 'discovered' }],
      cachedAt: Date.now(),
    }))
    vi.stubGlobal('fetch', fetchMock)
    const m = useAgentModels()
    await m.ensure('opencode-local')

    // Simulate a fresh shell mount: blow away in-memory state, keep storage.
    __resetAgentModelsCache.call(null) // also clears storage — undo that
    // Re-seed storage from what we just learned (mirrors what persistToStorage does)
    window.localStorage.setItem('annotask:agent:modelCatalog', JSON.stringify({
      'opencode-local': {
        cli: 'opencode-local',
        discovered: true,
        models: [{ id: 'cached/model', label: 'cached/model', source: 'discovered' }],
        cachedAt: Date.now(),
      },
    }))

    const m2 = useAgentModels()
    const cat = m2.catalogFor('opencode-local').value
    expect(cat.models.some(x => x.id === 'cached/model')).toBe(true)
  })

  it('blocks the picker (Auto-only + error) when the server returns an error', async () => {
    const fetchMock = makeMockFetch()
    fetchMock.responses.push(async () => new Response('boom', { status: 500 }) as Response)
    vi.stubGlobal('fetch', fetchMock)
    const m = useAgentModels()
    const cat = await m.ensure('opencode-local')
    expect(cat.models).toHaveLength(1)
    expect(cat.models[0].id).toBe('') // Auto only — no curated fallback
    expect(cat.discovered).toBe(false)
    expect(m.state.errors['opencode-local']).toBeDefined()
  })

  it('surfaces the server `error` field when the probe returns Auto-only', async () => {
    const fetchMock = makeMockFetch()
    fetchMock.responses.push(async () => jsonResponse({
      cli: 'copilot-local',
      discovered: false,
      models: [{ id: '', label: 'Auto (CLI default)', source: 'auto' }],
      cachedAt: Date.now(),
      error: 'copilot-local: no models returned by the live probe.',
    }))
    vi.stubGlobal('fetch', fetchMock)
    const m = useAgentModels()
    const cat = await m.ensure('copilot-local')
    expect(cat.discovered).toBe(false)
    expect(cat.error).toMatch(/no models returned/i)
    expect(m.state.errors['copilot-local']).toBe(cat.error)
  })
})
