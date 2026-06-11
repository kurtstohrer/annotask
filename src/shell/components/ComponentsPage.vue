<script setup lang="ts">
import { computed, onMounted, ref, watch, nextTick, useTemplateRef } from 'vue'
import { useComponentLibrary, colorForLibrary, type LibraryComponent } from '../composables/useProjectComponents'
import { useWorkspace } from '../composables/useWorkspace'
import { usePaletteDrag, type PaletteDragItem } from '../composables/usePaletteDrag'
import { HTML_CATALOG, LAYOUT_PRESETS, type CatalogItem } from '../types'
import type { useIframeManager } from '../composables/useIframeManager'
import type { PreviewComponentResult } from '../../shared/bridge-types'
import type { WireframeInstance, WireframeInstanceStatus } from '../../shared/wireframe-types'
import Icon from './Icon.vue'
import MfeFilterDropdown from './MfeFilterDropdown.vue'
import DesignSessionPanel from './DesignSessionPanel.vue'

const props = defineProps<{
  iframe: ReturnType<typeof useIframeManager>
  highlightRects: Array<{ sourceName: string }>
  /** Component name currently emphasized via `dataHighlights.focusedName` —
   *  driven by both list-row hover and iframe element hover. */
  focusedName?: string | null
  /** Placements persisted on the current route — drives the placements panel
   *  and "Build this route" (which only batches the 'placed' ones). */
  placements?: WireframeInstance[]
  /** Instance ids whose durable anchor no longer resolves (source drifted). */
  staleIds?: string[]
  /** Instance ids whose last re-mount attempt threw. */
  failedIds?: string[]
  /** Wireframe mode is active — clicking a component opens the generate
   *  panel instead of the detail preview (which stays behind the info icon). */
  wireframeActive?: boolean
}>()

const emit = defineEmits<{ build: []; deletePlacement: [id: string]; runAgent: [taskId: string]; generateComponent: [item: PaletteDragItem] }>()

// ── Placements panel (current route's wireframe instances) ──
function placementStatus(i: WireframeInstance): WireframeInstanceStatus {
  return i.status ?? 'placed' // legacy instances predate the field
}
const placedCount = computed(() => (props.placements ?? []).filter((i) => placementStatus(i) === 'placed').length)
const buildingCount = computed(() => (props.placements ?? []).filter((i) => placementStatus(i) === 'building').length)
const appliedCount = computed(() => (props.placements ?? []).filter((i) => placementStatus(i) === 'applied').length)

function placementName(i: WireframeInstance): string {
  return i.kind === 'component' ? (i.inserted.componentName ?? i.inserted.tag) : i.inserted.tag
}

function placementTooltip(i: WireframeInstance): string {
  const lines = [
    `${placementName(i)} — ${i.kind}`,
    `${i.anchor.position} ${i.anchor.component || i.anchor.targetTag || 'target'} (${i.anchor.file}:${i.anchor.line})`,
  ]
  if (i.taskId) lines.push(`Task: ${i.taskId}`)
  return lines.join('\n')
}

const cl = useComponentLibrary(props.iframe)
const ws = useWorkspace()
const paletteDrag = usePaletteDrag()

// ── Palette drag (drag a catalog item onto the live app) ──
function fidelityLabel(hint: LibraryComponent['fidelityHint']): string {
  if (hint === 'live') return 'live'
  if (hint === 'isolated-preview') return 'preview'
  if (hint === 'placeholder') return 'placeholder'
  return ''
}

// Synthesize minimum-viable props so a component renders with visible content
// instead of empty (a Button with no `label` is an empty box). Display-only —
// these are NOT persisted as the placed component's real props.
// 'text'/'name' are intentionally excluded — in many UI libs `text` is a
// boolean style flag (text/link button) and `name` is a form field id, not
// display content.
const CONTENT_PROP_KEYS = new Set(['label', 'value', 'title', 'header', 'content', 'caption', 'placeholder', 'message', 'description'])
function sampleProps(c: LibraryComponent): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const p of c.props) {
    const name = p.name
    const t = (p.type || '').toLowerCase()
    const stringish = t.includes('string') || t === ''
    if (p.options && p.options.length) { out[name] = p.options[0]; continue }
    // Only fill content props that are actually string-typed, so a boolean
    // `text`/`value` flag isn't turned into a label.
    if (stringish && CONTENT_PROP_KEYS.has(name.toLowerCase())) { out[name] = c.name; continue }
    if (!p.required) continue
    if (t.includes('bool')) out[name] = true
    else if (t.includes('number')) out[name] = 1
    else if (t.includes('[]') || t.includes('array')) out[name] = []
    else if (t.includes('string') || t === '' || t.includes('|')) out[name] = c.name
    else out[name] = {} // object/unknown required prop → empty obj avoids undefined-access throws
  }
  return out
}

function componentDragItem(libName: string, c: LibraryComponent): PaletteDragItem {
  return {
    kind: 'component', componentName: c.name, tag: c.name, label: c.name, library: libName,
    module: c.module, fidelityHint: c.fidelityHint ?? 'unknown', previewProps: sampleProps(c),
  }
}

function catalogDragItem(item: CatalogItem): PaletteDragItem {
  return {
    kind: item.category === 'layout-preset' ? 'layout-preset' : 'html',
    componentName: item.tag, tag: item.tag, label: item.label,
    props: item.defaultProps, classes: item.defaultClasses, textContent: item.defaultTextContent, category: item.category,
  }
}

