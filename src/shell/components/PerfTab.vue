<script setup lang="ts">
import { ref, computed } from 'vue'
import type { PerfScanResult, PerfRecording, WebVitalMetric } from '../../shared/bridge-types'
import type { PerfFinding, TimelineAction, PackageGroup } from '../composables/usePerfMonitor'
import FindingDrawer from './FindingDrawer.vue'

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

const showPackages = ref(false)

const emit = defineEmits<{
  'start-recording': []
  'stop-recording': []
  scan: []
  'create-task': [finding: PerfFinding]
}>()

const showResources = ref(false)
const detailFinding = ref<PerfFinding | null>(null)

const VITAL_ORDER = ['LCP', 'FCP', 'CLS', 'INP', 'TTFB'] as const
const VITAL_LABELS: Record<string, string> = {
  LCP: 'Largest Contentful Paint', FCP: 'First Contentful Paint',
  CLS: 'Cumulative Layout Shift', INP: 'Interaction to Next Paint', TTFB: 'Time to First Byte',
}

const VITAL_DESCRIPTIONS: Record<string, string> = {
  LCP: 'Measures how long it takes for the largest visible content element (image, text block, or video) to render. A slow LCP means users stare at a blank or incomplete page.',
  FCP: 'Measures when the first piece of content is painted to the screen. A slow FCP means the page appears unresponsive after navigation.',
  CLS: 'Measures unexpected layout shifts during the page lifecycle. High CLS means elements jump around as the page loads, causing misclicks and poor UX.',
  INP: 'Measures the worst interaction latency (click, tap, or keypress) throughout the page lifecycle. A slow INP means the page feels sluggish when users interact.',
  TTFB: 'Measures how long the browser waits for the first byte of the response from the server. A slow TTFB indicates server-side or network issues.',
}

const VITAL_FIXES: Record<string, string[]> = {
  LCP: [
    'Optimize and compress hero images (use WebP/AVIF, add width/height attributes)',
    'Preload critical resources with <link rel="preload">',
    'Remove render-blocking JavaScript and CSS',
    'Use a CDN to reduce server response time',
  ],
  FCP: [
    'Reduce server response time (TTFB)',
    'Eliminate render-blocking resources',
    'Inline critical CSS, defer non-critical CSS',
    'Minimize DOM size and reduce JavaScript execution',
  ],
  CLS: [
    'Always set width/height on images and videos',
    'Reserve space for dynamic content (ads, embeds)',
    'Avoid inserting content above existing content',
    'Use CSS contain: layout on animated elements',
  ],
  INP: [
    'Break up long tasks into smaller async chunks',
    'Use requestIdleCallback for non-urgent work',
    'Reduce JavaScript execution time in event handlers',
    'Debounce or throttle expensive input handlers',
  ],
  TTFB: [
    'Use a CDN to serve content closer to users',
    'Optimize server-side rendering and database queries',
    'Enable HTTP caching and compression (gzip/brotli)',
    'Use 103 Early Hints for preloading',
  ],
}

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

function formatBytes(bytes: number): string {
  if (bytes < 1024) return bytes + 'B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + 'KB'
  return (bytes / (1024 * 1024)).toFixed(1) + 'MB'
}

function shortenUrl(url: string): string {
  try { const p = new URL(url).pathname; return p.length > 50 ? '...' + p.slice(-47) : p }
  catch { return url.length > 50 ? '...' + url.slice(-47) : url }
}

const vitalsMap = computed(() => {
  const map: Record<string, WebVitalMetric> = {}
  for (const v of props.vitals) map[v.name] = v
  return map
})

function isHeavy(r: { initiatorType: string; transferSize: number }): boolean {
  const t: Record<string, number> = { script: 200 * 1024, img: 500 * 1024, css: 100 * 1024 }
  return r.transferSize > (t[r.initiatorType] ?? 500 * 1024)
}

function resources() {
  return props.recordingResult?.resources || props.scanResult?.resources || []
}

