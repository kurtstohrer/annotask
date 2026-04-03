<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'

interface LibraryProp {
  name: string
  type: string | null
  required: boolean
  default?: unknown
  description?: string | null
}

interface LibraryComponent {
  name: string
  module?: string
  props: LibraryProp[]
}

interface LibraryCatalog {
  name: string
  version: string
  components: LibraryComponent[]
}

const libraries = ref<LibraryCatalog[]>([])
const usedComponents = ref<Set<string>>(new Set())
const loading = ref(false)
const searchQuery = ref('')
const selectedComponent = ref<LibraryComponent | null>(null)
const showUsedOnly = ref(false)

const filteredLibraries = computed(() => {
  const q = searchQuery.value.toLowerCase().trim()
  return libraries.value
    .map(lib => {
      let components = lib.components
      if (q) components = components.filter(c => c.name.toLowerCase().includes(q) || c.module?.toLowerCase().includes(q))
      if (showUsedOnly.value) components = components.filter(c => usedComponents.value.has(c.name))
      return { ...lib, components }
    })
    .filter(lib => lib.components.length > 0)
})

const totalComponents = computed(() =>
  libraries.value.reduce((sum, lib) => sum + lib.components.length, 0)
)

const totalUsed = computed(() => {
  let count = 0
  for (const lib of libraries.value) {
    for (const c of lib.components) {
      if (usedComponents.value.has(c.name)) count++
    }
  }
  return count
})

async function refresh() {
  loading.value = true
  try {
    const [compRes, specRes] = await Promise.all([
      fetch('/__annotask/api/components'),
      fetch('/__annotask/api/design-spec'),
    ])
    if (compRes.ok) {
      const data = await compRes.json()
      libraries.value = data.libraries || []
    }
    if (specRes.ok) {
      const spec = await specRes.json()
      usedComponents.value = new Set(spec?.components?.used || [])
    }
  } catch { /* server may not be running */ }
  finally { loading.value = false }
}

onMounted(refresh)
</script>

<template>
  <div class="libraries-page">
    <div class="libraries-body">
      <!-- List panel -->
      <div class="list-panel">
        <div class="list-toolbar">
          <div class="search-wrap">
            <svg class="search-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            <input
              v-model="searchQuery"
              type="text"
              class="search-input"
              placeholder="Search components..."
            />
          </div>
          <button v-if="totalUsed > 0" :class="['filter-btn', { active: showUsedOnly }]" @click="showUsedOnly = !showUsedOnly" title="Show only components used in your project">
            Used <span class="filter-count">{{ totalUsed }}</span>
          </button>
          <button class="refresh-btn" :disabled="loading" @click="refresh" title="Rescan libraries">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" :class="{ spinning: loading }">
              <polyline points="23 4 23 10 17 10" /><polyline points="1 20 1 14 7 14" />
              <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
            </svg>
          </button>
        </div>

        <div v-if="loading && totalComponents === 0" class="empty-state">
          <div class="empty-spinner"></div>
          <span>Scanning libraries...</span>
        </div>
        <div v-else-if="totalComponents === 0" class="empty-state">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>
          <span>No component libraries found</span>
          <span class="empty-hint">Install a component library to see it here.</span>
        </div>

        <div v-else class="lib-list">
          <template v-for="lib in filteredLibraries" :key="lib.name">
            <div class="lib-group-header">
              <span class="lib-group-name">{{ lib.name }}</span>
              <span class="lib-group-version">v{{ lib.version }}</span>
              <span class="lib-group-count">{{ lib.components.length }}</span>
            </div>
            <button
              v-for="comp in lib.components"
              :key="comp.name"
              :class="['comp-item', { selected: selectedComponent?.name === comp.name }]"
              @click="selectedComponent = comp"
            >
              <span class="comp-name">{{ comp.name }}</span>
              <span v-if="usedComponents.has(comp.name)" class="used-badge" title="Used in your project">used</span>
              <span class="comp-prop-count" :title="comp.props.length + ' props'">{{ comp.props.length }}</span>
            </button>
          </template>
        </div>
      </div>

      <!-- Detail panel -->
      <div class="detail-panel">
        <template v-if="selectedComponent">
          <div class="detail-header">
            <h2 class="detail-name">{{ selectedComponent.name }}</h2>
            <code v-if="selectedComponent.module" class="detail-module">import { {{ selectedComponent.name }} } from '{{ selectedComponent.module }}'</code>
          </div>

          <div class="detail-section">
            <div class="section-header">
              <span class="section-label">Props</span>
              <span class="section-count">{{ selectedComponent.props.length }}</span>
            </div>

            <div v-if="selectedComponent.props.length === 0" class="no-props">
              No props detected for this component.
            </div>

            <table v-else class="props-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Type</th>
                  <th>Required</th>
                  <th>Default</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="p in selectedComponent.props" :key="p.name">
                  <td><code class="prop-name">{{ p.name }}</code></td>
                  <td><code v-if="p.type" class="prop-type">{{ p.type }}</code></td>
                  <td><span v-if="p.required" class="req-badge">required</span></td>
                  <td><code v-if="p.default != null" class="prop-default">{{ p.default }}</code></td>
                </tr>
              </tbody>
            </table>
          </div>
        </template>

        <div v-else class="detail-empty">
          <div class="context-card">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="1.5"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>
            <h3>Component Context for AI</h3>
            <p>Annotask scans your installed packages and extracts component names, props, types, and defaults into a structured catalog.</p>
            <p>When your AI coding agent processes a task, this catalog is included as context. The agent knows which components are available in your project, how to import them, and what props they accept — so it writes code using your actual design system instead of generic HTML.</p>
            <div class="context-how">
              <span class="how-label">How it works</span>
              <ol>
                <li>Annotask reads your <code>package.json</code> dependencies</li>
                <li>Each package is scanned for component exports and prop definitions</li>
                <li>The catalog is served via the API and MCP tools</li>
                <li>Your agent calls <code>annotask_get_components</code> to get the full catalog before applying changes</li>
              </ol>
            </div>
            <p class="context-hint">Select a component from the list to view its props, types, and defaults.</p>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.libraries-page {
  display: flex;
  flex-direction: column;
  flex: 1;
  height: 100%;
  overflow: hidden;
  background: var(--surface);
}

