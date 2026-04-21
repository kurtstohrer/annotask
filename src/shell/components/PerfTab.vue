<script setup lang="ts">
import { ref, computed } from 'vue'
import type { PerfScanResult, PerfRecording, WebVitalMetric } from '../../shared/bridge-types'
import type { PerfFinding, TimelineAction, PackageGroup } from '../composables/usePerfMonitor'
import PerfFindingDetail from './PerfFindingDetail.vue'
import PerfResourceTables from './PerfResourceTables.vue'
import Icon from './Icon.vue'

const props = defineProps<{
  recording: boolean
  recordingResult: PerfRecording | null
  scanResult: PerfScanResult | null
  scanLoading: boolean
  hasData: boolean
  timeline: TimelineAction[]
  vitals: WebVitalMetric[]
  score: { score: number; label: string; color: string }
  findings: PerfFinding[]
  taskFindings: Set<string>
  packageGroups: PackageGroup[]
  error: string | null
}>()

const emit = defineEmits<{
  'start-recording': []
  'stop-recording': []
  scan: []
  'create-task': [finding: PerfFinding]
}>()

const detailFinding = ref<PerfFinding | null>(null)

const VITAL_ORDER = ['LCP', 'FCP', 'CLS', 'INP', 'TTFB'] as const

function formatVital(name: string, value: number): string {
  if (name === 'CLS') return value.toFixed(3)
  if (value >= 1000) return (value / 1000).toFixed(1) + 's'
  return Math.round(value) + 'ms'
}

function formatMs(ms: number): string {
  if (ms >= 1000) return (ms / 1000).toFixed(1) + 's'
  return Math.round(ms) + 'ms'
}

function ratingClass(rating: string): string {
  if (rating === 'good') return 'rating-good'
  if (rating === 'needs-improvement') return 'rating-warn'
  return 'rating-poor'
}

const vitalsMap = computed(() => {
  const map: Record<string, WebVitalMetric> = {}
  for (const v of props.vitals) map[v.name] = v
  return map
})

const resources = computed(() =>
  props.recordingResult?.resources || props.scanResult?.resources || []
)

function onCreateTaskFromDetail() {
  if (detailFinding.value) {
    emit('create-task', detailFinding.value)
    detailFinding.value = null
  }
}
</script>

<template>
  <div class="perf-tab">
    <div v-if="score.score >= 0" class="perf-header">
      <span class="score-badge" :style="{ background: score.color }">{{ score.score }}</span>
    </div>

    <div v-if="error" class="perf-error">{{ error }}</div>

    <div v-if="recording" class="recording-indicator">
      <span class="rec-pulse"></span> Recording... interact with the app, then click Stop.
    </div>

    <div v-if="!hasData && !recording && !scanLoading" class="perf-empty">
      Record a session or scan to measure performance
    </div>

    <div v-if="vitals.length > 0 && !recording" class="vitals-grid">
      <div v-for="name in VITAL_ORDER" :key="name" class="vital-card"
           :class="vitalsMap[name] ? ratingClass(vitalsMap[name].rating) : 'rating-na'">
        <span class="vital-name">{{ name }}</span>
        <span v-if="vitalsMap[name]" class="vital-value">{{ formatVital(name, vitalsMap[name].value) }}</span>
        <span v-else class="vital-value vital-na">N/A</span>
        <span v-if="vitalsMap[name]" class="vital-rating" :class="ratingClass(vitalsMap[name].rating)">{{ vitalsMap[name].rating }}</span>
      </div>
    </div>

    <div v-if="timeline.length > 0 && !recording" class="timeline-section">
      <span class="section-label">Timeline ({{ recordingResult ? formatMs(recordingResult.duration) : '' }})</span>
      <div class="log">
        <template v-for="(action, i) in timeline" :key="i">
          <div class="log-entry" :class="{ 'log-action': true }">
            <span class="log-time">{{ formatMs(action.time) }}</span>
            <span class="log-text">{{ action.label }}</span>
            <span v-if="action.longTaskMs > 0" class="log-tag tag-blocking">{{ Math.round(action.longTaskMs) }}ms</span>
            <span v-if="action.shiftCount > 0" class="log-tag tag-shift">cls {{ action.shiftValue.toFixed(3) }}</span>
          </div>
          <div v-for="(evt, j) in action.events.filter(e => e.type !== 'action' && e.type !== 'navigation')" :key="j"
               class="log-entry log-event" :class="'log-' + evt.type">
            <span class="log-time">{{ formatMs(evt.time) }}</span>
            <span class="log-text">{{ evt.label }}</span>
          </div>
        </template>
      </div>
    </div>

    <div v-if="findings.length > 0 && !recording" class="findings-section">
      <span class="section-label">Findings ({{ findings.length }})</span>
      <div v-for="f in findings" :key="f.findingId" data-testid="perf-finding" :data-finding-id="f.findingId" :data-severity="f.severity" class="finding-card" :class="'severity-' + f.severity" @click="detailFinding = f">
        <span class="finding-severity" :class="'sev-' + f.severity">{{ f.severity === 'needs-improvement' ? 'warn' : f.severity }}</span>
        <span class="finding-title">{{ f.title }}</span>
        <span v-if="taskFindings.has(f.findingId)" class="finding-tasked-badge">tasked</span>
        <Icon class="finding-chevron" name="chevron-right" :size="10" :stroke-width="2.5" />
      </div>
    </div>

    <PerfResourceTables
      v-if="!recording"
      :resources="resources"
      :package-groups="packageGroups"
    />
  </div>

  <PerfFindingDetail
    v-if="detailFinding"
    :finding="detailFinding"
    :tasked="taskFindings.has(detailFinding.findingId)"
    @close="detailFinding = null"
    @create-task="onCreateTaskFromDetail"
  />