function onCreateTask(f: PerfFinding) {
  emit('create-task', f)
  detailFinding.value = null
}
</script>

<template>
  <div class="perf-tab">
    <!-- Score -->
    <div v-if="score.score >= 0" class="perf-header">
      <span class="score-badge" :style="{ background: score.color }">{{ score.score }}</span>
    </div>

    <div v-if="error" class="perf-error">{{ error }}</div>

    <!-- Recording indicator -->
    <div v-if="recording" class="recording-indicator">
      <span class="rec-pulse"></span> Recording... interact with the app, then click Stop.
    </div>

    <!-- Empty state -->
    <div v-if="!hasData && !recording && !scanLoading" class="perf-empty">
      Record a session or scan to measure performance
    </div>

    <!-- Vitals Grid -->
    <div v-if="vitals.length > 0 && !recording" class="vitals-grid">
      <div v-for="name in VITAL_ORDER" :key="name" class="vital-card"
           :class="vitalsMap[name] ? ratingClass(vitalsMap[name].rating) : 'rating-na'">
        <span class="vital-name">{{ name }}</span>
        <span v-if="vitalsMap[name]" class="vital-value">{{ formatVital(name, vitalsMap[name].value) }}</span>
        <span v-else class="vital-value vital-na">N/A</span>
        <span v-if="vitalsMap[name]" class="vital-rating" :class="ratingClass(vitalsMap[name].rating)">{{ vitalsMap[name].rating }}</span>
      </div>
    </div>

    <!-- Timeline Log -->
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

    <!-- Findings -->
    <div v-if="findings.length > 0 && !recording" class="findings-section">
      <span class="section-label">Findings ({{ findings.length }})</span>
      <div v-for="f in findings" :key="f.findingId" class="finding-card" :class="'severity-' + f.severity" @click="detailFinding = f">
        <span class="finding-severity" :class="'sev-' + f.severity">{{ f.severity === 'needs-improvement' ? 'warn' : f.severity }}</span>
        <span class="finding-title">{{ f.title }}</span>
        <span v-if="taskFindings.has(f.findingId)" class="finding-tasked-badge">tasked</span>
        <svg class="finding-chevron" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg>
      </div>
    </div>

    <!-- Package Groups (Bundle Analysis) -->
    <div v-if="packageGroups.length > 0 && !recording" class="collapsible-section">
      <button class="collapse-toggle" @click="showPackages = !showPackages">
        <svg :class="{ rotated: showPackages }" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg>
        Packages ({{ packageGroups.length }})
      </button>
      <div v-if="showPackages" class="resource-table">
        <div class="resource-header">
          <span class="res-name">Package</span>
          <span class="res-type">Modules</span>
          <span class="res-size">Size</span>
          <span class="res-dur">Alt?</span>
        </div>
        <div v-for="(pkg, i) in packageGroups.slice(0, 30)" :key="i"
             class="resource-row" :class="{ heavy: pkg.totalSize > 100 * 1024 }">
          <span class="res-name" :title="pkg.name">{{ pkg.name }}</span>
          <span class="res-type">{{ pkg.modules }}</span>
          <span class="res-size">{{ formatBytes(pkg.totalSize) }}</span>
          <span class="res-dur pkg-alt" :title="pkg.alternative || ''">{{ pkg.alternative ? 'Yes' : '' }}</span>
        </div>
      </div>
    </div>

    <!-- Resources -->
    <div v-if="resources().length > 0 && !recording" class="collapsible-section">
      <button class="collapse-toggle" @click="showResources = !showResources">
        <svg :class="{ rotated: showResources }" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg>
        Resources ({{ resources().length }})
      </button>
      <div v-if="showResources" class="resource-table">
        <div class="resource-header">
          <span class="res-name">URL</span>
          <span class="res-type">Type</span>
          <span class="res-size">Size</span>
          <span class="res-dur">Duration</span>
        </div>
        <div v-for="(r, i) in resources().slice(0, 50)" :key="i"
             class="resource-row" :class="{ heavy: isHeavy(r) }">
          <span class="res-name" :title="r.name">{{ shortenUrl(r.name) }}</span>
          <span class="res-type">{{ r.initiatorType }}</span>
          <span class="res-size">{{ formatBytes(r.transferSize) }}</span>
          <span class="res-dur">{{ formatMs(r.duration) }}</span>
        </div>
      </div>
    </div>
  </div>

  <!-- Finding Detail Drawer -->
  <FindingDrawer
    v-if="detailFinding"
    :title="detailFinding.title"
    :severity="detailFinding.severity"
    :tasked="taskFindings.has(detailFinding.findingId)"
    @close="detailFinding = null"
    @create-task="onCreateTask(detailFinding!)"
  >
    <!-- Metric value + rating -->
    <div class="detail-hero">
      <span class="detail-hero-value">{{ detailFinding.metric === 'CLS' ? detailFinding.value.toFixed(3) : detailFinding.unit === 'bytes' ? formatBytes(detailFinding.value) : formatMs(detailFinding.value) }}</span>
      <span class="detail-hero-rating" :class="'rating-' + detailFinding.severity">{{ detailFinding.severity }}</span>
    </div>

    <!-- What this metric means -->
    <div v-if="detailFinding.metric && VITAL_DESCRIPTIONS[detailFinding.metric]" class="detail-section">
      <span class="detail-label">What this means</span>
      <p class="detail-text">{{ VITAL_DESCRIPTIONS[detailFinding.metric] }}</p>
    </div>
    <div v-else class="detail-section">
      <span class="detail-label">Detail</span>
      <p class="detail-text">{{ detailFinding.detail }}</p>
    </div>

    <!-- Thresholds -->
    <div v-if="detailFinding.metric" class="detail-section">
      <span class="detail-label">Thresholds</span>
      <div class="detail-thresholds">
        <div class="threshold-row">
          <span class="threshold-bar good" />
          <span class="threshold-label">Good</span>
          <span class="threshold-value">{{ detailFinding.metric === 'CLS' ? '\u22640.1' : '\u2264' + ({ LCP: '2.5s', FCP: '1.8s', INP: '200ms', TTFB: '800ms' }[detailFinding.metric] || '') }}</span>
        </div>
        <div class="threshold-row">
          <span class="threshold-bar warn" />
          <span class="threshold-label">Needs improvement</span>
          <span class="threshold-value">{{ detailFinding.metric === 'CLS' ? '0.1\u20130.25' : ({ LCP: '2.5\u20134s', FCP: '1.8\u20133s', INP: '200\u2013500ms', TTFB: '0.8\u20131.8s' }[detailFinding.metric] || '') }}</span>
        </div>
        <div class="threshold-row">
          <span class="threshold-bar poor" />
          <span class="threshold-label">Poor</span>
          <span class="threshold-value">{{ detailFinding.metric === 'CLS' ? '>0.25' : '>' + ({ LCP: '4s', FCP: '3s', INP: '500ms', TTFB: '1.8s' }[detailFinding.metric] || '') }}</span>
        </div>
      </div>
    </div>

    <!-- How to fix -->
    <div v-if="detailFinding.metric && VITAL_FIXES[detailFinding.metric]" class="detail-section">
      <span class="detail-label">How to improve</span>
      <ul class="detail-fixes">
        <li v-for="(fix, i) in VITAL_FIXES[detailFinding.metric]" :key="i">{{ fix }}</li>
      </ul>
    </div>

    <!-- Heavy resources -->
    <div v-if="detailFinding.resources && detailFinding.resources.length > 0" class="detail-section">
      <span class="detail-label">Affected resources ({{ detailFinding.resources.length }})</span>
      <div v-for="(r, i) in detailFinding.resources" :key="i" class="detail-resource">
        <span class="detail-resource-name" :title="r.name">{{ shortenUrl(r.name) }}</span>
        <span class="detail-resource-meta">{{ formatBytes(r.size) }} &middot; {{ formatMs(r.duration) }}</span>
      </div>
    </div>

    <!-- Long task detail -->
    <div v-if="detailFinding.category === 'long-task'" class="detail-section">
      <span class="detail-label">What are long tasks?</span>
      <p class="detail-text">Tasks that block the main thread for over 50ms prevent the browser from responding to user input. Total Blocking Time (TBT) is the sum of the blocking portion (duration minus 50ms) of each long task.</p>
      <span class="detail-label" style="margin-top:8px">How to improve</span>
      <ul class="detail-fixes">
        <li>Break up long synchronous operations with setTimeout or requestIdleCallback</li>
        <li>Move heavy computation to Web Workers</li>
        <li>Code-split and lazy-load non-critical JavaScript</li>
        <li>Defer third-party scripts with async or defer attributes</li>
      </ul>
    </div>

    <!-- Bundle detail -->
    <div v-if="detailFinding.category === 'bundle'" class="detail-section">
      <span class="detail-label">How to improve</span>
      <ul class="detail-fixes">
        <li>Check if you're importing the full package when you only need a few functions</li>
        <li>Use tree-shakeable ESM imports (import { x } from 'pkg') instead of default imports</li>
        <li>Consider lighter alternatives if available</li>
        <li>Use dynamic import() for packages only needed on specific routes</li>
      </ul>
    </div>

    <!-- Resource detail -->
    <div v-if="detailFinding.category === 'resource' && !detailFinding.metric" class="detail-section">
      <span class="detail-label">How to improve</span>
      <ul class="detail-fixes">
        <li>Compress images with modern formats (WebP, AVIF)</li>
        <li>Minify and tree-shake JavaScript bundles</li>
        <li>Enable Brotli or gzip compression on the server</li>
        <li>Lazy-load images and scripts below the fold</li>
        <li>Use a CDN for static assets</li>
      </ul>
    </div>
  </FindingDrawer>