.refresh-btn {
  background: none; border: none; color: var(--text-muted); cursor: pointer;
  padding: 4px; border-radius: 4px; flex-shrink: 0; display: flex; align-items: center;
}
.refresh-btn:hover { color: var(--text); background: var(--surface-2); }
.refresh-btn:disabled { opacity: 0.4; cursor: default; }
.spinning { animation: spin 0.8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }

/* Body: list + detail */
.libraries-body {
  display: flex;
  flex: 1;
  overflow: hidden;
}

/* List panel */
.list-panel {
  width: 320px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  border-right: 1px solid var(--border);
  overflow: hidden;
}
.list-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}
.search-wrap {
  flex: 1;
  position: relative;
}
.search-icon {
  position: absolute;
  left: 8px;
  top: 50%;
  transform: translateY(-50%);
  color: var(--text-muted);
  pointer-events: none;
}
.search-input {
  width: 100%;
  padding: 6px 10px 6px 28px;
  font-size: 12px;
  background: var(--surface-2);
  color: var(--text);
  border: 1px solid var(--border);
  border-radius: 6px;
  outline: none;
}
.search-input:focus { border-color: var(--accent); }
.search-input::placeholder { color: var(--text-muted); }

.filter-btn {
  display: flex; align-items: center; gap: 4px;
  padding: 4px 10px; font-size: 11px; font-weight: 600;
  background: transparent; color: var(--text-muted);
  border: 1px solid var(--border); border-radius: 999px;
  cursor: pointer; white-space: nowrap; transition: all 0.15s;
}
.filter-btn:hover { border-color: var(--text-muted); color: var(--text); }
.filter-btn.active { background: color-mix(in srgb, var(--accent) 15%, transparent); border-color: var(--accent); color: var(--accent); }
.filter-count { font-size: 10px; opacity: 0.7; }

.lib-list {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
}
.lib-group-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 10px 8px 4px;
}
.lib-group-header:not(:first-child) { margin-top: 8px; }
.lib-group-name { font-size: 11px; font-weight: 700; color: var(--text); }
.lib-group-version { font-size: 10px; color: var(--text-muted); }
.lib-group-count { font-size: 10px; color: var(--text-muted); margin-left: auto; }

