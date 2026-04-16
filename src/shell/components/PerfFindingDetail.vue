<script setup lang="ts">
import type { PerfFinding } from '../composables/usePerfMonitor'
import FindingDrawer from './FindingDrawer.vue'

const props = defineProps<{
  finding: PerfFinding
  tasked: boolean
}>()

defineEmits<{
  close: []
  'create-task': []
}>()

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

const THRESHOLDS_GOOD: Record<string, string> = {
  LCP: '\u22642.5s', FCP: '\u22641.8s', CLS: '\u22640.1', INP: '\u2264200ms', TTFB: '\u2264800ms',
}
const THRESHOLDS_WARN: Record<string, string> = {
  LCP: '2.5\u20134s', FCP: '1.8\u20133s', CLS: '0.1\u20130.25', INP: '200\u2013500ms', TTFB: '0.8\u20131.8s',
}
const THRESHOLDS_POOR: Record<string, string> = {
  LCP: '>4s', FCP: '>3s', CLS: '>0.25', INP: '>500ms', TTFB: '>1.8s',
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return bytes + 'B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + 'KB'
  return (bytes / (1024 * 1024)).toFixed(1) + 'MB'
}

function formatMs(ms: number): string {
  if (ms >= 1000) return (ms / 1000).toFixed(1) + 's'
  return Math.round(ms) + 'ms'
}

function shortenUrl(url: string): string {
  try { const p = new URL(url).pathname; return p.length > 50 ? '...' + p.slice(-47) : p }
  catch { return url.length > 50 ? '...' + url.slice(-47) : url }
}

function formatHero(f: PerfFinding): string {
  if (f.metric === 'CLS') return f.value.toFixed(3)
  if (f.unit === 'bytes') return formatBytes(f.value)
  return formatMs(f.value)
}
</script>

<template>
  <FindingDrawer
    :title="props.finding.title"
    :severity="props.finding.severity"
    :tasked="props.tasked"
    @close="$emit('close')"
    @create-task="$emit('create-task')"
  >
    <div class="detail-hero">
      <span class="detail-hero-value">{{ formatHero(props.finding) }}</span>
      <span class="detail-hero-rating" :class="'rating-' + props.finding.severity">{{ props.finding.severity }}</span>
    </div>

    <div v-if="props.finding.metric && VITAL_DESCRIPTIONS[props.finding.metric]" class="detail-section">
      <span class="detail-label">What this means</span>
      <p class="detail-text">{{ VITAL_DESCRIPTIONS[props.finding.metric] }}</p>
    </div>
    <div v-else class="detail-section">
      <span class="detail-label">Detail</span>
      <p class="detail-text">{{ props.finding.detail }}</p>
    </div>

    <div v-if="props.finding.metric" class="detail-section">
      <span class="detail-label">Thresholds</span>
      <div class="detail-thresholds">
        <div class="threshold-row">
          <span class="threshold-bar good" />
          <span class="threshold-label">Good</span>
          <span class="threshold-value">{{ THRESHOLDS_GOOD[props.finding.metric] || '' }}</span>
        </div>
        <div class="threshold-row">
          <span class="threshold-bar warn" />
          <span class="threshold-label">Needs improvement</span>
          <span class="threshold-value">{{ THRESHOLDS_WARN[props.finding.metric] || '' }}</span>
        </div>
        <div class="threshold-row">
          <span class="threshold-bar poor" />
          <span class="threshold-label">Poor</span>
          <span class="threshold-value">{{ THRESHOLDS_POOR[props.finding.metric] || '' }}</span>
        </div>
      </div>
    </div>

    <div v-if="props.finding.metric && VITAL_FIXES[props.finding.metric]" class="detail-section">
      <span class="detail-label">How to improve</span>
      <ul class="detail-fixes">
        <li v-for="(fix, i) in VITAL_FIXES[props.finding.metric]" :key="i">{{ fix }}</li>
      </ul>
    </div>

    <div v-if="props.finding.resources && props.finding.resources.length > 0" class="detail-section">
      <span class="detail-label">Affected resources ({{ props.finding.resources.length }})</span>
      <div v-for="(r, i) in props.finding.resources" :key="i" class="detail-resource">
        <span class="detail-resource-name" :title="r.name">{{ shortenUrl(r.name) }}</span>
        <span class="detail-resource-meta">{{ formatBytes(r.size) }} &middot; {{ formatMs(r.duration) }}</span>
      </div>
    </div>

    <div v-if="props.finding.category === 'long-task'" class="detail-section">
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

    <div v-if="props.finding.category === 'bundle'" class="detail-section">
      <span class="detail-label">How to improve</span>
      <ul class="detail-fixes">
        <li>Check if you're importing the full package when you only need a few functions</li>
        <li>Use tree-shakeable ESM imports (import { x } from 'pkg') instead of default imports</li>
        <li>Consider lighter alternatives if available</li>
        <li>Use dynamic import() for packages only needed on specific routes</li>
      </ul>
    </div>

    <div v-if="props.finding.category === 'resource' && !props.finding.metric" class="detail-section">
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
.detail-hero { display: flex; align-items: baseline; gap: 10px; padding: 4px 0 8px; border-bottom: 1px solid var(--border); }
.detail-hero-value { font-size: 28px; font-weight: 700; color: var(--text); font-variant-numeric: tabular-nums; }
.detail-hero-rating { font-size: 11px; font-weight: 600; text-transform: uppercase; padding: 2px 8px; border-radius: 4px; }
.detail-hero-rating.rating-good { background: color-mix(in srgb, var(--success) 15%, transparent); color: var(--success); }
.detail-hero-rating.rating-needs-improvement { background: color-mix(in srgb, var(--warning) 15%, transparent); color: var(--warning); }
.detail-hero-rating.rating-poor { background: color-mix(in srgb, var(--danger) 15%, transparent); color: var(--danger); }

.detail-section { display: flex; flex-direction: column; gap: 4px; }
.detail-label { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; color: var(--text-muted); }
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
</style>