</template>

<style scoped>
.perf-tab { display: flex; flex-direction: column; gap: 10px; }
.perf-header { display: flex; align-items: center; justify-content: space-between; }
.section-label { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-muted); }

.score-badge { font-size: 10px; font-weight: 700; color: white; padding: 2px 6px; border-radius: 4px; min-width: 24px; text-align: center; }

.perf-error { font-size: 11px; color: var(--danger); padding: 6px 8px; background: color-mix(in srgb, var(--danger) 10%, transparent); border-radius: 5px; }
.perf-empty { font-size: 11px; color: var(--text-muted); padding: 12px 0; text-align: center; }
.recording-indicator { display: flex; align-items: center; gap: 6px; padding: 8px 10px; border-radius: 6px; font-size: 11px; background: color-mix(in srgb, var(--danger) 8%, transparent); color: var(--danger); border: 1px solid color-mix(in srgb, var(--danger) 20%, transparent); }
.rec-pulse { width: 8px; height: 8px; border-radius: 50%; background: var(--danger); animation: pulse-dot 1s infinite; flex-shrink: 0; }
@keyframes pulse-dot { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }

.vitals-grid { display: grid; grid-template-columns: repeat(5, 1fr); gap: 4px; }
.vital-card { display: flex; flex-direction: column; align-items: center; gap: 2px; padding: 6px 4px; border-radius: 6px; background: var(--surface-2); border-left: 2px solid var(--border); }
.vital-card.rating-good { border-left-color: var(--success); }
.vital-card.rating-warn { border-left-color: var(--warning); }
.vital-card.rating-poor { border-left-color: var(--danger); }
.vital-card.rating-na { border-left-color: var(--border); }
.vital-name { font-size: 9px; font-weight: 700; color: var(--text-muted); }
.vital-value { font-size: 12px; font-weight: 700; color: var(--text); }
.vital-na { color: var(--text-muted); font-weight: 400; }
.vital-rating { font-size: 8px; font-weight: 600; text-transform: uppercase; padding: 1px 4px; border-radius: 3px; }
.vital-rating.rating-good { background: color-mix(in srgb, var(--success) 15%, transparent); color: var(--success); }
.vital-rating.rating-warn { background: color-mix(in srgb, var(--warning) 15%, transparent); color: var(--warning); }
.vital-rating.rating-poor { background: color-mix(in srgb, var(--danger) 15%, transparent); color: var(--danger); }

.timeline-section { display: flex; flex-direction: column; gap: 4px; }
.log { display: flex; flex-direction: column; font-family: ui-monospace, 'SF Mono', 'Cascadia Code', monospace; font-size: 10px; line-height: 1.6; }
.log-entry { display: flex; align-items: baseline; gap: 6px; padding: 1px 0; }
.log-time { color: var(--text-muted); min-width: 32px; font-variant-numeric: tabular-nums; flex-shrink: 0; }
.log-text { color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.log-action .log-text { color: var(--text); font-weight: 600; }
.log-event { padding-left: 38px; }
.log-event .log-time { display: none; }
.log-long-task .log-text { color: var(--danger); }
.log-layout-shift .log-text { color: var(--warning); }
.log-paint .log-text { color: var(--success); }
.log-tag { font-size: 9px; padding: 0 4px; border-radius: 3px; flex-shrink: 0; margin-left: auto; }
.tag-blocking { background: color-mix(in srgb, var(--danger) 15%, transparent); color: var(--danger); }
.tag-shift { background: color-mix(in srgb, var(--warning) 15%, transparent); color: var(--warning); }

.findings-section { display: flex; flex-direction: column; gap: 4px; }
.finding-card {
  display: flex; align-items: center; gap: 6px; padding: 6px 8px; border-radius: 6px;
  background: var(--surface-2); cursor: pointer; border-left: 3px solid var(--border);
}
.finding-card:hover { background: var(--border); }
.finding-card.severity-poor { border-left-color: var(--danger); }
.finding-card.severity-needs-improvement { border-left-color: var(--warning); }
.finding-card.severity-good { border-left-color: var(--success); }
.finding-severity { font-size: 9px; font-weight: 700; text-transform: uppercase; padding: 1px 5px; border-radius: 3px; color: white; flex-shrink: 0; }
.finding-severity.sev-poor { background: var(--danger); }
.finding-severity.sev-needs-improvement { background: var(--warning); }
.finding-severity.sev-good { background: var(--success); }
.finding-title { font-size: 11px; font-weight: 600; color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.finding-tasked-badge { font-size: 9px; color: var(--success); margin-left: auto; flex-shrink: 0; }
.finding-chevron { color: var(--text-muted); flex-shrink: 0; margin-left: auto; }
.finding-tasked-badge + .finding-chevron { margin-left: 0; }
</style>
