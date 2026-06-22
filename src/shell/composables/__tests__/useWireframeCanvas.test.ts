import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest'
import { ref } from 'vue'

// useWireframeCanvas pulls in the useWireframeDoc singleton, which subscribes
// to the shared WebSocket client — stub it out like the other composable tests.
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

import { useWireframeCanvas, type WireframeCanvasIframe } from '../useWireframeCanvas'
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
    anchor: { file: 'PlanetsPage.vue', line: 9, position: 'append', component: 'PlanetsPage', targetTag: 'section' },
    inserted: { tag: 'planetcard', componentName: 'PlanetCard' },
    fidelity: 'live',
    mounted: true,
    createdAt: 1,
    ...extra,
  }
}

function docWith(instances: WireframeInstance[]): WireframeDocument {
  return { version: '1.0', updatedAt: 0, rev: 1, routes: [{ route: '/r', instances }] }
}

function makeIframe(): WireframeCanvasIframe {
  return {
    currentRoute: ref('/r'),
    bridgeReady: ref(false), // watchers stay quiet — these tests drive Build directly
    resolveElementAt: vi.fn(async () => null),
    findTemplateGroup: vi.fn(async () => ({ eids: ['target-1'] })),
    insertComponent: vi.fn(async () => ({ eid: 'mounted-1', mounted: true })),
    insertPlaceholder: vi.fn(async () => 'mounted-1'),
    removePlaceholder: vi.fn(async () => undefined),
  }
}

describe('useWireframeCanvas — Build collector', () => {
  let fetchMock: ReturnType<typeof vi.fn>
  let createRouteTask: Mock<(data: Record<string, unknown>) => Promise<{ id: string } | null>>
  /** Deep snapshot of the createRouteTask payload at call time — Build stamps
   *  the same instance objects 'building' right after, so a live reference
   *  would show post-mutation state. */
  let capturedPayloads: Array<Record<string, unknown>>
  let canvas: ReturnType<typeof useWireframeCanvas>

  beforeEach(async () => {
    capturedPayloads = []
    fetchMock = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'PUT') {
        const sent = JSON.parse(init.body as string) as WireframeDocument
        return jsonResponse({ ...sent, rev: (sent.rev ?? 0) + 1 })
      }
      return jsonResponse(docWith([]))
    })
    vi.stubGlobal('fetch', fetchMock)
    createRouteTask = vi.fn(async (data: Record<string, unknown>) => {
      capturedPayloads.push(JSON.parse(JSON.stringify(data)))
      return { id: 'task-9' }
    })
    canvas = useWireframeCanvas({
      iframe: makeIframe(),
      createRouteTask,
    })
    // Let the doc singleton's initial load settle before seeding the doc, so a
    // late response can't clobber the fixture.
    await Promise.resolve()
    await Promise.resolve()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('batches ONLY placed instances (with previewProps) into one wireframe_apply task and stamps them building', async () => {
    canvas.wireframeDoc.doc.value = docWith([
      instance('wfi-1', { status: 'placed', previewProps: { label: 'Hello' } }),
      instance('wfi-2'), // legacy-undefined counts as placed
      instance('wfi-3', { status: 'building', taskId: 'task-old' }),
    ])
    expect(canvas.placedCount.value).toBe(2)

    await canvas.buildWireframeRoute()

    expect(createRouteTask).toHaveBeenCalledTimes(1)
    const payload = capturedPayloads[0]
    expect(payload.type).toBe('wireframe_apply')
    const wireframe = (payload.context as { wireframe: { route: string; instances: WireframeInstance[] } }).wireframe
    expect(wireframe.route).toBe('/r')
    expect(wireframe.instances.map((i) => i.id)).toEqual(['wfi-1', 'wfi-2'])
    expect(wireframe.instances[0].previewProps).toEqual({ label: 'Hello' })

    const byId = Object.fromEntries(canvas.wireframeDoc.instancesForRoute('/r').map((i) => [i.id, i]))
    expect(byId['wfi-1'].status).toBe('building')
    expect(byId['wfi-1'].taskId).toBe('task-9')
    expect(byId['wfi-2'].status).toBe('building')
    expect(byId['wfi-3'].taskId).toBe('task-old') // untouched
    expect(canvas.placedCount.value).toBe(0)
  })

  it('a second Build with nothing placed creates no task', async () => {
    canvas.wireframeDoc.doc.value = docWith([instance('wfi-1', { status: 'placed' })])
    await canvas.buildWireframeRoute()
    expect(createRouteTask).toHaveBeenCalledTimes(1)
    await canvas.buildWireframeRoute()
    expect(createRouteTask).toHaveBeenCalledTimes(1)
  })

  it('a double-click cannot emit a duplicate task (re-entrancy guard)', async () => {
    canvas.wireframeDoc.doc.value = docWith([instance('wfi-1', { status: 'placed' })])
    // Hold task creation open so the second click lands mid-build.
    let release!: (v: { id: string }) => void
    createRouteTask.mockImplementationOnce(async (data: Record<string, unknown>) => {
      capturedPayloads.push(JSON.parse(JSON.stringify(data)))
      return new Promise((resolve) => { release = resolve })
    })
    const first = canvas.buildWireframeRoute()
    const second = canvas.buildWireframeRoute()
    release({ id: 'task-9' })
    await Promise.all([first, second])
    expect(createRouteTask).toHaveBeenCalledTimes(1)
  })

  it('a failed task creation leaves the batch placed so Build can retry', async () => {
    canvas.wireframeDoc.doc.value = docWith([instance('wfi-1', { status: 'placed' })])
    createRouteTask.mockResolvedValueOnce(null) // POST rejected / server down
    await canvas.buildWireframeRoute()
    expect(canvas.wireframeDoc.instancesForRoute('/r')[0].status).toBe('placed')
    expect(canvas.placedCount.value).toBe(1)
    await canvas.buildWireframeRoute()
    expect(createRouteTask).toHaveBeenCalledTimes(2)
  })

  it('deletePlacement unmounts the live node and removes the instance from the doc', async () => {
    canvas.wireframeDoc.doc.value = docWith([instance('wfi-1'), instance('wfi-2')])
    canvas.registerContainer('wfi-1', 'container-eid-1')
    const iframe = makeIframe()
    // Re-create the canvas against this iframe so removePlaceholder is observable.
    const localCanvas = useWireframeCanvas({
      iframe,
      createRouteTask,
    })
    localCanvas.registerContainer('wfi-1', 'container-eid-1')
    await localCanvas.deletePlacement('wfi-1')
    expect(iframe.removePlaceholder).toHaveBeenCalledWith('container-eid-1')
    expect(localCanvas.wireframeDoc.instancesForRoute('/r').map((i) => i.id)).toEqual(['wfi-2'])
  })
})
