import { useComponentLibrary, type LibraryComponent } from './useProjectComponents'
import { parseDefault } from '../utils/propWidgets'
import type { PaletteDragItem } from './usePaletteDrag'
import type { useWireframeMode, PaletteSnapshot, WireframeModeIframe } from './useWireframeMode'
import type { WireframeBlock, WireframeDataBinding, WireframePaletteRef } from '../../shared/wireframe-types'

/**
 * Place-first component flow for the wireframe canvas.
 *
 * A palette drop mints the block IMMEDIATELY (imageless, honest 'placeholder'
 * fidelity) and auto-selects it; the snapshot fills in the background. The user
 * then configures the block IN PLACE via the inline popover — editing a prop or
 * binding live-regenerates the snapshot (debounced) and updates the block. There
 * is no separate generate/place step and no per-drop session: the config target
 * is simply the selected block, and the snapshot lives on the block.
 *
 * Clone discipline: every payload that crosses postMessage (previewComponent) or
 * lands in the persisted block (placeComponentBlock / updatePaletteBlock) is
 * JSON-round-tripped at the boundary — reactive proxies throw DataCloneError in
 * postMessage and must never reach wireframe.json.
 *
 * Undo: the drop records one entry; the first fill folds into it
 * (recordHistory:false). A prop/binding edit records once (coalesce-keyed) and
 * its regen folds in too, so a config burst is a single undo.
 *
 * Supersession: a per-block monotonic token is captured before the
 * previewComponent await and re-checked after it — a stale in-flight render is
 * dropped so a newer edit always wins.
 */

/** Debounce before a live config edit regenerates the snapshot. Kept strictly
 *  below useCanvasHistory's COALESCE_MS (600) so an edit burst folds into one
 *  undo entry. */
const REGEN_DEBOUNCE_MS = 375
/** Offscreen preview mount width (matches the legacy generate flow). */
const PREVIEW_WIDTH = 320
/** How many loop instances to sketch for a list binding by default. */
const DEFAULT_REPEAT = 3

export interface ComponentGeneratorDeps {
  iframe: Pick<WireframeModeIframe, 'previewComponent'>
  wireframe: Pick<
    ReturnType<typeof useWireframeMode>,
    'placeComponentBlock' | 'updatePaletteBlock' | 'findBlock' | 'building' | 'setGenerating'
  >
  /** The current iframe surface's MFE id, for stamping placed blocks. Null in
   *  single-MFE / non-workspace projects (no stamp then). */
  surfaceMfe?: () => string | null
}

function plain<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function definedEntries(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined && v !== null && v !== '') out[k] = v
  }
  return out
}

