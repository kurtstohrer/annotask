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
import type { WireframeBlock } from '../../../shared/wireframe-types'

const SNAPSHOT = { mounted: true, fidelity: 'isolated-preview', dataUrl: 'data:image/png;base64,xx', width: 320, height: 100 }

function makeDeps() {
  const buildingFlag = ref(false)
  const previewComponent = vi.fn<ComponentGeneratorDeps['iframe']['previewComponent']>(async () => ({ ...SNAPSHOT }))
  const addPaletteBlock = vi.fn<ComponentGeneratorDeps['wireframe']['addPaletteBlock']>(async () => 'wfb-new')
  const updatePaletteBlock = vi.fn<ComponentGeneratorDeps['wireframe']['updatePaletteBlock']>(async () => undefined)
  return {
    buildingFlag,
    iframe: { previewComponent },
    wireframe: {
      addPaletteBlock,
      updatePaletteBlock,
      building: computed(() => buildingFlag.value),
    },
  }
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

const BINDING = {
  kind: 'composable' as const,
  name: 'usePlanets',
  module: 'src/composables/usePlanets.ts',
  path: 'planets[]',
  fields: ['name', 'type'],
  shape_source: 'api-schema' as const,
}

describe('useComponentGenerator', () => {
  beforeEach(() => {
    // Catalog fetches from useComponentLibrary.load() — keep them inert.
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, json: async () => ({}) })))
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('drop fast path remembers the drop point; pick path does not', () => {
    const deps = makeDeps()
    const gen = useComponentGenerator(deps)
    gen.openFromDrop(item(), { x: 40, y: 60 })
    expect(gen.session.value?.dropAt).toEqual({ x: 40, y: 60 })
    gen.cancel()
    expect(gen.session.value).toBeNull()
    gen.openFromPick(item())
    expect(gen.session.value?.dropAt).toBeNull()
  })

  it('does not open while the sketch is locked to a task', () => {
    const deps = makeDeps()
    deps.buildingFlag.value = true
    const gen = useComponentGenerator(deps)
    gen.openFromDrop(item(), { x: 0, y: 0 })
    expect(gen.session.value).toBeNull()
  })

  it('generate merges samples + real props (real wins) and clones at the bridge boundary', async () => {
    const deps = makeDeps()
    const gen = useComponentGenerator(deps)
    // A reactive item — the proxy must never reach previewComponent.
    const reactiveItem = reactive(item({ previewProps: { name: 'Mercury', type: 'rocky' } })) as PaletteDragItem
    gen.openFromDrop(reactiveItem, { x: 0, y: 0 })
    gen.session.value!.propsState = { name: 'Venus' }
    await gen.generate()

    const [name, props] = deps.iframe.previewComponent.mock.calls[0]
    expect(name).toBe('PlanetCard')
    expect(props).toEqual({ name: 'Venus', type: 'rocky' }) // real name wins
    expect(props).not.toBe(reactiveItem.previewProps)
    expect(gen.session.value?.generated?.fidelity).toBe('isolated-preview')
    expect(gen.session.value?.generatedWith).toEqual({ name: 'Venus', type: 'rocky' })
  })

  it('a snapshot without pixels degrades honestly to placeholder fidelity', async () => {
    const deps = makeDeps()
    deps.iframe.previewComponent.mockResolvedValueOnce({ mounted: false, fidelity: 'placeholder', error: 'no-runtime' } as never)
    const gen = useComponentGenerator(deps)
    gen.openFromPick(item())
    await gen.generate()
    expect(gen.session.value?.generated?.fidelity).toBe('placeholder')
    expect(gen.session.value?.error).toBe('no-runtime')
  })

  it('place commits the block with props, generate-time previewProps, and the binding', async () => {
    const deps = makeDeps()
    const gen = useComponentGenerator(deps)
    gen.openFromDrop(item(), { x: 12, y: 34 })
    gen.session.value!.propsState = { name: 'Venus' }
    gen.setBinding(BINDING)
    await gen.generate()
    const id = await gen.placeAtDropPoint()

    expect(id).toBe('wfb-new')
    expect(gen.session.value).toBeNull() // session closes on place
    const [refArg, snapArg, atArg, dataArg] = deps.wireframe.addPaletteBlock.mock.calls[0]
    expect(refArg).toMatchObject({
      tag: 'planetcard',
      componentName: 'PlanetCard',
      module: './src/components/PlanetCard.vue',
      props: { name: 'Venus' },
      previewProps: { name: 'Venus' }, // the merged set the user saw
    })
    expect(snapArg).toMatchObject({ dataUrl: SNAPSHOT.dataUrl, fidelity: 'isolated-preview' })
    expect(atArg).toEqual({ x: 12, y: 34 })
    expect(dataArg).toEqual(BINDING)
  })

  it('placement requires a generated snapshot', async () => {
    const deps = makeDeps()
    const gen = useComponentGenerator(deps)
    gen.openFromDrop(item(), { x: 0, y: 0 })
    expect(await gen.placeAtDropPoint()).toBeNull()
    expect(deps.wireframe.addPaletteBlock).not.toHaveBeenCalled()
  })

  it('edit mode seeds from the block and apply routes to updatePaletteBlock', async () => {
    const deps = makeDeps()
    const gen = useComponentGenerator(deps)
    const block: WireframeBlock = {
      id: 'wfb-7',
      kind: 'palette',
      rect: { x: 0, y: 0, width: 320, height: 100 },
      z: 1,
      createdAt: 1,
      component: {
        tag: 'planetcard',
        componentName: 'PlanetCard',
        module: './src/components/PlanetCard.vue',
        props: { name: 'Mars' },
        previewProps: { name: 'Mars', type: 'rocky' },
      },
      data: BINDING,
    }
    gen.openFromBlock(block)
    expect(gen.session.value?.editBlockId).toBe('wfb-7')
    expect(gen.session.value?.propsState).toEqual({ name: 'Mars' })
    expect(gen.session.value?.binding).toEqual(BINDING)

    gen.session.value!.propsState = { name: 'Jupiter' }
    await gen.generate()
    await gen.apply()

    expect(gen.session.value).toBeNull()
    expect(deps.wireframe.addPaletteBlock).not.toHaveBeenCalled()
    const [id, patch] = deps.wireframe.updatePaletteBlock.mock.calls[0]
    expect(id).toBe('wfb-7')
    expect(patch).toMatchObject({
      props: { name: 'Jupiter' },
      data: BINDING,
      snapshot: { dataUrl: SNAPSHOT.dataUrl },
    })
  })

  it('ghost placement toggles and cancels', async () => {
    const deps = makeDeps()
    const gen = useComponentGenerator(deps)
    gen.openFromPick(item())
    gen.beginPlace() // no snapshot yet — refused
    expect(gen.session.value?.placing).toBe(false)
    await gen.generate()
    gen.beginPlace()
    expect(gen.session.value?.placing).toBe(true)
    gen.cancelPlace()
    expect(gen.session.value?.placing).toBe(false)
  })
})
