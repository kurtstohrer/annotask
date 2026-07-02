// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { ref, nextTick } from 'vue'
import type { WireframeCaptureResult } from '../../../shared/bridge-types'
import type { useWireframeMode as UseWireframeMode, WireframeModeIframe } from '../useWireframeMode'
import type { InteractionMode } from '../useInteractionMode'

vi.mock('../../services/wsClient', () => ({
  on: () => () => { /* no-op */ },
  send: () => { /* no-op */ },
  isConnected: () => true,
}))

// The composite is best-effort reinforcement and jsdom can't load images —
// null keeps implementWireframe on its honest no-screenshot path.
vi.mock('../../utils/wireframeComposite', () => ({
  composeWireframeDiff: async () => null,
}))

/** A multi-MFE capture: one block owned by the 'child' MFE (package-local
 *  file, exactly as the bridge stamps it) and one host-owned block. */
const MFE_CAPTURE: WireframeCaptureResult = {
  viewport: { width: 1280, height: 800, docWidth: 1280, docHeight: 2400, scale: 2 },
  fullDataUrl: 'data:image/png;base64,FULL',
  blocks: [
    {
      eid: 'e1', file: 'src/App.vue', line: '3', component: 'ChildApp',
      source_tag: 'div', tag: 'div', cls: 'child-root', role: 'content',
      rect: { x: 0, y: 0, width: 1280, height: 300 }, dataUrl: 'data:image/png;base64,A',
      mfe: 'child',
    },
    {
      eid: 'e2', file: 'src/Host.vue', line: '8', component: 'Host',
      source_tag: 'footer', tag: 'footer', cls: 'host-footer', role: 'footer',
      rect: { x: 0, y: 300, width: 1280, height: 100 }, dataUrl: 'data:image/png;base64,B',
    },
  ],
}

const WORKSPACE = {
  root: '/ws',
  isWorkspace: true,
  currentDir: 'host',
  packages: [
    { name: 'host', dir: 'host' },
    { name: 'mfe-child', dir: 'mfe-child', mfe: 'child' },
  ],
}

function makeIframe(result: WireframeCaptureResult = MFE_CAPTURE): WireframeModeIframe & { currentRoute: ReturnType<typeof ref<string>> } {
  return {
    currentRoute: ref('/planets'),
    bridgeReady: ref(true),
    captureWireframe: vi.fn(async () => result),
    previewComponent: vi.fn(async () => ({ mounted: true })),
    findTemplateGroup: vi.fn(async () => ({ eids: ['live-1'] })),
    onBridgeEvent: vi.fn(),
  } as never
}

