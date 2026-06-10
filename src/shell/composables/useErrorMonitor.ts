import { ref, computed } from 'vue'
import type { Ref } from 'vue'
import type { useIframeManager } from './useIframeManager'
import type { useTasks } from './useTasks'
import type { ConsoleErrorEvent, UnhandledErrorEvent } from '../../shared/bridge-types'
import { useComponentContextCapture } from './useComponentContextCapture'

type IframeManager = ReturnType<typeof useIframeManager>
type TaskSystem = ReturnType<typeof useTasks>

export interface ErrorEntry {
  id: string
  level: 'error' | 'warn' | 'unhandled'
  message: string
  stack: string
  count: number
  firstSeen: number
  lastSeen: number
}

/**
 * Normalize a stack-derived file reference to a repo-relative path.
 *
 * Stack frames inside the iframe reference dev-server URLs
 * ("http://localhost:5173/src/App.vue"), Vite /@fs/ absolute imports, and
 * cache-busted modules ("src/App.vue?t=169..."). The server's SafeSourceFile
 * schema rejects URL-style paths and colons outright, so passing these
 * through verbatim turned every error_fix POST into a 400 that the old
 * createTask silently swallowed. Returns '' when the reference can't be
 * made repo-relative — the task is still creatable without a source anchor.
 */
export function normalizeStackFile(raw: string): string {
  if (!raw) return ''
  // Dev-server URL → path portion ("http://localhost:5173/src/App.vue" →
  // "src/App.vue"). Host may be empty (webpack-internal:///...).
  let f = raw.replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]*\//i, '')
  // Cache-buster / HMR query strings and fragments ("?t=169...", "?import").
  f = f.replace(/[?#].*$/, '')
  // Vite /@fs/ imports point at absolute filesystem paths. The shell can't
  // map those back under the repo root, so drop the anchor entirely.
  if (/^\/?@fs\//.test(f)) return ''
  // Leading "./" and "/" — server paths are repo-relative.
  f = f.replace(/^(\.\/)+/, '').replace(/^\/+/, '')
  // Anything still scheme- or URL-shaped ("node:internal/...", "data:...")
  // would 400 against SafeSourceFile — better no anchor than a failed task.
  if (f.includes(':') || f.includes('//')) return ''
  return f
}

export function useErrorMonitor(
  iframe: IframeManager,
  taskSystem: TaskSystem,
  currentRoute: Ref<string>,
) {
  const MAX_ERRORS = 256
  const errors = ref<ErrorEntry[]>([])
  const errorById = new Map<string, ErrorEntry>()
  const paused = ref(false)
  const componentContextCapture = useComponentContextCapture(iframe)

  /** Insert a new entry at the head while keeping the buffer bounded.
   *  Drops the oldest entries (and their dedup keys) once we exceed MAX_ERRORS. */
  function pushEntry(entry: ErrorEntry) {
    errors.value.unshift(entry)
    if (errors.value.length > MAX_ERRORS) {
      const trimmed = errors.value.splice(MAX_ERRORS)
      for (const t of trimmed) errorById.delete(t.id)
    }
  }

  /** Strip prop values from Vue component traces to avoid massive serialized data.
   *  "at <Pill label=\"Ice Giant\" color=\"blue\" ... >" → "at <Pill>" */
  function stripTraceProps(msg: string): string {
    return msg.replace(/<(\w[\w-]*)\s[^>]*>/g, '<$1>')
  }

  /** Dedupe key: level + message + first stack frame */
  function dedupKey(level: 'error' | 'warn' | 'unhandled', message: string, stack: string): string {
    let firstFrame = ''
    if (stack) {
      const lines = stack.split('\n')
      for (const l of lines) {
        const trimmed = l.trim()
        if (trimmed && trimmed !== message && (trimmed.startsWith('at ') || trimmed.includes('@'))) {
          firstFrame = trimmed
          break
        }
      }
    }
    return `${level}||${message}||${firstFrame}`
  }

  function handleConsoleError(data: ConsoleErrorEvent) {
    if (paused.value) return
    const message = stripTraceProps(data.message)
    const key = dedupKey(data.level, message, data.stack)
    const existing = errorById.get(key)
    if (existing) {
      existing.count = data.count
      existing.lastSeen = data.timestamp
    } else {
      const entry: ErrorEntry = {
        id: key,
        level: data.level,
        message,
        stack: data.stack,
        count: data.count,
        firstSeen: data.timestamp,
        lastSeen: data.timestamp,
      }
      errorById.set(key, entry)
      pushEntry(entry)
    }
  }

  function handleUnhandledError(data: UnhandledErrorEvent) {
    if (paused.value) return
    const level = 'unhandled' as const
    const message = stripTraceProps(data.message)
    const key = dedupKey(level, message, data.stack)
    const existing = errorById.get(key)
    if (existing) {
      existing.count++
      existing.lastSeen = data.timestamp
    } else {
      const entry: ErrorEntry = {
        id: key,
        level,
        message,
        stack: data.stack,
        count: 1,
        firstSeen: data.timestamp,
        lastSeen: data.timestamp,
      }
      errorById.set(key, entry)
      pushEntry(entry)
    }
  }

  function init() {
    iframe.onBridgeEvent('error:console', handleConsoleError)
    iframe.onBridgeEvent('error:unhandled', handleUnhandledError)
  }

  function clearErrors() {
    errors.value = []
    errorById.clear()
  }

  const errorCount = computed(() => errors.value.filter(e => e.level === 'error' || e.level === 'unhandled').length)
  const warnCount = computed(() => errors.value.filter(e => e.level === 'warn').length)

  /** Set of error IDs that already have tasks */
  const taskErrorIds = computed(() => {
    const ids = new Set<string>()
    for (const t of taskSystem.tasks.value) {
      if (t.type === 'error_fix' && t.context?.errorId) ids.add(t.context.errorId as string)
    }
    return ids
  })

  async function createErrorTask(entry: ErrorEntry) {
    const shortMsg = entry.message.length > 100 ? entry.message.slice(0, 100) + '...' : entry.message
    const title = entry.level === 'warn'
      ? `Fix warning: ${shortMsg}`
      : `Fix error: ${shortMsg}`

    // Try to extract file/line from stack
    let file = ''
    let line = 0
    let component = ''
    if (entry.stack) {
      // Match patterns like "at Component (file.vue:42:10)" or "file.vue:42:10"
      const match = entry.stack.match(/(?:at\s+(\w+)\s+\()?([^\s()]+\.\w+):(\d+)/)
      if (match) {
        component = match[1] || ''
        // Stack frames carry dev-server URLs, not repo paths — normalize or
        // drop the anchor so the POST passes SafeSourceFile validation.
        file = normalizeStackFile(match[2] || '')
        line = file ? parseInt(match[3], 10) || 0 : 0
      }
    }

    const colorScheme = await iframe.getColorScheme()
    const frag = componentContextCapture.fromSource(component, file, line)

    // Return the result so callers can distinguish success from a rejected
    // POST (createTask now reports failures via useTasks().lastError).
    return taskSystem.createTask({
      type: 'error_fix',
      description: title,
      file,
      line,
      component,
      route: currentRoute.value,
      ...(colorScheme ? { color_scheme: colorScheme } : {}),
      context: {
        errorId: entry.id,
        level: entry.level,
        message: entry.message,
        stack: entry.stack,
        occurrences: entry.count,
        ...(frag.component ? { component: frag.component } : {}),
      },
    })
  }

  return {
    errors,
    errorCount,
    warnCount,
    paused,
    taskErrorIds,
    init,
    clearErrors,
    createErrorTask,
  }
}
