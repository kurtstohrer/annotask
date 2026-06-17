<script setup lang="ts">
/**
 * Inline config popover anchored to the selected palette block — the "configure
 * on canvas" surface that replaced the right-docked generate panel. Editing a
 * prop or binding mutates the block and live-regenerates its snapshot (debounced
 * in the generator); the last-good snapshot stays visible with a shimmer until
 * the new render lands. Selecting the block opens it; Escape / the close button
 * dismisses it (which deselects the block).
 *
 * Anchoring mirrors the note/markdown editors: an absolute child of the selected
 * .wf-block, below it by default, flipped above when the block sits near the
 * bottom of the canvas. @pointerdown.stop keeps clicks from deselecting; the
 * keydown handler stops propagation so typing/Backspace never reaches the
 * canvas's block-delete shortcuts.
 */
import { computed, onMounted, ref } from 'vue'
import Icon from './Icon.vue'
import DataBindingPicker from './DataBindingPicker.vue'
import PropWidgetRows from './PropWidgetRows.vue'
import type { WidgetProp } from '../utils/propWidgets'
import type { useComponentGenerator } from '../composables/useComponentGenerator'
import type { WireframeBlock, WireframeDataBinding } from '../../shared/wireframe-types'

const props = defineProps<{
  block: WireframeBlock
  generator: ReturnType<typeof useComponentGenerator>
  /** This block's snapshot is rendering right now (drives the shimmer/label). */
  generating: boolean
  /** Captured document height (stage coords) — flips the popover above the
   *  block when it would overflow the bottom. */
  docHeight?: number
}>()

const emit = defineEmits<{ close: [] }>()

const pickerOpen = ref(false)

// Cold start (e.g. reopening a block after F5 without visiting Components): pull
// the catalog so the prop rows upgrade from untyped keys to typed widgets.
onMounted(() => props.generator.ensureCatalog())

const meta = computed(() => props.generator.metaForBlock(props.block))

/** Typed rows from catalog meta; fall back to the block's own prop keys as
 *  untyped rows (honest degradation before/without a catalog). */
const rows = computed<WidgetProp[]>(() => {
  const m = meta.value
  if (m && m.props.length > 0) return m.props
  return Object.keys(props.block.component?.props ?? {}).map((name) => ({ name, type: null }))
})

const values = computed<Record<string, unknown>>(() => props.block.component?.props ?? {})
const binding = computed<WireframeDataBinding | null>(() => props.block.data ?? null)
const dataSuggested = computed(() => props.generator.datasourceSuggested(props.block))

// Field→prop mapping + loop repeat (only meaningful once a binding exists).
const boundFields = computed<string[]>(() => binding.value?.fields ?? [])
const propMap = computed<Record<string, string>>(() => binding.value?.propMap ?? {})
const isListBinding = computed(() => props.generator.isListPath(binding.value?.path))
const repeatVal = computed(() => binding.value?.repeat ?? (isListBinding.value ? 3 : 1))

const fidelityLabel = computed(() => {
  const f = props.block.fidelity
  if (!f || f === 'live') return null
  return f === 'isolated-preview' ? 'isolated preview' : 'placeholder render'
})

/** Actionable explanation for a non-live render, shown under the header. */
const fidelityNote = computed(() => {
  const f = props.block.fidelity
  if (f === 'isolated-preview') return 'Rendered outside the live app context — may differ from production.'
  if (f === 'placeholder') return 'Couldn’t render live here — it may not be imported in the running app, or it needs required props.'
  return null
})

const flipAbove = computed(() => {
  const h = props.docHeight
  if (!h) return false
  return props.block.rect.y + props.block.rect.height + 300 > h
})

function onSet(name: string, value: unknown): void {
  props.generator.setProp(props.block.id, name, value)
}
function onBindingSelect(b: WireframeDataBinding): void {
  props.generator.setBinding(props.block.id, b)
  pickerOpen.value = false
}
function onBindingClear(): void {
  props.generator.setBinding(props.block.id, null)
  pickerOpen.value = false
}
function onMapProp(prop: string, e: Event): void {
  props.generator.setPropBinding(props.block.id, prop, (e.target as HTMLSelectElement).value || null)
}
function onRepeat(e: Event): void {
  const n = Number((e.target as HTMLInputElement).value)
  if (n >= 1) props.generator.setRepeat(props.block.id, n)
}
function onKeydown(e: KeyboardEvent): void {
  // Stop here so Backspace/Delete/arrows inside the popover never trigger the
  // canvas's block ops; Escape closes the popover.
  e.stopPropagation()
  if (e.key === 'Escape') emit('close')
}
</script>