</template>

<style scoped>
.perf-tab { display: flex; flex-direction: column; gap: 10px; }
.perf-header { display: flex; align-items: center; justify-content: space-between; }
.perf-header-left { display: flex; align-items: center; gap: 6px; }
.perf-actions { display: flex; gap: 4px; }
.section-label { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-muted); }

.score-badge { font-size: 10px; font-weight: 700; color: white; padding: 2px 6px; border-radius: 4px; min-width: 24px; text-align: center; }

.rec-btn { display: flex; align-items: center; gap: 4px; padding: 3px 10px; font-size: 10px; font-weight: 600; background: var(--surface-2); color: var(--text); border: 1px solid var(--border); border-radius: 4px; cursor: pointer; }
.rec-btn:hover { background: var(--border); }
.rec-btn.recording { background: color-mix(in srgb, var(--danger) 15%, transparent); border-color: var(--danger); color: var(--danger); }
.rec-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--danger); flex-shrink: 0; }
.rec-dot.active { animation: pulse-dot 1s infinite; }
@keyframes pulse-dot { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }

.scan-btn { padding: 3px 10px; font-size: 10px; font-weight: 600; background: var(--accent); color: var(--text-on-accent); border: none; border-radius: 4px; cursor: pointer; }
.scan-btn:disabled { opacity: 0.5; cursor: default; }
.scan-btn:hover:not(:disabled) { opacity: 0.9; }

