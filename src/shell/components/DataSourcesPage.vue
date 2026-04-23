<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useDataSources } from '../composables/useDataSources'
import { latencyBucketLabel } from '../composables/useDataSources'
import { useLocalStorageEnum } from '../composables/useLocalStorageRef'
import { useWorkspace } from '../composables/useWorkspace'
import DataSourceDetailPane from './DataSourceDetailPane.vue'
import MfeFilterDropdown from './MfeFilterDropdown.vue'
import Icon from './Icon.vue'
import type { DataSource, RuntimeEndpoint } from '../../schema'

const props = withDefaults(defineProps<{
  highlightRects: Array<{ sourceName: string; label: string; color: string; ownerSources?: string[] }>
  /** 'data' shows Network + Hooks tabs; 'libraries' renders the libraries list
   *  exclusively (used by the standalone Develop > Libraries sub-section). */
  variant?: 'data' | 'libraries'
  /** The iframe's current route — threaded in from App.vue's useIframeManager.
   *  Used by the Network tab's "This route" filter so we scope by the app's
   *  pathname, NOT the shell's (which is always `/__annotask/`). */
  currentRoute?: string
}>(), { variant: 'data', currentRoute: '/' })

const ds = useDataSources()
const ws = useWorkspace()
onMounted(() => { ws.load() })

type DataTab = 'hooks' | 'network' | 'apis'
const storedTab = useLocalStorageEnum<DataTab>('annotask:dataTab', ['hooks', 'network', 'apis'], 'network')

// Effective active tab — forced to 'libraries' when the caller asked for the
// libraries variant, otherwise whatever the user last viewed.
const activeTab = computed<'hooks' | 'libraries' | 'network' | 'apis'>(() =>
  props.variant === 'libraries' ? 'libraries' : storedTab.value)

// Drive highlight context from the active tab: APIs tab highlights schemas,
// Hooks tab highlights sources, Libraries tab shows nothing.
watch(activeTab, (t, prev) => {
  ds.setHighlightTab(t)
  // Clear selection when tab actually changes so the per-tab empty-state
  // instructions show up. Skip on the initial immediate fire (no prev).
  if (prev !== undefined && prev !== t) ds.clearSelection()
}, { immediate: true })

// `useDataSources` stores filter text and selection at module level, so the
// Data and Libraries sub-tabs would otherwise share visible state. Each mount
// (the two variants have distinct :keys in App.vue so they remount on switch)
// starts with a cleared filter and selection.
onMounted(() => {
  ds.filterText.value = ''
  ds.clearSelection()
})

const filterPlaceholder = computed(() => {
  if (activeTab.value === 'hooks') return 'Filter hooks by name, file, endpoint…'
  if (activeTab.value === 'network') return 'Filter observed endpoints by path or method…'
  if (activeTab.value === 'apis') return 'Filter APIs by title, location, or kind…'
  return 'Filter libraries by name or pattern…'
})

// Network tab filters — local to the page. Always scoped to the current
// iframe route (the "All routes" view was removed because per-route is the
// only view that answers the question users actually have: "what did THIS
// page hit, and how slow?"). Orphans toggle and search filter still apply
// on top of the route scope.
const networkFilterText = ref('')
const networkOrphansOnly = ref(false)

// The iframe route comes from the parent — reading window.location here would
// give `/__annotask/` (the shell's own pathname), not the route the user's
// app is actually displaying.
const currentIframeRoute = computed(() => props.currentRoute || '/')

const visibleRuntimeEndpoints = computed(() => {
  const route = currentIframeRoute.value
  let list = ds.runtimeEndpoints.value.filter(ep => ep.routes.some(r => r.route === route))
  if (networkOrphansOnly.value) {
    list = list.filter(ep => !ep.matchedSources || ep.matchedSources.length === 0)
  }
  const q = networkFilterText.value.trim().toLowerCase()
  if (q) {
    list = list.filter(ep =>
      ep.pattern.toLowerCase().includes(q)
      || ep.path.toLowerCase().includes(q)
      || ep.method.toLowerCase().includes(q)
      || (ep.sampleUrls?.some(u => u.toLowerCase().includes(q)) ?? false),
    )
  }
  return list
})

/** Tooltip for the latency-colored swatch — shows bucket and the underlying
 *  numbers so a user can see why a row reads "slow". */
function latencySwatchTooltip(ep: RuntimeEndpoint): string {
  const bucket = latencyBucketLabel(ep.avgMs)
  if (typeof ep.avgMs !== 'number') {
    return 'No timed samples yet — interact with the app and reload this row.'
  }
  const lines = [`Latency: ${bucket}`, `avg: ${Math.round(ep.avgMs)}ms`]
  if (typeof ep.maxMs === 'number') lines.push(`max: ${Math.round(ep.maxMs)}ms`)
  if (typeof ep.latencySamples === 'number') lines.push(`(${ep.latencySamples} timed sample${ep.latencySamples === 1 ? '' : 's'})`)
  return lines.join('\n')
}

function statusTone(status: number | undefined): 'ok' | 'warn' | 'err' | 'muted' {
  if (typeof status !== 'number') return 'muted'
  if (status >= 500) return 'err'
  if (status >= 400) return 'warn'
  if (status >= 200 && status < 400) return 'ok'
  return 'muted'
}

async function clearRuntimeEndpoints() {
  try {
    await fetch('/__annotask/api/runtime-endpoints', { method: 'DELETE' })
    await ds.reloadRuntime()
  } catch { /* best-effort */ }
}

/** Currently-focused runtime endpoint key. Mirrors the select/clear pattern
 *  on Hooks/APIs rows — click a row to pin its highlights (dims others),
 *  click again to release. Hover sets the same focus transiently so the
 *  matched elements flash in the iframe while the user scans the list. */
const selectedNetKey = ref<string | null>(null)

function onNetworkRowEnter(key: string) {
  // Don't override a pinned selection.
  if (selectedNetKey.value) return
  ds.focusNetworkEndpoint(key)
}
function onNetworkRowLeave() {
  if (selectedNetKey.value) return
  ds.focusNetworkEndpoint(null)
}
function onNetworkRowClick(key: string) {
  selectedNetKey.value = selectedNetKey.value === key ? null : key
  ds.focusNetworkEndpoint(selectedNetKey.value)
}