function onDragStart(e: DragEvent, item: PaletteDragItem) {
  paletteDrag.startDrag(item)
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = 'copy'
    e.dataTransfer.setData('application/x-annotask-palette', JSON.stringify(item))
    // Use the rendered snapshot as the drag ghost when we already have one.
    const url = item.kind === 'component' ? previewCache.get(item.componentName)?.dataUrl : undefined
    if (url) {
      const img = new Image()
      img.src = url
      e.dataTransfer.setDragImage(img, 20, 16)
    }
  }
}

function onDragEnd() {
  paletteDrag.endDrag()
}

// Filter the HTML/layout groups by the same search box (usage filters don't apply).
const q = computed(() => cl.filterText.value.trim().toLowerCase())
const layoutItems = computed(() => LAYOUT_PRESETS.filter((i) => !q.value || i.label.toLowerCase().includes(q.value)))
const htmlItems = computed(() => HTML_CATALOG.filter((i) => !q.value || i.label.toLowerCase().includes(q.value)))

// ── Component preview (offscreen render → snapshot) ──
const previewCache = new Map<string, PreviewComponentResult>()
const previewState = ref<{ loading: boolean; result: PreviewComponentResult | null }>({ loading: false, result: null })

async function loadPreview(c: LibraryComponent): Promise<void> {
  const name = c.name
  const cached = previewCache.get(name)
  if (cached) { previewState.value = { loading: false, result: cached }; return }
  previewState.value = { loading: true, result: null }
  const result = await props.iframe.previewComponent(name, sampleProps(c), c.module, 320)
  previewCache.set(name, result)
  // Ignore a stale response if the user moved on to another component.
  if (cl.selectedComponent.value?.name === name) previewState.value = { loading: false, result }
}

watch(() => cl.selectedComponent.value?.name, (name) => {
  previewState.value = { loading: false, result: null }
  const c = cl.selectedComponent.value
  if (name && c) void loadPreview(c)
}, { immediate: true })

function previewPlaceholderText(r: PreviewComponentResult | null): string {
  if (!r) return 'No preview available.'
  if (r.reason === 'not-registered') return 'Not loadable on this route — couldn’t resolve its module.'
  if (r.reason === 'threw') {
    if (/slot|children/i.test(r.detail || '')) return 'Container component — it needs child content (e.g. tabs/panels) to render.'
    return 'Couldn’t render standalone — it needs specific props or context.'
  }
  if (r.reason === 'rendered-empty') return 'Rendered nothing with sample props — needs real data or content.'
  if (r.error) return `Couldn’t snapshot the render (${r.error}).`
  return 'No preview available.'
}

const COLLAPSED_KEY = 'annotask:componentsCollapsedLibs'
const collapsedLibs = ref<Set<string>>(new Set())
try {
  const raw = localStorage.getItem(COLLAPSED_KEY)
  if (raw) collapsedLibs.value = new Set(JSON.parse(raw))
} catch {}

function toggleLib(name: string) {
  const next = new Set(collapsedLibs.value)
  if (next.has(name)) next.delete(name); else next.add(name)
  collapsedLibs.value = next
  try { localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...next])) } catch {}
}

onMounted(() => { cl.load(); ws.load() })

// Keep the "on this page" set in sync with iframe navigation + any DOM
// mutation that adds / removes instrumented elements (single-spa mount,
// conditional rendering, HMR). The bridge's MutationObserver emits
// `rendered:changed` debounced so we don't thrash on dense bursts.
props.iframe.onBridgeEvent('route:changed', () => { cl.refreshRenderedFiles() })
props.iframe.onBridgeEvent('rendered:changed', () => { cl.refreshRenderedFiles() })

// When the focused name changes *because the user hovered an element in the
// iframe* (rather than a row here), scroll the matching row into view so the
// correspondence is visible without the user hunting for it.
const listRef = useTemplateRef<HTMLElement>('listRef')
watch(() => props.focusedName, async (name) => {
  if (!name) return
  await nextTick()
  // focusedName is `${lib}\u0001${comp}` — strip the library prefix to find
  // the list row by its bare component name.
  const bare = name.includes('\u0001') ? name.split('\u0001').pop()! : name
  const el = listRef.value?.querySelector<HTMLElement>(`[data-component-name="${CSS.escape(bare)}"]`)
  if (el) el.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
})

function matchCount(name: string): number {
  let n = 0
  for (const h of props.highlightRects) if (h.sourceName === name) n++
  return n
}

function componentTooltip(lib: string, c: LibraryComponent): string {
  const lines: string[] = [
    `${c.name} — ${lib}`,
  ]
  if (c.module) lines.push(`Module: ${c.module}`)
  if (c.category) lines.push(`Category: ${c.category}`)
  if (c.deprecated) lines.push('⚠ deprecated')
  if (c.description) lines.push(c.description)
  lines.push(`${c.props.length} prop${c.props.length === 1 ? '' : 's'}` + (c.slots?.length ? ` · ${c.slots.length} slot${c.slots.length === 1 ? '' : 's'}` : '') + (c.events?.length ? ` · ${c.events.length} event${c.events.length === 1 ? '' : 's'}` : ''))
  if (cl.isOnPageInLib(lib, c.name)) lines.push('● on this page')
  else if (cl.isUsedInLib(lib, c.name)) lines.push('✓ used in this project')
  return lines.join('\n')
}
</script>