describe('useWireframeMode — MFE anchor translation', () => {
  let fetchMock: ReturnType<typeof vi.fn>
  /** Per-test control of the /api/workspace response (useWorkspace caches its
   *  load promise module-wide, so each test resets modules for a fresh race). */
  let workspaceResponse: () => Promise<{ ok: boolean; status: number; body: unknown }>

  beforeEach(() => {
    localStorage.removeItem('annotask:wireframe')
    workspaceResponse = async () => ({ ok: true, status: 200, body: WORKSPACE })
    fetchMock = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      const u = String(url)
      if (u.includes('/api/workspace')) {
        const { ok, status, body } = await workspaceResponse()
        return { ok, status, json: async () => body } as unknown as Response
      }
      if (u.includes('wireframe-snapshots') && init?.method === 'POST') {
        const body = JSON.parse(init.body as string) as { id: string }
        return { ok: true, status: 200, json: async () => ({ filename: `${body.id}.png` }) } as unknown as Response
      }
      if (u.includes('/api/design-session/apply') && init?.method === 'POST') {
        return { ok: true, status: 200, json: async () => ({ taskId: 't-1', batchId: 'b-1' }) } as unknown as Response
      }
      if (u.includes('/api/design-session/snapshots')) {
        return { ok: true, status: 200, json: async () => ({ files: {}, batches: [] }) } as unknown as Response
      }
      if (u.includes('/api/design-session')) {
        if (init?.method === 'PUT') {
          return { ok: true, status: 200, json: async () => ({ ...JSON.parse(init.body as string), rev: 2 }) } as unknown as Response
        }
        return { ok: true, status: 200, json: async () => ({ version: '1.0', sessionId: 'ds-x', startedAt: 0, updatedAt: 0, rev: 1, entries: [] }) } as unknown as Response
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
    vi.resetModules()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    localStorage.removeItem('annotask:wireframe')
  })

  /** Fresh module registry per call so useWorkspace/useWireframeDoc singletons
   *  can't leak a resolved catalog between tests. */
  async function makeMode(iframe = makeIframe()) {
    const { useWireframeMode } = await import('../useWireframeMode') as { useWireframeMode: typeof UseWireframeMode }
    const { useWireframeDoc } = await import('../useWireframeDoc')
    const wf = useWireframeDoc()
    await Promise.resolve()
    await Promise.resolve()
    wf.doc.value = { version: '1.0', updatedAt: 0, rev: 1, routes: [] }
    wf.loadError.value = null
    const interactionMode = ref<InteractionMode>('interact')
    const shellView = ref('design')
    const mode = useWireframeMode({ iframe, interactionMode, shellView })
    return { mode, iframe, wf }
  }

  it('capture AWAITS the workspace catalog, so a racing catalog load still yields host-relative anchors', async () => {
    // The catalog is in flight when the user hits capture — the old
    // fire-and-forget load let this race persist the package-local path.
    let releaseWorkspace!: () => void
    const gate = new Promise<void>((r) => { releaseWorkspace = r })
    workspaceResponse = async () => {
      await gate
      return { ok: true, status: 200, body: WORKSPACE }
    }

    const { mode, iframe } = await makeMode()
    const entering = mode.enter()
    await nextTick()
    await Promise.resolve()
    // Blocked on workspace.load() — the bridge hasn't been asked to capture.
    expect(iframe.captureWireframe).not.toHaveBeenCalled()

    releaseWorkspace()
    await entering
    expect(mode.active.value).toBe(true)
    const blocks = mode.canvas.value!.blocks
    // The MFE block's package-local path was translated to the host-relative
    // form; the host block passes through untouched.
    expect(blocks[0].anchor).toMatchObject({ file: '../mfe-child/src/App.vue', mfe: 'child' })
    expect(blocks[1].anchor).toMatchObject({ file: 'src/Host.vue' })
    expect(blocks[1].anchor!.mfe).toBeUndefined()
  })

  it('a failed catalog load never hangs or blocks capture — anchors stay package-local (server guard catches them)', async () => {
    workspaceResponse = async () => ({ ok: false, status: 500, body: {} })

    const { mode } = await makeMode()
    await mode.enter()
    expect(mode.active.value).toBe(true)
    // Identity translation, but the MFE claim rides along so the apply-time
    // attribution guard can re-derive or refuse.
    expect(mode.canvas.value!.blocks[0].anchor).toMatchObject({ file: 'src/App.vue', mfe: 'child' })
  })

  it('implementWireframe stamps the direction mfe into the journal anchor', async () => {
    const { mode } = await makeMode()
    await mode.enter()
    const block = mode.canvas.value!.blocks[0]
    mode.updateBlockRect(block.id, { ...block.rect, y: block.rect.y + 200 })

    const result = await mode.implementWireframe()
    expect(result).toEqual({ taskId: 't-1', batchId: 'b-1' })

    // The journal flush (PUT before the apply POST) carries the direction
    // entry with both the translated file AND the owning MFE on the anchor.
    const put = fetchMock.mock.calls.filter((c) =>
      String(c[0]).endsWith('/api/design-session') && (c[1] as RequestInit)?.method === 'PUT').pop()
    expect(put).toBeDefined()
    const doc = JSON.parse((put![1] as RequestInit).body as string) as { entries: Array<{ change: { type: string }; anchor: { file: string; mfe?: string } }> }
    const direction = doc.entries.find((e) => e.change.type === 'wireframe_direction')!
    expect(direction.anchor).toMatchObject({ file: '../mfe-child/src/App.vue', mfe: 'child' })
  })
})
