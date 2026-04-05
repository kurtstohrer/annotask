import { ref, computed } from 'vue'
import type { Ref } from 'vue'
import type { useIframeManager } from './useIframeManager'
import type { useTasks } from './useTasks'
import type { PerfScanResult, PerfRecording, PerfTimelineEvent, WebVitalMetric } from '../../shared/bridge-types'
import type { PerformanceSnapshot } from '../../schema'

type IframeManager = ReturnType<typeof useIframeManager>
type TaskSystem = ReturnType<typeof useTasks>

/** A group of perf events associated with a user action */
export interface TimelineAction {
  time: number
  label: string
  events: PerfTimelineEvent[]
  longTaskMs: number
  shiftCount: number
  shiftValue: number
  hasIssues: boolean
}

export interface PerfFinding {
  findingId: string
  category: 'vital' | 'resource' | 'long-task' | 'bundle'
  severity: 'good' | 'needs-improvement' | 'poor'
  title: string
  detail: string
  value: number
  unit: string
  metric?: string
  resources?: Array<{ name: string; size: number; duration: number }>
}

/** Known heavy packages with lighter alternatives */
const PACKAGE_ALTERNATIVES: Record<string, string> = {
  'moment': 'dayjs (2KB vs 300KB)',
  'lodash': 'lodash-es or native methods',
  'classnames': 'clsx (smaller)',
}

/** Extract npm package name from a URL path */
function extractPackageName(url: string): string | null {
  try {
    const path = new URL(url).pathname
    // Vite pre-bundled deps: /node_modules/.vite/deps/react.js?v=abc
    const viteDeps = path.match(/\/node_modules\/\.vite\/deps\/([^.?]+)/)
    if (viteDeps) return viteDeps[1].replace(/_/g, '/')
    // Direct node_modules: /node_modules/lodash-es/debounce.js or /@fs/.../node_modules/pkg/...
    const nm = path.match(/\/node_modules\/(@[^/]+\/[^/]+|[^/]+)/)
    if (nm) return nm[1]
  } catch {}
  return null
}

export interface PackageGroup {
  name: string
  modules: number
  totalSize: number
  alternative?: string
}

const VITAL_WEIGHTS: Record<string, number> = { LCP: 25, FCP: 15, CLS: 25, INP: 25, TTFB: 10 }
const VITAL_LABELS: Record<string, string> = {
  LCP: 'Largest Contentful Paint', FCP: 'First Contentful Paint',
  CLS: 'Cumulative Layout Shift', INP: 'Interaction to Next Paint', TTFB: 'Time to First Byte',
}
const RESOURCE_SIZE_THRESHOLDS: Record<string, number> = { script: 200 * 1024, img: 500 * 1024, css: 100 * 1024, font: 200 * 1024 }

function formatMs(ms: number): string {
  if (ms >= 1000) return (ms / 1000).toFixed(1) + 's'
  return Math.round(ms) + 'ms'
}

function formatVitalValue(name: string, value: number): string {
  if (name === 'CLS') return value.toFixed(3)
  return formatMs(value)
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return bytes + 'B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + 'KB'
  return (bytes / (1024 * 1024)).toFixed(1) + 'MB'
}

function shortenUrl(url: string): string {
  try { const p = new URL(url).pathname; return p.length > 40 ? '...' + p.slice(-37) : p }
  catch { return url.length > 40 ? '...' + url.slice(-37) : url }
}

function buildSnapshot(vitals: WebVitalMetric[], resources: Array<{ initiatorType: string; transferSize: number }>, recording?: PerfRecording): PerformanceSnapshot {
  const byType: Record<string, { count: number; size: number }> = {}
  let totalSize = 0
  for (const r of resources) {
    totalSize += r.transferSize
    const t = r.initiatorType || 'other'
    if (!byType[t]) byType[t] = { count: 0, size: 0 }
    byType[t].count++
    byType[t].size += r.transferSize
  }
  let tbt = 0
  let ltCount = 0
  if (recording) {
    for (const e of recording.events) {
      if (e.type === 'long-task' && e.duration) { ltCount++; tbt += Math.max(0, e.duration - 50) }
    }
  }
  return {
    url: recording?.url || '', route: recording?.route || '', timestamp: Date.now(),
    vitals: vitals.map(v => ({ name: v.name, value: v.value, rating: v.rating })),
    navigation: recording?.navigation ? { domContentLoaded: recording.navigation.domContentLoaded, loadComplete: recording.navigation.loadComplete, ttfb: recording.navigation.ttfb } : undefined,
    resourceSummary: { totalRequests: resources.length, totalTransferSize: totalSize, byType },
    longTaskCount: ltCount, totalBlockingTime: tbt,
  }
}

