<script setup lang="ts">
/**
 * Generate-component drawer — the wireframe canvas's pick → settings →
 * datasource → generate → place flow (replaces the blind instant drop).
 * Right-docked INSIDE WireframeCanvas so the canvas stays visible and
 * clickable for the Place step; ghost placement is rendered by the canvas
 * itself (this panel only drives the session).
 */
import { computed, ref } from 'vue'
import Icon from './Icon.vue'
import DataBindingPicker from './DataBindingPicker.vue'
import { inferWidget, enumValues, type WidgetProp } from '../utils/propWidgets'
import type { useComponentGenerator } from '../composables/useComponentGenerator'
import type { WireframeDataBinding } from '../../shared/wireframe-types'

const props = defineProps<{
  generator: ReturnType<typeof useComponentGenerator>
}>()

const session = computed(() => props.generator.session.value)
const pickerOpen = ref(false)

/** Prop rows for one editable state bag. With no catalog metadata yet, fall
 *  back to the bag's existing keys as untyped rows (honest degradation). */
function rowsFor(state: Record<string, unknown>): WidgetProp[] {
  const meta = session.value?.meta
  if (meta && meta.props.length > 0) return meta.props
  return Object.keys(state).map(name => ({ name, type: null }))
}

function setProp(state: Record<string, unknown>, name: string, value: unknown): void {
  if (value === undefined || value === '') delete state[name]
  else state[name] = value
}

function setJsonProp(state: Record<string, unknown>, name: string, raw: string): void {
  if (raw.trim() === '') { delete state[name]; return }
  try { state[name] = JSON.parse(raw) } catch { /* invalid — keep previous */ }
}

function jsonValue(state: Record<string, unknown>, name: string): string {
  const v = state[name]
  if (v === undefined) return ''
  return typeof v === 'string' ? v : JSON.stringify(v)
}

function onBindingSelect(binding: WireframeDataBinding): void {
  props.generator.setBinding(binding)
  pickerOpen.value = false
}

function onBindingClear(): void {
  props.generator.setBinding(null)
  pickerOpen.value = false
}

const fidelityLabel = computed(() => {
  const f = session.value?.generated?.fidelity
  if (!f || f === 'live') return null
  return f === 'isolated-preview' ? 'isolated preview' : 'placeholder render'
})
</script>

