import { ref, computed, watch, type Ref } from 'vue'
import { useWireframeDoc } from './useWireframeDoc'
import { useDesignSession } from './useDesignSession'
import { useWorkspace } from './useWorkspace'
import { useCanvasSelection } from './useCanvasSelection'
import { useCanvasHistory } from './useCanvasHistory'
import { computeWireframeDirections } from '../utils/wireframeDirections'
import { composeWireframeDiff } from '../utils/wireframeComposite'
import { normalizeRoute } from '../utils/routes'
import type { WireframeBlock, WireframeBlockAnchor, WireframeCanvasState, WireframeDataBinding, WireframeFidelity, WireframePaletteRef } from '../../shared/wireframe-types'
import type { WireframeCaptureBlock, WireframeCapturePayload, WireframeCaptureResult, WireframeCaptureProgress } from '../../shared/bridge-types'
import type { InteractionMode } from './useInteractionMode'

/** localStorage flag so F5 re-enters wireframe mode (W2 accept). Only the
 *  ACTIVE bit lives client-side — the canvas itself is server-persisted. */
const STORAGE_KEY = 'annotask:wireframe'

export interface WireframeModeIframe {
  currentRoute: Ref<string>
  bridgeReady: Ref<boolean>
  captureWireframe: (opts?: WireframeCapturePayload) => Promise<WireframeCaptureResult>
  /** Offscreen component mount → honest snapshot (palette drops). `opts.repeat`
   *  mounts N stacked instances; `opts.instanceProps` overlays per-instance prop
   *  values (bound data rows). */
  previewComponent: (componentName: string, props?: Record<string, unknown>, module?: string, width?: number, opts?: { repeat?: number; instanceProps?: Record<string, unknown>[] }) => Promise<{ mounted: boolean; fidelity?: string | null; dataUrl?: string; width?: number; height?: number; error?: string }>
  /** Durable-anchor → live eids re-resolution (explode targets). `mfe` scopes
   *  the DOM query to one micro-frontend so a shared package-local path resolves
   *  unambiguously. */
  findTemplateGroup: (file: string, line: string, tagName: string, mfe?: string) => Promise<{ eids: string[] }>
  // `any` matches the bridge event registry's signature (iframeBridge.on).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onBridgeEvent: (type: string, handler: (payload: any) => void) => void
}

/** What the palette hands a canvas drop — mirrors usePaletteDrag's item. */
export interface WireframeDropItem {
  kind: 'component' | 'html' | 'layout-preset'
  tag: string
  componentName?: string
  library?: string
  module?: string
  props?: Record<string, unknown>
  previewProps?: Record<string, unknown>
  classes?: string
  textContent?: string
  category?: string
}

export interface WireframeModeDeps {
  iframe: WireframeModeIframe
  interactionMode: Ref<InteractionMode>
  /** Top-level shell view — leaving 'design' exits wireframe mode. */
  shellView: Ref<string>
}

/** The honest snapshot a generate/drop produced — preview:component's
 *  result, normalized. No dataUrl ⇒ placeholder fidelity, never fabricated. */
export interface PaletteSnapshot {
  dataUrl?: string
  width?: number
  height?: number
  fidelity?: WireframeFidelity
  mounted?: boolean
}

/** A direct child of a captured block, probed live for the hover highlights.
 *  `rect` is in document (capture) coordinates — the canvas transforms it onto
 *  the block's current on-canvas rect. */
export interface WireframeChildRect {
  rect: { x: number; y: number; width: number; height: number }
  file: string
  line: string
  tag: string
  mfe?: string
  label: string
}

let blockCounter = 0
function mintBlockId(): string {
  blockCounter++
  return `wfb-${Date.now().toString(36)}-${blockCounter.toString(36)}`
}

/** POSIX-style relative dir between two workspace-root-relative, '/'-separated
 *  directories. `relDir('a/host', 'a/mfe')` → '../mfe'. Empty when equal. */
function relDir(fromDir: string, toDir: string): string {
  const from = fromDir ? fromDir.split('/') : []
  const to = toDir ? toDir.split('/') : []
  let i = 0
  while (i < from.length && i < to.length && from[i] === to[i]) i++
  return [...from.slice(i).map(() => '..'), ...to.slice(i)].join('/')
}

/** Build a captured block's source anchor from a capture-result block. Shared
 *  by the capture and explode paths so both carry the same shape — including
 *  `mfe`, the owning micro-frontend resolved during the MFE-aware walk (absent
 *  on single-MFE/legacy captures, where the field is simply omitted).
 *
 *  `toAnchorFile` rewrites the bridge's package-local `file` (Vite stamps it
 *  relative to the MFE's own root, e.g. `src/App.tsx`) into a path the HOST
 *  dev server can resolve — `../mfe-x/src/App.tsx` for a sibling MFE — so the
 *  agent's grounding (code-context/source-excerpt), the apply contract, and the
 *  byte-exact snapshot all hit the right file. Distinct MFEs sharing a local
 *  path (two `src/App.tsx`) become distinct anchors, so the snapshot dedup is
 *  honest. Identity when there's no MFE or the resolver can't place it. */