export function useComponentGenerator(deps: ComponentGeneratorDeps) {
  const cl = useComponentLibrary()
  // Per-block monotonic generation token — only the latest regen of a block may
  // write its snapshot; a superseded in-flight previewComponent is dropped.
  const tokens = new Map<string, number>()
  // Per-block debounce timers for live config edits.
  const timers = new Map<string, ReturnType<typeof setTimeout>>()

  /** Ensure the component catalog is loaded so the popover can show typed prop
   *  widgets and previewProps can seed from meta defaults. Lazy + idempotent. */
  function ensureCatalog(): void {
    if (cl.libraries.value.length === 0) void cl.load()
  }

  /** Catalog metadata for a component — library-scoped first, any-library
   *  fallback. Reads `cl.libraries` reactively so a computed wrapper re-resolves
   *  when the catalog lands after a cold start. */
  function resolveMeta(componentName: string | undefined, library?: string): LibraryComponent | null {
    if (!componentName) return null
    const libs = cl.libraries.value
    const scoped = library ? libs.find((l) => l.name === library) : undefined
    const inScope = scoped?.components.find((c) => c.name === componentName)
    if (inScope) return inScope
    for (const lib of libs) {
      const hit = lib.components.find((c) => c.name === componentName)
      if (hit) return hit
    }
    return null
  }

  /** Catalog meta for a placed block — drives the popover's typed widgets. */
  function metaForBlock(block: WireframeBlock): LibraryComponent | null {
    return resolveMeta(block.component?.componentName, block.component?.library)
  }

  function seedFromMeta(meta: LibraryComponent | null): Record<string, unknown> {
    const out: Record<string, unknown> = {}
    for (const p of meta?.props ?? []) {
      const parsed = parseDefault(p.default, p.type)
      if (parsed !== undefined) out[p.name] = parsed
    }
    return out
  }

  /** Build the persisted component ref from a palette item — stamps the MFE so
   *  apply-time codegen imports from the right package, and seeds previewProps
   *  (display samples) from the item or meta defaults. */
  function componentRefFromItem(item: PaletteDragItem): WireframePaletteRef {
    const meta = resolveMeta(item.componentName, item.library)
    const props = item.props ? plain(item.props) : undefined
    const seeded = seedFromMeta(meta)
    const previewProps = item.previewProps
      ? plain(item.previewProps)
      : (Object.keys(seeded).length > 0 ? seeded : undefined)
    const mfe = item.mfe ?? deps.surfaceMfe?.() ?? undefined
    return {
      tag: item.tag,
      componentName: item.componentName,
      ...(item.library ? { library: item.library } : {}),
      ...(item.module ? { module: item.module } : {}),
      ...(props ? { props } : {}),
      ...(previewProps ? { previewProps } : {}),
      ...(mfe ? { mfe } : {}),
    }
  }

  /** Real props win over display samples — the merged set is what the user sees
   *  rendered and what becomes the block's previewProps. */
  function mergedProps(block: WireframeBlock): Record<string, unknown> {
    const real = definedEntries(block.component?.props ?? {})
    const samples = block.component?.previewProps ?? {}
    return plain({ ...samples, ...real })
  }

  /** A binding whose path drills into an array is a list/loop. */
  function isListPath(path?: string): boolean {
    return !!path && path.includes('[]')
  }

  /** Resolve a block's data binding into a repeat count + per-instance prop
   *  overlays for the preview. A bound prop shows the contract's REAL example
   *  value when present (`sample`), else an honest `{field}` token — never
   *  synthesized. Unbound blocks render once with no overlay. */
  function bindingPreview(block: WireframeBlock): { repeat: number; instanceProps?: Record<string, unknown>[] } {
    const data = block.data
    if (!data) return { repeat: 1 }
    const repeat = Math.max(1, data.repeat ?? (isListPath(data.path) ? DEFAULT_REPEAT : 1))
    const map = data.propMap
    if (!map || Object.keys(map).length === 0) return { repeat }
    const sample = data.sample ?? []
    const instanceProps: Record<string, unknown>[] = []
    for (let i = 0; i < repeat; i++) {
      const row = sample[i] ?? sample[0]
      const overlay: Record<string, unknown> = {}
      for (const [prop, field] of Object.entries(map)) {
        const v = row?.[field]
        overlay[prop] = (v !== undefined && v !== null) ? v : `{${field}}`
      }
      instanceProps.push(overlay)
    }
    // A mapped field value can be a nested object/array (legitimate for
    // api-schema bindings), and `row` comes from the reactive `block.data.sample`
    // — so each value here is a Vue reactive proxy. structuredClone throws
    // DataCloneError on proxies, which would silently degrade the preview to a
    // placeholder. plain() at this boundary guarantees only JSON crosses
    // previewComponent's postMessage.
    return { repeat, instanceProps: plain(instanceProps) }
  }

  /** Render the block's component offscreen and write the honest snapshot back.
   *  Token-guarded so only the latest regen of a block wins. */
  async function runGenerate(id: string): Promise<void> {
    const block = deps.wireframe.findBlock(id)
    if (!block || block.kind !== 'palette' || !block.component?.componentName) {
      deps.wireframe.setGenerating(id, false)
      return
    }
    if (deps.wireframe.building.value) {
      deps.wireframe.setGenerating(id, false)
      return
    }
    const token = (tokens.get(id) ?? 0) + 1
    tokens.set(id, token)
    deps.wireframe.setGenerating(id, true)
    const merged = mergedProps(block)
    const { repeat, instanceProps } = bindingPreview(block)
    try {
      const res = await deps.iframe.previewComponent(
        block.component.componentName,
        merged,
        block.component.module,
        PREVIEW_WIDTH,
        { repeat, instanceProps },
      )
      if (tokens.get(id) !== token) return // superseded by a newer edit
      if (!deps.wireframe.findBlock(id)) return // block deleted mid-flight
      const snapshot: PaletteSnapshot = {
        dataUrl: res.dataUrl,
        width: res.width,
        height: res.height,
        fidelity: (res.fidelity as PaletteSnapshot['fidelity']) ?? (res.mounted ? 'isolated-preview' : 'placeholder'),
        mounted: res.mounted,
      }
      // Honest degradation: no pixels → the block stays a placeholder render.
      if (!res.dataUrl) snapshot.fidelity = 'placeholder'
      await deps.wireframe.updatePaletteBlock(id, { previewProps: merged, snapshot }, { recordHistory: false })
    } catch {
      if (tokens.get(id) === token && deps.wireframe.findBlock(id)) {
        await deps.wireframe.updatePaletteBlock(
          id,
          { snapshot: { fidelity: 'placeholder', mounted: false } },
          { recordHistory: false },
        )
      }
    } finally {
      if (tokens.get(id) === token) deps.wireframe.setGenerating(id, false)
    }
  }

  /** Debounced live regen for a config edit. Shows the shimmer immediately
   *  (keeping the last-good snapshot visible) and renders after the pause. */
  function scheduleRegen(id: string): void {
    if (deps.wireframe.building.value) return
    deps.wireframe.setGenerating(id, true)
    const existing = timers.get(id)
    if (existing) clearTimeout(existing)
    timers.set(id, setTimeout(() => {
      timers.delete(id)
      void runGenerate(id)
    }, REGEN_DEBOUNCE_MS))
  }

  /** Place-first drop: mint the block now, fill its snapshot immediately. */
  function placeComponent(item: PaletteDragItem, at: { x: number; y: number }): string | null {
    if (deps.wireframe.building.value) return null
    const plainItem = plain(item)
    ensureCatalog()
    const id = deps.wireframe.placeComponentBlock(componentRefFromItem(plainItem), at)
    if (id) void runGenerate(id)
    return id
  }

  /** Set one REAL prop on a placed block (codegen value) and live-regenerate.
   *  Records once per edit burst (coalesce-keyed via updatePaletteBlock). */
  function setProp(id: string, name: string, value: unknown): void {
    const block = deps.wireframe.findBlock(id)
    if (!block || block.kind !== 'palette' || deps.wireframe.building.value) return
    const props = { ...(block.component?.props ?? {}) }
    if (value === undefined || value === null || value === '') delete props[name]
    else props[name] = value
    void deps.wireframe.updatePaletteBlock(id, { props }, { recordHistory: true })
    scheduleRegen(id)
  }

  /** Bind (or clear) the block's data source and live-regenerate. */
  function setBinding(id: string, binding: WireframeDataBinding | null): void {
    if (deps.wireframe.building.value) return
    void deps.wireframe.updatePaletteBlock(id, { data: binding ? plain(binding) : null }, { recordHistory: true })
    scheduleRegen(id)
  }

  /** Map a component prop to a bound data field (or clear it with field=null),
   *  then live-regenerate so the preview shows the bound value. No-op without a
   *  binding on the block. */
  function setPropBinding(id: string, prop: string, field: string | null): void {
    const block = deps.wireframe.findBlock(id)
    if (!block || block.kind !== 'palette' || !block.data || deps.wireframe.building.value) return
    const data = plain(block.data)
    const map = { ...(data.propMap ?? {}) }
    if (field) map[prop] = field
    else delete map[prop]
    data.propMap = Object.keys(map).length > 0 ? map : undefined
    void deps.wireframe.updatePaletteBlock(id, { data }, { recordHistory: true })
    scheduleRegen(id)
  }

  /** Set how many loop instances a list binding sketches, then regenerate. */
  function setRepeat(id: string, n: number): void {
    const block = deps.wireframe.findBlock(id)
    if (!block || block.kind !== 'palette' || !block.data || deps.wireframe.building.value) return
    const data = plain(block.data)
    data.repeat = Math.max(1, Math.min(Math.round(n) || 1, 24))
    void deps.wireframe.updatePaletteBlock(id, { data }, { recordHistory: true })
    scheduleRegen(id)
  }

  /** Cancel every pending live regen — called before "Implement this wireframe"
   *  locks the sketch so an in-flight render can't mutate it mid-implement. */
  function cancel(): void {
    for (const t of timers.values()) clearTimeout(t)
    timers.clear()
  }

  /** The datasource step is OFFERED (not required) when the component looks
   *  data-driven — any prop infers as json (objects/arrays) or names an
   *  array-ish type. An explicit "Bind data…" affordance always exists. */
  function datasourceSuggested(block: WireframeBlock): boolean {
    const meta = metaForBlock(block)
    if (!meta) return false
    return meta.props.some((p) => {
      const t = (p.type ?? '').toLowerCase()
      return (
        t.includes('[]') ||
        t.includes('array') ||
        (!!p.type && !/^(string|number|boolean|bool|int|float)\b/.test(t) && !/^(['"])/.test(p.type ?? ''))
      )
    })
  }

  return {
    placeComponent,
    setProp,
    setBinding,
    setPropBinding,
    setRepeat,
    isListPath,
    regenerate: scheduleRegen,
    metaForBlock,
    ensureCatalog,
    datasourceSuggested,
    cancel,
  }
}