<template>
  <div v-if="session" class="gen-panel" data-testid="gen-panel" @pointerdown.stop @click.stop>
    <div class="gen-head">
      <span class="gen-title">{{ session.item.componentName }}</span>
      <span v-if="session.item.library" class="gen-lib">{{ session.item.library }}</span>
      <button class="gen-icon-btn" title="Close" data-testid="gen-cancel" @click="generator.cancel()">
        <Icon name="x" :size="14" />
      </button>
    </div>
    <code v-if="session.item.module" class="gen-module">{{ session.item.module }}</code>

    <div class="gen-scroll">
      <!-- Settings: real props (codegen) vs preview samples (display only). -->
      <section class="gen-section">
        <h4>Props <em>— real values, written into source</em></h4>
        <div v-for="p in rowsFor(session.propsState)" :key="`p-${p.name}`" class="gen-prop-row">
          <code class="gen-prop-name" :title="p.type ?? ''">{{ p.name }}</code>
          <template v-if="inferWidget(p) === 'boolean'">
            <input type="checkbox" :checked="session.propsState[p.name] === true" :data-testid="`gen-prop-${p.name}`"
              @change="(e) => setProp(session!.propsState, p.name, (e.target as HTMLInputElement).checked)">
          </template>
          <template v-else-if="inferWidget(p) === 'number'">
            <input type="number" class="gen-input" :value="(session.propsState[p.name] as number) ?? ''" :data-testid="`gen-prop-${p.name}`"
              @input="(e) => { const v = (e.target as HTMLInputElement).value; setProp(session!.propsState, p.name, v === '' ? undefined : Number(v)) }">
          </template>
          <template v-else-if="inferWidget(p) === 'enum'">
            <select class="gen-input" :value="(session.propsState[p.name] as string) ?? ''" :data-testid="`gen-prop-${p.name}`"
              @change="(e) => setProp(session!.propsState, p.name, (e.target as HTMLSelectElement).value || undefined)">
              <option value="">—</option>
              <option v-for="opt in enumValues(p)" :key="opt" :value="opt">{{ opt }}</option>
            </select>
          </template>
          <template v-else-if="inferWidget(p) === 'string'">
            <input type="text" class="gen-input" :value="(session.propsState[p.name] as string) ?? ''" :data-testid="`gen-prop-${p.name}`"
              @input="(e) => setProp(session!.propsState, p.name, (e.target as HTMLInputElement).value || undefined)">
          </template>
          <template v-else>
            <input type="text" class="gen-input" placeholder="JSON" :value="jsonValue(session.propsState, p.name)" :data-testid="`gen-prop-${p.name}`"
              @change="(e) => setJsonProp(session!.propsState, p.name, (e.target as HTMLInputElement).value)">
          </template>
        </div>
      </section>

      <section class="gen-section">
        <h4>Preview samples <em>— display only, never codegen'd</em></h4>
        <div v-for="p in rowsFor(session.previewPropsState)" :key="`s-${p.name}`" class="gen-prop-row">
          <code class="gen-prop-name">{{ p.name }}</code>
          <input type="text" class="gen-input" :value="jsonValue(session.previewPropsState, p.name)" :data-testid="`gen-preview-prop-${p.name}`"
            @change="(e) => setJsonProp(session!.previewPropsState, p.name, (e.target as HTMLInputElement).value)">
        </div>
      </section>

      <!-- Datasource: optional, offered — never required. -->
      <section class="gen-section">
        <h4>Data <em v-if="generator.datasourceSuggested.value">— this component looks data-driven</em></h4>
        <div v-if="session.binding" class="gen-binding-chip" data-testid="gen-binding-chip">
          <span class="gen-binding-name">{{ session.binding.name }}</span>
          <span v-if="session.binding.path" class="gen-binding-path">{{ session.binding.path }}</span>
          <span class="gen-binding-tag" :class="session.binding.shape_source">{{ session.binding.shape_source }}</span>
        </div>
        <button class="gen-btn" data-testid="gen-bind-open" @click="pickerOpen = true">
          {{ session.binding ? 'Change binding…' : 'Bind data…' }}
        </button>
      </section>

      <!-- Generate: honest snapshot on the app-true surface. -->
      <section class="gen-section">
        <h4>Generate</h4>
        <div class="gen-gen-row">
          <label class="gen-width">width <input type="number" class="gen-input" :value="session.width" min="80" max="1600"
            @input="(e) => { const v = Number((e.target as HTMLInputElement).value); if (v >= 80) session!.width = v }"></label>
          <button class="gen-btn primary" :disabled="session.generating"
            :data-testid="session.generated ? 'gen-regenerate' : 'gen-generate'"
            @click="generator.generate()">
            {{ session.generating ? 'Generating…' : session.generated ? 'Regenerate' : 'Generate' }}
          </button>
        </div>
        <div v-if="session.generated" class="gen-preview">
          <img v-if="session.generated.dataUrl" :src="session.generated.dataUrl" data-testid="gen-preview-img" alt="generated snapshot">
          <div v-else class="gen-preview-empty">no render — places as a visible placeholder</div>
          <span v-if="fidelityLabel" class="gen-fidelity" :class="session.generated.fidelity">{{ fidelityLabel }}</span>
        </div>
        <div v-if="session.error" class="gen-error">{{ session.error }}</div>
      </section>
    </div>

    <div class="gen-foot">
      <template v-if="session.editBlockId">
        <button class="gen-btn primary" :disabled="!session.generated && !session.binding" data-testid="gen-apply" @click="generator.apply()">Apply</button>
      </template>
      <template v-else>
        <button v-if="session.dropAt" class="gen-btn primary" :disabled="!session.generated" data-testid="gen-place-drop" @click="generator.placeAtDropPoint()">Place at drop point</button>
        <button class="gen-btn" :disabled="!session.generated" data-testid="gen-place"
          @click="session.placing ? generator.cancelPlace() : generator.beginPlace()">
          {{ session.placing ? 'Placing — click the canvas (Esc cancels)' : 'Place on canvas' }}
        </button>
      </template>
    </div>

    <div v-if="pickerOpen" class="gen-picker-overlay">
      <DataBindingPicker :initial="session.binding" @select="onBindingSelect" @clear="onBindingClear" @cancel="pickerOpen = false" />
    </div>
  </div>