<template>
  <div class="components-page">
    <div class="components-header">
      <div class="components-search">
        <input
          type="search"
          placeholder="Filter components by name or module…"
          :value="cl.filterText.value"
          @input="cl.filterText.value = ($event.target as HTMLInputElement).value"
        />
      </div>
      <div class="filter-group" role="tablist" aria-label="Usage filter">
        <button
          :class="['filter-btn', { active: cl.filterMode.value === 'all' }]"
          @click="cl.filterMode.value = 'all'"
          :title="'Show every component in the catalog'"
        >All</button>
        <button
          :class="['filter-btn', { active: cl.filterMode.value === 'used' }]"
          @click="cl.filterMode.value = 'used'"
          :title="'Show only components referenced anywhere in this project'"
        >
          Used
          <span v-if="cl.usedProjectSet.value.size" class="filter-count">{{ cl.usedProjectSet.value.size }}</span>
        </button>
        <button
          :class="['filter-btn', { active: cl.filterMode.value === 'onPage' }]"
          @click="cl.filterMode.value = 'onPage'"
          :title="'Show only components whose call sites render on the current route'"
        >
          On page
          <span v-if="cl.usedOnPageSet.value.size" class="filter-count">{{ cl.usedOnPageSet.value.size }}</span>
        </button>
      </div>
      <MfeFilterDropdown v-if="ws.hasAnyMfes.value" label="Components" />
      <button
        v-if="props.placements?.length"
        class="components-btn build"
        data-testid="palette-build-route"
        :disabled="placedCount === 0"
        :title="placedCount === 0
          ? 'No new placements to build — the listed ones are already building or applied'
          : 'Create a wireframe_apply task for this route\'s new placements'"
        @click="emit('build')"
      >
        <Icon name="wand" :size="13" />
        Build<span class="build-count">{{ placedCount }}</span>
      </button>
      <button
        class="components-btn icon"
        :title="cl.isLoading.value ? 'Loading…' : 'Reload components'"
        :aria-label="cl.isLoading.value ? 'Loading components' : 'Reload components'"
        :disabled="cl.isLoading.value"
        @click="cl.load()"
      >
        <Icon name="rotate-cw" :size="14" :stroke-width="2" :class="{ spinning: cl.isLoading.value }" />
      </button>
    </div>

    <div v-if="cl.loadError.value" class="components-error">{{ cl.loadError.value }}</div>

    <!-- Placements on this route: lifecycle chips + per-instance delete. The
         placed/building/applied split mirrors the Build button — only the
         'placed' ones go into the next wireframe_apply task. -->
    <div v-if="props.placements?.length" class="placements-panel" data-testid="palette-placements">
      <div class="placements-head">
        <span class="placements-title">Placements on this route</span>
        <span v-if="buildingCount" class="placements-summary">{{ buildingCount }} building</span>
        <span v-if="appliedCount" class="placements-summary">{{ appliedCount }} applied</span>
      </div>
      <div v-for="i in props.placements" :key="i.id" class="placement-row" :title="placementTooltip(i)">
        <span class="placement-name">{{ placementName(i) }}</span>
        <span class="placement-status" :data-status="placementStatus(i)">{{ placementStatus(i) }}</span>
        <span class="placement-fidelity" :class="'fid-' + i.fidelity">{{ i.fidelity === 'isolated-preview' ? 'preview' : i.fidelity }}</span>
        <span v-if="props.staleIds?.includes(i.id)" class="placement-stale" title="The anchor element no longer exists in the source — delete this placement">stale</span>
        <span v-else-if="props.failedIds?.includes(i.id)" class="placement-stale" title="The last re-mount attempt failed — see the console for details">failed</span>
        <button
          class="placement-delete"
          :title="`Delete placement ${placementName(i)}`"
          :aria-label="`Delete placement ${placementName(i)}`"
          @click="emit('deletePlacement', i.id)"
        >
          <Icon name="trash" :size="12" />
        </button>
      </div>
    </div>

    <!-- Design session: pending/applied panel edits + apply/undo/discard. -->
    <DesignSessionPanel @run-agent="emit('runAgent', $event)" />

    <div class="components-split">
      <!-- LIST view — visible when no component is selected. -->
      <div v-if="!cl.selectedComponent.value" ref="listRef" class="components-list">
        <div v-if="cl.isLoading.value && cl.libraries.value.length === 0" class="components-empty">
          Loading component libraries…
        </div>
        <div v-else-if="cl.filteredLibraries.value.length === 0" class="components-empty">
          <p v-if="cl.filterText.value">No matches for "{{ cl.filterText.value }}"</p>
          <p v-else-if="cl.filterMode.value === 'onPage'">No library components are rendered on this route. Try <strong>Used</strong> or <strong>All</strong>.</p>
          <p v-else-if="cl.filterMode.value === 'used'">No library components are referenced in this project. Switch to <strong>All</strong> to browse the full catalog.</p>
          <p v-else>No component libraries detected.</p>
          <p class="components-empty-hint">Annotask reads component metadata from registered library catalogs (Antenna, PrimeVue, Radix, Headless UI, etc.) at <code>scanComponentLibraries</code>.</p>
        </div>
        <template v-else>
          <div v-for="lib in cl.filteredLibraries.value" :key="lib.name" class="lib-group">
            <button
              type="button"
              class="lib-group-head"
              :aria-expanded="!collapsedLibs.has(lib.name)"
              :title="collapsedLibs.has(lib.name) ? `Expand ${lib.name}` : `Collapse ${lib.name}`"
              @click="toggleLib(lib.name)"
            >
              <Icon
                :name="collapsedLibs.has(lib.name) ? 'chevron-right' : 'chevron-down'"
                :size="12"
                :stroke-width="2.5"
                class="lib-group-chevron"
              />
              <span class="lib-group-name">{{ lib.name }}</span>
              <span class="lib-group-version">{{ lib.version }}</span>
              <span class="lib-group-count">{{ lib.components.length }}</span>
            </button>
            <button
              v-for="c in (collapsedLibs.has(lib.name) ? [] : lib.components)"
              :key="lib.name + c.name"
              class="components-list-item"
              :class="{
                selected: cl.selectedKey.value === `${lib.name}:::${c.name}`,
                focused: focusedName === cl.sourceName(lib.name, c.name),
                'on-page': cl.isOnPageInLib(lib.name, c.name),
              }"
              :data-component-name="c.name"
              :title="componentTooltip(lib.name, c) + (props.wireframeActive ? '\n↳ click to generate, or drag onto the canvas' : '\n↳ drag onto the app to place')"
              draggable="true"
              @dragstart="onDragStart($event, componentDragItem(lib.name, c))"
              @dragend="onDragEnd"
              @click="props.wireframeActive ? emit('generateComponent', componentDragItem(lib.name, c)) : cl.select(lib.name, c.name)"
              @mouseenter="cl.isOnPageInLib(lib.name, c.name) && cl.setFocus(cl.sourceName(lib.name, c.name))"
              @mouseleave="focusedName === cl.sourceName(lib.name, c.name) && cl.setFocus(null)"
            >
              <div class="item-row">
                <span class="item-swatch" :style="{ background: colorForLibrary(lib.name) }" />
                <span class="item-name" :class="{ deprecated: c.deprecated }">{{ c.name }}</span>
                <button v-if="props.wireframeActive" class="item-info-btn" :title="`Open the ${c.name} detail preview`"
                  @click.stop="cl.select(lib.name, c.name)">
                  <Icon name="info" :size="11" />
                </button>
                <span v-if="fidelityLabel(c.fidelityHint)" class="item-fidelity" :class="'fid-' + c.fidelityHint" :title="c.providerSignals && c.providerSignals.length ? 'Uses: ' + c.providerSignals.join(', ') : ''">{{ fidelityLabel(c.fidelityHint) }}</span>
                <span v-if="cl.isOnPageInLib(lib.name, c.name)" class="item-onpage" title="Rendered on the current route">on page</span>
                <span v-else-if="cl.isUsedInLib(lib.name, c.name)" class="item-used" title="Referenced somewhere in this project">used</span>
                <span v-if="matchCount(cl.sourceName(lib.name, c.name)) > 0" class="item-match">
                  {{ matchCount(cl.sourceName(lib.name, c.name)) }} el
                </span>
                <span v-if="c.category" class="item-category">{{ c.category }}</span>
              </div>
              <div v-if="c.description" class="item-desc">{{ c.description }}</div>
            </button>
          </div>
        </template>

        <!-- Building blocks: HTML elements + layout presets (drag to place).
             Shown in 'all' mode (the usage filters apply only to library
             components). -->
        <template v-if="cl.filterMode.value === 'all'">
          <div v-if="layoutItems.length" class="lib-group">
            <div class="lib-group-head static"><span class="lib-group-name">Layout</span><span class="lib-group-count">{{ layoutItems.length }}</span></div>
            <button
              v-for="item in layoutItems"
              :key="'layout-' + item.label"
              class="components-list-item"
              draggable="true"
              :title="item.defaultClasses + '\n↳ drag onto the app to place'"
              @dragstart="onDragStart($event, catalogDragItem(item))"
              @dragend="onDragEnd"
            >
              <div class="item-row">
                <Icon name="grid-2x2" :size="13" class="item-glyph" />
                <span class="item-name">{{ item.label }}</span>
                <code class="item-meta">{{ item.defaultClasses }}</code>
              </div>
            </button>
          </div>
          <div v-if="htmlItems.length" class="lib-group">
            <div class="lib-group-head static"><span class="lib-group-name">Elements</span><span class="lib-group-count">{{ htmlItems.length }}</span></div>
            <button
              v-for="item in htmlItems"
              :key="'html-' + item.label"
              class="components-list-item"
              draggable="true"
              :title="'<' + item.tag + '>\n↳ drag onto the app to place'"
              @dragstart="onDragStart($event, catalogDragItem(item))"
              @dragend="onDragEnd"
            >
              <div class="item-row">
                <Icon name="code" :size="13" class="item-glyph" />
                <span class="item-name">{{ item.label }}</span>
                <code class="item-meta">&lt;{{ item.tag }}&gt;</code>
              </div>
            </button>
          </div>
        </template>
      </div>

      <!-- DETAIL view — visible when a component is selected. A Back button
           in the header returns to the list. -->
      <div v-else class="components-detail">
        <div class="detail-back-bar">
          <button class="components-back-btn" @click="cl.clearSelection()" title="Back to components list">
            <Icon name="chevron-left" :size="12" :stroke-width="2.5" />
            <span>Back</span>
          </button>
        </div>

        <div class="detail-header">
          <div class="detail-title-row">
            <span class="detail-dot" :style="{ background: colorForLibrary(cl.selectedLibrary.value ?? '') }" />
            <span class="item-kind" data-kind="component">{{ cl.selectedLibrary.value }}</span>
            <span class="detail-name" :class="{ deprecated: cl.selectedComponent.value.deprecated }">{{ cl.selectedComponent.value.name }}</span>
            <span v-if="cl.isOnPageInLib(cl.selectedLibrary.value ?? '', cl.selectedComponent.value.name)" class="detail-onpage">on this page</span>
            <span v-else-if="cl.isUsedInLib(cl.selectedLibrary.value ?? '', cl.selectedComponent.value.name)" class="detail-used">used in project</span>
          </div>
          <div v-if="cl.selectedComponent.value.description" class="detail-description">{{ cl.selectedComponent.value.description }}</div>
          <div class="detail-meta">
            <div v-if="cl.selectedComponent.value.module"><strong>Import:</strong> <code>{{ cl.selectedComponent.value.module }}</code></div>
            <div v-if="cl.selectedComponent.value.category"><strong>Category:</strong> {{ cl.selectedComponent.value.category }}</div>
            <div v-if="cl.selectedComponent.value.sourceFile"><strong>Source:</strong> <code>{{ cl.selectedComponent.value.sourceFile }}</code></div>
          </div>
        </div>

        <!-- Live preview — offscreen render snapshot. Draggable to place. -->
        <div class="detail-section">
          <div class="ds-label">Preview</div>
          <div
            class="detail-preview"
            draggable="true"
            title="Drag onto the app to place"
            @dragstart="onDragStart($event, componentDragItem(cl.selectedLibrary.value ?? '', cl.selectedComponent.value))"
            @dragend="onDragEnd"
          >
            <div v-if="previewState.loading" class="detail-preview-state">Rendering preview…</div>
            <img
              v-else-if="previewState.result?.dataUrl"
              class="detail-preview-img"
              :src="previewState.result.dataUrl"
              :alt="`Preview of ${cl.selectedComponent.value.name}`"
            />
            <div v-else class="detail-preview-state placeholder">
              <Icon name="package" :size="20" />
              <div class="dp-name">{{ cl.selectedComponent.value.name }}</div>
              <div class="dp-reason">{{ previewPlaceholderText(previewState.result) }}</div>
            </div>
            <div class="detail-preview-hint"><Icon name="mouse-pointer" :size="11" /> Drag onto the app to place</div>
          </div>
        </div>

        <!-- Props -->
        <div v-if="cl.selectedComponent.value.props.length" class="detail-section">
          <div class="ds-label">Props <span class="ds-hint">({{ cl.selectedComponent.value.props.length }})</span></div>
          <div class="detail-table">
            <div v-for="p in cl.selectedComponent.value.props" :key="p.name" class="detail-row">
              <code class="cell-name">{{ p.name }}<span v-if="p.required" class="required-marker">*</span></code>
              <code v-if="p.type" class="cell-type">{{ p.type }}</code>
              <code v-if="p.default !== undefined" class="cell-default">= {{ p.default }}</code>
              <span v-if="p.description" class="cell-desc">{{ p.description }}</span>
              <span v-if="p.options?.length" class="cell-options">
                <code v-for="o in p.options" :key="o">{{ o }}</code>
              </span>
            </div>
          </div>
        </div>

        <!-- Slots -->
        <div v-if="cl.selectedComponent.value.slots?.length" class="detail-section">
          <div class="ds-label">Slots <span class="ds-hint">({{ cl.selectedComponent.value.slots.length }})</span></div>
          <div class="detail-table">
            <div v-for="s in cl.selectedComponent.value.slots" :key="s.name" class="detail-row">
              <code class="cell-name">{{ s.name }}<span v-if="s.scoped" class="scoped-marker" title="scoped slot">scoped</span></code>
              <span v-if="s.description" class="cell-desc">{{ s.description }}</span>
            </div>
          </div>
        </div>

        <!-- Events -->
        <div v-if="cl.selectedComponent.value.events?.length" class="detail-section">
          <div class="ds-label">Events <span class="ds-hint">({{ cl.selectedComponent.value.events.length }})</span></div>
          <div class="detail-table">
            <div v-for="ev in cl.selectedComponent.value.events" :key="ev.name" class="detail-row">
              <code class="cell-name">{{ ev.name }}</code>
              <code v-if="ev.payloadType" class="cell-type">{{ ev.payloadType }}</code>
              <span v-if="ev.description" class="cell-desc">{{ ev.description }}</span>
            </div>
          </div>
        </div>

        <!-- Usages -->
        <div class="detail-section">
          <div class="ds-label">
            Usages in this project
            <span class="ds-hint">(via <code>annotask_get_component_examples</code>)</span>
          </div>
          <div v-if="cl.isUsagesLoading.value" class="components-empty">Scanning usages…</div>
          <div v-else-if="cl.usages.value.length === 0" class="components-empty">
            <p>No call sites detected. This component isn't used in <code>src/</code> yet.</p>
          </div>
          <ul v-else class="usage-list">
            <li v-for="(u, i) in cl.usages.value" :key="i" class="usage-row">
              <span class="usage-file">{{ u.file }}<span v-if="u.line">:{{ u.line }}</span></span>
              <code v-if="u.import_path" class="usage-import">{{ u.import_path }}</code>
            </li>
          </ul>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.components-page {
  display: flex;
  flex-direction: column;
  flex: 0 0 440px;
  height: 100%;
  background: var(--bg);
  color: var(--text);
  font-size: 12px;
  overflow: hidden;
  border-left: 1px solid var(--border);
}
.components-header {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border);
  background: var(--surface);
}
.components-title {
  font-weight: 600;
  font-size: 13px;
}
.components-search { flex: 1; min-width: 160px; }
.components-search input {
  width: 100%;
  padding: 7px 10px;
  font-size: 13px;
  background: var(--surface-2);
  border: 1px solid var(--border);
  color: var(--text);
  border-radius: 4px;
}
.components-search input:focus {
  outline: none;
  border-color: var(--focus-ring);
}
.filter-group {
  display: flex;
  gap: 2px;
  background: var(--surface-2);
  padding: 2px;
  border-radius: 4px;
}
.filter-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 3px 8px;
  font-size: 11px;
  background: transparent;
  border: none;
  color: var(--text-muted);
  border-radius: 3px;
  cursor: pointer;
  font-weight: 500;
}
.filter-btn:hover { color: var(--text); background: var(--surface-3); }
.filter-btn.active {
  color: var(--text);
  background: var(--surface);
  box-shadow: 0 0 0 1px var(--border);
}
.filter-count {
  font-size: 10px;
  padding: 0 5px;
  border-radius: 3px;
  background: var(--surface-3);
  color: var(--text-muted);
  font-weight: 600;
}
.filter-btn.active .filter-count {
  background: color-mix(in srgb, var(--accent) 20%, transparent);
  color: var(--accent);
}
.components-btn {
  padding: 4px 10px;
  font-size: 12px;
  background: var(--surface-2);
  border: 1px solid var(--border);
  color: var(--text);
  cursor: pointer;
  border-radius: 4px;
}
.components-btn:hover:not(:disabled) { background: var(--surface-3); }
.components-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.components-btn.icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 5px 6px;
  color: var(--text-muted);
}
.components-btn.icon:hover:not(:disabled) { color: var(--text); }
.spinning {
  animation: annotask-spin 0.9s linear infinite;
}
@keyframes annotask-spin {
  from { transform: rotate(0deg); }
  to   { transform: rotate(360deg); }
}

