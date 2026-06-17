<script setup lang="ts">
/**
 * Data-source binding picker — search the REAL scanner catalog, pick a
 * source, drill into its resolved shape, and emit a WireframeDataBinding.
 *
 * Honesty rules (the whole point of this component):
 *   - Entries come from the static catalog only; runtime-discovered endpoints
 *     have no code identity and contribute no shapes this round.
 *   - The shape tree renders ONLY when a real API schema answered
 *     ('api-schema'). Regex-inferred hints ('source-details') show verbatim
 *     with their confidence; nothing is expanded into a fabricated tree.
 *   - With no shape at all ('none'), the path/fields inputs are visibly blind.
 *
 * Self-contained fetches — deliberately NOT useDataSources(), whose
 * module-level filter/selection state is shared with the Data view.
 */
import { computed, onMounted, ref } from 'vue'
import Icon from './Icon.vue'
import { flattenShape, fieldCandidates, sampleRows, buildBinding, type ShapeRow } from '../utils/bindingShape'
import type { DataSourceShape, DataShapeNode, ProjectDataEntry } from '../../schema'
import type { WireframeDataBinding } from '../../shared/wireframe-types'

const props = defineProps<{
  /** Existing binding when reconfiguring — shown as the current chip. */
  initial?: WireframeDataBinding | null
}>()

const emit = defineEmits<{
  select: [binding: WireframeDataBinding]
  clear: []
  cancel: []
}>()

const entries = ref<ProjectDataEntry[]>([])
const loading = ref(true)
const loadError = ref<string | null>(null)
const filter = ref('')

const selected = ref<ProjectDataEntry | null>(null)
const shape = ref<DataSourceShape | null>(null)
const shapeLoading = ref(false)

// Drill-down state. pickedPath is null until the user explicitly picks a row
// — an object ROOT's path is the empty string, so '' can't mean "nothing
// picked" without falsely highlighting that row.
const expanded = ref<Set<string>>(new Set())
const pickedPath = ref<string | null>(null)
const pickedNode = ref<DataShapeNode | null>(null)
const pickedFields = ref<Set<string>>(new Set())
// Free-text fallbacks for the source-details / none rungs.
const freePath = ref('')
const freeFields = ref('')

onMounted(async () => {
  try {
    const res = await fetch('/__annotask/api/data-sources')
    const body = await res.json() as { project_entries?: ProjectDataEntry[] }
    // Static entries only — runtime promotions have file:'' and no shapes.
    entries.value = (body.project_entries ?? []).filter(e => e.discovered_by !== 'runtime' && e.file)
  } catch {
    loadError.value = 'Could not load the data-source catalog'
  } finally {
    loading.value = false
  }
})

const filtered = computed(() => {
  const q = filter.value.trim().toLowerCase()
  if (!q) return entries.value
  return entries.value.filter(e =>
    e.name.toLowerCase().includes(q)
    || e.file.toLowerCase().includes(q)
    || (e.endpoint ?? '').toLowerCase().includes(q))
})

// Monotonic token: a cold first resolve (full scan) can take seconds while a
// later cache-warm pick returns instantly — a stale response must never land
// on a newer selection.
let pickSeq = 0

async function pickEntry(entry: ProjectDataEntry): Promise<void> {
  const seq = ++pickSeq
  selected.value = entry
  shape.value = null
  shapeLoading.value = true
  expanded.value = new Set()
  pickedPath.value = null
  pickedNode.value = null
  pickedFields.value = new Set()
  freePath.value = ''
  freeFields.value = ''
  try {
    const params = new URLSearchParams({ name: entry.name, kind: entry.kind })
    if (entry.file) params.set('file', entry.file)
    const res = await fetch(`/__annotask/api/data-source-shape?${params}`)
    const body = await res.json() as DataSourceShape | { error: string }
    if (seq !== pickSeq) return // a newer pick raced ahead — drop this response
    // Ambiguous/not-found degrade to the blind view — kind+file disambiguate
    // in practice, and honesty beats a guessed tree.
    shape.value = 'error' in body
      ? { name: entry.name, kind: entry.kind, file: entry.file, shape_source: 'none' }
      : body
  } catch {
    if (seq !== pickSeq) return
    shape.value = { name: entry.name, kind: entry.kind, file: entry.file, shape_source: 'none' }
  } finally {
    if (seq === pickSeq) shapeLoading.value = false
  }
}

