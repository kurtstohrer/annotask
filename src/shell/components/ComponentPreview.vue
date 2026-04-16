<script setup lang="ts">
import { ref, reactive, computed, watch } from 'vue'

interface PreviewProp {
  name: string
  type: string | null
  required: boolean
  default?: unknown
  description?: string | null
}
interface PreviewSlot {
  name: string
  description?: string | null
  scoped?: boolean
}
interface PreviewEvent {
  name: string
  payloadType?: string | null
  description?: string | null
}
interface PreviewComponent {
  name: string
  module?: string | null
  description?: string | null
  category?: string | null
  props: PreviewProp[]
  slots?: PreviewSlot[]
  events?: PreviewEvent[]
}

const props = defineProps<{ component: PreviewComponent }>()
const emit = defineEmits<{
  back: []
  insert: [snippet: string]
}>()

// Local prop/slot editor state — no longer tied to a live iframe, purely drives the
// snippet + JSON/YAML views.
const livePropsState = reactive<Record<string, unknown>>({})
const slotText = ref('')

const copyOk = ref(false)

type PropsViewMode = 'table' | 'json' | 'yaml'
const propsView = ref<PropsViewMode>('table')

// Parse a single-line default-value expression (e.g. `'small'`, `true`, `42`) into a real JS value.
// Falls back to the raw string if parsing fails. Keeps initial values honest to the extracted type.
function parseDefault(raw: unknown, type: string | null): unknown {
  if (raw == null) return undefined
  const s = String(raw).trim()
  if (!s || s === 'undefined' || s === 'null') return undefined
  if (s === 'true') return true
  if (s === 'false') return false
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s)
  // Quoted string
  const m = s.match(/^['"`](.*)['"`]$/)
  if (m) return m[1]
  // For enum types like 'a' | 'b', use the first
  if (type && /'[^']+'/.test(type)) {
    const first = type.match(/'([^']+)'/)
    if (first) return first[1]
  }
  return s
}

function initialPropsFor(comp: PreviewComponent): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const p of comp.props) {
    if (p.default != null) {
      const parsed = parseDefault(p.default, p.type)
      if (parsed !== undefined) out[p.name] = parsed
    }
  }
  return out
}

