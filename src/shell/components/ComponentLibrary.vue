<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'

interface LibraryComponent {
  name: string
  module?: string
  description?: string | null
  props: Array<{
    name: string
    type: string | null
    required: boolean
    default?: unknown
    description?: string | null
  }>
}

interface LibraryCatalog {
  name: string
  version: string
  components: LibraryComponent[]
}

const emit = defineEmits<{ select: [component: LibraryComponent] }>()

const libraries = ref<LibraryCatalog[]>([])
const loading = ref(false)
const expanded = ref<Set<string>>(new Set())
const searchQuery = ref('')

const filteredLibraries = computed(() => {
  if (!searchQuery.value.trim()) return libraries.value
  const q = searchQuery.value.toLowerCase()
  return libraries.value
    .map(lib => ({
      ...lib,
      components: lib.components.filter(c => c.name.toLowerCase().includes(q)),
    }))
    .filter(lib => lib.components.length > 0)
})

const totalComponents = computed(() =>
  libraries.value.reduce((sum, lib) => sum + lib.components.length, 0)
)

async function refresh() {
  loading.value = true
  try {
    const res = await fetch('/__annotask/api/components')
    if (res.ok) {
      const data = await res.json()
      libraries.value = data.libraries || []
    }
  } catch { /* server may not be running */ }
  finally { loading.value = false }
}

function toggle(name: string) {
  if (expanded.value.has(name)) {
    expanded.value.delete(name)
  } else {
    expanded.value.add(name)
  }
}

onMounted(() => { refresh() })
</script>

<template>
  <div class="comp-lib">
    <div class="comp-header">
      <span class="section-label">Components</span>
      <span v-if="totalComponents" class="total-count">{{ totalComponents }}</span>
      <button class="refresh-btn" :disabled="loading" @click="refresh" title="Refresh component list">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"
          :class="{ spinning: loading }">
          <polyline points="23 4 23 10 17 10" /><polyline points="1 20 1 14 7 14" />
          <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
        </svg>
      </button>
    </div>

    <input
      v-if="totalComponents > 5"
      v-model="searchQuery"
      type="text"
      class="comp-search"
      placeholder="Filter components..."
    />

    <div v-if="loading && totalComponents === 0" class="comp-empty">Scanning libraries...</div>
    <div v-else-if="totalComponents === 0" class="comp-empty">
      No component libraries found.<br>
      <span class="comp-hint">Install a component library (e.g. PrimeVue, Vuetify) to see it here.</span>
    </div>

    <template v-for="lib in filteredLibraries" :key="lib.name">
      <div class="lib-header">
        <span class="lib-name">{{ lib.name }}</span>
        <span v-if="lib.version" class="lib-version">v{{ lib.version }}</span>
        <span class="lib-count">{{ lib.components.length }}</span>
      </div>

      <div v-for="comp in lib.components" :key="comp.name" class="comp-item">
        <div class="comp-row">
          <button class="comp-expand-btn" @click.stop="toggle(comp.name)" title="Toggle props">
            <svg class="comp-chevron" :class="{ open: expanded.has(comp.name) }" width="10" height="10"
              viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </button>
          <button class="comp-name-btn" @click="emit('select', comp)">
            <span class="comp-name">{{ comp.name }}</span>
            <code v-if="comp.module" class="comp-module">{{ comp.module }}</code>
            <span v-if="comp.props.length" class="comp-prop-count">{{ comp.props.length }}</span>
          </button>
        </div>
        <div v-if="expanded.has(comp.name) && comp.props.length" class="comp-props">
          <div v-for="p in comp.props" :key="p.name" class="comp-prop">
            <code class="prop-name">{{ p.name }}</code>
            <span v-if="p.type" class="prop-type">{{ p.type }}</span>
            <span v-if="p.required" class="prop-required">req</span>
            <span v-if="p.default !== undefined && p.default !== null" class="prop-default">= {{ p.default }}</span>
          </div>
        </div>
        <div v-else-if="expanded.has(comp.name)" class="comp-no-props">No props detected</div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.comp-lib { display: flex; flex-direction: column; gap: 4px; }
.comp-header { display: flex; align-items: center; gap: 6px; margin-bottom: 4px; }
.section-label { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-muted); }
.total-count { font-size: 10px; color: var(--text-muted); margin-left: auto; }

.refresh-btn {
  background: none; border: none; color: var(--text-muted); cursor: pointer; padding: 2px;
  display: flex; align-items: center;
}
.refresh-btn:hover { color: var(--text); }
.refresh-btn:disabled { opacity: 0.5; cursor: default; }
.spinning { animation: spin 0.8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }

.comp-search {
  padding: 5px 8px; font-size: 11px;
  background: var(--surface-2); color: var(--text);
  border: 1px solid var(--border); border-radius: 5px;
  outline: none; margin-bottom: 4px;
}
.comp-search:focus { border-color: var(--accent); }

.comp-empty { font-size: 11px; color: var(--text-muted); padding: 20px 0; text-align: center; }
.comp-hint { font-size: 10px; color: var(--text-muted); opacity: 0.7; margin-top: 4px; display: inline-block; }

.lib-header {
  display: flex; align-items: center; gap: 6px;
  padding: 6px 0 2px; margin-top: 4px;
}
.lib-name { font-size: 11px; font-weight: 700; color: var(--text); }
.lib-version { font-size: 10px; color: var(--text-muted); }
.lib-count { font-size: 10px; color: var(--text-muted); margin-left: auto; }

.comp-item {
  border-radius: 6px;
  background: var(--surface-2);
  overflow: hidden;
}

.comp-row { display: flex; align-items: center; }

.comp-expand-btn {
  display: flex; align-items: center; justify-content: center;
  width: 24px; flex-shrink: 0; padding: 5px 0;
  background: none; border: none; cursor: pointer;
}
.comp-expand-btn:hover { opacity: 0.7; }

.comp-name-btn {
  display: flex; align-items: center; gap: 6px;
  flex: 1; min-width: 0; padding: 5px 8px 5px 0;
  background: none; border: none; cursor: pointer;
  font-size: 11px; color: var(--text); text-align: left;
}
.comp-name-btn:hover .comp-name { color: var(--accent); }

.comp-chevron { color: var(--text-muted); transition: transform 0.15s; flex-shrink: 0; }
.comp-chevron.open { transform: rotate(90deg); }

.comp-name { font-weight: 600; }
.comp-module { font-size: 9px; color: var(--text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 100px; }
.comp-prop-count { margin-left: auto; font-size: 9px; color: var(--text-muted); flex-shrink: 0; background: var(--border); padding: 0 4px; border-radius: 3px; }

.comp-props { padding: 0 8px 6px; display: flex; flex-direction: column; gap: 2px; }
.comp-no-props { padding: 4px 8px 6px; font-size: 10px; color: var(--text-muted); font-style: italic; }

.comp-prop {
  display: flex; align-items: baseline; gap: 5px;
  font-size: 10px; padding: 1px 0;
}

.prop-name { font-size: 10px; color: #60a5fa; font-weight: 500; }
.prop-type { color: var(--text-muted); font-size: 9px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 140px; }
.prop-required { font-size: 8px; color: #f59e0b; font-weight: 700; text-transform: uppercase; flex-shrink: 0; }
.prop-default { font-size: 9px; color: var(--text-muted); opacity: 0.8; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 80px; }
</style>