function matchCount(name: string): number {
  let n = 0
  for (const h of props.highlightRects) {
    // A multi-owner rect counts for every source that contributed to it —
    // previously the overlay silently dropped secondary owners, which left
    // their rows claiming zero matches even when the element WAS on page.
    if (h.sourceName === name || h.ownerSources?.includes(name)) n++
  }
  return n
}

/** Distinct source names present in the current overlay rects. Drives the
 *  "On page" filter and its pill count — a source is on-page iff it has at
 *  least one rendered highlight rect right now (as primary or multi-owner). */
const onPageSet = computed<Set<string>>(() => {
  const s = new Set<string>()
  for (const h of props.highlightRects) {
    s.add(h.sourceName)
    if (h.ownerSources) for (const o of h.ownerSources) s.add(o)
  }
  return s
})

/** Hooks and schemas after the On-page pill is applied on top of the
 *  composable's MFE filter. Kept in the component (not the composable)
 *  because `onPage` depends on `highlightRects`, which is a live prop. */
const visibleDataSources = computed(() => {
  const base = ds.filteredDataSources.value
  if (ds.filterMode.value !== 'onPage') return base
  const on = onPageSet.value
  return base.filter(item => on.has(hookSourceName(item)))
})

/** APIs list after the On-page pill is applied on top of the composable's
 *  schema filter. Schemas register under `schema.location` as their highlight
 *  sourceName (see `buildApiHighlightSources` in useDataSources), so the same
 *  `onPageSet` membership test works. */
const visibleApiSchemas = computed(() => {
  const base = ds.filteredApiSchemas.value
  if (ds.filterMode.value !== 'onPage') return base
  const on = onPageSet.value
  return base.filter(item => on.has(item.schema.location))
})

/** Count used by the On-page pill. Counts items in the composable's base
 *  (MFE-filtered) list whose sourceName appears in the current overlay rects. */
const onPageCount = computed(() => {
  const on = onPageSet.value
  if (activeTab.value === 'hooks') {
    let n = 0
    for (const item of ds.filteredDataSources.value) {
      if (on.has(hookSourceName(item))) n++
    }
    return n
  }
  if (activeTab.value === 'apis') {
    let n = 0
    for (const item of ds.filteredApiSchemas.value) {
      if (on.has(item.schema.location)) n++
    }
    return n
  }
  return 0
})

/** Source name used by useDataSources for a hook row — file + method
 *  qualified so same-named entries in sibling MFEs (`apiHealth` in every
 *  stress-test MFE) and same-endpoint entries that differ only by HTTP
 *  method (GET vs PATCH on `/foo`) stay addressable distinctly. Must
 *  match `entryBindingKey` on the composable side. */
function hookSourceName(item: { file: string; name: string; method?: string }): string {
  return `${item.file}\u0001${item.name}\u0002${item.method ?? ''}`
}

/** Binding-graph confidence for a hook row — proxies to useDataSources so
 *  the template can show a compact "fallback" badge without each template
 *  having to reach into the graph map. `null` means the graph hasn't
 *  resolved yet (row renders with no badge). */
function hookConfidence(item: { file: string; name: string; method?: string }) {
  return ds.bindingConfidenceFor(item)
}

/** Multi-line tooltip summary for a data-source row. */
function hookTooltip(item: { name: string; dataKind: DataSource['kind']; file: string; line?: number; endpoint?: string; method?: string; used_count: number; discovered_by?: 'static' | 'runtime' }): string {
  const isRuntime = item.discovered_by === 'runtime'
  const lines: string[] = [
    `${item.name} — ${kindLabel(item.dataKind)}${isRuntime ? ' (runtime-discovered)' : ''}`,
    isRuntime ? '(no source location — found by network capture)' : `${item.file}${item.line ? ':' + item.line : ''}`,
  ]
  if (item.endpoint) lines.push(`Endpoint: ${item.endpoint}`)
  if (item.used_count > 0) {
    lines.push(isRuntime
      ? `${item.used_count} runtime call${item.used_count === 1 ? '' : 's'} captured`
      : `${item.used_count} reference${item.used_count === 1 ? '' : 's'} in src/`)
  }
  const matches = matchCount(hookSourceName(item))
  if (matches > 0) lines.push(`${matches} element${matches === 1 ? '' : 's'} highlighted on this route`)
  const conf = hookConfidence(item)
  if (conf && conf.confidence === 'fallback') {
    lines.push('Match confidence: fallback (file-level wildcard)')
    if (conf.note) lines.push(conf.note)
  }
  return lines.join('\n')
}

/** Multi-line tooltip summary for an API-schema row. */
function apiTooltip(item: { schema: { kind: string; title?: string; location: string; in_repo: boolean; operation_count: number } }): string {
  const lines: string[] = [
    `${item.schema.title || item.schema.location} — ${item.schema.kind}`,
    item.schema.location,
    `${item.schema.operation_count} operation${item.schema.operation_count === 1 ? '' : 's'}`,
    item.schema.in_repo ? 'in-repo' : 'external',
  ]
  const matches = matchCount(item.schema.location)
  if (matches > 0) lines.push(`${matches} element${matches === 1 ? '' : 's'} highlighted on this route`)
  return lines.join('\n')
}

/** Multi-line tooltip summary for a library row. */
function libraryTooltip(lib: { name: string; version?: string; detected_patterns: string[] }): string {
  const lines = [
    `${lib.name}${lib.version ? ' ' + lib.version : ''}`,
  ]
  if (lib.detected_patterns.length) {
    lines.push(`Detected: ${lib.detected_patterns.join(', ')}`)
  }
  return lines.join('\n')
}

const showCreateForm = ref(false)
const createDesired = ref('')
const createDescription = ref('')
const createRationale = ref('')
const createError = ref<string | null>(null)
const createSuccessId = ref<string | null>(null)