/** Group raw timeline events into action windows */
function buildTimeline(events: PerfTimelineEvent[]): TimelineAction[] {
  const actions: TimelineAction[] = []
  let current: TimelineAction | null = null

  for (const e of events) {
    if (e.type === 'action' || e.type === 'navigation') {
      if (current) actions.push(current)
      current = { time: e.time, label: e.label, events: [], longTaskMs: 0, shiftCount: 0, shiftValue: 0, hasIssues: false }
    }
    if (!current) {
      current = { time: 0, label: 'Page load', events: [], longTaskMs: 0, shiftCount: 0, shiftValue: 0, hasIssues: false }
    }
    current.events.push(e)
    if (e.type === 'long-task' && e.duration) { current.longTaskMs += e.duration; current.hasIssues = true }
    if (e.type === 'layout-shift' && e.value) { current.shiftCount++; current.shiftValue += e.value; current.hasIssues = true }
  }
  if (current) actions.push(current)
  return actions
}

function readCssVar(name: string, fallback: string): string {
  try {
    const style = getComputedStyle(document.documentElement)
    return style.getPropertyValue(name).trim() || fallback
  } catch { return fallback }
}

export function usePerfMonitor(
  iframe: IframeManager,
  taskSystem: TaskSystem,
  currentRoute: Ref<string>,
) {
  // ── Recording state ──
  const recording = ref(false)
  const recordingResult = ref<PerfRecording | null>(null)
  const recordingError = ref<string | null>(null)

  // ── Scan state ──
  const scanResult = ref<PerfScanResult | null>(null)
  const scanLoading = ref(false)
  const scanError = ref<string | null>(null)
  const hasData = ref(false)

  // ── Derived ──
  const timeline = computed<TimelineAction[]>(() => {
    if (!recordingResult.value) return []
    return buildTimeline(recordingResult.value.events)
  })

  const vitals = computed<WebVitalMetric[]>(() => {
    return recordingResult.value?.vitals || scanResult.value?.vitals || []
  })

  const perfScore = computed(() => {
    const v = vitals.value
    if (v.length === 0) return { score: -1, label: 'N/A', color: readCssVar('--severity-minor', '#6b7280') }
    let tw = 0, ws = 0
    for (const m of v) {
      const w = VITAL_WEIGHTS[m.name] || 0
      if (!w) continue
      tw += w
      ws += w * (m.rating === 'good' ? 100 : m.rating === 'needs-improvement' ? 50 : 0)
    }
    if (tw === 0) return { score: -1, label: 'N/A', color: readCssVar('--severity-minor', '#6b7280') }
    const score = Math.round(ws / tw)
    return { score, label: score >= 90 ? 'Good' : score >= 50 ? 'Needs Work' : 'Poor', color: score >= 90 ? readCssVar('--success', '#22c55e') : score >= 50 ? readCssVar('--warning', '#f59e0b') : readCssVar('--danger', '#ef4444') }
  })

  /** Group resources by npm package name */
  const packageGroups = computed<PackageGroup[]>(() => {
    const resources = recordingResult.value?.resources || scanResult.value?.resources || []
    const groups: Record<string, { modules: number; totalSize: number }> = {}
    for (const r of resources) {
      if (r.initiatorType !== 'script' && r.initiatorType !== 'module') continue
      const pkg = extractPackageName(r.name)
      if (!pkg) continue
      if (!groups[pkg]) groups[pkg] = { modules: 0, totalSize: 0 }
      groups[pkg].modules++
      groups[pkg].totalSize += r.transferSize
    }
    return Object.entries(groups)
      .map(([name, g]) => ({ name, ...g, alternative: PACKAGE_ALTERNATIVES[name] }))
      .sort((a, b) => b.totalSize - a.totalSize)
  })

  const perfFindings = computed<PerfFinding[]>(() => {
    const v = vitals.value
    const resources = recordingResult.value?.resources || scanResult.value?.resources || []
    const findings: PerfFinding[] = []

    for (const m of v) {
      if (m.rating !== 'good') {
        findings.push({
          findingId: `vital:${m.name}`, category: 'vital', severity: m.rating,
          title: `${VITAL_LABELS[m.name] || m.name}: ${formatVitalValue(m.name, m.value)}`,
          detail: `${m.name} is rated "${m.rating}". Target: good.`,
          value: m.value, unit: m.name === 'CLS' ? '' : 'ms', metric: m.name,
        })
      }
    }

    const heavyByType: Record<string, Array<{ name: string; size: number; duration: number }>> = {}
    for (const r of resources) {
      const threshold = RESOURCE_SIZE_THRESHOLDS[r.initiatorType] ?? 500 * 1024
      if (r.transferSize > threshold) {
        const t = r.initiatorType || 'other'
        if (!heavyByType[t]) heavyByType[t] = []
        heavyByType[t].push({ name: r.name, size: r.transferSize, duration: r.duration })
      }
    }
    for (const [type, res] of Object.entries(heavyByType)) {
      const totalSize = res.reduce((s, r) => s + r.size, 0)
      findings.push({
        findingId: `resource:heavy-${type}`, category: 'resource', severity: 'needs-improvement',
        title: `${res.length} large ${type} resource${res.length > 1 ? 's' : ''} (${formatBytes(totalSize)})`,
        detail: res.map(r => `${shortenUrl(r.name)} — ${formatBytes(r.size)}`).join(', '),
        value: totalSize, unit: 'bytes', resources: res,
      })
    }

    // Bundle: heavy packages (>100KB)
    for (const pkg of packageGroups.value) {
      if (pkg.totalSize > 100 * 1024) {
        const alt = pkg.alternative ? ` Consider: ${pkg.alternative}.` : ''
        findings.push({
          findingId: `bundle:${pkg.name}`, category: 'bundle',
          severity: pkg.totalSize > 300 * 1024 ? 'poor' : 'needs-improvement',
          title: `${pkg.name}: ${formatBytes(pkg.totalSize)} (${pkg.modules} module${pkg.modules > 1 ? 's' : ''})`,
          detail: `Package "${pkg.name}" contributes ${formatBytes(pkg.totalSize)} to page weight.${alt}`,
          value: pkg.totalSize, unit: 'bytes',
        })
      }
    }

    // Long tasks from recording
    if (recordingResult.value) {
      const longTasks = recordingResult.value.events.filter(e => e.type === 'long-task')
      if (longTasks.length > 0) {
        const total = longTasks.reduce((s, e) => s + (e.duration || 0), 0)
        const tbt = longTasks.reduce((s, e) => s + Math.max(0, (e.duration || 0) - 50), 0)
        findings.push({
          findingId: 'blocking:long-tasks', category: 'long-task',
          severity: tbt > 600 ? 'poor' : tbt > 200 ? 'needs-improvement' : 'good',
          title: `${longTasks.length} long task${longTasks.length > 1 ? 's' : ''} (${Math.round(total)}ms total)`,
          detail: `Total Blocking Time: ${Math.round(tbt)}ms.`, value: tbt, unit: 'ms',
        })
      }
    }

    const order = { poor: 0, 'needs-improvement': 1, good: 2 }
    findings.sort((a, b) => order[a.severity] - order[b.severity])
    return findings
  })

  const perfTaskFindings = computed(() => {
    const ids = new Set<string>()
    for (const t of taskSystem.tasks.value) {
      if (t.type === 'perf_fix' && t.context?.findingId) ids.add(t.context.findingId as string)
    }
    return ids
  })

  // ── Actions ──
  function startRecording() {
    recording.value = true
    recordingResult.value = null
    recordingError.value = null
    iframe.startPerfRecording()
  }

  async function stopRecording() {
    recording.value = false
    const result = await iframe.stopPerfRecording()
    recordingResult.value = result
    recordingError.value = result.error || null
    hasData.value = true

    if (!result.error) {
      const snapshot = buildSnapshot(result.vitals, result.resources, result)
      try { fetch('/__annotask/api/performance', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(snapshot) }) } catch {}
    }
  }

  async function scanPerf() {
    scanLoading.value = true
    scanError.value = null
    const result = await iframe.scanPerf()
    scanResult.value = result
    scanError.value = result.error || null
    scanLoading.value = false
    hasData.value = true

    if (!result.error) {
      const snapshot = buildSnapshot(result.vitals, result.resources)
      try { fetch('/__annotask/api/performance', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(snapshot) }) } catch {}
    }
  }

  function createPerfTask(finding: PerfFinding) {
    const snapshot = recordingResult.value
      ? buildSnapshot(recordingResult.value.vitals, recordingResult.value.resources, recordingResult.value)
      : scanResult.value ? buildSnapshot(scanResult.value.vitals, scanResult.value.resources) : undefined
    taskSystem.createTask({
      type: 'perf_fix', description: `Improve performance: ${finding.title}`,
      file: '', line: 0, component: '', route: currentRoute.value,
      context: {
        findingId: finding.findingId, category: finding.category, severity: finding.severity,
        detail: finding.detail, value: finding.value, unit: finding.unit,
        metric: finding.metric, resources: finding.resources, metrics: snapshot,
      },
    })
  }

  return {
    recording, recordingResult, recordingError,
    scanResult, scanLoading, scanError, hasData,
    timeline, vitals, perfScore, perfFindings, perfTaskFindings, packageGroups,
    startRecording, stopRecording, scanPerf, createPerfTask,
  }
}