const rows = computed<ShapeRow[]>(() =>
  shape.value?.shape ? flattenShape(shape.value.shape, expanded.value) : [])

function toggleExpand(row: ShapeRow): void {
  const next = new Set(expanded.value)
  if (next.has(row.path)) next.delete(row.path)
  else next.add(row.path)
  expanded.value = next
}

function pickRow(row: ShapeRow): void {
  if (!row.selectable) return
  pickedPath.value = row.path
  pickedNode.value = row.node
  pickedFields.value = new Set()
  if (!expanded.value.has(row.path) && row.expandable) toggleExpand(row)
}

const candidates = computed(() => (pickedNode.value ? fieldCandidates(pickedNode.value) : []))

function toggleField(key: string): void {
  const next = new Set(pickedFields.value)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  pickedFields.value = next
}

const shapeSourceLabel = computed(() => {
  const s = shape.value
  if (!s) return null
  if (s.shape_source === 'api-schema') {
    const pct = s.match_confidence != null ? ` · match ${Math.round(s.match_confidence * 100)}%` : ''
    return { cls: 'api-schema', text: `api schema${s.schema_ref ? ` · ${s.schema_ref}` : ''}${pct}` }
  }
  if (s.shape_source === 'source-details') {
    return { cls: 'inferred', text: `inferred (regex, ${s.details_confidence ?? 'low'})` }
  }
  return { cls: 'none', text: 'no shape available — entered blind' }
})

const canBind = computed(() => !!selected.value && !!shape.value && !shapeLoading.value)

function confirm(): void {
  const entry = selected.value
  const s = shape.value
  if (!entry || !s) return
  const usingTree = s.shape_source === 'api-schema'
  const path = usingTree ? (pickedPath.value ?? '') : freePath.value
  const fields = usingTree
    ? [...pickedFields.value]
    : freeFields.value.split(',').map(f => f.trim()).filter(Boolean)
  // Pull REAL contract example rows for the preview (api-schema only); default a
  // sketch repeat for a list path. propMap is mapped later in the popover.
  const sample = usingTree && pickedNode.value ? sampleRows(pickedNode.value, fields, 5) : []
  const isList = path.includes('[]')
  emit('select', buildBinding(entry, {
    path,
    fields,
    shape_source: s.shape_source,
    ...(sample.length > 0 ? { sample } : {}),
    ...(isList ? { repeat: 3 } : {}),
  }))
}
</script>