.perf-error { font-size: 11px; color: var(--danger); padding: 6px 8px; background: color-mix(in srgb, var(--danger) 10%, transparent); border-radius: 5px; }
.perf-empty { font-size: 11px; color: var(--text-muted); padding: 12px 0; text-align: center; }
.recording-indicator { display: flex; align-items: center; gap: 6px; padding: 8px 10px; border-radius: 6px; font-size: 11px; background: color-mix(in srgb, var(--danger) 8%, transparent); color: var(--danger); border: 1px solid color-mix(in srgb, var(--danger) 20%, transparent); }
.rec-pulse { width: 8px; height: 8px; border-radius: 50%; background: var(--danger); animation: pulse-dot 1s infinite; flex-shrink: 0; }

/* Vitals */
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

/* Timeline Log */
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

/* Findings */
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

/* Detail drawer content */
.detail-hero { display: flex; align-items: baseline; gap: 10px; padding: 4px 0 8px; border-bottom: 1px solid var(--border); }
.detail-hero-value { font-size: 28px; font-weight: 700; color: var(--text); font-variant-numeric: tabular-nums; }
.detail-hero-rating { font-size: 11px; font-weight: 600; text-transform: uppercase; padding: 2px 8px; border-radius: 4px; }
.detail-hero-rating.rating-good { background: color-mix(in srgb, var(--success) 15%, transparent); color: var(--success); }
.detail-hero-rating.rating-needs-improvement { background: color-mix(in srgb, var(--warning) 15%, transparent); color: var(--warning); }
.detail-hero-rating.rating-poor { background: color-mix(in srgb, var(--danger) 15%, transparent); color: var(--danger); }

