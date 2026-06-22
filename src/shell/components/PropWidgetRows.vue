<script setup lang="ts">
/**
 * Type-aware prop editor rows — extracted from the legacy generate panel so the
 * inline block popover and any other prop UI share one widget switch. Pure: it
 * renders the current values and emits `set` on change; the parent owns where
 * the value lands.
 */
import { inferWidget, enumValues, type WidgetProp } from '../utils/propWidgets'

const props = defineProps<{
  rows: WidgetProp[]
  values: Record<string, unknown>
  /** data-testid prefix (e.g. 'wf-prop' → 'wf-prop-label'). */
  testidPrefix?: string
}>()

const emit = defineEmits<{ set: [name: string, value: unknown] }>()

function jsonValue(name: string): string {
  const v = props.values[name]
  if (v === undefined) return ''
  return typeof v === 'string' ? v : JSON.stringify(v)
}

function setJson(name: string, raw: string): void {
  if (raw.trim() === '') { emit('set', name, undefined); return }
  try { emit('set', name, JSON.parse(raw)) } catch { /* invalid — keep previous */ }
}

const tid = (name: string) => `${props.testidPrefix ?? 'prop'}-${name}`
</script>

<template>
  <div v-for="p in rows" :key="p.name" class="pw-row">
    <code class="pw-name" :title="p.type ?? ''">{{ p.name }}</code>
    <template v-if="inferWidget(p) === 'boolean'">
      <input type="checkbox" :checked="values[p.name] === true" :data-testid="tid(p.name)"
        @change="(e) => emit('set', p.name, (e.target as HTMLInputElement).checked)">
    </template>
    <template v-else-if="inferWidget(p) === 'number'">
      <input type="number" class="pw-input" :value="(values[p.name] as number) ?? ''" :data-testid="tid(p.name)"
        @input="(e) => { const v = (e.target as HTMLInputElement).value; emit('set', p.name, v === '' ? undefined : Number(v)) }">
    </template>
    <template v-else-if="inferWidget(p) === 'enum'">
      <select class="pw-input" :value="(values[p.name] as string) ?? ''" :data-testid="tid(p.name)"
        @change="(e) => emit('set', p.name, (e.target as HTMLSelectElement).value || undefined)">
        <option value="">—</option>
        <option v-for="opt in enumValues(p)" :key="opt" :value="opt">{{ opt }}</option>
      </select>
    </template>
    <template v-else-if="inferWidget(p) === 'string'">
      <input type="text" class="pw-input" :value="(values[p.name] as string) ?? ''" :data-testid="tid(p.name)"
        @input="(e) => emit('set', p.name, (e.target as HTMLInputElement).value || undefined)">
    </template>
    <template v-else>
      <input type="text" class="pw-input" placeholder="JSON" :value="jsonValue(p.name)" :data-testid="tid(p.name)"
        @change="(e) => setJson(p.name, (e.target as HTMLInputElement).value)">
    </template>
  </div>
</template>

<style scoped>
.pw-row { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; }
.pw-name { min-width: 84px; font-size: 11px; color: var(--syntax-property); overflow: hidden; text-overflow: ellipsis; }
.pw-input {
  flex: 1;
  min-width: 0;
  padding: 4px 6px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 4px;
  color: var(--text);
  font-size: 11px;
}
</style>