function buildAnchor(b: WireframeCaptureBlock, toAnchorFile: (mfe: string | undefined, file: string) => string): WireframeBlockAnchor {
  return {
    file: toAnchorFile(b.mfe, b.file),
    line: parseInt(b.line, 10) || 0,
    ...(b.component ? { component: b.component } : {}),
    ...(b.source_tag ? { sourceTag: b.source_tag } : {}),
    ...(b.cls ? { cssClass: b.cls } : {}),
    tag: b.tag,
    role: b.role,
    ...(b.mfe ? { mfe: b.mfe } : {}),
    // Anchorless blocks (file '') carry the bridge's DOM fingerprint so the
    // apply-time direction stays resolvable (annotask_resolve_fingerprint).
    ...(b.fingerprint ? { fingerprint: b.fingerprint } : {}),
  }
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
  const session = useDesignSession()
  const workspace = useWorkspace()
  // Prefetch for the MFE filter and anchor translation. Fire-and-forget here
  // (init must not block); the capture/explode paths AWAIT their own load()
  // call — cached and idempotent — before building anchors, so a capture can
  // no longer race this and persist package-local MFE paths.
  void workspace.load()

  /** Rewrite a block's package-local `file` into a HOST-resolvable path using
   *  its owning MFE: a sibling MFE's `src/App.tsx` becomes `../mfe-x/src/App.tsx`
   *  (relative to the host dev server's project root). Returns `file` unchanged
   *  when there's no MFE, the catalog hasn't loaded, the MFE is unknown, or the
   *  block lives in the running package itself. */
  function toAnchorFile(mfe: string | undefined, file: string): string {
    if (!mfe) return file
    const pkg = workspace.info.value?.packages.find((p) => p.mfe === mfe)
    if (!pkg?.dir) return file
    const rel = relDir(workspace.info.value?.currentDir ?? '', pkg.dir)
    return rel ? `${rel}/${file}` : file
  }

  /** Inverse of toAnchorFile: a host-resolvable anchor path (`../mfe-x/src/App.tsx`)
   *  back to the MFE's package-local form (`src/App.tsx`) that the DOM's
   *  `data-annotask-file` actually carries — needed to re-resolve a block for
   *  explode. Identity when there's no MFE / the prefix doesn't apply. */
  function toLocalFile(mfe: string | undefined, file: string): string {
    if (!mfe) return file
    const pkg = workspace.info.value?.packages.find((p) => p.mfe === mfe)
    if (!pkg?.dir) return file
    const rel = relDir(workspace.info.value?.currentDir ?? '', pkg.dir)
    return rel && file.startsWith(`${rel}/`) ? file.slice(rel.length + 1) : file
  }

  const active = ref(false)
  const capturing = ref(false)
  const progress = ref<WireframeCaptureProgress | null>(null)
  const error = ref<string | null>(null)
  /** Working copy of the route's canvas while the mode is active. */
  const canvas = ref<WireframeCanvasState | null>(null)
  /** The route the working canvas belongs to. Saves key off THIS, not the
   *  live iframe route — a route change fires the exit-flush while the iframe
   *  has already moved on, and keying off the live route would persist the old
   *  canvas under the new route. */
  const canvasRoute = ref<string | null>(null)
  /** This-session dataUrls (blockId → PNG) — instant render before/while the
   *  uploads land; after a reload images come from the snapshot routes. */
  const liveImages = ref<Record<string, string>>({})
  /** Blocks whose snapshot is currently rendering (place-first first fill, or a
   *  live reconfigure regen). CLIENT-ONLY — never persisted, so a reload mid-
   *  generation reads the block as an honest 'placeholder', never a stuck
   *  shimmer. The canvas reads this to show the "rendering…" overlay. */
  const generatingIds = ref<Set<string>>(new Set())
  function setGenerating(id: string, on: boolean): void {
    const has = generatingIds.value.has(id)
    if (on === has) return
    const next = new Set(generatingIds.value)
    if (on) next.add(id); else next.delete(id)
    generatingIds.value = next
  }

  // Selection + undo/redo operate on the working canvas. History snapshots both
  // blocks AND selection, so undo restores what was selected at each step.
  const selection = useCanvasSelection(canvas)
  const history = useCanvasHistory(
    () => ({ blocks: canvas.value?.blocks ?? [], selection: selection.selectedIds.value }),
    (snap) => {
      if (!canvas.value) return
      canvas.value.blocks = snap.blocks
      selection.setSelection(snap.selection)
      persistSoon()
    },
  )

  iframe.onBridgeEvent('wireframe:capture-progress', (p: WireframeCaptureProgress) => {
    if (capturing.value) progress.value = p
  })

  function activeRoute(): string {
    return normalizeRoute(iframe.currentRoute.value)
  }

  /** Resolve a block's image source: session dataUrl first, then the
   *  persisted sidecar file. Null = the honest "capture failed" hatch.
   *  Strictly own-id keyed: duplicates get their own liveImages entry at
   *  duplication time, so a later regenerate of the original can't bleed
   *  into them through a shared key. */
  function imageSrc(block: WireframeBlock): string | null {
    const live = liveImages.value[block.id]
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
      // Anchor translation (toAnchorFile) needs the workspace catalog — await
      // it so a capture can't race the init prefetch and persist package-local
      // MFE paths (which the host would resolve to its own same-named files).
      // A failed load still resolves (info stays null, identity translation);
      // the server-side attribution guard catches those anchors at apply time.
      await workspace.load()
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
          anchor: buildAnchor(b, toAnchorFile),
          ...(b.embedded ? { embedded: b.embedded } : {}),
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
      canvasRoute.value = route
      history.clear()

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
      canvasRoute.value = route
      history.clear()
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
    flushPersist()
    active.value = false
    canvas.value = null
    canvasRoute.value = null
    history.clear()
    setFlag(false)
    // Clear any capture/explode error so the App-level banner (shown when the
    // canvas is unmounted) doesn't linger after a clean exit.
    error.value = null
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

  // Persist canvas mutations (drag/resize/notes/blocks) with a trailing
  // debounce so pointer-up bursts don't stack PUTs.
  let persistTimer: ReturnType<typeof setTimeout> | null = null
  function persistSoon(): void {
    if (!canvas.value || !canvasRoute.value) return
    if (persistTimer) clearTimeout(persistTimer)
    persistTimer = setTimeout(() => {
      persistTimer = null
      if (canvas.value && canvasRoute.value) void wireframeDoc.saveCanvas(canvasRoute.value, canvas.value)
    }, 300)
  }

  /** Cancel the trailing debounce and write once, NOW. Called on exit so the
   *  last drag/edit can't be dropped by `canvas.value` being cleared before the
   *  pending timer fires (the old fire-and-forget timer lost that tail edit). */
  function flushPersist(): void {
    if (persistTimer) { clearTimeout(persistTimer); persistTimer = null }
    if (canvas.value && canvasRoute.value) void wireframeDoc.saveCanvas(canvasRoute.value, canvas.value)
  }

  // ── Block operations (W2 manipulation) ────────────────────

  function findBlock(id: string): WireframeBlock | null {
    return canvas.value?.blocks.find((b) => b.id === id) ?? null
  }

  function maxZ(): number {
    return (canvas.value?.blocks ?? []).reduce((m, b) => Math.max(m, b.z), 0)
  }

  function minZ(): number {
    const blocks = canvas.value?.blocks ?? []
    return blocks.length ? blocks.reduce((m, b) => Math.min(m, b.z), Infinity) : 0
  }

  // Rect updates are gesture/nudge driven: the component brackets a drag with
  // history.begin()/end() and records once per arrow-nudge, so this stays out
  // of the history (recording per pointermove would bury the stack).
  function updateBlockRect(id: string, rect: { x: number; y: number; width: number; height: number }): void {
    const b = findBlock(id)
    if (!b) return
    b.rect = { ...rect }
    b.updatedAt = Date.now()
    persistSoon()
  }

  function bringToFront(id: string): void {
    const b = findBlock(id)
    if (!b) return
    const top = maxZ()
    if (b.z === top && canvas.value!.blocks.filter((x) => x.z === top).length === 1) return
    history.record('z:' + id)
    b.z = top + 1
    b.updatedAt = Date.now()
    persistSoon()
  }

  function sendToBack(id: string): void {
    const b = findBlock(id)
    if (!b) return
    const bottom = minZ()
    if (b.z === bottom && canvas.value!.blocks.filter((x) => x.z === bottom).length === 1) return
    history.record('z:' + id)
    b.z = bottom - 1
    b.updatedAt = Date.now()
    persistSoon()
  }

  /** One layer up: swap z with the nearest block currently above it. */
  function bringForward(id: string): void {
    const c = canvas.value
    const b = findBlock(id)
    if (!c || !b) return
    const above = c.blocks
      .filter((x) => !x.deleted && x.z > b.z)
      .sort((p, q) => p.z - q.z)[0]
    if (!above) return // already on top
    history.record('z:' + id)
    const z = b.z
    b.z = above.z
    above.z = z
    b.updatedAt = Date.now()
    above.updatedAt = Date.now()
    persistSoon()
  }

  /** One layer down: swap z with the nearest block currently below it. */
  function sendBackward(id: string): void {
    const c = canvas.value
    const b = findBlock(id)
    if (!c || !b) return
    const below = c.blocks
      .filter((x) => !x.deleted && x.z < b.z)
      .sort((p, q) => q.z - p.z)[0]
    if (!below) return // already at the bottom
    history.record('z:' + id)
    const z = b.z
    b.z = below.z
    below.z = z
    b.updatedAt = Date.now()
    below.updatedAt = Date.now()
    persistSoon()
  }

  function setNote(id: string, note: string): void {
    const b = findBlock(id)
    if (!b) return
    history.record('note:' + id)
    const trimmed = note.trim()
    if (trimmed) b.note = trimmed
    else delete b.note
    b.updatedAt = Date.now()
    persistSoon()
  }

  /** USER-WRITTEN markdown for a drawn section — travels verbatim. */
  function setBlockMd(id: string, md: string): void {
    const b = findBlock(id)
    if (!b) return
    history.record('md:' + id)
    const trimmed = md.trim()
    if (trimmed) b.md = trimmed
    else delete b.md
    b.updatedAt = Date.now()
    persistSoon()
  }

  /** Attach/clear a data-source binding. The picker emits a reactive proxy —
   *  JSON-clone before it lands in the persisted doc. */
  function setBlockData(id: string, data: WireframeDataBinding | null): void {
    const b = findBlock(id)
    if (!b) return
    history.record('data:' + id)
    if (data) b.data = JSON.parse(JSON.stringify(data)) as WireframeDataBinding
    else delete b.data
    b.updatedAt = Date.now()
    persistSoon()
  }

  /** Captured blocks soft-delete (the apply diff needs deletion as a fact);
   *  palette/placeholder blocks are sketch material — remove outright, and
   *  drop the snapshot file unless another block (duplicate) still shares it. */
  function deleteBlock(id: string): void {
    const c = canvas.value
    const b = findBlock(id)
    if (!c || !b) return
    history.record('delete:' + id)
    if (b.kind === 'captured') {
      b.deleted = true
      b.updatedAt = Date.now()
    } else {
      c.blocks = c.blocks.filter((x) => x.id !== id)
      if (b.image && !c.blocks.some((x) => x.image === b.image)) {
        void deleteSnapshot(b.image)
      }
    }
    persistSoon()
  }

  function undeleteBlock(id: string): void {
    const b = findBlock(id)
    if (!b?.deleted) return
    history.record('undelete:' + id)
    delete b.deleted
    b.updatedAt = Date.now()
    persistSoon()
  }

  const deletedBlocks = computed(() => (canvas.value?.blocks ?? []).filter((b) => b.deleted))

  /** Duplicate = new sketch material based on an existing block. Shares the
   *  image file; `duplicateOf` points at the ROOT original so the apply diff
   *  can say "another <X>" even through duplicate-of-duplicate chains. */
  function duplicateBlock(id: string): string | null {
    const c = canvas.value
    const src = findBlock(id)
    if (!c || !src || src.deleted) return null
    history.record('duplicate:' + id)
    const copy: WireframeBlock = {
      ...JSON.parse(JSON.stringify(src)) as WireframeBlock,
      id: mintBlockId(),
      rect: { ...src.rect, x: src.rect.x + 16, y: src.rect.y + 16 },
      z: maxZ() + 1,
      duplicateOf: src.duplicateOf ?? src.id,
      createdAt: Date.now(),
    }
    delete copy.updatedAt
    // Own liveImages entry — the copy renders the image AS IT IS NOW even if
    // the original regenerates later (imageSrc is strictly own-id keyed).
    const srcLive = liveImages.value[src.id]
    if (srcLive) liveImages.value = { ...liveImages.value, [copy.id]: srcLive }
    c.blocks.push(copy)
    persistSoon()
    return copy.id
  }

  /** Mint one palette block from a component ref + snapshot. Deep-clones the
   *  ref and binding at the boundary (reactive proxies must never land in the
   *  persisted doc), registers the in-session image, uploads the sidecar PNG,
   *  and persists. Returns the new block id. */
  async function addPaletteBlock(
    componentRef: WireframePaletteRef,
    snapshot: PaletteSnapshot,
    at: { x: number; y: number },
    data?: WireframeDataBinding,
  ): Promise<string | null> {
    const c = canvas.value
    if (!c) return null
    history.record('add')
    const id = mintBlockId()
    const width = snapshot.width && snapshot.width > 24 ? snapshot.width : 320
    const height = snapshot.height && snapshot.height > 24 ? snapshot.height : 120
    const block: WireframeBlock = {
      id,
      kind: 'palette',
      rect: { x: at.x, y: at.y, width, height },
      z: maxZ() + 1,
      createdAt: Date.now(),
      component: JSON.parse(JSON.stringify(componentRef)) as WireframePaletteRef,
      fidelity: snapshot.fidelity ?? (snapshot.mounted ? 'isolated-preview' : 'placeholder'),
      ...(data ? { data: JSON.parse(JSON.stringify(data)) as WireframeDataBinding } : {}),
    }
    if (snapshot.dataUrl) {
      liveImages.value = { ...liveImages.value, [id]: snapshot.dataUrl }
      const filename = await uploadSnapshot(id, snapshot.dataUrl)
      if (filename) block.image = filename
    } else {
      block.fidelity = 'placeholder'
    }
    c.blocks.push(block)
    persistSoon()
    return id
  }

  /** Place-first: synchronously mint an IMAGELESS palette block at the drop
   *  point, auto-select it, and record ONE undo entry — the snapshot is filled
   *  in afterwards (by the generator) through updatePaletteBlock with
   *  recordHistory:false, so it folds into this single entry. The block is
   *  honest from the first frame: fidelity 'placeholder', no fabricated pixels,
   *  and `generatingIds` drives the "rendering…" shimmer until the fill lands.
   *  Returns the new block id (null while the sketch is locked). */
  function placeComponentBlock(componentRef: WireframePaletteRef, at: { x: number; y: number }): string | null {
    const c = canvas.value
    if (!c || building.value) return null
    history.record('add')
    const id = mintBlockId()
    const block: WireframeBlock = {
      id,
      kind: 'palette',
      rect: { x: at.x, y: at.y, width: 320, height: 120 },
      z: maxZ() + 1,
      createdAt: Date.now(),
      component: JSON.parse(JSON.stringify(componentRef)) as WireframePaletteRef,
      fidelity: 'placeholder',
    }
    c.blocks.push(block)
    selection.select(id)
    setGenerating(id, true)
    persistSoon()
    return id
  }

  /** Regenerate-in-place: patch a placed palette block's props/binding and/or
   *  swap its snapshot. Re-uploads under the SAME block id (`<id>.png`
   *  overwrites; the current session renders from liveImages so there is no
   *  cache-bust concern). Position is preserved; dims follow the snapshot. */
  async function updatePaletteBlock(id: string, patch: {
    props?: Record<string, unknown>
    previewProps?: Record<string, unknown>
    data?: WireframeDataBinding | null
    snapshot?: PaletteSnapshot
  }, opts: { recordHistory?: boolean } = {}): Promise<void> {
    const b = findBlock(id)
    if (!b || b.kind !== 'palette' || !b.component) return
    // The drop and prop/binding edits already snapshot the pre-mutation state;
    // the async snapshot fill that follows is a derived image swap that must
    // FOLD into that one entry (recordHistory:false) so a place + render — or a
    // prop-edit burst + its regen — is a single undo. The prop/binding setters
    // pass recordHistory:true (coalesce-keyed) so a burst still folds.
    if (opts.recordHistory !== false) history.record('regenerate:' + id)
    if (patch.props !== undefined) {
      if (Object.keys(patch.props).length > 0) b.component.props = JSON.parse(JSON.stringify(patch.props)) as Record<string, unknown>
      else delete b.component.props
    }
    if (patch.previewProps !== undefined) {
      if (Object.keys(patch.previewProps).length > 0) b.component.previewProps = JSON.parse(JSON.stringify(patch.previewProps)) as Record<string, unknown>
      else delete b.component.previewProps
    }
    if (patch.data !== undefined) {
      if (patch.data) b.data = JSON.parse(JSON.stringify(patch.data)) as WireframeDataBinding
      else delete b.data
    }
    const snap = patch.snapshot
    if (snap) {
      b.fidelity = snap.fidelity ?? (snap.mounted ? 'isolated-preview' : 'placeholder')
      if (snap.dataUrl) {
        liveImages.value = { ...liveImages.value, [b.id]: snap.dataUrl }
        // Fresh filename per regenerate: duplicates may share the OLD file
        // (overwriting it would silently change them), and the browser caches
        // snapshot URLs for an hour (same-name re-upload would be masked
        // after the next reload).
        const oldImage = b.image
        const filename = await uploadSnapshot(mintBlockId(), snap.dataUrl)
        if (filename) {
          b.image = filename
          const c = canvas.value
          if (oldImage && oldImage !== filename && c && !c.blocks.some((x) => x.image === oldImage)) {
            void deleteSnapshot(oldImage)
          }
        }
        if (snap.width && snap.width > 24) b.rect.width = snap.width
        if (snap.height && snap.height > 24) b.rect.height = snap.height
      } else {
        b.fidelity = 'placeholder'
      }
    }
    b.updatedAt = Date.now()
    persistSoon()
  }

  /** Palette drop onto the canvas: components render as an honest
   *  preview:component snapshot (live iframe under the overlay does the
   *  mounting); html/layout-preset catalog items become labeled placeholders —
   *  there is no real render to rasterize, so we never fabricate one. */
  async function dropPaletteItem(item: WireframeDropItem, at: { x: number; y: number }): Promise<void> {
    const c = canvas.value
    if (!c) return
    // Components are placed first (imageless) via placeComponentBlock and filled
    // by the generator — they never reach here. This path is html/layout-preset
    // catalog items: there is no real render to rasterize, so they become
    // labeled placeholders, never a fabricated snapshot.
    history.record('add')
    const id = mintBlockId()
    c.blocks.push({
      id,
      kind: 'placeholder',
      rect: { x: at.x, y: at.y, width: 320, height: 120 },
      z: maxZ() + 1,
      createdAt: Date.now(),
      label: item.textContent || item.category || `<${item.tag}>`,
    })
    persistSoon()
  }

  /** User-drawn placeholder box — visibly a sketch, never fabricated UI. */
  function addPlaceholderBlock(rect: { x: number; y: number; width: number; height: number }, label: string): string | null {
    const c = canvas.value
    if (!c) return null
    history.record('add')
    const id = mintBlockId()
    c.blocks.push({
      id,
      kind: 'placeholder',
      rect: { ...rect },
      z: maxZ() + 1,
      createdAt: Date.now(),
      label: label.trim() || 'placeholder',
    })
    persistSoon()
    return id
  }

  /** Hover probe: the direct children of a captured block, re-resolved live and
   *  MFE-scoped, WITHOUT rasterizing — for the canvas's per-element hover
   *  highlights. Returns document-coordinate rects (the canvas maps them onto
   *  the block's current rect). Empty when the block isn't explodable or can't
   *  be re-resolved (route changed / source drifted). Mirrors explodeBlock's
   *  re-resolution so the highlight previews exactly what an explode would
   *  produce. */
  async function resolveBlockChildren(block: WireframeBlock): Promise<WireframeChildRect[]> {
    if (!active.value || block.kind !== 'captured' || block.shell || block.deleted) return []
    if (!block.originalRect) return []
    try {
      // toLocalFile needs the catalog to undo the anchor's MFE prefix.
      await workspace.load()
      // Anchored blocks re-resolve via their durable source anchor; anchorless
      // ones (un-instrumented MFE/library DOM) re-resolve by captured geometry.
      // Mirrors explodeBlock so the hover highlights preview exactly what an
      // explode would produce — anchorless blocks included.
      let payload: WireframeCapturePayload
      let rootEid: string | null = null
      if (block.anchor?.file) {
        const group = await iframe.findTemplateGroup(
          toLocalFile(block.anchor.mfe, block.anchor.file),
          String(block.anchor.line),
          block.anchor.tag ?? '',
          block.anchor.mfe,
        )
        rootEid = group.eids[0] ?? null
        if (!rootEid) return []
        payload = { rootEid, metaOnly: true }
      } else {
        payload = { rootRect: { ...block.originalRect }, metaOnly: true }
      }
      const res = await iframe.captureWireframe(payload)
      if (res.error || !res.blocks?.length) return []
      // One block back = no finer granularity (same guard explode uses). The
      // geometric path learns the root eid from the bridge's response.
      const probeRoot = rootEid ?? res.rootEid ?? null
      if (res.blocks.length === 1 && probeRoot && res.blocks[0].eid === probeRoot) return []
      return res.blocks.map((b) => ({
        rect: { x: b.rect.x, y: b.rect.y, width: b.rect.width, height: b.rect.height },
        file: b.file, line: b.line, tag: b.tag,
        ...(b.mfe ? { mfe: b.mfe } : {}),
        label: b.cls || b.component || b.tag,
      }))
    } catch { return [] }
  }

  /**
   * Explode (W4): re-capture one captured block a level deeper — the block is
   * replaced by per-child blocks, each carrying its own source anchor (or an
   * empty anchor when the block was anchorless — geometric children of an
   * un-instrumented region stay anchorless, useful for layout but not codegen).
   * The children rasterize from the LIVE page (the only honest pixel source)
   * and are translated by the block's canvas delta so they land inside the box
   * the user sees, even after a move.
   */
  async function explodeBlock(id: string): Promise<boolean> {
    const c = canvas.value
    const parent = findBlock(id)
    if (!c || !parent || parent.kind !== 'captured' || parent.deleted || capturing.value) return false
    if (parent.shell) {
      error.value = 'Already exploded — its children are separate blocks.'
      return false
    }
    // An <iframe> mount is another app's document — its interior can't be
    // decomposed into anything meaningful from here. Move/resize stays fine.
    if (parent.embedded === 'iframe') {
      error.value = 'This block is an embedded application — annotate it from its own dev server.'
      return false
    }
    if (!parent.originalRect) {
      error.value = "This block can't be exploded — its captured geometry is missing. Recapture instead."
      return false
    }
    error.value = null

    // Explode both reads (toLocalFile) and mints (buildAnchor) MFE anchors —
    // same workspace-catalog dependency as capture, same await.
    await workspace.load()

    // Resolve the live element to re-capture a level deeper. ANCHORED blocks
    // re-resolve from their durable source anchor (eids are volatile) — the DOM
    // carries the MFE's package-local path, so translate the resolvable anchor
    // back to local form and scope the query to the owning MFE. ANCHORLESS
    // blocks (DOM rendered by an un-instrumented shared/library/dist component,
    // or a pending MFE region) carry no anchor to look up — re-resolve their
    // live subtree by captured GEOMETRY instead, so they still decompose into
    // (anchorless) geometric children for layout wireframing.
    let payload: WireframeCapturePayload
    let rootEid: string | null = null
    if (parent.anchor?.file) {
      const group = await iframe.findTemplateGroup(
        toLocalFile(parent.anchor.mfe, parent.anchor.file),
        String(parent.anchor.line),
        parent.anchor.tag ?? '',
        parent.anchor.mfe,
      )
      rootEid = group.eids[0] ?? null
      if (!rootEid) {
        error.value = 'Could not find this block in the live page — the source may have changed. Recapture instead.'
        return false
      }
      payload = { rootEid }
    } else {
      payload = { rootRect: { ...parent.originalRect } }
    }

    capturing.value = true
    try {
      const res = await iframe.captureWireframe(payload)
      if (res.error || !res.blocks?.length) {
        error.value = res.error ?? 'nothing to explode'
        return false
      }
      // One block back = no finer granularity available. The geometric path
      // learns the resolved root's eid from the bridge response.
      const resolvedRoot = rootEid ?? res.rootEid ?? null
      if (res.blocks.length === 1 && resolvedRoot && res.blocks[0].eid === resolvedRoot) {
        error.value = parent.anchor?.file
          ? 'This block has no separable children.'
          : "This block isn't mapped to source (it's rendered by an un-instrumented component) and has no separable children — it can still be moved or resized as one block."
        return false
      }

      const dx = parent.rect.x - parent.originalRect.x
      const dy = parent.rect.y - parent.originalRect.y
      // Children stack above everything: reusing the parent's z could collide
      // with unrelated blocks and leave render order to DOM-order luck.
      const baseZ = maxZ() + 1
      const uploads: Array<{ id: string; dataUrl: string }> = []
      const nextImages = { ...liveImages.value }
      const children: WireframeBlock[] = res.blocks.map((b, i) => {
        const childId = mintBlockId()
        const rect = { x: b.rect.x + dx, y: b.rect.y + dy, width: b.rect.width, height: b.rect.height }
        if (b.dataUrl) {
          nextImages[childId] = b.dataUrl
          uploads.push({ id: childId, dataUrl: b.dataUrl })
        }
        return {
          id: childId,
          kind: 'captured',
          rect,
          // The diff baseline is the LIVE position (un-translated): a child of
          // a moved parent is already "moved" relative to the real page.
          originalRect: { x: b.rect.x, y: b.rect.y, width: b.rect.width, height: b.rect.height },
          z: baseZ + i,
          createdAt: Date.now(),
          anchor: buildAnchor(b, toAnchorFile),
          // Lineage: dragging the parent SHELL moves its children with it.
          parentId: id,
          ...(b.embedded ? { embedded: b.embedded } : {}),
          ...(b.error ? { captureError: b.error } : {}),
          ...(b.clipped ? { clipped: true } : {}),
        }
      })

      // Past every early-return — about to mutate the canvas. Snapshot now so a
      // single undo restores the parent block in place of its children.
      history.record('explode:' + id)
      liveImages.value = nextImages
      const oldParentImage = parent.image
      if (res.shellDataUrl) {
        // The parent stays as the SHELL backdrop: the container's background/
        // padding/inter-child surface, captured with the children hidden so
        // moving a child never reveals a ghost copy of itself. New file id —
        // duplicates of the parent keep referencing the original pixels.
        liveImages.value = { ...nextImages, [parent.id]: res.shellDataUrl }
        parent.shell = true
        parent.updatedAt = Date.now()
        delete parent.image
        const shellFilename = await uploadSnapshot(`${parent.id}-shell`, res.shellDataUrl)
        if (shellFilename) parent.image = shellFilename
      } else {
        // No honest shell to show — keeping the old image would ghost the
        // children, so the parent goes and the children stand alone.
        c.blocks = c.blocks.filter((b) => b.id !== id)
      }
      c.blocks.push(...children)
      if (oldParentImage && !c.blocks.some((b) => b.image === oldParentImage)) {
        void deleteSnapshot(oldParentImage)
      }

      const byId = new Map(children.map((b) => [b.id, b]))
      await Promise.all(uploads.map(async ({ id: childId, dataUrl }) => {
        const filename = await uploadSnapshot(childId, dataUrl)
        if (filename) byId.get(childId)!.image = filename
      }))
      await wireframeDoc.saveCanvas(activeRoute(), c)
      return true
    } finally {
      capturing.value = false
      progress.value = null
    }
  }

  // ── Implement this wireframe (W3 directions + agent apply) ─────────────

  /** Locked while a wireframe_apply task implements this sketch. */
  const building = computed(() => canvas.value?.status === 'building')
  const implementing = ref(false)

  /**
   * Diff the sketch into anchored directions, compose+upload the before/after
   * composite, replace the route's pending direction entries in the journal,
   * and mint ONE wireframe_apply task through the existing apply loop. The
   * caller hands the taskId to the embedded-agent auto-run.
   */
  async function implementWireframe(): Promise<{ taskId: string; batchId: string } | null> {
    const c = canvas.value
    if (!c || capturing.value || implementing.value || building.value) return null
    implementing.value = true
    error.value = null
    try {
      const route = activeRoute()
      // The diff and the persisted doc must agree — flush pending mutations.
      if (persistTimer) { clearTimeout(persistTimer); persistTimer = null }
      await wireframeDoc.saveCanvas(route, c)

      const directions = computeWireframeDirections(c)
      if (directions.length === 0) {
        error.value = 'Nothing to implement — rearrange the sketch first.'
        return null
      }

      // Composite is best-effort reinforcement; the directions text is the
      // contract. A failed upload never blocks the apply.
      let screenshot: string | undefined
      try {
        const composite = await composeWireframeDiff({
          canvas: c,
          directions,
          imageSrc,
          beforeSrc: c.fullImage ? `/__annotask/wireframe-snapshots/${c.fullImage}` : null,
        })
        if (composite) {
          const res = await fetch('/__annotask/api/screenshots', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ data: composite }),
          })
          if (res.ok) screenshot = ((await res.json()) as { filename: string }).filename
        }
      } catch { /* image is reinforcement, not the contract */ }

      // Direction entries are a PROJECTION of the canvas — replace this
      // route's pending set wholesale, then record the fresh diff.
      session.removeWhere((e) =>
        e.change.type === 'wireframe_direction' && e.route === route
        && (e.live.status === 'pending' || e.live.status === 'failed'))
      for (const d of directions) {
        session.record({
          change: d,
          // The owning MFE rides the anchor so the server's apply-time
          // attribution guard can verify the file against that package.
          anchor: { file: d.file, line: d.line, ...(d.block.tag ? { targetTag: d.block.tag } : {}), ...(d.mfe ? { mfe: d.mfe } : {}) },
          route,
        })
      }

      const result = await session.applyNow({ route, ...(screenshot ? { screenshot } : {}) })
      if (!result) {
        error.value = session.lastError.value ?? 'apply failed'
        return null
      }
      // The server stamped the canvas 'building' — pick up the locked copy.
      await wireframeDoc.load()
      const locked = wireframeDoc.canvasForRoute(route)
      if (locked) canvas.value = locked
      return result
    } finally {
      implementing.value = false
    }
  }

  /** Undo this implementation: delete the task (lifecycle revert: canvas back
   *  to 'sketch', entries released) then restore the batch's pre-apply bytes.
   *  The sketch is retained for tweak-and-re-implement. */
  async function undoImplementation(): Promise<void> {
    const taskId = canvas.value?.taskId
    if (!taskId) return
    try {
      await fetch(`/__annotask/api/tasks/${encodeURIComponent(taskId)}`, { method: 'DELETE' })
    } catch { /* task may already be gone */ }
    await session.undoLastBatch()
    await wireframeDoc.load()
    const fresh = wireframeDoc.canvasForRoute(activeRoute())
    if (fresh) {
      canvas.value = fresh
      canvasRoute.value = activeRoute()
      history.clear()
    }
  }

  // Server-side lifecycle flips (verify/accept/delete hooks broadcast
  // wireframe:updated → the doc singleton reloads) must reach the working
  // copy: sync ONLY the lifecycle identity so a reload can't roll back
  // un-debounced local edits mid-drag. A canvas that disappears while locked
  // means the task was accepted — the implementation is live; show it.
  watch(
    () => {
      if (!active.value) return null
      const c = wireframeDoc.canvasForRoute(activeRoute())
      return c ? `${c.status ?? 'sketch'}:${c.taskId ?? ''}` : 'gone'
    },
    (sig) => {
      if (!active.value || sig === null) return
      const fresh = wireframeDoc.canvasForRoute(activeRoute())
      if (!fresh) {
        if (canvas.value?.status === 'building') exit()
        return
      }
      const cur = canvas.value
      if (cur && ((fresh.status ?? 'sketch') !== (cur.status ?? 'sketch') || fresh.taskId !== cur.taskId)) {
        canvas.value = fresh
        canvasRoute.value = activeRoute()
        // Lifecycle flip (sketch ⇄ building) replaces the working copy — the
        // pre-flip undo stack no longer matches it.
        history.clear()
      }
    },
  )

  // The canvas is per-route and per-view: leaving the Design view or
  // navigating the iframe exits the mode (re-entering restores the sketch).
  watch(shellView, (v) => {
    if (v !== 'design' && active.value) exit()
  })
  watch(iframe.currentRoute, (next, prev) => {
    if (active.value && normalizeRoute(next) !== normalizeRoute(prev ?? '')) exit()
  })

  // Boot restore: re-enter only when the flag survives AND a persisted canvas
  // exists for the current route. Never auto-capture at boot. The iframe's
  // currentRoute starts at '/' and settles to the restored last-route a beat
  // AFTER bridgeReady — so a no-canvas miss on the unsettled '/' must keep
  // waiting, not clear the flag.
  let booted = false
  const stopBoot = watch(
    [iframe.bridgeReady, wireframeDoc.isLoading, iframe.currentRoute],
    ([ready, loading]) => {
      // The immediate pass runs before `stopBoot` exists — gate on a flag and
      // detach the watcher on the first post-boot change instead.
      if (booted) { stopBoot(); return }
      if (!ready || loading) return
      let flagged = false
      try { flagged = localStorage.getItem(STORAGE_KEY) === '1' } catch { /* ignore */ }
      if (!flagged) { booted = true; return }
      const route = activeRoute()
      const existing = wireframeDoc.canvasForRoute(route)
      if (existing && shellView.value === 'design') {
        booted = true
        canvas.value = existing
        canvasRoute.value = route
        history.clear()
        interactionMode.value = 'select'
        active.value = true
      } else if (route !== '/') {
        // The route has settled somewhere without a sketch — stale flag.
        booted = true
        setFlag(false)
      }
      // route === '/' with no canvas: still settling — keep watching.
    },
    { immediate: true },
  )

  /** Canvas-scoped undo/redo. No-ops while the sketch is locked (building) or
   *  the mode is closed — the agent-apply path has its own server-owned undo. */
  function undo(): void {
    if (!active.value || building.value || !canvas.value) return
    history.undo()
  }
  function redo(): void {
    if (!active.value || building.value || !canvas.value) return
    history.redo()
  }

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
    // selection + history
    selection,
    history,
    undo,
    redo,
    // block ops
    updateBlockRect,
    bringToFront,
    sendToBack,
    bringForward,
    sendBackward,
    setNote,
    setBlockMd,
    setBlockData,
    deleteBlock,
    undeleteBlock,
    deletedBlocks,
    duplicateBlock,
    dropPaletteItem,
    addPaletteBlock,
    placeComponentBlock,
    updatePaletteBlock,
    generatingIds,
    setGenerating,
    findBlock,
    addPlaceholderBlock,
    explodeBlock,
    resolveBlockChildren,
    // implement (W3)
    building,
    implementing,
    implementWireframe,
    undoImplementation,
  }
}
