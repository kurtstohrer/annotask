<script setup lang="ts">
/**
 * On-canvas legend for the active overlay sources. Renders in a corner of the
 * canvas so the user can decode rect colors WITHOUT looking away at the
 * sidebar — the core fix for "color means three different things and nothing
 * on the canvas says which".
 *
 * Two modes, chosen from the sources themselves:
 *   - identity  → one row per source (swatch + label), hover to focus that
 *                 source's rects (reuses the same focus path as the sidebar).
 *   - latency   → the Network tab colors by latency, so a per-endpoint legend
 *                 would be noise; instead we show the latency buckets and a
 *                 "Color: latency" header so an orange rect reads as "slow",
 *                 not "second source".
 */
import { computed } from 'vue'
import { colorForSource, type DataHighlightSource } from '../composables/useDataHighlights'

const props = defineProps<{
  sources: DataHighlightSource[]
  focusedName: string | null
  /** True when more elements matched than the overlay cap draws. */
  truncated?: boolean
  /** Rects actually drawn (capped). */
  shown?: number
  /** True total matched this pass (uncapped) — drives "showing N of M". */
  total?: number
}>()

const emit = defineEmits<{ (e: 'focus', name: string | null): void }>()

const isLatency = computed(() => props.sources.some(s => s.encoding === 'latency'))

/** Mirrors `colorForLatency` / `latencyBucketLabel` in useDataSources.ts. */
const latencyBuckets = [
  { label: 'fast · <200ms', color: 'var(--success)' },
  { label: 'ok · <500ms', color: 'var(--warning)' },
  { label: 'slow · <1s', color: 'var(--annotation-orange)' },
  { label: 'very slow · ≥1s', color: 'var(--danger)' },
  { label: 'no data', color: 'var(--text-muted)' },
]

const items = computed(() =>
  props.sources.map(s => ({
    name: s.name,
    label: s.defaultLabel ?? s.name,
    color: s.color ?? colorForSource(s.name),
    approximate: s.confidence === 'fallback' || s.confidence === 'runtime-only',
  })),
)
</script>

<template>
  <div class="overlay-legend" @mouseleave="emit('focus', null)">
    <div class="ol-head">
      <span class="ol-title">{{ isLatency ? 'Color: latency' : 'Highlights' }}</span>
      <span class="ol-count">{{ sources.length }}</span>
    </div>

    <!-- Latency mode: fixed buckets, not per-endpoint. -->
    <div v-if="isLatency" class="ol-list">
      <div v-for="b in latencyBuckets" :key="b.label" class="ol-row">
        <span class="ol-swatch ol-solid" :style="{ '--sw': b.color }" />
        <span class="ol-label">{{ b.label }}</span>
      </div>
    </div>

    <!-- Identity mode: one row per source, hover to focus. -->
    <div v-else class="ol-list ol-scroll">
      <button
        v-for="it in items"
        :key="it.name"
        type="button"
        class="ol-row ol-row-btn"
        :class="{ focused: it.name === focusedName, dimmed: focusedName && it.name !== focusedName }"
        @mouseenter="emit('focus', it.name)"
        @focus="emit('focus', it.name)"
        @blur="emit('focus', null)"
      >
        <span class="ol-swatch" :class="it.approximate ? 'ol-dotted' : 'ol-solid'" :style="{ '--sw': it.color }" />
        <span class="ol-label">{{ it.label }}</span>
        <span v-if="it.approximate" class="ol-approx" title="Approximate — file-level / runtime-only match">≈</span>
      </button>
    </div>

    <!-- Density: never hide overflow silently. When the rect cap clips matches,
         say so explicitly so the user knows the picture is incomplete. -->
    <div v-if="truncated" class="ol-trunc" title="Too many matches to draw at once — narrow the selection or filter to see specific ones">
      <span class="ol-trunc-dot" />
      Showing {{ (shown ?? 0).toLocaleString() }} of {{ (total ?? 0).toLocaleString() }} — too dense
    </div>
  </div>
</template>

<style scoped>
.overlay-legend {
  position: absolute;
  left: 10px;
  bottom: 10px;
  z-index: 10002;
  max-width: 240px;
  padding: 6px;
  background: var(--surface-glass, var(--surface));
  backdrop-filter: blur(6px);
  border: 1px solid var(--border);
  border-radius: 8px;
  box-shadow: 0 2px 10px var(--shadow);
  font-size: 11px;
  pointer-events: auto;
  user-select: none;
}

.ol-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 1px 4px 5px;
  color: var(--text-muted);
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  font-size: 9.5px;
}
.ol-count {
  min-width: 16px;
  height: 15px;
  padding: 0 4px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: var(--surface-2, var(--surface));
  border: 1px solid var(--border);
  border-radius: 8px;
  font-size: 9px;
}

.ol-list { display: flex; flex-direction: column; gap: 1px; }
.ol-scroll { max-height: 184px; overflow-y: auto; }

.ol-row {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 3px 5px;
  border-radius: 5px;
  color: var(--text);
  line-height: 1.2;
}
.ol-row-btn {
  width: 100%;
  background: transparent;
  border: none;
  cursor: pointer;
  text-align: left;
  font: inherit;
  transition: background 0.1s ease-out, opacity 0.1s ease-out;
}
.ol-row-btn:hover,
.ol-row-btn.focused { background: color-mix(in srgb, var(--accent) 14%, transparent); }
.ol-row-btn.dimmed { opacity: 0.45; }

.ol-swatch {
  flex: 0 0 auto;
  width: 16px;
  height: 0;
  border-radius: 1px;
}
.ol-solid { border-top: 3px solid var(--sw); }
/* Dotted swatch mirrors the approximate (file-level/runtime) rect border. */
.ol-dotted { border-top: 3px dotted var(--sw); }

.ol-label {
  flex: 1 1 auto;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.ol-approx {
  flex: 0 0 auto;
  font-family: monospace;
  font-weight: 700;
  color: var(--text-muted);
}

.ol-trunc {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 4px;
  padding: 4px 5px;
  border-top: 1px solid var(--border);
  color: var(--warning);
  font-size: 10px;
  font-weight: 600;
  line-height: 1.2;
}
.ol-trunc-dot {
  flex: 0 0 auto;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--warning);
}
</style>
