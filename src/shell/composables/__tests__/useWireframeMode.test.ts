// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { ref, nextTick } from 'vue'

vi.mock('../../services/wsClient', () => ({
  on: () => () => { /* no-op */ },
  send: () => { /* no-op */ },
  isConnected: () => true,
}))

import { useWireframeMode, type WireframeModeIframe } from '../useWireframeMode'
import { useWireframeDoc } from '../useWireframeDoc'
import type { WireframeCaptureResult } from '../../../shared/bridge-types'
import type { InteractionMode } from '../useInteractionMode'

const CAPTURE_OK: WireframeCaptureResult = {
  viewport: { width: 1280, height: 800, docWidth: 1280, docHeight: 2400, scale: 2 },
  fullDataUrl: 'data:image/png;base64,FULL',
  blocks: [
    {
      eid: 'e1', file: 'src/pages/PlanetsPage.vue', line: '12', component: 'PlanetsPage',
      source_tag: 'header', tag: 'header', role: 'header',
      rect: { x: 0, y: 0, width: 1280, height: 80 }, dataUrl: 'data:image/png;base64,A',
    },
    {
      eid: 'e2', file: 'src/pages/PlanetsPage.vue', line: '30', component: 'PlanetsPage',
      source_tag: 'div', tag: 'div', role: 'content',
      rect: { x: 0, y: 80, width: 1280, height: 600 }, dataUrl: 'data:image/png;base64,B',
    },
    {
      eid: 'e3', file: '', line: '', component: '', source_tag: '', tag: 'section', role: 'content',
      rect: { x: 0, y: 680, width: 1280, height: 200 }, dataUrl: null, error: 'capture failed',
    },
  ],
}

function makeIframe(result: WireframeCaptureResult = CAPTURE_OK): WireframeModeIframe & { currentRoute: ReturnType<typeof ref<string>> } {
  return {
    currentRoute: ref('/planets'),
    bridgeReady: ref(true),
    captureWireframe: vi.fn(async () => result),
    onBridgeEvent: vi.fn(),
  } as never
}

