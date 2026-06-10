import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// Replace the shared WebSocket client so importing useWireframeDoc neither
// opens a real socket nor races reconnect timers (same pattern as useTasks).
vi.mock('../../services/wsClient', () => {
  const listeners = new Map<string, Set<(d?: unknown) => void>>()
  return {
    on: (event: string, handler: (d?: unknown) => void) => {
      if (!listeners.has(event)) listeners.set(event, new Set())
      listeners.get(event)!.add(handler)
      return () => { listeners.get(event)?.delete(handler) }
    },
    send: () => { /* no-op */ },
    isConnected: () => true,
  }
})

import { useWireframeDoc, type WireframeIframe } from '../useWireframeDoc'
import type { WireframeDocument, WireframeInstance } from '../../../shared/wireframe-types'

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response
}

function instance(id: string, extra: Partial<WireframeInstance> = {}): WireframeInstance {
  return {
    id,
    kind: 'component',
    anchor: { file: 'PlanetsPage.vue', line: 9, position: 'append', targetTag: 'section' },
    inserted: { tag: 'planetcard', componentName: 'PlanetCard', props: { real: true } },
    fidelity: 'live',
    mounted: true,
    createdAt: 1,
    ...extra,
  }
}

function docWith(instances: WireframeInstance[], route = '/r'): WireframeDocument {
  return { version: '1.0', updatedAt: 0, rev: 1, routes: [{ route, instances }] }
}

function makeIframe(overrides: Partial<WireframeIframe> = {}): WireframeIframe {
  return {
    findTemplateGroup: vi.fn(async () => ({ eids: ['target-1'] })),
    insertComponent: vi.fn(async () => ({ eid: 'mounted-1' })),
    insertPlaceholder: vi.fn(async () => 'mounted-1'),
    ...overrides,
  }
}