.components-error {
  padding: 8px 12px;
  color: var(--danger);
  border-bottom: 1px solid var(--border);
  background: color-mix(in srgb, var(--danger) 10%, transparent);
}

.components-split {
  display: flex;
  flex-direction: column;
  flex: 1;
  overflow: hidden;
  min-height: 0;
}
.components-list {
  flex: 1;
  min-width: 0;
  overflow-y: auto;
  background: var(--surface);
}

.detail-back-bar {
  padding: 8px 12px;
  border-bottom: 1px solid var(--border);
  background: var(--surface);
  position: sticky;
  top: 0;
  z-index: 1;
}
.components-back-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px 4px 6px;
  font-size: 11px;
  font-weight: 500;
  background: var(--surface-2);
  border: 1px solid var(--border);
  color: var(--text);
  border-radius: 4px;
  cursor: pointer;
}
.components-back-btn:hover {
  background: var(--surface-3);
  color: var(--text);
}
.lib-group {
  display: flex;
  flex-direction: column;
}
.lib-group-head {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  background: var(--surface-2);
  border: none;
  border-bottom: 1px solid var(--border);
  color: var(--text);
  width: 100%;
  text-align: left;
  cursor: pointer;
  font: inherit;
  position: sticky;
  top: 0;
  z-index: 1;
}
.lib-group-head:hover { background: var(--surface-3); }
.lib-group-head:focus-visible {
  outline: none;
  box-shadow: inset 0 0 0 2px var(--focus-ring);
}
.lib-group-chevron {
  color: var(--text-muted);
  flex-shrink: 0;
}
.lib-group-name {
  font-family: var(--font-mono, monospace);
  font-weight: 700;
  font-size: 11px;
}
.lib-group-version {
  color: var(--text-muted);
  font-family: var(--font-mono, monospace);
  font-size: 10px;
}
.lib-group-count {
  margin-left: auto;
  color: var(--text-muted);
  font-size: 10px;
}