<template>
  <div class="binding-picker" data-testid="binding-picker" @pointerdown.stop @click.stop>
    <div class="bp-head">
      <span class="bp-title">Bind a data source</span>
      <span v-if="props.initial" class="bp-current">currently: {{ props.initial.name }}{{ props.initial.path ? ` · ${props.initial.path}` : '' }}</span>
      <button class="bp-icon-btn" title="Close" data-testid="binding-cancel" @click="emit('cancel')">
        <Icon name="x" :size="14" />
      </button>
    </div>

    <div class="bp-body">
      <div class="bp-list">
        <input
          v-model="filter"
          class="bp-filter"
          type="text"
          placeholder="Search sources by name, file, endpoint…"
          data-testid="binding-filter"
        >
        <div v-if="loading" class="bp-empty">Loading catalog…</div>
        <div v-else-if="loadError" class="bp-empty">{{ loadError }}</div>
        <div v-else-if="filtered.length === 0" class="bp-empty">No data sources found</div>
        <button
          v-for="e in filtered"
          :key="`${e.name}:${e.file}`"
          class="bp-row"
          :class="{ active: selected?.name === e.name && selected?.file === e.file }"
          :data-testid="`binding-row-${e.name}`"
          @click="pickEntry(e)"
        >
          <span class="bp-kind" :data-kind="e.kind">{{ e.kind }}</span>
          <span class="bp-name">{{ e.display_name ?? e.name }}</span>
          <span v-if="e.endpoint" class="bp-endpoint">{{ e.endpoint }}</span>
        </button>
      </div>

      <div class="bp-detail">
        <div v-if="!selected" class="bp-empty">Pick a source on the left</div>
        <div v-else-if="shapeLoading" class="bp-empty">Resolving shape…</div>
        <template v-else-if="shape">
          <div class="bp-meta">
            <span class="bp-kind" :data-kind="shape.kind">{{ shape.kind }}</span>
            <code class="bp-module">{{ shape.file }}</code>
            <span v-if="shapeSourceLabel" class="bp-shape-tag" :class="shapeSourceLabel.cls">{{ shapeSourceLabel.text }}</span>
          </div>

          <!-- Rung 1: real contract — walkable tree. -->
          <template v-if="shape.shape_source === 'api-schema' && shape.shape">
            <div class="bp-tree" data-testid="binding-shape-tree">
              <div
                v-for="row in rows"
                :key="row.path || '(root)'"
                class="bp-tree-row"
                :class="{ picked: pickedPath === row.path, selectable: row.selectable }"
                :style="{ paddingLeft: `${8 + row.depth * 16}px` }"
                @click="pickRow(row)"
              >
                <button
                  v-if="row.expandable"
                  class="bp-twisty"
                  @click.stop="toggleExpand(row)"
                >{{ expanded.has(row.path) ? '▾' : '▸' }}</button>
                <span v-else class="bp-twisty-pad" />
                <span class="bp-key">{{ row.key }}</span>
                <span class="bp-type">
                  {{ row.node.kind === 'scalar' ? row.node.scalar
                    : row.node.kind === 'array' ? 'array'
                    : row.node.kind === 'ref' ? `→ ${row.node.ref}`
                    : row.node.kind }}
                </span>
              </div>
            </div>
            <div v-if="pickedNode" class="bp-picked">
              <span class="bp-picked-path">path: <code>{{ pickedPath || '(whole response)' }}</code></span>
              <div v-if="candidates.length" class="bp-fields">
                <span class="bp-fields-label">show fields:</span>
                <label v-for="key in candidates" :key="key" class="bp-field">
                  <input
                    type="checkbox"
                    :checked="pickedFields.has(key)"
                    :data-testid="`binding-field-${key}`"
                    @change="toggleField(key)"
                  >
                  {{ key }}
                </label>
              </div>
            </div>
          </template>

          <!-- Rung 2: regex hints, verbatim. Rung 3: nothing. Both fall back to free text. -->
          <template v-else>
            <div v-if="shape.shape_source === 'source-details'" class="bp-hints">
              <div v-if="shape.signature" class="bp-hint"><span>signature</span><code>{{ shape.signature }}</code></div>
              <div v-if="shape.return_type" class="bp-hint"><span>return type</span><code>{{ shape.return_type }}</code></div>
              <div v-if="shape.referenced_types?.length" class="bp-hint"><span>types</span><code>{{ shape.referenced_types.join(', ') }}</code></div>
            </div>
            <div class="bp-free">
              <label class="bp-free-row">
                <span>Path <em>(e.g. planets[] or data.user)</em></span>
                <input v-model="freePath" type="text" data-testid="binding-path-input" placeholder="optional">
              </label>
              <label class="bp-free-row">
                <span>Fields <em>(comma-separated)</em></span>
                <input v-model="freeFields" type="text" data-testid="binding-fields-input" placeholder="e.g. name, type">
              </label>
            </div>
          </template>
        </template>
      </div>
    </div>

    <div class="bp-foot">
      <button v-if="props.initial" class="bp-btn danger" data-testid="binding-clear" @click="emit('clear')">Clear binding</button>
      <span class="bp-spacer" />
      <button class="bp-btn" @click="emit('cancel')">Cancel</button>
      <button class="bp-btn primary" :disabled="!canBind" data-testid="binding-confirm" @click="confirm">Bind</button>
    </div>
  </div>
</template>