function kindLabel(kind: DataSource['kind']): string {
  switch (kind) {
    case 'composable': return 'hook'
    case 'signal': return 'signal'
    case 'store': return 'store'
    case 'fetch': return 'fetch'
    case 'graphql': return 'graphql'
    case 'loader': return 'loader'
    case 'rpc': return 'rpc'
  }
}

const routesOnPage = computed(() => {
  const item = ds.selectedItem.value
  if (!item || item.kind !== 'api-schema') return []
  return ds.operationsOnPage(item.schema.location, props.highlightRects)
})

const selectedSchemaBadge = computed(() => {
  const link = ds.selectedSchemaLink.value
  if (!link) return null
  if (link.schema_in_repo) return { text: 'in-repo', tone: 'ok' as const }
  return { text: 'external', tone: 'warn' as const }
})

function openCreate() {
  createDesired.value = ''
  createDescription.value = ''
  createRationale.value = ''
  createError.value = null
  createSuccessId.value = null
  showCreateForm.value = true
}

async function submitCreate() {
  createError.value = null
  if (!createDesired.value.trim() || !createDescription.value.trim()) {
    createError.value = 'Description and desired change are required'
    return
  }
  const res = await ds.createApiUpdateTask({
    description: createDescription.value.trim(),
    desired_change: createDesired.value.trim(),
    rationale: createRationale.value.trim() || undefined,
  })
  if (res.ok) {
    createSuccessId.value = res.id
    showCreateForm.value = false
  } else {
    createError.value = res.error
  }
}

function cancelCreate() {
  showCreateForm.value = false
}
</script>

