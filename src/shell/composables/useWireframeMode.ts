import { ref, watch, type Ref } from 'vue'
import { useWireframeDoc } from './useWireframeDoc'
import { normalizeRoute } from '../utils/routes'
import type { WireframeBlock, WireframeCanvasState } from '../../shared/wireframe-types'
import type { WireframeCapturePayload, WireframeCaptureResult, WireframeCaptureProgress } from '../../shared/bridge-types'
import type { InteractionMode } from './useInteractionMode'

/** localStorage flag so F5 re-enters wireframe mode (W2 accept). Only the
 *  ACTIVE bit lives client-side — the canvas itself is server-persisted. */
const STORAGE_KEY = 'annotask:wireframe'

export interface WireframeModeIframe {
  currentRoute: Ref<string>
  bridgeReady: Ref<boolean>
  captureWireframe: (opts?: WireframeCapturePayload) => Promise<WireframeCaptureResult>
  // `any` matches the bridge event registry's signature (iframeBridge.on).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onBridgeEvent: (type: string, handler: (payload: any) => void) => void
}

export interface WireframeModeDeps {
  iframe: WireframeModeIframe
  interactionMode: Ref<InteractionMode>
  /** Top-level shell view — leaving 'design' exits wireframe mode. */
  shellView: Ref<string>
}

let blockCounter = 0
function mintBlockId(): string {
  blockCounter++
  return `wfb-${Date.now().toString(36)}-${blockCounter.toString(36)}`
}

/**
 * Wireframe mode — freezes the current route into a manipulable image canvas.
 *
 * Capture rasterizes the live view into per-block PNGs (the bridge walks the
 * DOM; images ARE the rendered truth at capture time), uploads them as
 * sidecar files, and persists block geometry + anchors to wireframe.json.
 * The live iframe stays mounted underneath the canvas overlay the whole time,
 * so exiting is lossless — no reload, no re-navigation.
 */
