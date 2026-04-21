<script setup lang="ts">
import { onMounted, ref, watch, nextTick, useTemplateRef } from 'vue'
import { useComponentLibrary, colorForLibrary, type LibraryComponent } from '../composables/useProjectComponents'
import { useWorkspace } from '../composables/useWorkspace'
import type { useIframeManager } from '../composables/useIframeManager'
import Icon from './Icon.vue'
import MfeFilterDropdown from './MfeFilterDropdown.vue'

const props = defineProps<{
  iframe: ReturnType<typeof useIframeManager>
  highlightRects: Array<{ sourceName: string }>
  /** Component name currently emphasized via `dataHighlights.focusedName` —
   *  driven by both list-row hover and iframe element hover. */
  focusedName?: string | null
}>()

const cl = useComponentLibrary(props.iframe)
const ws = useWorkspace()

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
              :title="componentTooltip(lib.name, c)"
              @click="cl.select(lib.name, c.name)"
              @mouseenter="cl.isOnPageInLib(lib.name, c.name) && cl.setFocus(cl.sourceName(lib.name, c.name))"
              @mouseleave="focusedName === cl.sourceName(lib.name, c.name) && cl.setFocus(null)"
            >
              <div class="item-row">
                <span class="item-swatch" :style="{ background: colorForLibrary(lib.name) }" />
                <span class="item-name" :class="{ deprecated: c.deprecated }">{{ c.name }}</span>
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
  cursor: pointer;
  font-size: 12px;
}
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
</style>
