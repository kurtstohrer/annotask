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
      source_tag: 'header', tag: 'header', cls: 'page-header', role: 'header',
      rect: { x: 0, y: 0, width: 1280, height: 80 }, dataUrl: 'data:image/png;base64,A',
    },
    {
      eid: 'e2', file: 'src/pages/PlanetsPage.vue', line: '30', component: 'PlanetsPage',
      source_tag: 'div', tag: 'div', cls: 'toolbar', role: 'content',
      rect: { x: 0, y: 80, width: 1280, height: 600 }, dataUrl: 'data:image/png;base64,B',
    },
    {
      eid: 'e3', file: '', line: '', component: '', source_tag: '', tag: 'section', cls: '', role: 'content',
      rect: { x: 0, y: 680, width: 1280, height: 200 }, dataUrl: null, error: 'capture failed',
    },
  ],
}

function makeIframe(result: WireframeCaptureResult = CAPTURE_OK): WireframeModeIframe & { currentRoute: ReturnType<typeof ref<string>> } {
  return {
    currentRoute: ref('/planets'),
    bridgeReady: ref(true),
    captureWireframe: vi.fn(async () => result),
    previewComponent: vi.fn(async () => ({ mounted: true, fidelity: 'isolated-preview', dataUrl: 'data:image/png;base64,P', width: 320, height: 140 })),
    findTemplateGroup: vi.fn(async () => ({ eids: ['live-1'] })),
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

  describe('block operations (W2)', () => {
    it('updateBlockRect / bringToFront / setNote mutate the working canvas', async () => {
      const { mode } = makeMode()
      await mode.enter()
      const [a, b] = mode.canvas.value!.blocks
      mode.updateBlockRect(a.id, { x: 10, y: 20, width: 300, height: 150 })
      expect(a.rect).toEqual({ x: 10, y: 20, width: 300, height: 150 })
      expect(a.originalRect).toEqual({ x: 0, y: 0, width: 1280, height: 80 }) // diff baseline untouched

      mode.bringToFront(a.id)
      expect(a.z).toBeGreaterThan(b.z)

      mode.setNote(a.id, '  make this a carousel  ')
      expect(a.note).toBe('make this a carousel')
      mode.setNote(a.id, '   ')
      expect(a.note).toBeUndefined()
    })

    it('captured blocks soft-delete (diff fact) and can be restored; sketch blocks remove outright', async () => {
      const { mode } = makeMode()
      await mode.enter()
      const captured = mode.canvas.value!.blocks[0]
      mode.deleteBlock(captured.id)
      expect(captured.deleted).toBe(true)
      expect(mode.canvas.value!.blocks).toHaveLength(3) // still in the doc
      expect(mode.deletedBlocks.value.map((b) => b.id)).toEqual([captured.id])
      mode.undeleteBlock(captured.id)
      expect(captured.deleted).toBeUndefined()

      const phId = mode.addPlaceholderBlock({ x: 5, y: 5, width: 100, height: 50 }, 'pagination here')!
      mode.deleteBlock(phId)
      expect(mode.canvas.value!.blocks.find((b) => b.id === phId)).toBeUndefined()
    })

    it('duplicateBlock offsets +16/+16, tops z, shares the image, and roots duplicateOf', async () => {
      const { mode } = makeMode()
      await mode.enter()
      const src = mode.canvas.value!.blocks[0]
      const copyId = mode.duplicateBlock(src.id)!
      const copy = mode.canvas.value!.blocks.find((b) => b.id === copyId)!
      expect(copy.rect.x).toBe(src.rect.x + 16)
      expect(copy.rect.y).toBe(src.rect.y + 16)
      expect(copy.z).toBeGreaterThan(src.z)
      expect(copy.duplicateOf).toBe(src.id)
      expect(copy.image).toBe(src.image)
      // The session dataUrl resolves through the duplicate chain.
      expect(mode.imageSrc(copy)).toBe('data:image/png;base64,A')
      // A duplicate of the duplicate still roots at the original.
      const grandId = mode.duplicateBlock(copyId)!
      expect(mode.canvas.value!.blocks.find((b) => b.id === grandId)!.duplicateOf).toBe(src.id)
    })

    it('deleting one of two blocks sharing an image keeps the file; the last one drops it', async () => {
      const { mode } = makeMode()
      await mode.enter()
      // Palette block (hard-delete path) + its duplicate share one file.
      await mode.dropPaletteItem({ kind: 'component', tag: 'planetcard', componentName: 'PlanetCard', module: './components/PlanetCard.vue' }, { x: 40, y: 40 })
      const palette = mode.canvas.value!.blocks.find((b) => b.kind === 'palette')!
      const dupId = mode.duplicateBlock(palette.id)!
      const fileDeletes = () => fetchMock.mock.calls.filter((c) => String(c[0]).includes(`wireframe-snapshots/${palette.image}`) && (c[1] as RequestInit)?.method === 'DELETE').length

      mode.deleteBlock(palette.id)
      expect(fileDeletes()).toBe(0) // duplicate still references the file
      mode.deleteBlock(dupId)
      expect(fileDeletes()).toBe(1)
    })

    it('dropPaletteItem: components snapshot honestly; catalog items become placeholders', async () => {
      const { mode, iframe } = makeMode()
      await mode.enter()
      await mode.dropPaletteItem({ kind: 'component', tag: 'planetcard', componentName: 'PlanetCard', module: './components/PlanetCard.vue', props: { real: true } }, { x: 100, y: 200 })
      const palette = mode.canvas.value!.blocks.find((b) => b.kind === 'palette')!
      expect(iframe.previewComponent).toHaveBeenCalledWith('PlanetCard', { real: true }, './components/PlanetCard.vue', 320)
      expect(palette.rect).toMatchObject({ x: 100, y: 200, width: 320, height: 140 })
      expect(palette.fidelity).toBe('isolated-preview')
      expect(palette.component).toMatchObject({ componentName: 'PlanetCard', props: { real: true } })
      expect(palette.image).toMatch(/\.png$/)

      await mode.dropPaletteItem({ kind: 'layout-preset', tag: 'div', category: 'flex row' }, { x: 0, y: 0 })
      const ph = mode.canvas.value!.blocks.filter((b) => b.kind === 'placeholder')
      expect(ph).toHaveLength(1)
      expect(ph[0].label).toBe('flex row')
    })
  })

  describe('explode (W4)', () => {
    const CHILD_CAPTURE: WireframeCaptureResult = {
      viewport: { width: 1280, height: 800, docWidth: 1280, docHeight: 2400, scale: 2 },
      shellDataUrl: 'data:image/png;base64,SHELL',
      blocks: [
        {
          eid: 'c1', file: 'src/pages/PlanetsPage.vue', line: '31', component: 'PlanetsPage',
          source_tag: 'div', tag: 'div', cls: 'search-row', role: 'content',
          rect: { x: 0, y: 90, width: 600, height: 40 }, dataUrl: 'data:image/png;base64,C1',
        },
        {
          eid: 'c2', file: 'src/pages/PlanetsPage.vue', line: '35', component: 'PlanetsPage',
          source_tag: 'div', tag: 'div', cls: 'sort-row', role: 'content',
          rect: { x: 620, y: 90, width: 600, height: 40 }, dataUrl: 'data:image/png;base64,C2',
        },
      ],
    }

    it('keeps the parent as a SHELL backdrop and adds translated children with their own anchors', async () => {
      const { mode, iframe } = makeMode()
      await mode.enter()
      const parent = mode.canvas.value!.blocks[1] // div.toolbar, y 80
      const parentImage = parent.image
      // The user moved the parent +0/+30 before exploding — children follow.
      mode.updateBlockRect(parent.id, { ...parent.rect, y: parent.rect.y + 30 })

      vi.mocked(iframe.captureWireframe).mockResolvedValueOnce(CHILD_CAPTURE)
      const ok = await mode.explodeBlock(parent.id)
      expect(ok).toBe(true)
      expect(iframe.findTemplateGroup).toHaveBeenCalledWith('src/pages/PlanetsPage.vue', '30', 'div')
      expect(iframe.captureWireframe).toHaveBeenLastCalledWith({ rootEid: 'live-1' })

      const blocks = mode.canvas.value!.blocks
      // The parent survives as the container shell — its surface styling stays
      // visible under the children (this was the "double-click removes the
      // styling" bug).
      const shell = blocks.find((b) => b.id === parent.id)!
      expect(shell.shell).toBe(true)
      expect(shell.image).toBe(`${parent.id}-shell.png`)
      expect(mode.imageSrc(shell)).toBe('data:image/png;base64,SHELL')
      // A second explode of the shell is refused.
      expect(await mode.explodeBlock(parent.id)).toBe(false)
      expect(mode.error.value).toContain('Already exploded')

      const children = blocks.filter((b) => b.anchor?.cssClass === 'search-row' || b.anchor?.cssClass === 'sort-row')
      expect(children).toHaveLength(2)
      // Canvas rects ride the parent's move delta; the diff baseline stays live.
      expect(children[0].rect.y).toBe(120)
      expect(children[0].originalRect!.y).toBe(90)
      expect(children[0].anchor).toMatchObject({ file: 'src/pages/PlanetsPage.vue', line: 31 })
      expect(children[0].image).toMatch(/\.png$/)
      // Children stack above the shell.
      expect(Math.min(...children.map((b) => b.z))).toBeGreaterThan(shell.z)
      // The parent's ORIGINAL snapshot file was dropped (nothing references it).
      const deletes = fetchMock.mock.calls.filter((c) => String(c[0]).includes(`wireframe-snapshots/${parentImage}`) && (c[1] as RequestInit)?.method === 'DELETE')
      expect(deletes).toHaveLength(1)
    })

    it('falls back to removing the parent when no shell could be captured (a stale image would ghost the children)', async () => {
      const { mode, iframe } = makeMode()
      await mode.enter()
      const parent = mode.canvas.value!.blocks[1]
      vi.mocked(iframe.captureWireframe).mockResolvedValueOnce({ ...CHILD_CAPTURE, shellDataUrl: undefined })
      expect(await mode.explodeBlock(parent.id)).toBe(true)
      expect(mode.canvas.value!.blocks.find((b) => b.id === parent.id)).toBeUndefined()
    })

    it('an unresolvable anchor keeps the block and surfaces an error', async () => {
      const { mode, iframe } = makeMode()
      await mode.enter()
      vi.mocked(iframe.findTemplateGroup).mockResolvedValueOnce({ eids: [] })
      const parent = mode.canvas.value!.blocks[0]
      expect(await mode.explodeBlock(parent.id)).toBe(false)
      expect(mode.error.value).toContain('Could not find this block')
      expect(mode.canvas.value!.blocks.find((b) => b.id === parent.id)).toBeDefined()
    })

    it('a block with no separable children stays intact', async () => {
      const { mode, iframe } = makeMode()
      await mode.enter()
      const parent = mode.canvas.value!.blocks[0]
      vi.mocked(iframe.captureWireframe).mockResolvedValueOnce({
        viewport: CAPTURE_OK.viewport,
        blocks: [{
          eid: 'live-1', file: 'src/pages/PlanetsPage.vue', line: '12', component: 'PlanetsPage',
          source_tag: 'header', tag: 'header', cls: 'page-header', role: 'header',
          rect: { x: 0, y: 0, width: 1280, height: 80 }, dataUrl: 'data:image/png;base64,A',
        }],
      })
      expect(await mode.explodeBlock(parent.id)).toBe(false)
      expect(mode.error.value).toContain('no separable children')
      expect(mode.canvas.value!.blocks.find((b) => b.id === parent.id)).toBeDefined()
    })
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