.components-list-item {
  display: block;
  width: 100%;
  text-align: left;
  padding: 6px 10px;
  border: none;
  border-bottom: 1px solid var(--border);
  background: transparent;
  color: var(--text);
  cursor: grab;
  font-size: 12px;
}
.components-list-item:active { cursor: grabbing; }
.components-list-item:hover { background: var(--surface-2); }
.components-list-item.selected { background: color-mix(in srgb, var(--accent) 15%, transparent); }
.components-list-item.focused {
  background: color-mix(in srgb, var(--accent) 18%, transparent);
  box-shadow: inset 3px 0 0 var(--accent);
}
.components-list-item.on-page { cursor: pointer; }

.item-row {
  display: flex;
  gap: 6px;
  align-items: baseline;
  flex-wrap: wrap;
}
.item-swatch {
  display: inline-block;
  width: 4px;
  height: 14px;
  border-radius: 2px;
  flex-shrink: 0;
}
.item-name {
  font-weight: 600;
  font-family: var(--font-mono, monospace);
}
.item-name.deprecated {
  text-decoration: line-through;
  color: var(--text-muted);
}
.item-info-btn {
  display: inline-flex;
  align-items: center;
  background: none;
  border: none;
  color: var(--text-muted);
  cursor: pointer;
  padding: 0 2px;
}
.item-info-btn:hover { color: var(--text); }
.item-used {
  font-size: 9px;
  padding: 1px 4px;
  border-radius: 3px;
  background: color-mix(in srgb, var(--success) 20%, transparent);
  color: var(--success);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  font-weight: 600;
}
.item-onpage {
  font-size: 9px;
  padding: 1px 4px;
  border-radius: 3px;
  background: color-mix(in srgb, var(--accent) 22%, transparent);
  color: var(--accent);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  font-weight: 700;
}
.item-match {
  font-size: 10px;
  padding: 1px 5px;
  border-radius: 3px;
  background: color-mix(in srgb, var(--accent) 18%, transparent);
  color: var(--accent);
}
.item-category {
  margin-left: auto;
  font-size: 10px;
  color: var(--text-muted);
  font-style: italic;
}
.item-desc {
  color: var(--text-muted);
  font-size: 11px;
  margin-top: 2px;
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  -webkit-box-orient: vertical;
}

