import { computed, ref } from 'vue'
import { useComponentLibrary, type LibraryComponent } from './useProjectComponents'
import { parseDefault } from '../utils/propWidgets'
import type { PaletteDragItem } from './usePaletteDrag'
import type { useWireframeMode, PaletteSnapshot, WireframeModeIframe } from './useWireframeMode'
import type { WireframeBlock, WireframeDataBinding } from '../../shared/wireframe-types'

/**
 * Generate-component flow for the wireframe canvas — replaces the blind
 * instant drop. One session at a time: pick (palette click or drop) →
 * settings (real props vs preview samples) → datasource (optional binding)
 * → generate (honest preview:component snapshot on the app-true surface) →
 * place (ghost at cursor / remembered drop point), or apply in edit mode.
 *
 * Clone discipline: the drag item is cloned plain at open(); every payload
 * that crosses postMessage (generate) or lands in the persisted block
 * (place/apply) is JSON-round-tripped at the boundary — reactive proxies
 * throw DataCloneError in postMessage and must never reach wireframe.json.
 */

export interface GeneratorSession {
  item: PaletteDragItem
  /** Prop metadata from the component catalog — null until resolved. */
  meta: LibraryComponent | null
  /** REAL props — persisted as component.props, used by codegen. */
  propsState: Record<string, unknown>
  /** Display samples — what the preview mounts with; never codegen'd. */
  previewPropsState: Record<string, unknown>
  binding: WireframeDataBinding | null
  /** Remembered drop point (the drag-drop fast path). */
  dropAt: { x: number; y: number } | null
  /** Preview mount width. */
  width: number
  generated: PaletteSnapshot | null
  /** The exact merged props the last generate rendered — persisted as the
   *  block's previewProps (they ARE what the user saw and approved). */
  generatedWith: Record<string, unknown> | null
  generating: boolean
  /** Ghost-placement mode: the generated image rides the cursor. */
  placing: boolean
  error: string | null
  /** Reconfigure mode: the placed block being edited. */
  editBlockId: string | null
}

export interface ComponentGeneratorDeps {
  iframe: Pick<WireframeModeIframe, 'previewComponent'>
  wireframe: Pick<ReturnType<typeof useWireframeMode>, 'addPaletteBlock' | 'updatePaletteBlock' | 'building'>
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
  const session = ref<GeneratorSession | null>(null)

  /** Catalog metadata for the session's component — library-scoped first,
   *  any-library fallback. Lazy: the catalog may not be loaded yet (reopening
   *  a block after F5 without visiting Components). */
  function resolveMeta(item: PaletteDragItem): LibraryComponent | null {
    const libs = cl.libraries.value
    const scoped = item.library ? libs.find(l => l.name === item.library) : undefined
    const inScope = scoped?.components.find(c => c.name === item.componentName)
    if (inScope) return inScope
    for (const lib of libs) {
      const hit = lib.components.find(c => c.name === item.componentName)
      if (hit) return hit
    }
    return null
  }

  function seedFromMeta(meta: LibraryComponent | null): Record<string, unknown> {
    const out: Record<string, unknown> = {}
    for (const p of meta?.props ?? []) {
      const parsed = parseDefault(p.default, p.type)
      if (parsed !== undefined) out[p.name] = parsed
    }
    return out
  }

  function open(item: PaletteDragItem, opts: { dropAt?: { x: number; y: number } | null; block?: WireframeBlock } = {}): void {
    if (deps.wireframe.building.value) return // sketch locked to a task
    const plainItem = plain(item)
    const block = opts.block
    const meta = resolveMeta(plainItem)
    if (!meta && cl.libraries.value.length === 0) {
      // Catalog not loaded this session — fetch in the background; the panel
      // upgrades from raw key/value rows to typed widgets when it lands.
      void cl.load().then(() => {
        if (session.value && !session.value.meta) session.value.meta = resolveMeta(session.value.item)
      })
    }
    session.value = {
      item: plainItem,
      meta,
      propsState: block?.component?.props ? plain(block.component.props) : (plainItem.props ? plain(plainItem.props) : {}),
      previewPropsState: block?.component?.previewProps
        ? plain(block.component.previewProps)
        : (plainItem.previewProps ? plain(plainItem.previewProps) : seedFromMeta(meta)),
      binding: block?.data ? plain(block.data) : null,
      dropAt: opts.dropAt ?? null,
      width: 320,
      generated: null,
      generatedWith: null,
      generating: false,
      placing: false,
      error: null,
      editBlockId: block?.id ?? null,
    }
  }