<template>
  <div class="data-page">
    <div class="data-header">
      <div v-if="variant === 'data'" class="data-tabs">
        <button :class="['data-tab', { active: activeTab === 'network' }]" @click="storedTab = 'network'" title="Network calls the iframe has actually made. Fills gaps the regex scanner misses.">
          Network
          <span v-if="ds.runtimeEndpoints.value.length" class="data-tab-badge">{{ ds.runtimeEndpoints.value.length }}</span>
        </button>
        <button :class="['data-tab', { active: activeTab === 'apis' }]" @click="storedTab = 'apis'" title="API contracts discovered in the repo (OpenAPI, GraphQL, tRPC, JSON Schema).">
          APIs
          <span v-if="ds.apiSchemaItems.value.length" class="data-tab-badge">{{ ds.apiSchemaItems.value.length }}</span>
        </button>
        <button :class="['data-tab', { active: activeTab === 'hooks' }]" @click="storedTab = 'hooks'">
          Hooks
          <span v-if="ds.dataSourceItems.value.length" class="data-tab-badge">{{ ds.dataSourceItems.value.length }}</span>
        </button>
      </div>
      <div v-if="activeTab === 'libraries'" class="data-search">
        <input
          type="search"
          :placeholder="filterPlaceholder"
          :value="ds.filterText.value"
          @input="ds.filterText.value = ($event.target as HTMLInputElement).value"
        />
      </div>
      <div v-else-if="activeTab === 'network'" class="data-search">
        <input
          type="search"
          :placeholder="filterPlaceholder"
          v-model="networkFilterText"
        />
      </div>
      <div v-else class="filter-group" role="tablist" aria-label="Visibility filter">
        <button
          :class="['filter-btn', { active: ds.filterMode.value === 'all' }]"
          @click="ds.filterMode.value = 'all'"
          title="Show every detected project hook, store, or fetch wrapper"
        >All</button>
        <button
          :class="['filter-btn', { active: ds.filterMode.value === 'onPage' }]"
          @click="ds.filterMode.value = 'onPage'"
          title="Show only hooks with highlights on the current route"
        >
          On page
          <span v-if="onPageCount" class="filter-count">{{ onPageCount }}</span>
        </button>
      </div>
      <MfeFilterDropdown
        v-if="ws.hasAnyMfes.value && activeTab !== 'libraries'"
        label="Hooks"
      />
      <button
        class="data-btn icon"
        :title="ds.isLoading.value ? 'Loading…' : 'Reload'"
        :aria-label="ds.isLoading.value ? 'Loading' : 'Reload'"
        :disabled="ds.isLoading.value"
        @click="ds.reload()"
      >
        <Icon name="rotate-cw" :size="14" :stroke-width="2" :class="{ spinning: ds.isLoading.value }" />
      </button>
    </div>

    <div v-if="ds.loadError.value" class="data-error">
      {{ ds.loadError.value }}
    </div>

    <div class="data-split">
      <!-- LIST view — visible when no item is selected. -->
      <div v-if="!ds.selectedItem.value" class="data-list">
        <!-- HOOKS -->
        <template v-if="activeTab === 'hooks'">
          <div v-if="ds.isLoading.value && ds.dataSourceItems.value.length === 0" class="data-empty">
            Loading hooks…
          </div>
          <div v-else-if="visibleDataSources.length === 0" class="data-empty">
            <p v-if="ds.filterMode.value === 'onPage'">No hooks have highlights on this route. Switch to <strong>All</strong> to browse every detected hook.</p>
            <p v-else>No project hooks, stores, or fetch wrappers detected.</p>
            <p class="data-empty-hint">Annotask scans <code>src/</code> for composables, stores, signals, fetch wrappers, GraphQL ops, and tRPC routers.</p>
          </div>
          <div v-else class="data-list-groups">
            <button
              v-for="item in visibleDataSources" :key="item.id"
              data-testid="data-source-item"
              :data-source-name="item.name"
              :data-source-kind="item.dataKind"
              class="data-list-item"
              :class="{ selected: item.id === ds.selectedId.value }"
              :title="hookTooltip(item)"
              @click="ds.select(item.id)"
            >
              <div class="item-row">
                <span class="item-swatch" :style="{ background: ds.colorForEntry(item.name) }" />
                <span class="item-kind" :data-kind="item.dataKind">{{ kindLabel(item.dataKind) }}</span>
                <span class="item-name">{{ item.name }}</span>
                <span v-if="item.endpoint" class="item-endpoint">{{ item.endpoint }}</span>
                <span
                  v-if="item.discovered_by === 'runtime'"
                  class="item-badge warn"
                  title="Discovered by runtime network capture — the regex scanner didn't pin it to a source location. Use annotask_get_runtime_endpoints for call stats, or grep the codebase to locate the call site."
                >runtime</span>
                <span
                  v-if="hookConfidence(item)?.confidence === 'fallback'"
                  class="item-badge warn"
                  :title="`Match confidence: fallback — the binding analyzer couldn't precisely locate this source and fell back to file-level wildcard matching. Highlights may include unrelated elements.${hookConfidence(item)?.note ? '\\n' + hookConfidence(item)?.note : ''}`"
                >fallback</span>
                <span v-if="matchCount(hookSourceName(item)) > 0" class="item-match">
                  {{ matchCount(hookSourceName(item)) }} el
                </span>
                <span v-if="item.used_count > 0" class="item-used">{{ item.used_count }} {{ item.discovered_by === 'runtime' ? (item.used_count === 1 ? 'call' : 'calls') : (item.used_count === 1 ? 'ref' : 'refs') }}</span>
                <span class="item-file">{{ item.file || '—' }}</span>
              </div>
            </button>
          </div>
        </template>

        <!-- APIS -->
        <template v-else-if="activeTab === 'apis'">
          <div v-if="ds.isLoading.value && ds.apiSchemaItems.value.length === 0" class="data-empty">
            Loading APIs…
          </div>
          <div v-else-if="visibleApiSchemas.length === 0" class="data-empty">
            <p v-if="ds.filterMode.value === 'onPage'">No API schemas have highlights on this route. Switch to <strong>All</strong> to browse the full catalog.</p>
            <p v-else>No API schemas detected.</p>
            <p class="data-empty-hint">Annotask scans for OpenAPI/Swagger, GraphQL SDL, tRPC routers, and JSON Schema files — plus dev-server introspection probes.</p>
          </div>
          <div v-else class="data-list-groups">
            <button
              v-for="item in visibleApiSchemas" :key="item.id"
              class="data-list-item"
              :class="{ selected: item.id === ds.selectedId.value }"
              :title="apiTooltip(item)"
              @click="ds.select(item.id)"
            >
              <div class="item-row">
                <span class="item-swatch" :style="{ background: ds.colorForSchema(item.schema.location) }" />
                <span class="item-kind" data-kind="schema">{{ item.schema.kind }}</span>
                <span class="item-name">{{ item.schema.title || item.schema.location }}</span>
                <span class="item-badge" :class="{ warn: !item.schema.in_repo }">
                  {{ item.schema.in_repo ? 'in-repo' : 'external' }}
                </span>
                <span v-if="matchCount(item.schema.location) > 0" class="item-match">
                  {{ matchCount(item.schema.location) }} el
                </span>
                <span class="item-used">{{ item.schema.operation_count }} op{{ item.schema.operation_count === 1 ? '' : 's' }}</span>
                <span class="item-file">{{ item.schema.location }}</span>
              </div>
            </button>
          </div>
        </template>

        <!-- NETWORK (runtime-observed endpoints, scoped to current route) -->
        <template v-else-if="activeTab === 'network'">
          <div class="network-controls">
            <span class="network-route-tag" :title="`Showing endpoints captured on ${currentIframeRoute}`">
              <code>{{ currentIframeRoute }}</code>
            </span>
            <label class="network-toggle">
              <input type="checkbox" v-model="networkOrphansOnly" />
              <span title="Endpoints the static scanner didn't discover — candidates for wider regex coverage or a real API contract.">Orphans only</span>
            </label>
            <button
              class="data-btn icon"
              title="Clear captured endpoints"
              aria-label="Clear captured endpoints"
              @click="clearRuntimeEndpoints"
            >
              <Icon name="trash" :size="13" :stroke-width="2" />
            </button>
          </div>
          <div v-if="visibleRuntimeEndpoints.length === 0" class="data-empty">
            <p v-if="networkOrphansOnly">No orphan endpoints on <code>{{ currentIframeRoute }}</code> — every runtime call maps to a static data source.</p>
            <p v-else-if="networkFilterText">No matches for "{{ networkFilterText }}" on <code>{{ currentIframeRoute }}</code>.</p>
            <p v-else>No endpoints captured on <code>{{ currentIframeRoute }}</code> yet.</p>
            <p class="data-empty-hint">The iframe's bridge client monkey-patches <code>fetch</code>, <code>XMLHttpRequest</code>, and <code>navigator.sendBeacon</code>. Interact with the app and calls will appear here. Aggregation is keyed by (origin, method, pattern).</p>
          </div>
          <div v-else class="data-list-groups">
            <button
              v-for="ep in visibleRuntimeEndpoints"
              :key="ds.networkEndpointKey(ep)"
              class="data-list-item"
              :class="{ selected: selectedNetKey === ds.networkEndpointKey(ep) }"
              :title="ep.sampleUrls.join('\n')"
              @mouseenter="onNetworkRowEnter(ds.networkEndpointKey(ep))"
              @mouseleave="onNetworkRowLeave()"
              @click="onNetworkRowClick(ds.networkEndpointKey(ep))"
            >
              <div class="item-row">
                <span
                  class="item-swatch"
                  :style="{ background: ds.colorForEndpoint(ep) }"
                  :title="latencySwatchTooltip(ep)"
                />
                <span class="item-kind net-method" :data-method="ep.method">{{ ep.method }}</span>
                <code class="net-pattern">{{ ep.pattern }}</code>
                <span
                  v-if="ep.lastStatus != null"
                  class="net-status"
                  :data-tone="statusTone(ep.lastStatus)"
                >{{ ep.lastStatus }}</span>
                <span
                  v-if="typeof ep.avgMs === 'number'"
                  class="net-latency"
                  :style="{ color: ds.colorForEndpoint(ep) }"
                  :title="latencySwatchTooltip(ep)"
                >{{ Math.round(ep.avgMs) }}ms</span>
                <span v-if="matchCount(ds.networkEndpointKey(ep)) > 0" class="item-match">
                  {{ matchCount(ds.networkEndpointKey(ep)) }} el
                </span>
                <span v-if="ep.matchedSources?.length" class="item-badge" :title="`Matches static: ${ep.matchedSources.join(', ')}`">static</span>
                <span v-else class="item-badge warn" title="Not found by the regex scanner — only discovered at runtime.">orphan</span>
                <span v-if="ep.matchedSchemaLocation" class="item-badge" :title="`OpenAPI: ${ep.matchedSchemaLocation}${ep.matchedOperationId ? ' · ' + ep.matchedOperationId : ''}`">schema</span>
                <span class="item-used">{{ ep.count }} call{{ ep.count === 1 ? '' : 's' }}</span>
              </div>
              <div class="item-row net-meta">
                <span v-if="ep.origin" class="net-origin">{{ ep.origin }}</span>
                <span class="net-routes">
                  <span v-for="r in ep.routes.slice(0, 4)" :key="r.route" class="net-route-chip" :title="`${r.count} call${r.count === 1 ? '' : 's'} on ${r.route}`">
                    {{ r.route }}
                  </span>
                  <span v-if="ep.routes.length > 4" class="net-route-more">+{{ ep.routes.length - 4 }}</span>
                </span>
              </div>
            </button>
          </div>
        </template>

        <!-- LIBRARIES -->
        <template v-else-if="activeTab === 'libraries'">
          <div v-if="ds.isLoading.value && ds.libraries.value.length === 0" class="data-empty">
            Loading libraries…
          </div>
          <div v-else-if="ds.filteredLibraries.value.length === 0" class="data-empty">
            <p v-if="ds.filterText.value">No matches for "{{ ds.filterText.value }}"</p>
            <p v-else>No data-fetching libraries detected.</p>
            <p class="data-empty-hint">Annotask looks for React Query, SWR, Apollo, urql, Pinia, Zustand, Redux, Jotai, Solid primitives, Svelte stores, axios, ofetch, GraphQL clients, tRPC, and htmx in your <code>package.json</code>.</p>
          </div>
          <div v-else class="lib-list">
            <button
              v-for="lib in ds.filteredLibraries.value" :key="lib.name"
              class="lib-item"
              :class="{ selected: ds.selectedId.value === `lib:${lib.name}` }"
              :title="libraryTooltip(lib)"
              @click="ds.select(`lib:${lib.name}`)"
            >
              <div class="lib-head">
                <span class="lib-name">{{ lib.name }}</span>
                <span v-if="lib.version" class="lib-version">{{ lib.version }}</span>
              </div>
              <div v-if="lib.detected_patterns.length" class="lib-patterns">
                <code v-for="p in lib.detected_patterns" :key="p">{{ p }}</code>
              </div>
            </button>
          </div>
        </template>
      </div>

      <!-- DETAIL view — visible when an item is selected. A Back button in
           the header returns to the list. Tab switching auto-clears selection. -->
      <div v-else class="data-detail">
        <div class="detail-back-bar">
          <button class="data-back-btn" @click="ds.clearSelection()" :title="`Back to ${activeTab === 'hooks' ? 'Hooks' : activeTab === 'apis' ? 'APIs' : activeTab === 'network' ? 'Network' : 'Libraries'} list`">
            <Icon name="chevron-left" :size="12" :stroke-width="2.5" />
            <span>Back</span>
          </button>
        </div>

        <template v-if="ds.selectedItem.value.kind === 'data-source'">
          <div class="detail-header">
            <div class="detail-title-row">
              <span class="detail-dot" :style="{ background: ds.colorForEntry(ds.selectedItem.value.name) }" :title="`Highlight color for ${ds.selectedItem.value.name}`" />
              <span class="item-kind" :data-kind="ds.selectedItem.value.dataKind">{{ kindLabel(ds.selectedItem.value.dataKind) }}</span>
              <span class="detail-name">{{ ds.selectedItem.value.name }}</span>
              <span v-if="selectedSchemaBadge" class="item-badge" :class="{ warn: selectedSchemaBadge.tone === 'warn' }">
                {{ selectedSchemaBadge.text }}
              </span>
            </div>
            <div v-if="ds.selectedSchemaLink.value?.schema_in_repo" class="detail-actions">
              <button data-testid="btn-create-api-task" class="data-btn primary" @click="openCreate">Create API Update Task</button>
            </div>
            <div v-else-if="ds.selectedSchemaLink.value && !ds.selectedSchemaLink.value.schema_in_repo" class="detail-note">
              External API — schema cannot be edited from here.
            </div>
          </div>

          <div v-if="createSuccessId" class="detail-success">
            Created <code>{{ createSuccessId }}</code> with type <code>api_update</code>.
          </div>

          <div v-if="showCreateForm" class="create-form">
            <label>
              <span>Task description (markdown)</span>
              <textarea v-model="createDescription" rows="2" placeholder="e.g. Add expires_at to the Cat response so the badge can show expiration." />
            </label>
            <label>
              <span>Desired change</span>
              <textarea v-model="createDesired" rows="2" placeholder="e.g. Add nullable `expires_at: string` (ISO date) to the Cat response schema and the backend handler." />
            </label>
            <label>
              <span>Rationale (optional)</span>
              <textarea v-model="createRationale" rows="1" placeholder="Why is this change needed?" />
            </label>
            <div v-if="createError" class="create-error">{{ createError }}</div>
            <div class="create-actions">
              <button data-testid="btn-submit-api-task" class="data-btn primary" @click="submitCreate">Create task</button>
              <button class="data-btn" @click="cancelCreate">Cancel</button>
            </div>
          </div>

          <DataSourceDetailPane
            :details="ds.details.value"
            :isLoading="ds.isDetailsLoading.value"
            :error="ds.detailsError.value"
          />
        </template>

        <template v-else-if="ds.selectedItem.value.kind === 'api-schema'">
          <div class="detail-header">
            <div class="detail-title-row">
              <span class="detail-dot" :style="{ background: ds.colorForSchema(ds.selectedItem.value.schema.location) }" :title="`Highlight color for ${ds.selectedItem.value.schema.location}`" />
              <span class="item-kind" data-kind="schema">{{ ds.selectedItem.value.schema.kind }}</span>
              <span class="detail-name">{{ ds.selectedItem.value.schema.title || ds.selectedItem.value.schema.location }}</span>
              <span class="item-badge" :class="{ warn: !ds.selectedItem.value.schema.in_repo }">
                {{ ds.selectedItem.value.schema.in_repo ? 'in-repo' : 'external' }}
              </span>
            </div>
            <div class="detail-meta">
              <div><strong>Location:</strong> <code>{{ ds.selectedItem.value.schema.location }}</code></div>
              <div v-if="ds.selectedItem.value.schema.version"><strong>Version:</strong> {{ ds.selectedItem.value.schema.version }}</div>
              <div><strong>Operations:</strong> {{ ds.selectedItem.value.schema.operation_count }}</div>
              <div><strong>Source:</strong> {{ ds.selectedItem.value.schema.source }}</div>
            </div>
          </div>

          <!-- Routes on this page — operations from this schema with highlights currently rendered. -->
          <div v-if="routesOnPage.length > 0" class="routes-on-page">
            <div class="ds-label">
              Routes on this page
              <span class="ds-hint">(highlighted in the preview)</span>
            </div>
            <div class="routes-list">
              <div v-for="r in routesOnPage" :key="r.method + r.path" class="route-chip" :style="{ '--route-color': r.color }">
                <span class="route-dot" />
                <span class="op-method">{{ r.method.toUpperCase() }}</span>
                <code class="op-path">{{ r.path }}</code>
                <span class="route-count">{{ r.count }} el</span>
              </div>
            </div>
          </div>

          <div class="schema-ops">
            <div v-for="(op, idx) in ds.selectedItem.value.schema.operations.slice(0, 50)" :key="idx" class="schema-op">
              <span class="op-method">{{ op.method.toUpperCase() }}</span>
              <code class="op-path">{{ op.path }}</code>
              <span v-if="op.summary" class="op-summary">{{ op.summary }}</span>
            </div>
            <div v-if="ds.selectedItem.value.schema.operations.length > 50" class="schema-op-more">
              …and {{ ds.selectedItem.value.schema.operations.length - 50 }} more
            </div>
          </div>
        </template>

        <template v-else-if="ds.selectedItem.value.kind === 'library'">
          <div class="detail-header">
            <div class="detail-title-row">
              <span class="item-kind" data-kind="schema">library</span>
              <span class="detail-name">{{ ds.selectedItem.value.library.name }}</span>
              <span v-if="ds.selectedItem.value.library.version" class="item-used">{{ ds.selectedItem.value.library.version }}</span>
            </div>
            <div v-if="ds.selectedItem.value.library.detected_patterns.length" class="lib-patterns lib-patterns-detail">
              <code v-for="p in ds.selectedItem.value.library.detected_patterns" :key="p">{{ p }}</code>
            </div>
          </div>

          <div class="lib-usages">
            <div class="ds-label">
              Project usages
              <span class="ds-hint">(via <code>annotask_get_data_source_examples</code>)</span>
            </div>
            <div v-if="ds.isLibraryUsagesLoading.value" class="data-empty">Scanning usages…</div>
            <div v-else-if="ds.libraryUsages.value.length === 0" class="data-empty">
              <p>No project files consume this library's identifiers.</p>
              <p class="data-empty-hint">Library may be transitive or used in a way the scanner doesn't recognize.</p>
            </div>
            <ul v-else class="usage-list">
              <li v-for="(u, i) in ds.libraryUsages.value" :key="i" class="usage-row">
                <code class="usage-pattern">{{ u.pattern }}</code>
                <span class="usage-file">{{ u.file }}<span v-if="u.line">:{{ u.line }}</span></span>
              </li>
            </ul>
          </div>
        </template>
      </div>
    </div>
  </div>
