<template>
  <FindingDrawer
    :title="violation.help"
    :severity="violation.impact"
    :tasked="tasked"
    @close="$emit('close')"
    @create-task="$emit('create-task', violation)"
  >
    <div class="fd-detail-section">
      <span class="fd-detail-label">Rule</span>
      <span class="fd-detail-value">{{ violation.id }}</span>
    </div>
    <div class="fd-detail-section">
      <span class="fd-detail-label">Impact</span>
      <span class="fd-detail-value">{{ violation.impact }}</span>
    </div>
    <div class="fd-detail-section">
      <span class="fd-detail-label">Description</span>
      <p class="fd-detail-text">{{ violation.description }}</p>
    </div>
    <div v-if="violation.elements && violation.elements.length" class="fd-detail-section">
      <span class="fd-detail-label">Affected Elements ({{ violation.nodes }})</span>
      <div v-for="(el, i) in violation.elements" :key="i" class="fd-a11y-element">
        <code v-if="el.html" class="fd-a11y-html">{{ el.html }}</code>
        <code v-if="el.target" class="fd-a11y-selector">{{ el.target }}</code>
        <p v-if="el.failureSummary" class="fd-a11y-fix">{{ el.failureSummary }}</p>
        <span v-if="el.file" class="fd-a11y-source">{{ el.file }}:{{ el.line }} &middot; {{ el.component }}</span>

        <div v-if="a11yInfoFor(el)" class="fd-a11y-meta">
          <div class="fd-meta-row" v-if="a11yInfoFor(el)!.accessible_name">
            <span class="fd-meta-label">Accessible name</span>
            <span class="fd-meta-value">"{{ a11yInfoFor(el)!.accessible_name }}"
              <span class="fd-meta-source">({{ a11yInfoFor(el)!.name_source }})</span>
            </span>
          </div>
          <div class="fd-meta-row" v-else>
            <span class="fd-meta-label">Accessible name</span>
            <span class="fd-meta-value fd-meta-missing">none</span>
          </div>
          <div class="fd-meta-row">
            <span class="fd-meta-label">Role</span>
            <span class="fd-meta-value">{{ a11yInfoFor(el)!.role || '—' }}
              <span class="fd-meta-source">({{ a11yInfoFor(el)!.role_source }})</span>
            </span>
          </div>
          <div class="fd-meta-row" v-if="a11yInfoFor(el)!.tabindex !== null">
            <span class="fd-meta-label">tabindex</span>
            <span class="fd-meta-value">{{ a11yInfoFor(el)!.tabindex }}</span>
          </div>
          <div class="fd-meta-row" v-if="a11yInfoFor(el)!.contrast">
            <span class="fd-meta-label">Contrast</span>
            <span class="fd-meta-value fd-contrast">
              <span class="fd-swatch" :style="{ background: a11yInfoFor(el)!.contrast!.foreground }" />
              <span class="fd-swatch" :style="{ background: a11yInfoFor(el)!.contrast!.background }" />
              {{ a11yInfoFor(el)!.contrast!.ratio }}:1
              <span class="fd-meta-source" :class="{ 'fd-pass': a11yInfoFor(el)!.contrast!.aa_normal, 'fd-fail': !a11yInfoFor(el)!.contrast!.aa_normal }">
                {{ a11yInfoFor(el)!.contrast!.aa_normal ? 'AA pass' : 'AA fail' }}
              </span>
            </span>
          </div>
          <div class="fd-meta-row" v-if="a11yInfoFor(el)!.aria_attrs.length">
            <span class="fd-meta-label">ARIA</span>
            <span class="fd-meta-value">
              <code v-for="attr in a11yInfoFor(el)!.aria_attrs" :key="attr.name" class="fd-aria-chip">
                {{ attr.name }}="{{ attr.value }}"
              </code>
            </span>
          </div>
        </div>
      </div>
    </div>
    <div class="fd-detail-section">
      <span class="fd-detail-label">Learn More</span>
      <a :href="violation.helpUrl" target="_blank" rel="noopener" class="fd-link">{{ violation.helpUrl }}</a>
    </div>
  </FindingDrawer>
</template>

<script setup lang="ts">
import { ref, watch, onMounted } from 'vue'
import FindingDrawer from './FindingDrawer.vue'
import type { A11yViolation } from '../composables/useA11yScanner'
import type { useIframeManager } from '../composables/useIframeManager'
import type { AccessibilityInfo } from '../../shared/bridge-types'

interface Props {
  violation: A11yViolation
  tasked: boolean
  iframe: ReturnType<typeof useIframeManager>
}

const props = defineProps<Props>()
defineEmits<{
  (e: 'close'): void
  (e: 'create-task', violation: A11yViolation): void
}>()

// Keyed by selector for axe violations, and by eid for synthetic violations
// (tab-order) where the element was already resolved by the overlay.
const a11yInfoByKey = ref(new Map<string, AccessibilityInfo>())

type Element = NonNullable<A11yViolation['elements']>[number]
function keyFor(el: Element): string { return el.target || (el.eid ? 'eid:' + el.eid : '') }
function a11yInfoFor(el: Element): AccessibilityInfo | undefined {
  const k = keyFor(el)
  return k ? a11yInfoByKey.value.get(k) : undefined
}

async function loadA11yInfo() {
  a11yInfoByKey.value = new Map()
  const elements = props.violation.elements || []
  const next = new Map<string, AccessibilityInfo>()

  // Selector-based elements: resolve selector → eid, then fetch info.
  const selectorEls = elements.filter(e => !!e.target && !e.eid)
  if (selectorEls.length) {
    const selectors = selectorEls.map(e => e.target)
    const resolved = await props.iframe.resolveBySelectors(selectors)
    const eids = resolved.map(r => r.eid).filter((e): e is string => !!e)
    if (eids.length) {
      const infos = await props.iframe.computeAccessibilityInfo(eids)
      let infoIdx = 0
      for (const r of resolved) {
        if (!r.eid) continue
        const info = infos[infoIdx++]
        if (info) next.set(r.selector, info)
      }
    }
  }

  // Eid-based elements (tab-order): skip the selector resolve step.
  const eidEls = elements.filter(e => !!e.eid)
  if (eidEls.length) {
    const eids = eidEls.map(e => e.eid!) as string[]
    const infos = await props.iframe.computeAccessibilityInfo(eids)
    for (let i = 0; i < eids.length; i++) {
      const info = infos[i]
      if (info) next.set('eid:' + eids[i], info)
    }
  }

  a11yInfoByKey.value = next
}

onMounted(loadA11yInfo)
watch(() => props.violation.id, loadA11yInfo)
</script>

<style scoped>
.fd-a11y-meta {
  margin-top: 8px;
  padding: 8px 10px;
  background: var(--surface-2);
  border-radius: 6px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.fd-meta-row { display: flex; gap: 8px; font-size: 11px; align-items: baseline; }
.fd-meta-label { color: var(--text-muted); min-width: 110px; flex-shrink: 0; }
.fd-meta-value { color: var(--text); display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.fd-meta-source { color: var(--text-muted); font-size: 10px; }
.fd-meta-missing { color: var(--danger); font-style: italic; }
.fd-contrast { font-family: monospace; }
.fd-swatch {
  display: inline-block;
  width: 14px; height: 14px;
  border-radius: 3px;
  border: 1px solid var(--border);
}
.fd-pass { color: var(--success); }
.fd-fail { color: var(--danger); }
.fd-aria-chip {
  display: inline-block;
  padding: 1px 6px;
  margin-right: 4px;
  font-size: 10px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 3px;
  color: var(--text);
}
</style>