  /** Drop fast path: the panel opens with the drop point remembered. */
  function openFromDrop(item: PaletteDragItem, at: { x: number; y: number }): void {
    open(item, { dropAt: at })
  }

  /** Palette click path. */
  function openFromPick(item: PaletteDragItem): void {
    open(item)
  }

  /** Reconfigure a placed palette block (gear button). */
  function openFromBlock(block: WireframeBlock): void {
    if (block.kind !== 'palette' || !block.component?.componentName) return
    open({
      kind: 'component',
      componentName: block.component.componentName,
      tag: block.component.tag,
      label: block.component.componentName,
      ...(block.component.library ? { library: block.component.library } : {}),
      ...(block.component.module ? { module: block.component.module } : {}),
    }, { block })
  }

  async function generate(): Promise<void> {
    const s = session.value
    if (!s || s.generating) return
    s.generating = true
    s.error = null
    try {
      // Real values win over samples; the merged set is what the user sees.
      const merged = plain({ ...s.previewPropsState, ...definedEntries(s.propsState) })
      const res = await deps.iframe.previewComponent(s.item.componentName, merged, s.item.module, s.width)
      s.generatedWith = merged
      s.generated = {
        dataUrl: res.dataUrl,
        width: res.width,
        height: res.height,
        fidelity: (res.fidelity as PaletteSnapshot['fidelity']) ?? (res.mounted ? 'isolated-preview' : 'placeholder'),
        mounted: res.mounted,
      }
      if (!res.dataUrl) {
        // Honest degradation: no pixels → the placed block is a placeholder
        // render. Placement stays allowed; the panel says so.
        s.generated.fidelity = 'placeholder'
        s.error = res.error ?? null
      }
    } catch (err) {
      s.generated = { fidelity: 'placeholder', mounted: false }
      s.error = (err as Error).message ?? 'generate failed'
    } finally {
      s.generating = false
    }
  }

  function setBinding(binding: WireframeDataBinding | null): void {
    const s = session.value
    if (!s) return
    s.binding = binding ? plain(binding) : null
  }

  function beginPlace(): void {
    const s = session.value
    if (!s || !s.generated) return
    s.placing = true
  }

  function cancelPlace(): void {
    const s = session.value
    if (s) s.placing = false
  }

  function componentRef(s: GeneratorSession) {
    const props = definedEntries(s.propsState)
    const previewProps = s.generatedWith ?? plain({ ...s.previewPropsState, ...props })
    return {
      tag: s.item.tag,
      componentName: s.item.componentName,
      ...(s.item.library ? { library: s.item.library } : {}),
      ...(s.item.module ? { module: s.item.module } : {}),
      ...(Object.keys(props).length > 0 ? { props } : {}),
      ...(Object.keys(previewProps).length > 0 ? { previewProps } : {}),
    }
  }

  async function placeAt(at: { x: number; y: number }): Promise<string | null> {
    const s = session.value
    if (!s || !s.generated) return null
    const id = await deps.wireframe.addPaletteBlock(componentRef(s), s.generated, at, s.binding ?? undefined)
    session.value = null
    return id
  }

  async function placeAtDropPoint(): Promise<string | null> {
    const s = session.value
    if (!s?.dropAt) return null
    return placeAt(s.dropAt)
  }

  /** Edit mode: write the reconfiguration back to the placed block. */
  async function apply(): Promise<void> {
    const s = session.value
    if (!s?.editBlockId) return
    await deps.wireframe.updatePaletteBlock(s.editBlockId, {
      props: definedEntries(s.propsState),
      previewProps: s.generatedWith ?? plain({ ...s.previewPropsState, ...definedEntries(s.propsState) }),
      data: s.binding,
      ...(s.generated?.dataUrl ? { snapshot: s.generated } : {}),
    })
    session.value = null
  }

  function cancel(): void {
    session.value = null
  }

  /** Datasource step is OFFERED (not required) when the component looks
   *  data-driven: any prop infers as json (objects/arrays) or names an
   *  array-ish type. An explicit "Bind data…" affordance always exists. */
  const datasourceSuggested = computed(() => {
    const meta = session.value?.meta
    if (!meta) return false
    return meta.props.some(p => {
      const t = (p.type ?? '').toLowerCase()
      return t.includes('[]') || t.includes('array') || (!!p.type && !/^(string|number|boolean|bool|int|float)\b/.test(t) && !/^(['"])/.test(p.type ?? ''))
    })
  })

  return {
    session,
    datasourceSuggested,
    openFromDrop,
    openFromPick,
    openFromBlock,
    generate,
    setBinding,
    beginPlace,
    cancelPlace,
    placeAt,
    placeAtDropPoint,
    apply,
    cancel,
  }
}