</template>

<style scoped>
.data-page {
  display: flex;
  flex-direction: column;
  flex: 0 0 440px;     /* match theme-panel / tasks-panel width */
  height: 100%;
  background: var(--bg);
  color: var(--text);
  font-size: 12px;
  overflow: hidden;
  border-left: 1px solid var(--border);
}
.data-header {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border);
  background: var(--surface);
}
.data-title {
  font-weight: 600;
  font-size: 13px;
}
.data-tabs {
  display: flex;
  gap: 2px;
  background: var(--surface-2);
  padding: 2px;
  border-radius: 4px;
}
.data-tab {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  font-size: 12px;
  background: transparent;
  border: none;
  color: var(--text-muted);
  border-radius: 3px;
  cursor: pointer;
  font-weight: 500;
}
.data-tab:hover {
  color: var(--text);
  background: var(--surface-3);
}
.data-tab.active {
  color: var(--text);
  background: var(--surface);
  box-shadow: 0 0 0 1px var(--border);
}
.data-tab-badge {
  font-size: 10px;
  padding: 1px 5px;
  border-radius: 3px;
  background: var(--surface-3);
  color: var(--text-muted);
  font-weight: 600;
}
.data-tab.active .data-tab-badge {
  background: color-mix(in srgb, var(--accent) 20%, transparent);
  color: var(--accent);
}
.data-search {
  flex: 1;
  min-width: 160px;
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
.data-search input {
  width: 100%;
  padding: 7px 10px;
  font-size: 13px;
  background: var(--surface-2);
  border: 1px solid var(--border);
  color: var(--text);
  border-radius: 4px;
}
.data-search input:focus {
  outline: none;
  border-color: var(--focus-ring);
}
.data-btn {
  padding: 4px 10px;
  font-size: 12px;
  background: var(--surface-2);
  border: 1px solid var(--border);
  color: var(--text);
  cursor: pointer;
  border-radius: 4px;
}
.data-btn:hover:not(:disabled) {
  background: var(--surface-3);
}
.data-btn.icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 5px 6px;
  color: var(--text-muted);
}
.data-btn.icon:hover:not(:disabled) { color: var(--text); }
.spinning {
  animation: annotask-spin 0.9s linear infinite;
}
@keyframes annotask-spin {
  from { transform: rotate(0deg); }
  to   { transform: rotate(360deg); }
}
.data-btn.primary {
  background: var(--accent);
  color: var(--text-on-accent);
  border-color: var(--accent);
}
.data-btn.primary:hover {
  background: var(--accent-hover);
}
.data-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.data-error {
  padding: 8px 12px;
  color: var(--danger);
  border-bottom: 1px solid var(--border);
  background: color-mix(in srgb, var(--danger) 10%, transparent);
}