<template>
  <div class="wf-popover" :class="{ above: flipAbove }" data-testid="wf-block-popover"
    @pointerdown.stop @click.stop @keydown="onKeydown">
    <div class="wf-pop-head">
      <span class="wf-pop-title">{{ block.component?.componentName ?? block.component?.tag }}</span>
      <span v-if="block.component?.library" class="wf-pop-lib">{{ block.component.library }}</span>
      <span v-if="block.component?.mfe" class="wf-pop-mfe" :title="`renders &amp; imports from ${block.component.mfe}`">{{ block.component.mfe }}</span>
      <span class="wf-pop-spacer" />
      <span v-if="generating" class="wf-pop-rendering" data-testid="wf-pop-rendering">rendering…</span>
      <span v-else-if="fidelityLabel" class="wf-pop-fidelity" :class="block.fidelity">{{ fidelityLabel }}</span>
      <button class="wf-pop-close" title="Close (Esc)" data-testid="wf-pop-close" @click="emit('close')">
        <Icon name="x" :size="13" />
      </button>
    </div>
    <code v-if="block.component?.module" class="wf-pop-module">{{ block.component.module }}</code>

    <div class="wf-pop-body">
      <p v-if="!generating && fidelityNote" class="wf-pop-note" data-testid="wf-pop-fidelity-note">{{ fidelityNote }}</p>
      <section class="wf-pop-section">
        <h4>Props <em>— written into source</em></h4>
        <p v-if="rows.length === 0" class="wf-pop-empty">No editable props detected.</p>
        <PropWidgetRows v-else :rows="rows" :values="values" testid-prefix="wf-prop" @set="onSet" />
      </section>

      <section class="wf-pop-section">
        <h4>Data <em v-if="dataSuggested">— looks data-driven</em></h4>
        <div v-if="binding" class="wf-pop-binding" data-testid="wf-pop-binding">
          <span class="wf-pop-binding-name">{{ binding.name }}</span>
          <span v-if="binding.path" class="wf-pop-binding-path">{{ binding.path }}</span>
          <span class="wf-pop-binding-tag" :class="binding.shape_source">{{ binding.shape_source }}</span>
        </div>
        <button class="wf-pop-btn" data-testid="wf-pop-bind" @click="pickerOpen = true">
          {{ binding ? 'Change binding…' : 'Bind data…' }}
        </button>

        <!-- Map each prop to a bound field; list bindings sketch N loop rows. -->
        <div v-if="binding && boundFields.length && rows.length" class="wf-pop-map" data-testid="wf-pop-map">
          <div class="wf-pop-map-title">Map props → data{{ isListBinding ? ' (per item)' : '' }}</div>
          <div v-for="p in rows" :key="`map-${p.name}`" class="wf-pop-map-row">
            <code class="wf-pop-map-prop">{{ p.name }}</code>
            <select class="wf-pop-map-select" :data-testid="`wf-pop-map-${p.name}`"
              :value="propMap[p.name] ?? ''" @change="onMapProp(p.name, $event)">
              <option value="">— literal —</option>
              <option v-for="f in boundFields" :key="f" :value="f">{{ f }}</option>
            </select>
          </div>
          <label v-if="isListBinding" class="wf-pop-repeat">
            show
            <input type="number" min="1" max="24" class="wf-pop-repeat-input" data-testid="wf-pop-repeat"
              :value="repeatVal" @change="onRepeat($event)">
            instances
          </label>
        </div>
      </section>
    </div>

    <div v-if="pickerOpen" class="wf-pop-picker-overlay" @pointerdown.self="pickerOpen = false">
      <DataBindingPicker :initial="binding" @select="onBindingSelect" @clear="onBindingClear" @cancel="pickerOpen = false" />
    </div>
  </div>
</template>

