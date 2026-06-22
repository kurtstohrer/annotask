import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { computed, reactive, ref } from 'vue'

// useComponentGenerator pulls in useComponentLibrary, whose module state
// subscribes to the shared WebSocket client — stub it like the other tests.
vi.mock('../../services/wsClient', () => ({
  on: () => () => {},
  send: () => {},
  isConnected: () => true,
}))

import { useComponentGenerator, type ComponentGeneratorDeps } from '../useComponentGenerator'
import type { PaletteDragItem } from '../usePaletteDrag'
import type { WireframeBlock, WireframePaletteRef, WireframeDataBinding } from '../../../shared/wireframe-types'
import type { PaletteSnapshot } from '../useWireframeMode'

const SNAPSHOT = { mounted: true, fidelity: 'isolated-preview', dataUrl: 'data:image/png;base64,xx', width: 320, height: 100 }

/** A manually-resolvable promise — lets a test hold a previewComponent call
 *  in-flight to exercise supersession / mid-flight deletion. */
function deferred<T>() {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((r) => { resolve = r })
  return { promise, resolve }
}

/** Drain the microtask queue (the runGenerate async chain) — independent of the
 *  fake timer clock, which only governs the debounce setTimeout. */
async function flush(times = 6): Promise<void> {
  for (let i = 0; i < times; i++) await Promise.resolve()
}

function makeDeps(surfaceMfe?: () => string | null) {
  const buildingFlag = ref(false)
  const blocks = new Map<string, WireframeBlock>()
  let counter = 0

  const previewComponent = vi.fn<ComponentGeneratorDeps['iframe']['previewComponent']>(async () => ({ ...SNAPSHOT }))
  const placeComponentBlock = vi.fn((componentRef: WireframePaletteRef, at: { x: number; y: number }) => {
    const id = `wfb-${++counter}`
    blocks.set(id, {
      id,
      kind: 'palette',
      rect: { x: at.x, y: at.y, width: 320, height: 120 },
      z: 1,
      createdAt: 1,
      component: JSON.parse(JSON.stringify(componentRef)) as WireframePaletteRef,
      fidelity: 'placeholder',
    })
    return id
  })
  const updatePaletteBlock = vi.fn(async (
    id: string,
    patch: { props?: Record<string, unknown>; previewProps?: Record<string, unknown>; data?: WireframeDataBinding | null; snapshot?: PaletteSnapshot },
    _opts?: { recordHistory?: boolean },
  ) => {
    const b = blocks.get(id)
    if (!b || !b.component) return
    if (patch.props !== undefined) {
      if (Object.keys(patch.props).length > 0) b.component.props = JSON.parse(JSON.stringify(patch.props))
      else delete b.component.props
    }
    if (patch.previewProps !== undefined) b.component.previewProps = JSON.parse(JSON.stringify(patch.previewProps))
    if (patch.data !== undefined) { if (patch.data) b.data = JSON.parse(JSON.stringify(patch.data)); else delete b.data }
    if (patch.snapshot) {
      b.fidelity = patch.snapshot.fidelity ?? (patch.snapshot.mounted ? 'isolated-preview' : 'placeholder')
      if (patch.snapshot.dataUrl) b.image = `${id}.png`
    }
  })
  const findBlock = vi.fn((id: string) => blocks.get(id) ?? null)
  const setGenerating = vi.fn((_id: string, _on: boolean) => {})

  const deps: ComponentGeneratorDeps = {
    iframe: { previewComponent },
    wireframe: { placeComponentBlock, updatePaletteBlock, findBlock, building: computed(() => buildingFlag.value), setGenerating },
    ...(surfaceMfe ? { surfaceMfe } : {}),
  }
  return { deps, buildingFlag, blocks, previewComponent, placeComponentBlock, updatePaletteBlock, findBlock, setGenerating }
}

function item(extra: Partial<PaletteDragItem> = {}): PaletteDragItem {
  return {
    kind: 'component',
    componentName: 'PlanetCard',
    tag: 'planetcard',
    label: 'PlanetCard',
    library: 'Project',
    module: './src/components/PlanetCard.vue',
    previewProps: { name: 'Mercury' },
    ...extra,
  }
}

const BINDING: WireframeDataBinding = {
  kind: 'composable',
  name: 'usePlanets',
  module: 'src/composables/usePlanets.ts',
  path: 'planets[]',
  fields: ['name', 'type'],
  shape_source: 'api-schema',
}