</template>

<style scoped>
.gen-panel {
  position: absolute;
  top: 44px;
  right: 8px;
  bottom: 8px;
  width: 340px;
  display: flex;
  flex-direction: column;
  background: var(--surface-elevated);
  border: 1px solid var(--border-strong);
  border-radius: 8px;
  box-shadow: 0 8px 24px var(--shadow);
  color: var(--text);
  font-size: 12px;
  z-index: 60;
}
.gen-head { display: flex; align-items: center; gap: 8px; padding: 10px 12px 4px; }
.gen-title { font-weight: 600; font-size: 13px; }
.gen-lib {
  padding: 1px 6px;
  border-radius: 3px;
  font-size: 10px;
  background: color-mix(in srgb, var(--accent) 18%, transparent);
  color: var(--accent);
}
.gen-icon-btn { margin-left: auto; background: none; border: none; color: var(--text-muted); cursor: pointer; padding: 2px; }
.gen-icon-btn:hover { color: var(--text); }
.gen-module { display: block; padding: 0 12px 6px; color: var(--text-muted); font-size: 10px; }
.gen-scroll { flex: 1; overflow-y: auto; padding: 0 12px; display: flex; flex-direction: column; gap: 12px; }
.gen-section h4 { margin: 0 0 6px; font-size: 11px; font-weight: 600; }
.gen-section h4 em { font-style: normal; font-weight: 400; color: var(--text-muted); }
.gen-prop-row { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; }
.gen-prop-name { min-width: 90px; font-size: 11px; color: var(--syntax-property); overflow: hidden; text-overflow: ellipsis; }
.gen-input {
  flex: 1;
  min-width: 0;
  padding: 4px 6px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 4px;
  color: var(--text);
  font-size: 11px;
}
.gen-binding-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 6px;
  padding: 3px 8px;
  border-radius: 4px;
  background: var(--surface-2);
  border: 1px solid var(--border);
}
.gen-binding-name { font-weight: 600; }
.gen-binding-path { color: var(--text-muted); font-family: ui-monospace, monospace; font-size: 10px; }
.gen-binding-tag { padding: 0 5px; border-radius: 3px; font-size: 9px; }
.gen-binding-tag.api-schema { background: color-mix(in srgb, var(--success) 18%, transparent); color: var(--success); }
.gen-binding-tag.source-details { background: color-mix(in srgb, var(--warning) 18%, transparent); color: var(--warning); }
.gen-binding-tag.none { background: color-mix(in srgb, var(--text-muted) 18%, transparent); color: var(--text-muted); }
.gen-gen-row { display: flex; align-items: center; gap: 8px; }
.gen-width { display: flex; align-items: center; gap: 4px; color: var(--text-muted); font-size: 11px; }
.gen-width .gen-input { width: 64px; flex: none; }
.gen-preview { position: relative; margin-top: 8px; border: 1px solid var(--border); border-radius: 4px; overflow: hidden; }
.gen-preview img { display: block; max-width: 100%; }
.gen-preview-empty { padding: 16px; text-align: center; color: var(--text-muted); border: 1px dashed var(--border-strong); }
.gen-fidelity {
  position: absolute;
  left: 4px;
  bottom: 4px;
  padding: 1px 6px;
  border-radius: 3px;
  font-size: 9px;
  background: color-mix(in srgb, var(--warning) 85%, black);
  color: #111;
}
.gen-fidelity.placeholder { background: color-mix(in srgb, var(--text-muted) 85%, black); color: #eee; }
.gen-error { margin-top: 6px; color: var(--danger); font-size: 11px; }
.gen-foot { display: flex; gap: 8px; padding: 10px 12px; border-top: 1px solid var(--border); }
.gen-btn {
  padding: 5px 10px;
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: 4px;
  color: var(--text);
  cursor: pointer;
  font-size: 12px;
}
.gen-btn:hover { background: var(--surface-3); }
.gen-btn.primary { background: var(--accent); border-color: var(--accent); color: var(--text-on-accent); }
.gen-btn.primary:hover { background: var(--accent-hover); }
.gen-btn:disabled { opacity: 0.5; cursor: default; }
.gen-picker-overlay {
  position: fixed;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--overlay);
  z-index: 80;
}
</style>