describe('useWireframeDoc', () => {
  let fetchMock: ReturnType<typeof vi.fn>
  let warnSpy: ReturnType<typeof vi.spyOn>
  let wf: ReturnType<typeof useWireframeDoc>

  beforeEach(async () => {
    fetchMock = vi.fn().mockResolvedValue(jsonResponse(docWith([])))
    vi.stubGlobal('fetch', fetchMock)
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    wf = useWireframeDoc()
    // The singleton's first useWireframeDoc() fires load(); let it settle so a
    // late response can't clobber the doc a test seeds below.
    await Promise.resolve()
    await Promise.resolve()
    wf.resetApplied()
    wf.staleIds.value = []
    wf.failedIds.value = []
    wf.loadError.value = null
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  describe('reapply', () => {
    it('mounts only placed (or legacy-undefined) instances — never building/applied', async () => {
      wf.doc.value = docWith([
        instance('wfi-placed', { status: 'placed' }),
        instance('wfi-legacy'), // no status field == placed
        instance('wfi-building', { status: 'building', taskId: 'task-1' }),
        instance('wfi-applied', { status: 'applied', taskId: 'task-1' }),
      ])
      const iframe = makeIframe()
      await wf.reapply('/r', iframe)
      const mountedIds = vi.mocked(iframe.insertComponent).mock.calls.map((c) => c[5])
      expect(mountedIds).toEqual(['wfi-placed', 'wfi-legacy'])
    })

    it('mounts components with previewProps when captured, falling back to inserted.props', async () => {
      wf.doc.value = docWith([
        instance('wfi-sampled', { previewProps: { label: 'Hello' } }),
        instance('wfi-plain'),
      ])
      const iframe = makeIframe()
      await wf.reapply('/r', iframe)
      expect(iframe.insertComponent).toHaveBeenNthCalledWith(1, 'target-1', 'append', 'PlanetCard', { label: 'Hello' }, undefined, 'wfi-sampled')
      expect(iframe.insertComponent).toHaveBeenNthCalledWith(2, 'target-1', 'append', 'PlanetCard', { real: true }, undefined, 'wfi-plain')
    })

    it('isolates per-instance failures — a throwing insert does not stop the next', async () => {
      wf.doc.value = docWith([instance('wfi-boom'), instance('wfi-ok')])
      const iframe = makeIframe({
        insertComponent: vi.fn(async (...args: unknown[]) => {
          if (args[5] === 'wfi-boom') throw new Error('mount failed')
          return { eid: 'mounted-ok' }
        }),
      })
      await wf.reapply('/r', iframe)
      expect(iframe.insertComponent).toHaveBeenCalledTimes(2)
      expect(wf.failedIds.value).toEqual(['wfi-boom'])
      expect(warnSpy).toHaveBeenCalled()
    })

    it('records a stale anchor (empty template group) in staleIds instead of mounting', async () => {
      wf.doc.value = docWith([instance('wfi-stale'), instance('wfi-live')])
      const iframe = makeIframe({
        findTemplateGroup: vi.fn(async (file: string, line: string) =>
          line === '9' ? { eids: [] } : { eids: ['target-1'] }),
      })
      // Drift only the first instance's anchor resolution.
      wf.doc.value.routes[0].instances[1].anchor.line = 22
      await wf.reapply('/r', iframe)
      expect(wf.staleIds.value).toEqual(['wfi-stale'])
      expect(vi.mocked(iframe.insertComponent).mock.calls.map((c) => c[5])).toEqual(['wfi-live'])

      // A later pass that resolves again clears the badge (no force needed —
      // stale instances were never marked applied).
      iframe.findTemplateGroup = vi.fn(async () => ({ eids: ['target-1'] }))
      await wf.reapply('/r', iframe)
      expect(wf.staleIds.value).toEqual([])
    })

    it('skips an instance whose stamped node is already in the iframe DOM', async () => {
      wf.doc.value = docWith([instance('wfi-already'), instance('wfi-fresh')])
      const iframe = makeIframe({
        resolveBySelectors: vi.fn(async (selectors: string[]) => selectors.map((selector) => ({
          selector,
          eid: selector.includes('wfi-already') ? 'existing-eid' : null,
        }))),
      })
      await wf.reapply('/r', iframe)
      expect(iframe.resolveBySelectors).toHaveBeenCalledWith([
        '[data-annotask-instance="wfi-already"]',
        '[data-annotask-instance="wfi-fresh"]',
      ])
      expect(vi.mocked(iframe.insertComponent).mock.calls.map((c) => c[5])).toEqual(['wfi-fresh'])
    })

    it('does not re-mount an instance twice for the same route (appliedIds de-dup)', async () => {
      wf.doc.value = docWith([instance('wfi-once')])
      const iframe = makeIframe()
      await wf.reapply('/r', iframe)
      await wf.reapply('/r', iframe)
      expect(iframe.insertComponent).toHaveBeenCalledTimes(1)
      await wf.reapply('/r', iframe, { force: true })
      expect(iframe.insertComponent).toHaveBeenCalledTimes(2)
    })
  })

  describe('persist (rev round-trip)', () => {
    it('sends the current rev and adopts the server-stamped doc on success', async () => {
      wf.doc.value = docWith([])
      fetchMock.mockImplementation(async (_url: string, init?: RequestInit) => {
        const sent = JSON.parse(init!.body as string) as WireframeDocument
        expect(sent.rev).toBe(1)
        return jsonResponse({ ...sent, rev: 2 })
      })
      await wf.saveInstance('/r', instance('wfi-new'))
      expect(wf.doc.value.rev).toBe(2)
      expect(wf.loadError.value).toBeNull()
    })

    it('on 409 it reloads the doc, surfaces a conflict message, and does not retry the write', async () => {
      wf.doc.value = docWith([instance('wfi-mine')])
      const serverDoc = { ...docWith([instance('wfi-theirs')]), rev: 5 }
      fetchMock.mockImplementation(async (_url: string, init?: RequestInit) => {
        if (init?.method === 'PUT') return jsonResponse({ error: { code: 'conflict', message: 'stale' } }, 409)
        return jsonResponse(serverDoc) // the reload GET
      })
      await wf.saveInstance('/r', instance('wfi-another'))
      const puts = fetchMock.mock.calls.filter((c) => (c[1] as RequestInit | undefined)?.method === 'PUT')
      expect(puts).toHaveLength(1)
      expect(wf.doc.value.rev).toBe(5)
      expect(wf.instancesForRoute('/r').map((i) => i.id)).toEqual(['wfi-theirs'])
      expect(wf.loadError.value).toContain('changed in another tab')
    })
  })

  describe('markInstancesBuilding / deleteInstance', () => {
    beforeEach(() => {
      // Echo PUTs back with a bumped rev so doc.value stays coherent.
      fetchMock.mockImplementation(async (_url: string, init?: RequestInit) => {
        if (init?.method === 'PUT') {
          const sent = JSON.parse(init.body as string) as WireframeDocument
          return jsonResponse({ ...sent, rev: (sent.rev ?? 0) + 1 })
        }
        return jsonResponse(docWith([]))
      })
    })

    it('stamps the batch building with the owning task id in ONE persist', async () => {
      wf.doc.value = docWith([instance('wfi-a'), instance('wfi-b'), instance('wfi-c')])
      await wf.markInstancesBuilding('/r', ['wfi-a', 'wfi-c'], 'task-7')
      const byId = Object.fromEntries(wf.instancesForRoute('/r').map((i) => [i.id, i]))
      expect(byId['wfi-a'].status).toBe('building')
      expect(byId['wfi-a'].taskId).toBe('task-7')
      expect(byId['wfi-c'].status).toBe('building')
      expect(byId['wfi-b'].status).toBeUndefined()
      const puts = fetchMock.mock.calls.filter((c) => (c[1] as RequestInit | undefined)?.method === 'PUT')
      expect(puts).toHaveLength(1)
    })

    it('deleteInstance drops the instance and its stale/failed bookkeeping', async () => {
      wf.doc.value = docWith([instance('wfi-dead'), instance('wfi-kept')])
      wf.staleIds.value = ['wfi-dead']
      wf.failedIds.value = ['wfi-dead']
      await wf.deleteInstance('/r', 'wfi-dead')
      expect(wf.instancesForRoute('/r').map((i) => i.id)).toEqual(['wfi-kept'])
      expect(wf.staleIds.value).toEqual([])
      expect(wf.failedIds.value).toEqual([])
    })
  })
})