.comp-item {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 6px 10px;
  background: none;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  text-align: left;
  color: var(--text);
  font-size: 12px;
  transition: background 0.1s;
}
.comp-item:hover { background: var(--surface-2); }
.comp-item.selected { background: color-mix(in srgb, var(--accent) 10%, transparent); }

.comp-name { font-weight: 600; flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.used-badge {
  font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.03em;
  color: #22c55e; background: rgba(34, 197, 94, 0.1);
  padding: 1px 5px; border-radius: 3px; flex-shrink: 0;
}
.comp-prop-count {
  font-size: 10px; color: var(--text-muted); flex-shrink: 0;
  background: var(--surface-2); padding: 0 5px; border-radius: 3px;
  min-width: 18px; text-align: center;
}

/* Detail panel */
.detail-panel {
  flex: 1;
  overflow-y: auto;
  padding: 20px 24px;
}

.detail-header { margin-bottom: 24px; }
.detail-name { margin: 0; font-size: 22px; font-weight: 700; color: var(--text); }
.detail-module {
  display: inline-block;
  margin-top: 6px;
  font-size: 12px;
  color: var(--text-muted);
  background: var(--surface-2);
  padding: 4px 10px;
  border-radius: 6px;
  border: 1px solid var(--border);
}

.detail-section { }
.section-header { display: flex; align-items: center; gap: 8px; margin-bottom: 12px; }
.section-label { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-muted); }
.section-count { font-size: 11px; color: var(--text-muted); }

.no-props {
  font-size: 13px; color: var(--text-muted); font-style: italic; padding: 16px 0;
}

.props-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}
.props-table th {
  text-align: left;
  padding: 8px 12px;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--text-muted);
  background: var(--surface-2);
  border-bottom: 1px solid var(--border);
}
.props-table th:first-child { border-radius: 6px 0 0 0; }
.props-table th:last-child { border-radius: 0 6px 0 0; }
.props-table td {
  padding: 8px 12px;
  border-bottom: 1px solid var(--border);
  vertical-align: top;
}
.props-table tr:last-child td { border-bottom: none; }
.props-table tbody tr:hover { background: rgba(255,255,255,0.02); }

.prop-name { font-size: 13px; color: var(--accent); font-weight: 600; }
.prop-type { font-size: 12px; color: var(--text-muted); word-break: break-all; }
.req-badge { font-size: 10px; font-weight: 700; color: #f59e0b; text-transform: uppercase; }
.prop-default { font-size: 12px; color: var(--text-muted); }

/* Empty detail: context explanation */
.detail-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
}
.context-card {
  max-width: 480px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.context-card h3 {
  margin: 0;
  font-size: 16px;
  font-weight: 700;
  color: var(--text);
}
.context-card p {
  margin: 0;
  font-size: 12px;
  color: var(--text-muted);
  line-height: 1.6;
}
.context-how {
  margin-top: 4px;
  padding: 10px 14px;
  background: var(--surface-2);
  border-radius: 8px;
  border: 1px solid var(--border);
}
.how-label {
  display: block;
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-muted);
  margin-bottom: 6px;
}
.context-how ol {
  margin: 0;
  padding-left: 18px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.context-how li {
  font-size: 12px;
  color: var(--text-muted);
  line-height: 1.5;
}
.context-how code {
  font-size: 11px;
  color: var(--accent);
  background: var(--surface);
  padding: 1px 5px;
  border-radius: 3px;
}
.context-hint {
  font-size: 11px;
  color: var(--text-muted);
  opacity: 0.6;
  margin-top: 2px;
}

/* Empty state (list panel) */
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 40px 20px;
  color: var(--text-muted);
  font-size: 12px;
  text-align: center;
}
.empty-hint { font-size: 11px; opacity: 0.6; }
.empty-spinner {
  width: 20px; height: 20px; border: 2px solid var(--border);
  border-top-color: var(--text-muted); border-radius: 50%;
  animation: spin 0.8s linear infinite;
}
</style>