describe('useWireframeMode', () => {
  let fetchMock: ReturnType<typeof vi.fn>
  let wf: ReturnType<typeof useWireframeDoc>

  beforeEach(async () => {
    localStorage.removeItem('annotask:wireframe')
    fetchMock = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      if (String(url).includes('wireframe-snapshots') && init?.method === 'POST') {
        const body = JSON.parse(init.body as string) as { id: string }
        return { ok: true, status: 200, json: async () => ({ filename: `${body.id}.png` }) } as unknown as Response
      }
      if (init?.method === 'PUT') {
        return { ok: true, status: 200, json: async () => ({ ...JSON.parse(init.body as string), rev: 2 }) } as unknown as Response
      }
      if (init?.method === 'DELETE') {
        return { ok: true, status: 200, json: async () => ({}) } as unknown as Response
      }
      return { ok: true, status: 200, json: async () => ({ version: '1.0', updatedAt: 0, rev: 1, routes: [] }) } as unknown as Response
    })
    vi.stubGlobal('fetch', fetchMock)
    wf = useWireframeDoc()
    await Promise.resolve()
    await Promise.resolve()
    wf.doc.value = { version: '1.0', updatedAt: 0, rev: 1, routes: [] }
    wf.loadError.value = null
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    localStorage.removeItem('annotask:wireframe')
  })

  function makeMode(iframe = makeIframe()) {
    const interactionMode = ref<InteractionMode>('interact')
    const shellView = ref('design')
    const mode = useWireframeMode({ iframe, interactionMode, shellView })
    return { mode, iframe, interactionMode, shellView }
  }

  it('enter() captures, anchors blocks, uploads PNGs, persists, and activates', async () => {
    const { mode, interactionMode } = makeMode()
    await mode.enter()

    expect(mode.active.value).toBe(true)
    expect(interactionMode.value).toBe('select')
    expect(localStorage.getItem('annotask:wireframe')).toBe('1')

    const canvas = mode.canvas.value!
    expect(canvas.blocks).toHaveLength(3)
    expect(canvas.viewport.docHeight).toBe(2400)
    // Anchors survive the bridge → block translation.
    expect(canvas.blocks[0].anchor).toMatchObject({ file: 'src/pages/PlanetsPage.vue', line: 12, role: 'header' })
    expect(canvas.blocks[0].originalRect).toEqual(canvas.blocks[0].rect)
    // The unstamped failing block stays honest: no image, captureError set.
    expect(canvas.blocks[2].captureError).toBe('capture failed')
    expect(canvas.blocks[2].image).toBeUndefined()
    expect(mode.imageSrc(canvas.blocks[2])).toBeNull()

    // Uploads: 2 block PNGs + 1 full page; canvas persisted with filenames.
    const posts = fetchMock.mock.calls.filter((c) => String(c[0]).includes('wireframe-snapshots') && (c[1] as RequestInit)?.method === 'POST')
    expect(posts).toHaveLength(3)
    expect(canvas.blocks[0].image).toMatch(/^wfb-.+\.png$/)
    expect(canvas.fullImage).toMatch(/^wf-full-.+\.png$/)
    // In-session render uses the dataUrl, not the uploaded file.
    expect(mode.imageSrc(canvas.blocks[0])).toBe('data:image/png;base64,A')
    expect(wf.canvasForRoute('/planets')?.blocks).toHaveLength(3)
  })

  it('enter() reuses a persisted canvas without capturing; images come from the sidecar route', async () => {
    const persisted = {
      capturedAt: 5,
      viewport: { width: 1280, height: 800, docWidth: 1280, docHeight: 2400, scale: 2 },
      blocks: [{
        id: 'wfb-old', kind: 'captured' as const,
        rect: { x: 0, y: 0, width: 100, height: 50 }, z: 1, createdAt: 1,
        anchor: { file: 'a.vue', line: 1 }, originalRect: { x: 0, y: 0, width: 100, height: 50 },
        image: 'wfb-old.png',
      }],
    }
    wf.doc.value = { version: '1.0', updatedAt: 0, rev: 1, routes: [{ route: '/planets', instances: [], canvas: persisted }] }
    const { mode, iframe } = makeMode()
    await mode.enter()
    expect(mode.active.value).toBe(true)
    expect(iframe.captureWireframe).not.toHaveBeenCalled()
    expect(mode.imageSrc(mode.canvas.value!.blocks[0])).toBe('/__annotask/wireframe-snapshots/wfb-old.png')
  })

  it('a failed capture surfaces the error and stays in live view', async () => {
    const { mode } = makeMode(makeIframe({ error: 'failed to load html2canvas' }))
    await mode.enter()
    expect(mode.active.value).toBe(false)
    expect(mode.error.value).toBe('failed to load html2canvas')
    expect(localStorage.getItem('annotask:wireframe')).toBeNull()
  })

  it('exit() is lossless bookkeeping: flag cleared, canvas stays persisted', async () => {
    const { mode } = makeMode()
    await mode.enter()
    mode.exit()
    expect(mode.active.value).toBe(false)
    expect(localStorage.getItem('annotask:wireframe')).toBeNull()
    expect(wf.canvasForRoute('/planets')).not.toBeNull()
  })

  it('route change and leaving the design view exit the mode', async () => {
    const { mode, iframe, shellView } = makeMode()
    await mode.enter()
    iframe.currentRoute.value = '/moons'
    await nextTick()
    expect(mode.active.value).toBe(false)

    iframe.currentRoute.value = '/planets'
    await nextTick() // route watcher settles before the user re-toggles
    await mode.enter() // canvas persisted → instant re-entry
    expect(mode.active.value).toBe(true)
    shellView.value = 'editor'
    await nextTick()
    expect(mode.active.value).toBe(false)
  })

  it('recapture() discards the old canvas + snapshot files and captures fresh', async () => {
    const { mode } = makeMode()
    await mode.enter()
    const oldFirstId = mode.canvas.value!.blocks[0].id
    await mode.recapture()
    expect(mode.active.value).toBe(true)
    expect(mode.canvas.value!.blocks[0].id).not.toBe(oldFirstId)
    const deletes = fetchMock.mock.calls.filter((c) => String(c[0]).includes('wireframe-snapshots/') && (c[1] as RequestInit)?.method === 'DELETE')
    expect(deletes.length).toBeGreaterThanOrEqual(3) // 2 block files + full page
  })

  it('boot restore re-enters only with both the flag and a persisted canvas', async () => {
    localStorage.setItem('annotask:wireframe', '1')
    // No canvas persisted → flag is cleared, mode stays off.
    const first = makeMode()
    await nextTick()
    expect(first.mode.active.value).toBe(false)
    expect(localStorage.getItem('annotask:wireframe')).toBeNull()

    // With a persisted canvas → boots straight into the sketch.
    localStorage.setItem('annotask:wireframe', '1')
    wf.doc.value = {
      version: '1.0', updatedAt: 0, rev: 1,
      routes: [{
        route: '/planets', instances: [],
        canvas: {
          capturedAt: 5,
          viewport: { width: 1280, height: 800, docWidth: 1280, docHeight: 2400, scale: 2 },
          blocks: [],
        },
      }],
    }
    const second = makeMode()
    await nextTick()
    expect(second.mode.active.value).toBe(true)
  })
})