function inferWidget(p: PreviewProp): 'boolean' | 'number' | 'enum' | 'string' | 'json' {
  const t = (p.type || '').toLowerCase()
  if (t === 'boolean' || t === 'bool') return 'boolean'
  if (t === 'number' || t === 'int' || t === 'float') return 'number'
  if (/^(['"][\w-]+['"]\s*\|\s*)+['"][\w-]+['"]\s*$/.test(p.type || '')) return 'enum'
  if (t === 'string' || t.startsWith('string')) return 'string'
  // Complex types (objects, arrays, functions) — give the user a JSON escape hatch
  return 'json'
}

function enumValues(p: PreviewProp): string[] {
  if (!p.type) return []
  return [...p.type.matchAll(/'([^']+)'/g)].map(m => m[1])
}

function jsonFor(value: unknown): string {
  if (value === undefined) return ''
  try { return JSON.stringify(value) } catch { return '' }
}

function setJsonProp(name: string, raw: string) {
  if (raw.trim() === '') { delete livePropsState[name]; return }
  try { livePropsState[name] = JSON.parse(raw) } catch { /* invalid — leave previous */ }
}

// ── JSON / YAML serialization for the data views ─────────────────

function propsWithValues() {
  return props.component.props.map(p => ({
    name: p.name,
    type: p.type ?? null,
    required: p.required,
    default: p.default ?? null,
    ...(p.description ? { description: p.description } : {}),
    ...(livePropsState[p.name] !== undefined ? { value: livePropsState[p.name] } : {}),
  }))
}

const propsJson = computed(() => JSON.stringify(propsWithValues(), null, 2))
const propsYaml = computed(() => toYaml(propsWithValues()))
const propsJsonHtml = computed(() => highlightJson(propsJson.value))
const propsYamlHtml = computed(() => highlightYaml(propsYaml.value))

/** HTML-escape once up front so the tokenizer regexes can't pick up literal tags from user data. */
function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** Regex-based JSON highlighter. Token order matters: strings first (with optional trailing
 *  colon that flags them as property keys), then literals, then numbers. Punctuation (`{}[],`)
 *  stays untagged so it picks up the surrounding text color. */
function highlightJson(src: string): string {
  const escaped = escapeHtml(src)
  return escaped.replace(
    /("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false|null)\b|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g,
    (m, str?: string, colon?: string, kw?: string, num?: string) => {
      if (str) {
        if (colon) return `<span class="syn-property">${str}</span><span class="syn-operator">${colon}</span>`
        return `<span class="syn-string">${str}</span>`
      }
      if (kw === 'null') return `<span class="syn-null">null</span>`
      if (kw) return `<span class="syn-boolean">${kw}</span>`
      if (num !== undefined) return `<span class="syn-number">${num}</span>`
      return m
    },
  )
}

/** Line-based YAML highlighter tuned to our emitter's output shape. Handles list markers,
 *  key:value pairs, quoted strings, booleans, null, numbers. Bare string values get no span
 *  and fall through to the default text color. */
function highlightYaml(src: string): string {
  return src.split('\n').map(line => {
    const lead = /^\s*/.exec(line)?.[0] ?? ''
    let rest = line.slice(lead.length)
    let out = lead

    if (rest === '-') return out + '<span class="syn-punctuation">-</span>'
    if (rest.startsWith('- ')) {
      out += '<span class="syn-punctuation">-</span> '
      rest = rest.slice(2)
    }

    const kv = /^([\w$-]+)(:)(\s*)(.*)$/.exec(rest)
    if (kv) {
      const [, key, colon, space, val] = kv
      out += `<span class="syn-property">${escapeHtml(key)}</span>`
      out += `<span class="syn-operator">${colon}</span>`
      out += space
      if (val) out += highlightYamlValue(val)
      return out
    }
    return out + highlightYamlValue(rest)
  }).join('\n')
}

function highlightYamlValue(val: string): string {
  const t = val.trim()
  const escaped = escapeHtml(val)
  if (!t) return escaped
  if (/^(["']).*\1$/.test(t)) return `<span class="syn-string">${escaped}</span>`
  if (t === 'true' || t === 'false') return `<span class="syn-boolean">${escaped}</span>`
  if (t === 'null' || t === '~') return `<span class="syn-null">${escaped}</span>`
  if (/^-?\d+(?:\.\d+)?$/.test(t)) return `<span class="syn-number">${escaped}</span>`
  if (t === '{}' || t === '[]') return `<span class="syn-punctuation">${escaped}</span>`
  return escaped
}

// Minimal YAML emitter for this use case: arrays of flat objects whose values are
// primitives or short nested objects. Quotes strings that contain YAML-significant chars.
function toYaml(value: unknown, indent = 0): string {
  const pad = '  '.repeat(indent)
  if (value === null) return 'null'
  if (typeof value === 'boolean' || typeof value === 'number') return String(value)
  if (typeof value === 'string') return yamlString(value)
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]'
    return value.map(item => {
      if (item !== null && typeof item === 'object' && !Array.isArray(item)) {
        const entries = Object.entries(item as Record<string, unknown>)
        if (entries.length === 0) return `${pad}- {}`
        const [firstKey, firstVal] = entries[0]
        const rest = entries.slice(1)
        const firstLine = `${pad}- ${firstKey}: ${formatInlineOrBlock(firstVal, indent + 1)}`
        const restLines = rest.map(([k, v]) => `${pad}  ${k}: ${formatInlineOrBlock(v, indent + 1)}`)
        return [firstLine, ...restLines].join('\n')
      }
      return `${pad}- ${toYaml(item, indent)}`
    }).join('\n')
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
    if (entries.length === 0) return '{}'
    return entries.map(([k, v]) => `${pad}${k}: ${formatInlineOrBlock(v, indent + 1)}`).join('\n')
  }
  return String(value)
}

function formatInlineOrBlock(v: unknown, indent: number): string {
  if (v !== null && typeof v === 'object' && ((Array.isArray(v) && v.length) || Object.keys(v).length)) {
    return '\n' + toYaml(v, indent)
  }
  return toYaml(v, 0)
}

function yamlString(s: string): string {
  // Quote if it looks risky (empty, leading space, YAML keywords, contains colons/hashes/etc.)
  if (s === '' || /^[\s]|[\s]$|[:#&*?!|><'"%@`{},\[\]]/.test(s) || /^(true|false|null|yes|no|~|\d)/i.test(s)) {
    return JSON.stringify(s) // double-quoted strings are valid YAML
  }
  return s
}

async function copyData(kind: 'json' | 'yaml') {
  const text = kind === 'json' ? propsJson.value : propsYaml.value
  try {
    await navigator.clipboard.writeText(text)
    copyOk.value = true
    setTimeout(() => { copyOk.value = false }, 1500)
  } catch { /* ignore */ }
}

watch(() => props.component, (c) => {
  if (!c) return
  for (const key of Object.keys(livePropsState)) delete livePropsState[key]
  Object.assign(livePropsState, initialPropsFor(c))
  slotText.value = ''
}, { immediate: true })

// ── Code snippet generation ──────────────────────────────────────

function formatAttrValue(value: unknown): string {
  if (typeof value === 'string') return `"${value.replace(/"/g, '&quot;')}"`
  if (typeof value === 'boolean' || typeof value === 'number') return `{${JSON.stringify(value)}}`
  return `{${JSON.stringify(value)}}`
}

const snippet = computed(() => {
  const name = props.component.name
  const entries = Object.entries(livePropsState).filter(([, v]) => v !== undefined)
  const attrs = entries.map(([k, v]) => {
    // Vue-style: boolean true → bare attr; string → ="..."; other → :k="..."
    if (typeof v === 'boolean' && v) return k
    if (typeof v === 'string') return `${k}="${v.replace(/"/g, '&quot;')}"`
    return `:${k}="${String(JSON.stringify(v)).replace(/"/g, '&quot;')}"`
  })
  const slotBody = slotText.value.trim()
  if (attrs.length === 0) {
    return slotBody
      ? `<${name}>${slotBody}</${name}>`
      : `<${name} />`
  }
  if (attrs.length <= 2 && !slotBody) return `<${name} ${attrs.join(' ')} />`
  const attrBlock = attrs.join('\n  ')
  return slotBody
    ? `<${name}\n  ${attrBlock}\n>${slotBody}</${name}>`
    : `<${name}\n  ${attrBlock}\n/>`
})

async function copySnippet() {
  try {
    await navigator.clipboard.writeText(snippet.value)
    copyOk.value = true
    setTimeout(() => { copyOk.value = false }, 1500)
  } catch { /* ignore */ }
}

function insertSnippet() {
  emit('insert', snippet.value)
}
</script>

<template>
  <div class="cp-root">
    <button class="cp-back" @click="emit('back')" title="Back to component list">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="15 18 9 12 15 6"/></svg>
      Back
    </button>

    <header class="cp-header">
      <div class="cp-title">
        <h3>{{ component.name }}</h3>
        <span v-if="component.category" class="cp-cat">{{ component.category }}</span>
      </div>
      <code v-if="component.module" class="cp-module">{{ component.module }}</code>
      <p v-if="component.description" class="cp-desc">{{ component.description }}</p>
    </header>

    <section v-if="component.props.length" class="cp-section">
      <div class="cp-props-header">
        <h4 class="cp-section-title">Props <span class="cp-count">{{ component.props.length }}</span></h4>
        <div class="cp-view-toggle" role="tablist" aria-label="Props view mode">
          <button
            :class="['cp-toggle-btn', { active: propsView === 'table' }]"
            role="tab" :aria-selected="propsView === 'table'"
            @click="propsView = 'table'"
          >Table</button>
          <button
            :class="['cp-toggle-btn', { active: propsView === 'json' }]"
            role="tab" :aria-selected="propsView === 'json'"
            @click="propsView = 'json'"
          >JSON</button>
          <button
            :class="['cp-toggle-btn', { active: propsView === 'yaml' }]"
            role="tab" :aria-selected="propsView === 'yaml'"
            @click="propsView = 'yaml'"
          >YAML</button>
        </div>
      </div>

      <table v-if="propsView === 'table'" class="cp-props-table">
        <thead>
          <tr>
            <th scope="col">Name</th>
            <th scope="col">Type</th>
            <th scope="col" class="th-center">Req</th>
            <th scope="col">Default</th>
            <th scope="col">Value</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="p in component.props" :key="p.name">
            <td :title="p.description ?? ''">
              <code class="cp-prop-name">{{ p.name }}</code>
            </td>
            <td class="cp-td-type" :title="p.type ?? ''">
              <code v-if="p.type">{{ p.type }}</code>
            </td>
            <td class="th-center">
              <span v-if="p.required" class="cp-badge-req">req</span>
            </td>
            <td class="cp-td-default">
              <code v-if="p.default != null">{{ p.default }}</code>
            </td>
            <td class="cp-td-input">
              <template v-if="inferWidget(p) === 'boolean'">
                <input
                  type="checkbox"
                  class="cp-input-check"
                  :checked="livePropsState[p.name] === true"
                  @change="(e) => livePropsState[p.name] = (e.target as HTMLInputElement).checked"
                />
              </template>
              <template v-else-if="inferWidget(p) === 'number'">
                <input
                  type="number"
                  class="cp-input"
                  :value="livePropsState[p.name] as number ?? ''"
                  @input="(e) => {
                    const v = (e.target as HTMLInputElement).value
                    livePropsState[p.name] = v === '' ? undefined : Number(v)
                  }"
                />
              </template>
              <template v-else-if="inferWidget(p) === 'enum'">
                <select
                  class="cp-input"
                  :value="livePropsState[p.name] as string ?? ''"
                  @change="(e) => {
                    const v = (e.target as HTMLSelectElement).value
                    livePropsState[p.name] = v === '' ? undefined : v
                  }"
                >
                  <option value="">—</option>
                  <option v-for="v in enumValues(p)" :key="v" :value="v">{{ v }}</option>
                </select>
              </template>
              <template v-else-if="inferWidget(p) === 'string'">
                <input
                  type="text"
                  class="cp-input"
                  :value="livePropsState[p.name] as string ?? ''"
                  @input="(e) => {
                    const v = (e.target as HTMLInputElement).value
                    livePropsState[p.name] = v === '' ? undefined : v
                  }"
                />
              </template>
              <template v-else>
                <input
                  type="text"
                  class="cp-input"
                  placeholder="JSON"
                  :value="jsonFor(livePropsState[p.name])"
                  @change="(e) => setJsonProp(p.name, (e.target as HTMLInputElement).value)"
                />
              </template>
            </td>
          </tr>
        </tbody>
      </table>

      <div v-else class="cp-data-view">
        <button class="cp-btn cp-copy-btn" @click="copyData(propsView)">{{ copyOk ? 'Copied' : 'Copy' }}</button>
        <pre class="cp-code cp-code-syntax"><code v-html="propsView === 'json' ? propsJsonHtml : propsYamlHtml" /></pre>
      </div>
    </section>

    <section v-if="component.slots && component.slots.length" class="cp-section">
      <h4 class="cp-section-title">Slots <span class="cp-count">{{ component.slots.length }}</span></h4>
      <ul class="cp-list">
        <li v-for="s in component.slots" :key="s.name">
          <code>{{ s.name }}</code>
          <span v-if="s.scoped" class="cp-badge-scoped">scoped</span>
          <span v-if="s.description" class="cp-list-desc">· {{ s.description }}</span>
        </li>
      </ul>
      <label class="cp-slot-editor">
        <span>Default slot content</span>
        <textarea
          v-model="slotText"
          rows="2"
          placeholder="Text, HTML, or leave empty…"
        />
      </label>
    </section>

    <section v-if="component.events && component.events.length" class="cp-section">
      <h4 class="cp-section-title">Events <span class="cp-count">{{ component.events.length }}</span></h4>
      <ul class="cp-list">
        <li v-for="e in component.events" :key="e.name">
          <code>{{ e.name }}</code>
          <span v-if="e.payloadType" class="cp-list-type">{{ e.payloadType }}</span>
          <span v-if="e.description" class="cp-list-desc">· {{ e.description }}</span>
        </li>
      </ul>
    </section>

    <section class="cp-section cp-snippet">
      <div class="cp-snippet-header">
        <h4 class="cp-section-title">Snippet</h4>
        <div class="cp-snippet-actions">
          <button class="cp-btn" @click="copySnippet">{{ copyOk ? 'Copied' : 'Copy' }}</button>
          <button class="cp-btn cp-btn-primary" @click="insertSnippet">Insert as task</button>
        </div>
      </div>
      <pre class="cp-code"><code>{{ snippet }}</code></pre>
    </section>
  </div>
</template>

<style scoped>
.cp-root { display: flex; flex-direction: column; gap: 12px; }

.cp-back {
  align-self: flex-start;
  display: flex; align-items: center; gap: 4px;
  background: none; border: none; color: var(--accent); cursor: pointer;
  font-size: 11px; font-weight: 600; padding: 2px 0;
}
.cp-back:hover { opacity: 0.8; }

.cp-header { display: flex; flex-direction: column; gap: 4px; }
.cp-title { display: flex; align-items: baseline; gap: 8px; }
.cp-title h3 { margin: 0; font-size: 16px; font-weight: 700; color: var(--text); }
.cp-cat {
  font-size: 9px; letter-spacing: 0.05em; text-transform: uppercase;
  padding: 1px 6px; border-radius: 10px;
  background: color-mix(in srgb, var(--accent) 14%, transparent);
  color: var(--accent); font-weight: 700;
}
.cp-module { font-size: 10px; color: var(--text-muted); }
.cp-desc { margin: 0; font-size: 11px; color: var(--text-muted); line-height: 1.4; }


.cp-section { display: flex; flex-direction: column; gap: 6px; }
.cp-section-title {
  margin: 0; display: flex; align-items: baseline; gap: 6px;
  font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em;
  color: var(--text-muted);
}
.cp-count { font-size: 10px; color: var(--text-muted); opacity: 0.8; font-weight: 500; }

.cp-props-header {
  display: flex; align-items: center; justify-content: space-between; gap: 8px;
}
.cp-view-toggle {
  display: inline-flex; gap: 1px; padding: 2px; border-radius: 6px;
  background: var(--surface-2); border: 1px solid var(--border);
}
.cp-toggle-btn {
  padding: 3px 10px; font-size: 10px; font-weight: 600;
  background: transparent; color: var(--text-muted); border: 0; border-radius: 4px;
  cursor: pointer; letter-spacing: 0.03em;
}
.cp-toggle-btn:hover { color: var(--text); }
.cp-toggle-btn.active {
  background: var(--accent); color: var(--text-on-accent, white);
}

.cp-props-table {
  width: 100%; border-collapse: collapse; font-size: 11px;
  background: var(--surface-2); border-radius: 6px; overflow: hidden;
}
.cp-props-table thead th {
  text-align: left; padding: 6px 8px;
  font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em;
  color: var(--text-muted); background: var(--surface-3, var(--surface-2));
  border-bottom: 1px solid var(--border);
}
.cp-props-table th.th-center, .cp-props-table td.th-center { text-align: center; }
.cp-props-table tbody td {
  padding: 4px 8px; border-bottom: 1px solid var(--border); vertical-align: middle;
}
.cp-props-table tbody tr:last-child td { border-bottom: 0; }
.cp-props-table tbody tr:hover { background: color-mix(in srgb, var(--accent) 4%, transparent); }
.cp-props-table code { font-size: 10px; font-family: ui-monospace, Menlo, monospace; }
.cp-props-table .cp-prop-name { color: #60a5fa; font-weight: 600; }
.cp-td-type code {
  color: var(--text-muted);
  display: inline-block; max-width: 180px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; vertical-align: middle;
}
.cp-td-default code { color: var(--text-muted); opacity: 0.85; }
.cp-td-input { min-width: 120px; }
.cp-td-input .cp-input, .cp-td-input .cp-input-check { margin: 0; }

.cp-data-view {
  position: relative;
  padding: 0; border-radius: 6px;
}
.cp-copy-btn {
  position: absolute; top: 6px; right: 6px; z-index: 1;
  padding: 3px 8px; font-size: 10px;
}

/* Syntax colors — use the shell's theme variables so all 18 built-in themes apply. */
.cp-code-syntax :deep(.syn-property)    { color: var(--syntax-property); }
.cp-code-syntax :deep(.syn-string)      { color: var(--syntax-string); }
.cp-code-syntax :deep(.syn-number)      { color: var(--syntax-number); }
.cp-code-syntax :deep(.syn-boolean)     { color: var(--syntax-boolean); font-weight: 600; }
.cp-code-syntax :deep(.syn-null)        { color: var(--syntax-null); font-style: italic; }
.cp-code-syntax :deep(.syn-operator)    { color: var(--syntax-operator); }
.cp-code-syntax :deep(.syn-punctuation) { color: var(--syntax-punctuation); }

.cp-prop {
  display: grid; grid-template-columns: 1fr 140px; gap: 6px 8px; align-items: center;
  padding: 6px 8px; border-radius: 6px; background: var(--surface-2);
}
.cp-prop-label { display: flex; align-items: baseline; gap: 6px; min-width: 0; }
.cp-prop-name { font-size: 11px; color: #60a5fa; font-weight: 600; }
.cp-badge-req {
  font-size: 8px; color: #f59e0b; font-weight: 700; text-transform: uppercase;
}
.cp-prop-type {
  font-size: 9px; color: var(--text-muted);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 100%;
}
.cp-prop-desc {
  grid-column: 1 / -1; margin: 0; font-size: 10px; color: var(--text-muted); line-height: 1.3;
}

.cp-input {
  grid-column: 2 / 3;
  padding: 4px 6px; font-size: 11px;
  background: var(--surface); color: var(--text);
  border: 1px solid var(--border); border-radius: 4px; outline: none;
  min-width: 0; width: 100%; box-sizing: border-box;
}
.cp-input:focus { border-color: var(--accent); }
.cp-input-check { grid-column: 2 / 3; justify-self: end; }

.cp-list {
  margin: 0; padding: 0; list-style: none;
  display: flex; flex-direction: column; gap: 2px;
}
.cp-list li {
  padding: 4px 8px; border-radius: 4px; background: var(--surface-2);
  font-size: 11px; display: flex; align-items: baseline; gap: 6px; flex-wrap: wrap;
}
.cp-list code { font-size: 11px; color: #60a5fa; font-weight: 600; }
.cp-list-type, .cp-list-desc { font-size: 10px; color: var(--text-muted); }
.cp-badge-scoped {
  font-size: 8px; color: var(--purple, #a855f7); font-weight: 700; text-transform: uppercase;
}

.cp-slot-editor { display: flex; flex-direction: column; gap: 4px; }
.cp-slot-editor span {
  font-size: 10px; font-weight: 600; color: var(--text-muted);
}
.cp-slot-editor textarea {
  padding: 6px 8px; font-size: 11px;
  background: var(--surface); color: var(--text);
  border: 1px solid var(--border); border-radius: 4px; outline: none;
  font-family: ui-monospace, Menlo, monospace; resize: vertical;
}
.cp-slot-editor textarea:focus { border-color: var(--accent); }

.cp-snippet-header {
  display: flex; align-items: center; justify-content: space-between; gap: 8px;
}
.cp-snippet-actions { display: flex; gap: 6px; }
.cp-btn {
  padding: 4px 10px; font-size: 11px; font-weight: 600;
  background: var(--surface); color: var(--text);
  border: 1px solid var(--border); border-radius: 4px; cursor: pointer;
}
.cp-btn:hover { border-color: var(--accent); color: var(--accent); }
.cp-btn-primary {
  background: var(--accent); color: var(--text-on-accent, white); border-color: var(--accent);
}
.cp-btn-primary:hover { opacity: 0.9; color: var(--text-on-accent, white); }

.cp-code {
  margin: 0; padding: 8px 10px; border-radius: 6px;
  background: var(--surface-3, var(--surface-2));
  font-family: ui-monospace, Menlo, monospace; font-size: 10px;
  color: var(--text); line-height: 1.4;
  overflow-x: auto; white-space: pre;
  border: 1px solid var(--border);
}
</style>