describe('useComponentGenerator (place-first)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    // Catalog fetches from useComponentLibrary.load() — keep them inert.
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, json: async () => ({}) })))
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('placeComponent mints the block immediately and fills its snapshot', async () => {
    const d = makeDeps()
    const gen = useComponentGenerator(d.deps)
    const id = gen.placeComponent(item(), { x: 40, y: 60 })
    expect(id).toBe('wfb-1')
    // Block minted synchronously at the drop point, imageless placeholder.
    const [refArg, atArg] = d.placeComponentBlock.mock.calls[0]
    expect(refArg).toMatchObject({ componentName: 'PlanetCard', module: './src/components/PlanetCard.vue', previewProps: { name: 'Mercury' } })
    expect(atArg).toEqual({ x: 40, y: 60 })
    // Background fill renders and writes the snapshot WITHOUT recording history.
    await flush()
    expect(d.previewComponent).toHaveBeenCalledTimes(1)
    const [, props, module, width] = d.previewComponent.mock.calls[0]
    expect(props).toEqual({ name: 'Mercury' })
    expect(module).toBe('./src/components/PlanetCard.vue')
    expect(width).toBe(320)
    const [fid, patch, opts] = d.updatePaletteBlock.mock.calls[0]
    expect(fid).toBe(id)
    expect(patch.snapshot).toMatchObject({ dataUrl: SNAPSHOT.dataUrl, fidelity: 'isolated-preview' })
    expect(opts).toEqual({ recordHistory: false })
    expect(d.blocks.get(id!)?.fidelity).toBe('isolated-preview')
  })

  it('stamps the surface MFE on the placed block when the item has none', () => {
    const d = makeDeps(() => 'checkout')
    const gen = useComponentGenerator(d.deps)
    gen.placeComponent(item(), { x: 0, y: 0 })
    expect(d.placeComponentBlock.mock.calls[0][0]).toMatchObject({ mfe: 'checkout' })
  })

  it("prefers the item's own MFE over the surface MFE", () => {
    const d = makeDeps(() => 'checkout')
    const gen = useComponentGenerator(d.deps)
    gen.placeComponent(item({ mfe: 'admin' }), { x: 0, y: 0 })
    expect(d.placeComponentBlock.mock.calls[0][0]).toMatchObject({ mfe: 'admin' })
  })

  it('does not place while the sketch is locked to a task', () => {
    const d = makeDeps()
    d.buildingFlag.value = true
    const gen = useComponentGenerator(d.deps)
    expect(gen.placeComponent(item(), { x: 0, y: 0 })).toBeNull()
    expect(d.placeComponentBlock).not.toHaveBeenCalled()
  })

  it('strips reactive proxies before the previewComponent boundary', async () => {
    const d = makeDeps()
    const gen = useComponentGenerator(d.deps)
    const reactiveItem = reactive(item({ previewProps: { name: 'Mercury' } })) as PaletteDragItem
    gen.placeComponent(reactiveItem, { x: 0, y: 0 })
    await flush()
    const props = d.previewComponent.mock.calls[0][1]
    expect(props).toEqual({ name: 'Mercury' })
    expect(props).not.toBe(reactiveItem.previewProps)
  })

  it('setProp merges samples + real (real wins) and regenerates after the debounce', async () => {
    const d = makeDeps()
    const gen = useComponentGenerator(d.deps)
    const id = gen.placeComponent(item(), { x: 0, y: 0 })!
    await flush()
    d.previewComponent.mockClear()

    gen.setProp(id, 'name', 'Venus')
    // Prop mutation is synchronous + recorded (recordHistory not false).
    const propCall = d.updatePaletteBlock.mock.calls.find((c) => c[1].props)!
    expect(propCall[1].props).toEqual({ name: 'Venus' })
    expect(propCall[2]?.recordHistory).not.toBe(false)
    // No render yet — it's debounced.
    expect(d.previewComponent).not.toHaveBeenCalled()

    vi.advanceTimersByTime(375)
    await flush()
    expect(d.previewComponent).toHaveBeenCalledTimes(1)
    expect(d.previewComponent.mock.calls[0][1]).toEqual({ name: 'Venus' }) // real over the Mercury sample
  })

  it('setBinding writes the binding and regenerates', async () => {
    const d = makeDeps()
    const gen = useComponentGenerator(d.deps)
    const id = gen.placeComponent(item(), { x: 0, y: 0 })!
    await flush()
    d.previewComponent.mockClear()

    gen.setBinding(id, BINDING)
    expect(d.blocks.get(id)?.data).toEqual(BINDING)
    vi.advanceTimersByTime(375)
    await flush()
    expect(d.previewComponent).toHaveBeenCalledTimes(1)
  })

  it('drops a superseded in-flight render (only the latest snapshot lands)', async () => {
    const d = makeDeps()
    const defs: Array<ReturnType<typeof deferred<typeof SNAPSHOT>>> = []
    d.previewComponent.mockImplementation(() => {
      const def = deferred<typeof SNAPSHOT>()
      defs.push(def)
      return def.promise
    })
    const gen = useComponentGenerator(d.deps)
    const id = gen.placeComponent(item(), { x: 0, y: 0 })! // first fill → render A (pending)
    await flush()
    gen.setProp(id, 'name', 'Venus')
    vi.advanceTimersByTime(375)
    await flush() // regen → render B (pending)
    expect(defs.length).toBe(2)

    // Resolve the NEWER render first, then the stale one.
    defs[1].resolve({ ...SNAPSHOT, dataUrl: 'data:image/png;base64,B' })
    await flush()
    defs[0].resolve({ ...SNAPSHOT, dataUrl: 'data:image/png;base64,A' })
    await flush()

    const snapshotWrites = d.updatePaletteBlock.mock.calls.filter((c) => c[1].snapshot)
    expect(snapshotWrites.length).toBe(1) // the stale render A was dropped
    expect(snapshotWrites[0][1].snapshot?.dataUrl).toBe('data:image/png;base64,B')
  })

  it('no-ops a render whose block was deleted mid-flight', async () => {
    const d = makeDeps()
    const def = deferred<typeof SNAPSHOT>()
    d.previewComponent.mockImplementation(() => def.promise)
    const gen = useComponentGenerator(d.deps)
    const id = gen.placeComponent(item(), { x: 0, y: 0 })!
    await flush()
    d.blocks.delete(id) // user undid the drop before the render returned
    def.resolve({ ...SNAPSHOT })
    await flush()
    const snapshotWrites = d.updatePaletteBlock.mock.calls.filter((c) => c[1].snapshot)
    expect(snapshotWrites.length).toBe(0)
  })

  it('degrades honestly to placeholder fidelity when a render has no pixels', async () => {
    const d = makeDeps()
    d.previewComponent.mockResolvedValue({ mounted: false, fidelity: 'placeholder', error: 'no-runtime' } as never)
    const gen = useComponentGenerator(d.deps)
    const id = gen.placeComponent(item(), { x: 0, y: 0 })!
    await flush()
    const snap = d.updatePaletteBlock.mock.calls.find((c) => c[1].snapshot)![1].snapshot
    expect(snap?.fidelity).toBe('placeholder')
    expect(d.blocks.get(id)?.fidelity).toBe('placeholder')
  })

  it('cancel() clears a pending regen so it never fires', async () => {
    const d = makeDeps()
    const gen = useComponentGenerator(d.deps)
    const id = gen.placeComponent(item(), { x: 0, y: 0 })!
    await flush()
    d.previewComponent.mockClear()
    gen.setProp(id, 'name', 'Venus')
    gen.cancel()
    vi.advanceTimersByTime(375)
    await flush()
    expect(d.previewComponent).not.toHaveBeenCalled()
  })

  it('setProp is inert while the sketch is locked', async () => {
    const d = makeDeps()
    const gen = useComponentGenerator(d.deps)
    const id = gen.placeComponent(item(), { x: 0, y: 0 })!
    await flush()
    d.updatePaletteBlock.mockClear()
    d.buildingFlag.value = true
    gen.setProp(id, 'name', 'Venus')
    expect(d.updatePaletteBlock).not.toHaveBeenCalled()
  })

  const LIST_BINDING: WireframeDataBinding = {
    kind: 'composable', name: 'usePlanets', module: 'src/composables/usePlanets.ts',
    path: 'planets[]', fields: ['name'], shape_source: 'api-schema',
  }

  it('renders a list binding as N instances with REAL example values', async () => {
    const d = makeDeps()
    const gen = useComponentGenerator(d.deps)
    const id = gen.placeComponent(item(), { x: 0, y: 0 })!
    await flush()
    gen.setBinding(id, { ...LIST_BINDING, repeat: 3, sample: [{ name: 'Mercury' }, { name: 'Venus' }, { name: 'Earth' }] })
    gen.setPropBinding(id, 'label', 'name')
    d.previewComponent.mockClear()
    vi.advanceTimersByTime(375)
    await flush()
    const opts = d.previewComponent.mock.calls[0][4]
    expect(opts?.repeat).toBe(3)
    expect(opts?.instanceProps).toEqual([{ label: 'Mercury' }, { label: 'Venus' }, { label: 'Earth' }])
  })

  it('falls back to {field} tokens when the contract has no example', async () => {
    const d = makeDeps()
    const gen = useComponentGenerator(d.deps)
    const id = gen.placeComponent(item(), { x: 0, y: 0 })!
    await flush()
    gen.setBinding(id, { ...LIST_BINDING }) // no sample, no repeat
    gen.setPropBinding(id, 'label', 'name')
    d.previewComponent.mockClear()
    vi.advanceTimersByTime(375)
    await flush()
    const opts = d.previewComponent.mock.calls[0][4]
    expect(opts?.repeat).toBe(3) // list path defaults to 3 instances
    expect(opts?.instanceProps).toEqual([{ label: '{name}' }, { label: '{name}' }, { label: '{name}' }])
  })

  it('setPropBinding sets then clears a field→prop mapping', async () => {
    const d = makeDeps()
    const gen = useComponentGenerator(d.deps)
    const id = gen.placeComponent(item(), { x: 0, y: 0 })!
    await flush()
    gen.setBinding(id, { ...LIST_BINDING })
    gen.setPropBinding(id, 'label', 'name')
    expect(d.blocks.get(id)!.data!.propMap).toEqual({ label: 'name' })
    gen.setPropBinding(id, 'label', null)
    expect(d.blocks.get(id)!.data!.propMap).toBeUndefined()
  })

  it('produces a structured-clone-safe instanceProps payload for nested-object sample values', async () => {
    // Regression: a mapped field value can be a nested object/array (legit for
    // api-schema bindings). Read off the REACTIVE block, each such value is a
    // Vue proxy — structuredClone (postMessage) throws DataCloneError on it,
    // silently degrading the block's preview to a permanent placeholder. The
    // payload crossing the bridge must be plain JSON.
    const d = makeDeps()
    const gen = useComponentGenerator(d.deps)
    const id = gen.placeComponent(item(), { x: 0, y: 0 })!
    await flush()

    gen.setBinding(id, {
      ...LIST_BINDING,
      repeat: 2,
      // A nested object + array per row — the api-schema case that proxies.
      sample: [
        { name: 'Mercury', meta: { moons: 0, tags: ['rocky'] } },
        { name: 'Venus', meta: { moons: 0, tags: ['rocky', 'hot'] } },
      ],
    })
    gen.setPropBinding(id, 'detail', 'meta')

    // Force the block (and its sample rows) to be a live reactive proxy, as it
    // is in the running app — so `row[field]` yields a proxied nested object.
    const block = d.blocks.get(id)!
    block.data = reactive(block.data!) as typeof block.data

    d.previewComponent.mockClear()
    vi.advanceTimersByTime(375)
    await flush()

    const opts = d.previewComponent.mock.calls[0][4]
    expect(opts?.instanceProps).toEqual([
      { detail: { moons: 0, tags: ['rocky'] } },
      { detail: { moons: 0, tags: ['rocky', 'hot'] } },
    ])
    // The whole options payload must survive the postMessage clone boundary.
    expect(() => structuredClone(opts)).not.toThrow()
  })

  it('setRepeat clamps to [1,24]', async () => {
    const d = makeDeps()
    const gen = useComponentGenerator(d.deps)
    const id = gen.placeComponent(item(), { x: 0, y: 0 })!
    await flush()
    gen.setBinding(id, { ...LIST_BINDING })
    gen.setRepeat(id, 100)
    expect(d.blocks.get(id)!.data!.repeat).toBe(24)
    gen.setRepeat(id, 2)
    expect(d.blocks.get(id)!.data!.repeat).toBe(2)
  })
})