<style scoped>
.binding-picker {
  display: flex;
  flex-direction: column;
  width: min(640px, 92vw);
  max-height: min(480px, 80vh);
  background: var(--surface-elevated);
  border: 1px solid var(--border-strong);
  border-radius: 8px;
  box-shadow: 0 12px 32px var(--shadow);
  color: var(--text);
  font-size: 12px;
}
.bp-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--border);
}
.bp-title { font-weight: 600; }
.bp-current { color: var(--text-muted); font-size: 11px; }
.bp-icon-btn {
  margin-left: auto;
  background: none;
  border: none;
  color: var(--text-muted);
  cursor: pointer;
  padding: 2px;
}
.bp-icon-btn:hover { color: var(--text); }
.bp-body {
  display: grid;
  grid-template-columns: 240px 1fr;
  min-height: 0;
  flex: 1;
}
.bp-list {
  display: flex;
  flex-direction: column;
  border-right: 1px solid var(--border);
  overflow-y: auto;
}
.bp-filter {
  margin: 8px;
  padding: 5px 8px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 4px;
  color: var(--text);
  font-size: 12px;
}
.bp-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  background: none;
  border: none;
  color: var(--text);
  cursor: pointer;
  text-align: left;
  font-size: 12px;
}
.bp-row:hover { background: var(--surface-2); }
.bp-row.active { background: color-mix(in srgb, var(--accent) 18%, transparent); }
.bp-kind {
  flex-shrink: 0;
  padding: 1px 5px;
  border-radius: 3px;
  font-size: 10px;
  background: color-mix(in srgb, var(--info) 20%, transparent);
  color: var(--info);
}
.bp-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.bp-endpoint {
  margin-left: auto;
  color: var(--text-muted);
  font-size: 10px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 40%;
}
.bp-detail {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px;
  overflow-y: auto;
}
.bp-empty { color: var(--text-muted); padding: 16px; text-align: center; }
.bp-meta { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.bp-module { color: var(--text-muted); font-size: 11px; }
.bp-shape-tag {
  padding: 1px 6px;
  border-radius: 3px;
  font-size: 10px;
}
.bp-shape-tag.api-schema { background: color-mix(in srgb, var(--success) 18%, transparent); color: var(--success); }
.bp-shape-tag.inferred { background: color-mix(in srgb, var(--warning) 18%, transparent); color: var(--warning); }
.bp-shape-tag.none { background: color-mix(in srgb, var(--text-muted) 18%, transparent); color: var(--text-muted); }
.bp-tree {
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--surface);
  font-family: ui-monospace, monospace;
  font-size: 11px;
  overflow-y: auto;
}
.bp-tree-row {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 3px 8px;
}
.bp-tree-row.selectable { cursor: pointer; }
.bp-tree-row.selectable:hover { background: var(--surface-2); }
.bp-tree-row.picked { background: color-mix(in srgb, var(--accent) 20%, transparent); }
.bp-twisty {
  background: none;
  border: none;
  color: var(--text-muted);
  cursor: pointer;
  width: 14px;
  padding: 0;
  font-size: 10px;
}
.bp-twisty-pad { width: 14px; }
.bp-key { color: var(--syntax-property); }
.bp-type { color: var(--text-muted); margin-left: 6px; }
.bp-picked { display: flex; flex-direction: column; gap: 6px; }
.bp-picked-path code { color: var(--accent); }
.bp-fields { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.bp-fields-label { color: var(--text-muted); }
.bp-field { display: flex; align-items: center; gap: 4px; cursor: pointer; }
.bp-hints { display: flex; flex-direction: column; gap: 4px; }
.bp-hint { display: flex; gap: 8px; align-items: baseline; }
.bp-hint span { color: var(--text-muted); font-size: 10px; min-width: 72px; }
.bp-hint code { font-size: 11px; word-break: break-all; }
.bp-free { display: flex; flex-direction: column; gap: 8px; }
.bp-free-row { display: flex; flex-direction: column; gap: 3px; }
.bp-free-row span { color: var(--text-muted); font-size: 11px; }
.bp-free-row em { font-style: normal; opacity: 0.7; }
.bp-free-row input {
  padding: 5px 8px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 4px;
  color: var(--text);
  font-size: 12px;
}
.bp-foot {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  border-top: 1px solid var(--border);
}
.bp-spacer { flex: 1; }
.bp-btn {
  padding: 5px 12px;
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: 4px;
  color: var(--text);
  cursor: pointer;
  font-size: 12px;
}
.bp-btn:hover { background: var(--surface-3); }
.bp-btn.primary { background: var(--accent); border-color: var(--accent); color: var(--text-on-accent); }
.bp-btn.primary:hover { background: var(--accent-hover); }
.bp-btn.primary:disabled { opacity: 0.5; cursor: default; }
.bp-btn.danger { color: var(--danger); border-color: color-mix(in srgb, var(--danger) 40%, transparent); background: none; }
</style>