<style scoped>
.wf-popover {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  width: 290px;
  max-height: 360px;
  display: flex;
  flex-direction: column;
  background: var(--surface-elevated);
  border: 1px solid var(--border-strong);
  border-radius: 8px;
  box-shadow: 0 8px 24px var(--shadow);
  color: var(--text);
  font-size: 12px;
  /* Above the resize handles (z ~1099) and block chrome. */
  z-index: 1200;
  cursor: default;
}
.wf-popover.above { top: auto; bottom: calc(100% + 4px); }
.wf-pop-head { display: flex; align-items: center; gap: 6px; padding: 8px 10px 4px; }
.wf-pop-title { font-weight: 600; font-size: 12px; }
.wf-pop-lib {
  padding: 1px 5px;
  border-radius: 3px;
  font-size: 9px;
  background: color-mix(in srgb, var(--accent) 18%, transparent);
  color: var(--accent);
}
.wf-pop-mfe {
  padding: 1px 5px;
  border-radius: 3px;
  font-size: 9px;
  background: color-mix(in srgb, var(--purple) 18%, transparent);
  color: var(--purple);
}
.wf-pop-spacer { flex: 1; }
.wf-pop-rendering { font-size: 9px; color: var(--text-muted); font-style: italic; }
.wf-pop-fidelity {
  padding: 1px 5px;
  border-radius: 3px;
  font-size: 9px;
  background: color-mix(in srgb, var(--warning) 85%, black);
  color: #111;
}
.wf-pop-fidelity.placeholder { background: color-mix(in srgb, var(--text-muted) 85%, black); color: #eee; }
.wf-pop-close { background: none; border: none; color: var(--text-muted); cursor: pointer; padding: 2px; display: flex; }
.wf-pop-close:hover { color: var(--text); }
.wf-pop-module { display: block; padding: 0 10px 6px; color: var(--text-muted); font-size: 10px; }
.wf-pop-body { flex: 1; overflow-y: auto; padding: 0 10px 10px; display: flex; flex-direction: column; gap: 10px; }
.wf-pop-section h4 { margin: 6px 0 6px; font-size: 11px; font-weight: 600; }
.wf-pop-section h4 em { font-style: normal; font-weight: 400; color: var(--text-muted); }
.wf-pop-empty { margin: 0; color: var(--text-muted); font-size: 11px; }
.wf-pop-note {
  margin: 8px 0 0;
  padding: 6px 8px;
  font-size: 10px;
  line-height: 1.35;
  color: var(--text-muted);
  background: color-mix(in srgb, var(--warning) 12%, transparent);
  border-radius: 4px;
}
.wf-pop-binding {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 6px;
  padding: 3px 8px;
  border-radius: 4px;
  background: var(--surface-2);
  border: 1px solid var(--border);
}
.wf-pop-binding-name { font-weight: 600; }
.wf-pop-binding-path { color: var(--text-muted); font-family: ui-monospace, monospace; font-size: 10px; }
.wf-pop-binding-tag { padding: 0 5px; border-radius: 3px; font-size: 9px; }
.wf-pop-binding-tag.api-schema { background: color-mix(in srgb, var(--success) 18%, transparent); color: var(--success); }
.wf-pop-binding-tag.source-details { background: color-mix(in srgb, var(--warning) 18%, transparent); color: var(--warning); }
.wf-pop-binding-tag.none { background: color-mix(in srgb, var(--text-muted) 18%, transparent); color: var(--text-muted); }
.wf-pop-btn {
  padding: 5px 10px;
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: 4px;
  color: var(--text);
  cursor: pointer;
  font-size: 12px;
}
.wf-pop-btn:hover { background: var(--surface-3); }
.wf-pop-map { margin-top: 8px; padding-top: 8px; border-top: 1px solid var(--border); }
.wf-pop-map-title { font-size: 10px; font-weight: 600; color: var(--text-muted); margin-bottom: 6px; }
.wf-pop-map-row { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; }
.wf-pop-map-prop { min-width: 84px; font-size: 11px; color: var(--syntax-property); overflow: hidden; text-overflow: ellipsis; }
.wf-pop-map-select {
  flex: 1;
  min-width: 0;
  padding: 4px 6px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 4px;
  color: var(--text);
  font-size: 11px;
}
.wf-pop-repeat { display: flex; align-items: center; gap: 6px; margin-top: 6px; font-size: 11px; color: var(--text-muted); }
.wf-pop-repeat-input { width: 52px; padding: 3px 6px; background: var(--surface); border: 1px solid var(--border); border-radius: 4px; color: var(--text); font-size: 11px; }
.wf-pop-picker-overlay {
  position: fixed;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--overlay);
  z-index: 80;
}
</style>