export function useWireframeMode(deps: WireframeModeDeps) {
  const { iframe, interactionMode, shellView } = deps
  const wireframeDoc = useWireframeDoc()

  const active = ref(false)
  const capturing = ref(false)
  const progress = ref<WireframeCaptureProgress | null>(null)
  const error = ref<string | null>(null)
  /** Working copy of the route's canvas while the mode is active. */
  const canvas = ref<WireframeCanvasState | null>(null)
  /** This-session dataUrls (blockId → PNG) — instant render before/while the
   *  uploads land; after a reload images come from the snapshot routes. */
  const liveImages = ref<Record<string, string>>({})

  iframe.onBridgeEvent('wireframe:capture-progress', (p: WireframeCaptureProgress) => {
    if (capturing.value) progress.value = p
  })

  function activeRoute(): string {
    return normalizeRoute(iframe.currentRoute.value)
  }

  /** Resolve a block's image source: session dataUrl first (own id, then the
   *  duplicated original's), then the persisted sidecar file. Null = the
   *  honest "capture failed" hatch. */
  function imageSrc(block: WireframeBlock): string | null {
    const live = liveImages.value[block.id]
      ?? (block.duplicateOf ? liveImages.value[block.duplicateOf] : undefined)
    if (live) return live
    if (block.image) return `/__annotask/wireframe-snapshots/${block.image}`
    return null
  }

  async function uploadSnapshot(id: string, dataUrl: string): Promise<string | null> {
    try {
      const res = await fetch('/__annotask/api/wireframe-snapshots', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, data: dataUrl }),
      })
      if (!res.ok) return null
      return ((await res.json()) as { filename: string }).filename
    } catch {
      return null
    }
  }

  async function deleteSnapshot(filename: string): Promise<void> {
    try {
      await fetch(`/__annotask/api/wireframe-snapshots/${filename}`, { method: 'DELETE' })
    } catch { /* best-effort cleanup */ }
  }

  function setFlag(on: boolean): void {
    try {
      if (on) localStorage.setItem(STORAGE_KEY, '1')
      else localStorage.removeItem(STORAGE_KEY)
    } catch { /* storage may be unavailable */ }
  }

  /** Capture the live route into a fresh canvas. Returns false (and stays in
   *  live view) when there is nothing honest to show. */
  async function captureIntoCanvas(route: string): Promise<boolean> {
    capturing.value = true
    progress.value = null
    error.value = null
    try {
      const res = await iframe.captureWireframe()
      if (res.error || !res.blocks?.length || !res.viewport) {
        error.value = res.error ?? 'nothing to capture'
        return false
      }

      const blocks: WireframeBlock[] = []
      const uploads: Array<{ id: string; dataUrl: string }> = []
      const nextImages: Record<string, string> = {}
      res.blocks.forEach((b, i) => {
        const id = mintBlockId()
        const rect = { x: b.rect.x, y: b.rect.y, width: b.rect.width, height: b.rect.height }
        const block: WireframeBlock = {
          id,
          kind: 'captured',
          rect,
          originalRect: { ...rect },
          z: i + 1,
          createdAt: Date.now(),
          anchor: {
            file: b.file,
            line: parseInt(b.line, 10) || 0,
            ...(b.component ? { component: b.component } : {}),
            ...(b.source_tag ? { sourceTag: b.source_tag } : {}),
            tag: b.tag,
            role: b.role,
          },
          ...(b.error ? { captureError: b.error } : {}),
          ...(b.clipped ? { clipped: true } : {}),
        }
        if (b.dataUrl) {
          nextImages[id] = b.dataUrl
          uploads.push({ id, dataUrl: b.dataUrl })
        }
        blocks.push(block)
      })

      const next: WireframeCanvasState = {
        capturedAt: Date.now(),
        viewport: res.viewport,
        ...(res.truncated ? { truncated: true } : {}),
        blocks,
      }
      liveImages.value = nextImages
      canvas.value = next

      // Uploads are sequential-ish but independent: a failed upload leaves the
      // block image-less on disk (renders from memory this session, honest
      // hatch after reload) — never a fabricated picture.
      const byId = new Map(blocks.map((b) => [b.id, b]))
      await Promise.all(uploads.map(async ({ id, dataUrl }) => {
        const filename = await uploadSnapshot(id, dataUrl)
        if (filename) byId.get(id)!.image = filename
      }))
      if (res.fullDataUrl) {
        const fullId = `wf-full-${Date.now().toString(36)}`
        const filename = await uploadSnapshot(fullId, res.fullDataUrl)
        if (filename) next.fullImage = filename
      }

      await wireframeDoc.saveCanvas(route, next)
      return true
    } finally {
      capturing.value = false
      progress.value = null
    }
  }

  /** Toggle ON: reuse the route's persisted canvas if one exists, else
   *  capture. Never captures at boot — only on explicit entry. */
  async function enter(): Promise<void> {
    if (active.value || capturing.value) return
    const route = activeRoute()
    const existing = wireframeDoc.canvasForRoute(route)
    if (existing) {
      canvas.value = existing
    } else {
      const ok = await captureIntoCanvas(route)
      if (!ok) return
    }
    interactionMode.value = 'select'
    active.value = true
    setFlag(true)
  }

  /** Toggle OFF: the live app is still there underneath — lossless. The
   *  canvas stays persisted; re-entering reuses it. */
  function exit(): void {
    active.value = false
    canvas.value = null
    setFlag(false)
  }

  /** Discard the persisted canvas (and its snapshot files) and capture fresh.
   *  Wholesale by design: merging old coordinates onto a re-rendered page
   *  could silently lie about what the user is looking at. */
  async function recapture(): Promise<void> {
    if (capturing.value) return
    const route = activeRoute()
    const old = wireframeDoc.canvasForRoute(route)
    if (old) {
      const files = [...old.blocks.map((b) => b.image), old.fullImage].filter((f): f is string => !!f)
      await wireframeDoc.clearCanvas(route)
      void Promise.all(files.map(deleteSnapshot))
    }
    liveImages.value = {}
    canvas.value = null
    const ok = await captureIntoCanvas(route)
    if (!ok) {
      // Capture failed after the old canvas was discarded — drop to live view
      // rather than showing a stale sketch we just deleted.
      exit()
      return
    }
    active.value = true
    setFlag(true)
  }

  // Persist canvas mutations (W2: drag/resize/notes) with a trailing debounce
  // so pointer-up bursts don't stack PUTs.
  let persistTimer: ReturnType<typeof setTimeout> | null = null
  function persistSoon(): void {
    if (!canvas.value) return
    if (persistTimer) clearTimeout(persistTimer)
    persistTimer = setTimeout(() => {
      persistTimer = null
      if (canvas.value) void wireframeDoc.saveCanvas(activeRoute(), canvas.value)
    }, 300)
  }

  // The canvas is per-route and per-view: leaving the Design view or
  // navigating the iframe exits the mode (re-entering restores the sketch).
  watch(shellView, (v) => {
    if (v !== 'design' && active.value) exit()
  })
  watch(iframe.currentRoute, (next, prev) => {
    if (active.value && normalizeRoute(next) !== normalizeRoute(prev ?? '')) exit()
  })

  // Boot restore: re-enter only when the flag survives AND a persisted canvas
  // exists for the current route. Never auto-capture at boot.
  let booted = false
  const stopBoot = watch(
    [iframe.bridgeReady, wireframeDoc.isLoading],
    ([ready, loading]) => {
      // The immediate pass runs before `stopBoot` exists — gate on a flag and
      // detach the watcher on the first post-boot change instead.
      if (booted) { stopBoot(); return }
      if (!ready || loading) return
      booted = true
      let flagged = false
      try { flagged = localStorage.getItem(STORAGE_KEY) === '1' } catch { /* ignore */ }
      if (!flagged) return
      const existing = wireframeDoc.canvasForRoute(activeRoute())
      if (existing && shellView.value === 'design') {
        canvas.value = existing
        interactionMode.value = 'select'
        active.value = true
      } else {
        setFlag(false)
      }
    },
    { immediate: true },
  )

  return {
    active,
    capturing,
    progress,
    error,
    canvas,
    imageSrc,
    enter,
    exit,
    recapture,
    persistSoon,
    deleteSnapshot,
  }
}