.components-detail {
  flex: 1;
  overflow-y: auto;
  min-width: 0;
}
.components-detail-empty,
.components-empty {
  padding: 24px 20px;
  color: var(--text-muted);
  font-size: 12px;
  line-height: 1.55;
}
.components-detail-empty h3 {
  font-size: 14px;
  font-weight: 700;
  color: var(--text);
  margin: 0 0 8px;
}
.components-detail-empty p { margin: 0 0 12px; }
.components-detail-empty ul {
  padding-left: 18px;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.components-detail-empty strong { color: var(--text); font-weight: 600; }
.components-detail-empty code,
.components-empty code {
  background: var(--surface-2);
  padding: 1px 5px;
  border-radius: 3px;
  font-family: var(--font-mono, monospace);
  font-size: 11px;
  color: var(--text);
}

.detail-header {
  padding: 12px;
  border-bottom: 1px solid var(--border);
  background: var(--surface);
}
.detail-title-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}
.detail-dot {
  display: inline-block;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  flex-shrink: 0;
}
.item-kind {
  font-size: 10px;
  font-family: var(--font-mono, monospace);
  padding: 1px 5px;
  border-radius: 3px;
  background: var(--surface-3);
  color: var(--cyan);
  text-transform: lowercase;
}
.detail-name {
  font-weight: 600;
  font-size: 14px;
  font-family: var(--font-mono, monospace);
}
.detail-name.deprecated {
  text-decoration: line-through;
  color: var(--text-muted);
}
.detail-used {
  margin-left: auto;
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 3px;
  background: color-mix(in srgb, var(--success) 20%, transparent);
  color: var(--success);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  font-weight: 600;
}
.detail-onpage {
  margin-left: auto;
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 3px;
  background: color-mix(in srgb, var(--accent) 22%, transparent);
  color: var(--accent);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  font-weight: 700;
}
.detail-description {
  color: var(--text);
  font-size: 12px;
  line-height: 1.55;
  margin-bottom: 8px;
}
.detail-meta {
  display: flex;
  flex-direction: column;
  gap: 2px;
  color: var(--text-muted);
  font-size: 11px;
}
.detail-meta code {
  color: var(--text);
  background: var(--surface-2);
  padding: 1px 4px;
  border-radius: 3px;
}