.detail-section { display: flex; flex-direction: column; gap: 4px; }
.detail-label { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; color: var(--text-muted); }
.detail-value { font-size: 13px; color: var(--text); }
.detail-text { font-size: 12px; color: var(--text); line-height: 1.6; margin: 0; }

.detail-thresholds { display: flex; flex-direction: column; gap: 4px; }
.threshold-row { display: flex; align-items: center; gap: 8px; }
.threshold-bar { width: 4px; height: 16px; border-radius: 2px; flex-shrink: 0; }
.threshold-bar.good { background: var(--success); }
.threshold-bar.warn { background: var(--warning); }
.threshold-bar.poor { background: var(--danger); }
.threshold-label { font-size: 11px; color: var(--text); min-width: 120px; }
.threshold-value { font-size: 11px; color: var(--text-muted); font-variant-numeric: tabular-nums; }

.detail-fixes { margin: 0; padding-left: 16px; font-size: 12px; color: var(--text); line-height: 1.7; }
.detail-fixes li { margin-bottom: 2px; }
.detail-fixes li::marker { color: var(--accent); }

.detail-resource { display: flex; justify-content: space-between; align-items: baseline; padding: 4px 8px; border-radius: 4px; background: var(--surface-2); margin-top: 2px; }
.detail-resource-name { font-size: 11px; color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: ui-monospace, 'SF Mono', monospace; }
.detail-resource-meta { font-size: 10px; color: var(--text-muted); flex-shrink: 0; margin-left: 8px; }

/* Collapsible */
.collapsible-section { border-top: 1px solid var(--border); padding-top: 6px; }
.collapse-toggle { display: flex; align-items: center; gap: 4px; background: none; border: none; cursor: pointer; font-size: 10px; font-weight: 600; color: var(--text-muted); padding: 2px 0; }
.collapse-toggle:hover { color: var(--text); }
.collapse-toggle svg { transition: transform 0.15s; }
.collapse-toggle svg.rotated { transform: rotate(90deg); }

/* Resource Table */
.resource-table { margin-top: 6px; font-size: 10px; }
.resource-header, .resource-row { display: grid; grid-template-columns: 1fr 60px 60px 60px; gap: 4px; padding: 3px 0; }
.resource-header { font-weight: 700; color: var(--text-muted); border-bottom: 1px solid var(--border); text-transform: uppercase; font-size: 9px; }
.resource-row { color: var(--text); border-bottom: 1px solid rgba(255,255,255,0.04); }
.resource-row.heavy { color: var(--warning); }
.res-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.res-type { color: var(--text-muted); }
.res-size { text-align: right; }
.res-dur { text-align: right; color: var(--text-muted); }
.pkg-alt { color: var(--warning); font-weight: 600; cursor: help; }
</style>
