<template>
  <details class="acc-section" :open="initialOpen">
    <summary class="acc-summary">
      <span class="acc-title">Accessibility</span>
      <span v-if="info" class="acc-status" :class="overallClass">{{ overallLabel }}</span>
      <span v-else-if="loading" class="acc-status loading">…</span>
    </summary>
    <div v-if="info" class="acc-body">
      <div class="acc-row">
        <span class="acc-label">Name</span>
        <span class="acc-value">
          <span v-if="info.accessible_name">"{{ info.accessible_name }}"</span>
          <span v-else class="acc-missing">none</span>
          <span class="acc-source">via {{ info.name_source }}</span>
        </span>
      </div>
      <div class="acc-row">
        <span class="acc-label">Role</span>
        <span class="acc-value">
          <code>{{ info.role || '—' }}</code>
          <span class="acc-source">{{ info.role_source }}</span>
        </span>
      </div>
      <div class="acc-row">
        <span class="acc-label">Focusable</span>
        <span class="acc-value">
          {{ info.focusable ? 'yes' : 'no' }}
          <span v-if="info.tabindex !== null" class="acc-source">tabindex={{ info.tabindex }}</span>
        </span>
      </div>
      <div class="acc-row">
        <span class="acc-label">Focus indicator</span>
        <span class="acc-value" :class="info.focus_indicator">
          {{ info.focus_indicator }}
          <span v-if="info.focus_indicator === 'unknown'" class="acc-source">— focus the element to verify</span>
        </span>
      </div>
      <div class="acc-row" v-if="info.contrast">
        <span class="acc-label">Contrast</span>
        <span class="acc-value contrast-row">
          <span class="acc-swatch" :style="{ background: info.contrast.foreground }" />
          <span class="acc-swatch" :style="{ background: info.contrast.background }" />
          <code>{{ info.contrast.ratio }}:1</code>
          <span class="badge" :class="info.contrast.aa_normal ? 'pass' : 'fail'">
            AA {{ info.contrast.aa_normal ? 'pass' : 'fail' }}
          </span>
          <span class="badge" :class="info.contrast.aaa_normal ? 'pass' : 'fail'">
            AAA {{ info.contrast.aaa_normal ? 'pass' : 'fail' }}
          </span>
        </span>
      </div>
      <div class="acc-row" v-if="info.aria_attrs.length">
        <span class="acc-label">ARIA</span>
        <span class="acc-value chip-list">
          <code v-for="a in info.aria_attrs" :key="a.name" class="chip">
            {{ a.name }}="{{ a.value }}"
          </code>
        </span>
      </div>
    </div>
    <div v-else-if="loading" class="acc-loading">Computing accessibility info…</div>
    <div v-else class="acc-loading">Select an element to view accessibility info.</div>
  </details>
</template>

<script setup lang="ts">
import { ref, watch, computed } from 'vue'
import type { useIframeManager } from '../composables/useIframeManager'
import type { AccessibilityInfo } from '../../shared/bridge-types'

const props = defineProps<{
  iframe: ReturnType<typeof useIframeManager>
  eid: string | null
  initialOpen?: boolean
}>()

const info = ref<AccessibilityInfo | null>(null)
const loading = ref(false)
let token = 0

async function reload() {
  if (!props.eid) {
    info.value = null
    return
  }
  loading.value = true
  const my = ++token
  const items = await props.iframe.computeAccessibilityInfo([props.eid])
  if (my !== token) return
  info.value = items[0] || null
  loading.value = false
}

watch(() => props.eid, reload, { immediate: true })

const overallLabel = computed(() => {
  if (!info.value) return ''
  const issues: string[] = []
  if (!info.value.accessible_name && info.value.focusable) issues.push('no name')
  if (info.value.contrast && !info.value.contrast.aa_normal) issues.push('low contrast')
  if (info.value.tabindex !== null && info.value.tabindex > 0) issues.push('positive tabindex')
  if (issues.length === 0) return 'looks ok'
  return issues.join(' · ')
})

const overallClass = computed(() => {
  if (!info.value) return ''
  return overallLabel.value === 'looks ok' ? 'pass' : 'fail'
})
</script>

<style scoped>
.acc-section {
  border-top: 1px solid var(--border);
  padding: 10px 12px;
}
.acc-summary {
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 8px;
  list-style: none;
  user-select: none;
}
.acc-summary::-webkit-details-marker { display: none; }
.acc-summary::before {
  content: '▸';
  color: var(--text-muted);
  font-size: 10px;
  transition: transform 0.12s;
}
.acc-section[open] > .acc-summary::before { transform: rotate(90deg); }
.acc-title { font-size: 12px; font-weight: 600; color: var(--text); }
.acc-status {
  margin-left: auto;
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 3px;
  background: var(--surface-2);
  color: var(--text-muted);
}
.acc-status.pass { color: var(--success); }
.acc-status.fail { color: var(--danger); }
.acc-status.loading { color: var(--text-muted); }

.acc-body { margin-top: 8px; display: flex; flex-direction: column; gap: 4px; }
.acc-row { display: flex; gap: 8px; font-size: 11px; align-items: baseline; }
.acc-label { color: var(--text-muted); min-width: 100px; flex-shrink: 0; }
.acc-value { color: var(--text); display: flex; align-items: center; gap: 6px; flex-wrap: wrap; min-width: 0; }
.acc-source { color: var(--text-muted); font-size: 10px; }
.acc-missing { color: var(--danger); font-style: italic; }

.acc-value.visible { color: var(--success); }
.acc-value.none { color: var(--danger); }
.acc-value.unknown { color: var(--text-muted); }

.contrast-row { font-family: monospace; }
.acc-swatch {
  display: inline-block;
  width: 14px; height: 14px;
  border-radius: 3px;
  border: 1px solid var(--border);
}
.badge {
  font-size: 10px;
  padding: 1px 5px;
  border-radius: 3px;
  font-family: sans-serif;
}
.badge.pass { background: color-mix(in srgb, var(--success) 18%, transparent); color: var(--success); }
.badge.fail { background: color-mix(in srgb, var(--danger) 18%, transparent); color: var(--danger); }
.chip-list { gap: 4px; }
.chip {
  display: inline-block;
  padding: 1px 5px;
  font-size: 10px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 3px;
  color: var(--text);
}

.acc-loading { font-size: 11px; color: var(--text-muted); margin-top: 8px; padding-bottom: 4px; }
</style>