.detail-section {
  padding: 10px 12px;
  border-bottom: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.ds-label {
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-muted);
  font-weight: 600;
}
.ds-hint {
  font-size: 10px;
  color: var(--text-muted);
  font-weight: normal;
  text-transform: none;
  letter-spacing: normal;
  margin-left: 4px;
}
.ds-hint code {
  background: var(--surface-2);
  padding: 1px 4px;
  border-radius: 3px;
  font-family: var(--font-mono, monospace);
}

.detail-table {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.detail-row {
  display: flex;
  gap: 6px;
  align-items: baseline;
  flex-wrap: wrap;
  padding: 4px 0;
  border-bottom: 1px dashed color-mix(in srgb, var(--border) 60%, transparent);
}
.detail-row:last-child { border-bottom: none; }
.cell-name {
  font-family: var(--font-mono, monospace);
  font-weight: 600;
  color: var(--text);
}
.required-marker {
  color: var(--danger);
  margin-left: 2px;
}
.scoped-marker {
  margin-left: 4px;
  font-size: 9px;
  padding: 1px 4px;
  border-radius: 3px;
  background: var(--surface-3);
  color: var(--text-muted);
  font-family: var(--font-mono, monospace);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.cell-type {
  font-family: var(--font-mono, monospace);
  color: var(--cyan);
  background: var(--surface-2);
  padding: 1px 4px;
  border-radius: 3px;
}
.cell-default {
  font-family: var(--font-mono, monospace);
  color: var(--syntax-string, var(--success));
  background: var(--surface-2);
  padding: 1px 4px;
  border-radius: 3px;
}
.cell-desc {
  color: var(--text-muted);
  font-size: 11px;
  width: 100%;
}
.cell-options {
  display: inline-flex;
  gap: 3px;
  flex-wrap: wrap;
}
.cell-options code {
  background: var(--surface-2);
  padding: 1px 4px;
  border-radius: 3px;
  font-family: var(--font-mono, monospace);
  font-size: 10px;
  color: var(--text-muted);
}

.usage-list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.usage-row {
  display: flex;
  align-items: baseline;
  gap: 8px;
  font-size: 11px;
}
.usage-file {
  font-family: var(--font-mono, monospace);
  color: var(--accent);
}
.usage-import {
  margin-left: auto;
  color: var(--text-muted);
  font-family: var(--font-mono, monospace);
  font-size: 10px;
  background: var(--surface-2);
  padding: 1px 5px;
  border-radius: 3px;
}

/* ── Palette merge: build button, drag affordances, fidelity badges ── */
.components-btn.build {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  border-color: var(--accent);
  background: var(--accent);
  color: var(--text-on-accent, #fff);
  font-weight: 600;
}
.components-btn.build:hover:not(:disabled) { background: var(--accent-hover, var(--accent)); }
.build-count {
  min-width: 14px;
  padding: 0 4px;
  border-radius: 8px;
  background: color-mix(in srgb, #000 22%, transparent);
  font-size: 10px;
  text-align: center;
}

/* ── Placements panel (lifecycle of this route's wireframe instances) ── */
.placements-panel {
  border-bottom: 1px solid var(--border);
  background: var(--surface);
  max-height: 180px;
  overflow-y: auto;
}
.placements-head {
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: 6px 12px 4px;
}
.placements-title {
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-muted);
  font-weight: 600;
}
.placements-summary {
  font-size: 10px;
  color: var(--text-muted);
}
.placement-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 3px 12px;
  font-size: 11px;
}
.placement-row:hover { background: var(--surface-2); }
.placement-name {
  font-family: var(--font-mono, monospace);
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
  flex: 1;
}
.placement-status {
  font-size: 9px;
  padding: 1px 5px;
  border-radius: 3px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  font-weight: 600;
}
.placement-status[data-status="placed"] {
  background: color-mix(in srgb, var(--status-pending) 20%, transparent);
  color: var(--status-pending);
}
.placement-status[data-status="building"] {
  background: color-mix(in srgb, var(--status-in-progress) 20%, transparent);
  color: var(--status-in-progress);
}
.placement-status[data-status="applied"] {
  background: color-mix(in srgb, var(--status-accepted) 20%, transparent);
  color: var(--status-accepted);
}
.placement-fidelity {
  font-size: 9px;
  color: var(--text-muted);
}
.placement-stale {
  font-size: 9px;
  padding: 1px 5px;
  border-radius: 3px;
  background: color-mix(in srgb, var(--warning) 20%, transparent);
  color: var(--warning);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  font-weight: 600;
}
.placement-delete {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 2px;
  background: transparent;
  border: none;
  border-radius: 3px;
  color: var(--text-muted);
  cursor: pointer;
}
.placement-delete:hover {
  color: var(--danger);
  background: color-mix(in srgb, var(--danger) 12%, transparent);
}

.lib-group-head.static {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 4px 8px;
  cursor: default;
}

.item-glyph { color: var(--text-muted); flex: 0 0 auto; }
.item-meta {
  margin-left: auto;
  color: var(--text-muted);
  font-size: 10px;
  font-family: var(--font-mono, monospace);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 50%;
}

.item-fidelity {
  flex: 0 0 auto;
  font-size: 9px;
  font-weight: 600;
  line-height: 1;
  padding: 2px 5px;
  border-radius: 6px;
  color: var(--text-on-accent, #fff);
}
.item-fidelity.fid-live { background: var(--success); }
.item-fidelity.fid-isolated-preview { background: var(--warning); }
.item-fidelity.fid-placeholder,
.item-fidelity.fid-unknown { background: var(--role-component); }

/* Detail live preview */
.detail-preview {
  position: relative;
  border: 1px dashed var(--border-strong);
  border-radius: 8px;
  background:
    linear-gradient(45deg, var(--surface-2) 25%, transparent 25%, transparent 75%, var(--surface-2) 75%) 0 0 / 16px 16px,
    var(--surface);
  padding: 12px;
  min-height: 80px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  cursor: grab;
}
.detail-preview:active { cursor: grabbing; }
.detail-preview-img {
  max-width: 100%;
  max-height: 260px;
  border-radius: 4px;
  box-shadow: 0 1px 6px var(--shadow, rgba(0,0,0,0.2));
  background: #fff;
}
.detail-preview-state {
  color: var(--text-muted);
  text-align: center;
  font-size: 11px;
}
.detail-preview-state.placeholder { display: flex; flex-direction: column; align-items: center; gap: 4px; color: var(--text-muted); }
.dp-name { font-size: 12px; font-weight: 600; color: var(--text); }
.dp-reason { max-width: 260px; line-height: 1.4; }
.detail-preview-hint {
  position: absolute;
  bottom: 4px;
  right: 6px;
  display: inline-flex;
  align-items: center;
  gap: 3px;
  font-size: 9px;
  color: var(--text-muted);
  opacity: 0.8;
}
</style>
