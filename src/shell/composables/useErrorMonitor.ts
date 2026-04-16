import { ref, computed } from 'vue'
import type { Ref } from 'vue'
import type { useIframeManager } from './useIframeManager'
import type { useTasks } from './useTasks'
import type { ConsoleErrorEvent, UnhandledErrorEvent } from '../../shared/bridge-types'

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

export function useErrorMonitor(
  iframe: IframeManager,
  taskSystem: TaskSystem,
  currentRoute: Ref<string>,
) {
  const MAX_ERRORS = 256
  const errors = ref<ErrorEntry[]>([])
  const errorById = new Map<string, ErrorEntry>()
  const paused = ref(false)

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
        file = match[2] || ''
        line = parseInt(match[3], 10) || 0
      }
    }

    const colorScheme = await iframe.getColorScheme()

    taskSystem.createTask({
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