.data-split {
  display: flex;
  flex-direction: column;
  flex: 1;
  overflow: hidden;
  min-height: 0;
}

.data-list {
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

.data-back-btn {
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
.data-back-btn:hover {
  background: var(--surface-3);
  color: var(--text);
}
.data-list-groups {
  display: flex;
  flex-direction: column;
}
.data-list-item {
  display: block;
  width: 100%;
  text-align: left;
  padding: 6px 10px;
  border: none;
  border-bottom: 1px solid var(--border);
  background: transparent;
  color: var(--text);
  cursor: pointer;
  font-size: 12px;
}
.data-list-item:hover {
  background: var(--surface-2);
}
.data-list-item.selected {
  background: color-mix(in srgb, var(--accent) 15%, transparent);
}
.item-row {
  display: flex;
  gap: 6px;
  align-items: baseline;
  flex-wrap: wrap;
}
.item-kind {
  font-size: 10px;
  font-family: var(--font-mono, monospace);
  padding: 1px 5px;
  border-radius: 3px;
  background: var(--surface-3);
  color: var(--text-muted);
  text-transform: lowercase;
}
.item-swatch {
  display: inline-block;
  width: 4px;
  height: 14px;
  border-radius: 2px;
  flex-shrink: 0;
}
.item-match {
  font-size: 10px;
  padding: 1px 5px;
  border-radius: 3px;
  background: color-mix(in srgb, var(--accent) 18%, transparent);
  color: var(--accent);
}
.item-kind[data-kind="composable"] { color: var(--purple); }
.item-kind[data-kind="store"] { color: var(--cyan); }
.item-kind[data-kind="fetch"] { color: var(--accent); }
.item-kind[data-kind="graphql"] { color: var(--indigo); }
.item-kind[data-kind="rpc"] { color: var(--orange); }
.item-kind[data-kind="signal"] { color: var(--success); }
.item-kind[data-kind="loader"] { color: var(--warning); }
.item-kind[data-kind="schema"] { color: var(--info); }
.item-name {
  font-weight: 600;
  font-family: var(--font-mono, monospace);
}
.item-endpoint {
  color: var(--text-muted);
  font-family: var(--font-mono, monospace);
  font-size: 11px;
}
.item-used {
  margin-left: auto;
  color: var(--text-muted);
  font-size: 11px;
}
.item-file {
  width: 100%;
  color: var(--text-muted);
  font-size: 10px;
  font-family: var(--font-mono, monospace);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.item-badge {
  font-size: 10px;
  padding: 1px 5px;
  border-radius: 3px;
  background: color-mix(in srgb, var(--success) 20%, transparent);
  color: var(--success);
}
.item-badge.warn {
  background: color-mix(in srgb, var(--warning) 20%, transparent);
  color: var(--warning);
}

.data-detail {
  flex: 1;
  overflow-y: auto;
  padding: 0;
  min-width: 0;
}
.data-detail-empty {
  padding: 24px 20px;
  color: var(--text-muted);
  font-size: 12px;
  line-height: 1.55;
}
.data-detail-empty h3 {
  font-size: 14px;
  font-weight: 700;
  color: var(--text);
  margin: 0 0 8px;
}
.data-detail-empty p {
  margin: 0 0 12px;
}
.data-detail-empty ul {
  padding-left: 18px;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.data-detail-empty strong {
  color: var(--text);
  font-weight: 600;
}
.data-detail-empty code {
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
.detail-name {
  font-weight: 600;
  font-size: 14px;
  font-family: var(--font-mono, monospace);
}
.detail-dot {
  display: inline-block;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  flex-shrink: 0;
}
.detail-actions {
  display: flex;
  gap: 6px;
}
.detail-note {
  color: var(--text-muted);
  font-size: 11px;
  font-style: italic;
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
  font-size: 11px;
}

.detail-success {
  padding: 8px 12px;
  color: var(--success);
  background: color-mix(in srgb, var(--success) 10%, transparent);
  border-bottom: 1px solid var(--border);
  font-size: 12px;
}
.detail-success code {
  color: var(--success);
  font-family: var(--font-mono, monospace);
}

.create-form {
  padding: 10px 12px;
  border-bottom: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.create-form label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 11px;
}
.create-form span {
  color: var(--text-muted);
  font-weight: 500;
}
.create-form textarea {
  padding: 6px 8px;
  background: var(--surface-2);
  border: 1px solid var(--border);
  color: var(--text);
  border-radius: 4px;
  font-family: inherit;
  font-size: 12px;
  resize: vertical;
}
.create-form textarea:focus {
  outline: none;
  border-color: var(--focus-ring);
}
.create-error {
  color: var(--danger);
  font-size: 11px;
}
.create-actions {
  display: flex;
  gap: 6px;
  justify-content: flex-end;
}

.routes-on-page {
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  border-bottom: 1px solid var(--border);
}
.routes-on-page .ds-label {
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-muted);
  font-weight: 600;
}
.routes-on-page .ds-hint {
  font-size: 10px;
  color: var(--text-muted);
  font-weight: normal;
  text-transform: none;
  letter-spacing: normal;
  margin-left: 4px;
}
.routes-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.route-chip {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 6px;
  background: color-mix(in srgb, var(--route-color) 10%, transparent);
  border-left: 3px solid var(--route-color);
  border-radius: 0 4px 4px 0;
  font-size: 11px;
}
.route-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--route-color);
  flex-shrink: 0;
}
.route-chip .op-method {
  min-width: 54px;
  font-weight: 700;
  color: var(--route-color);
}
.route-chip .op-path {
  flex: 1;
  color: var(--text);
  font-family: var(--font-mono, monospace);
}
.route-count {
  font-size: 10px;
  color: var(--text-muted);
  padding: 1px 5px;
  border-radius: 3px;
  background: var(--surface-2);
}

.schema-ops {
  padding: 8px 12px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.schema-op {
  display: flex;
  gap: 8px;
  align-items: baseline;
  padding: 4px 6px;
  border-bottom: 1px solid var(--border);
}
.op-method {
  font-family: var(--font-mono, monospace);
  font-size: 10px;
  font-weight: 600;
  color: var(--accent);
  min-width: 60px;
}
.op-path {
  font-family: var(--font-mono, monospace);
  font-size: 12px;
  color: var(--text);
}
.op-summary {
  color: var(--text-muted);
  font-size: 11px;
}
.schema-op-more {
  color: var(--text-muted);
  font-style: italic;
  font-size: 11px;
  padding: 4px 6px;
}

.network-controls {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-bottom: 1px solid var(--border);
  background: var(--surface);
}
.network-toggle {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 11px;
  color: var(--text-muted);
  cursor: pointer;
  user-select: none;
}
.network-toggle input {
  margin: 0;
  cursor: pointer;
}
.net-method {
  font-weight: 700;
}
.net-method[data-method="GET"]     { color: var(--info); }
.net-method[data-method="POST"]    { color: var(--success); }
.net-method[data-method="PUT"]     { color: var(--warning); }
.net-method[data-method="PATCH"]   { color: var(--warning); }
.net-method[data-method="DELETE"]  { color: var(--danger); }
.net-pattern {
  font-family: var(--font-mono, monospace);
  color: var(--text);
  font-weight: 500;
  font-size: 12px;
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.net-status {
  font-family: var(--font-mono, monospace);
  font-size: 10px;
  padding: 1px 5px;
  border-radius: 3px;
  background: var(--surface-3);
  color: var(--text-muted);
  font-weight: 600;
}
.net-status[data-tone="ok"]   { background: color-mix(in srgb, var(--success) 20%, transparent); color: var(--success); }
.net-status[data-tone="warn"] { background: color-mix(in srgb, var(--warning) 20%, transparent); color: var(--warning); }
.net-status[data-tone="err"]  { background: color-mix(in srgb, var(--danger)  20%, transparent); color: var(--danger); }

/* Latency chip — color is set inline from `colorForLatency` so it tracks
 * the same bucket as the swatch and the iframe overlay. */
.net-latency {
  font-family: var(--font-mono, monospace);
  font-size: 10px;
  font-weight: 600;
  padding: 1px 5px;
  border-radius: 3px;
  background: color-mix(in srgb, currentColor 12%, transparent);
}

/* Route tag in the network controls — replaces the All/This-route toggle. */
.network-route-tag {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  color: var(--text-muted);
  background: var(--surface-2);
  padding: 2px 8px;
  border-radius: 4px;
}
.network-route-tag code {
  font-family: var(--font-mono, monospace);
  color: var(--text);
}
.net-meta {
  margin-top: 3px;
  gap: 6px;
}
.net-origin {
  color: var(--text-muted);
  font-family: var(--font-mono, monospace);
  font-size: 10px;
}
.net-routes {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  flex: 1;
  justify-content: flex-end;
}
.net-route-chip {
  font-family: var(--font-mono, monospace);
  font-size: 10px;
  padding: 1px 5px;
  border-radius: 3px;
  background: var(--surface-2);
  color: var(--text-muted);
  max-width: 160px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.net-route-more {
  font-size: 10px;
  color: var(--text-muted);
  padding: 1px 3px;
}

.data-empty {
  padding: 32px 16px;
  color: var(--text-muted);
  text-align: center;
  font-size: 12px;
}
.data-empty-hint {
  font-size: 11px;
  margin-top: 8px;
}
.data-empty code {
  background: var(--surface-2);
  padding: 1px 4px;
  border-radius: 3px;
  font-family: var(--font-mono, monospace);
}

.lib-list {
  display: flex;
  flex-direction: column;
}
.lib-item {
  padding: 8px 12px;
  border: none;
  border-bottom: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  gap: 4px;
  background: transparent;
  color: var(--text);
  text-align: left;
  cursor: pointer;
  width: 100%;
  font-size: 12px;
}
.lib-item:hover {
  background: var(--surface-2);
}
.lib-item.selected {
  background: color-mix(in srgb, var(--accent) 15%, transparent);
}
.lib-head {
  display: flex;
  align-items: baseline;
  gap: 8px;
}
.lib-name {
  font-family: var(--font-mono, monospace);
  font-weight: 600;
  font-size: 12px;
}
.lib-version {
  color: var(--text-muted);
  font-size: 11px;
  font-family: var(--font-mono, monospace);
}
.lib-patterns {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.lib-patterns code {
  background: var(--surface-2);
  padding: 1px 5px;
  border-radius: 3px;
  font-family: var(--font-mono, monospace);
  font-size: 10px;
  color: var(--text-muted);
}
.lib-patterns-detail {
  margin-top: 6px;
}

.lib-usages {
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.lib-usages .ds-label {
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-muted);
  font-weight: 600;
}
.lib-usages .ds-hint {
  font-size: 10px;
  color: var(--text-muted);
  font-weight: normal;
  text-transform: none;
  letter-spacing: normal;
  margin-left: 4px;
}
.lib-usages .ds-hint code {
  background: var(--surface-2);
  padding: 1px 4px;
  border-radius: 3px;
  font-size: 10px;
  font-family: var(--font-mono, monospace);
}
.usage-list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.usage-row {
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: 2px 0;
  font-size: 11px;
}
.usage-pattern {
  font-family: var(--font-mono, monospace);
  font-size: 11px;
  background: var(--surface-2);
  padding: 1px 5px;
  border-radius: 3px;
  color: var(--accent);
  flex-shrink: 0;
}
.usage-file {
  font-family: var(--font-mono, monospace);
  color: var(--text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
  flex: 1;
}
</style>
