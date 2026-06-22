import { describe, it, expect, vi } from 'vitest'
import { ref } from 'vue'
import { normalizeStackFile, useErrorMonitor, type ErrorEntry } from '../useErrorMonitor'
import type { useIframeManager } from '../useIframeManager'
import type { useTasks } from '../useTasks'

describe('normalizeStackFile', () => {
  // [stack-derived file reference, expected repo-relative path]
  const cases: Array<[string, string]> = [
    // Dev-server URLs (with port) lose scheme://host:port/
    ['http://localhost:5173/src/App.vue', 'src/App.vue'],
    ['https://localhost:8443/src/pages/OverviewPage.vue', 'src/pages/OverviewPage.vue'],
    // Vite cache-buster / HMR query strings are stripped
    ['http://localhost:5173/src/components/Pill.vue?t=1717171717123', 'src/components/Pill.vue'],
    ['src/main.ts?import&t=123', 'src/main.ts'],
    // /@fs/ imports point at absolute filesystem paths — no anchor possible
    ['/@fs/home/kurt/code/app/src/App.vue', ''],
    ['http://localhost:5173/@fs/home/kurt/code/app/src/App.vue', ''],
    // Plain repo-relative paths pass through; leading ./ and / are stripped
    ['src/App.vue', 'src/App.vue'],
    ['/src/App.vue', 'src/App.vue'],
    ['./src/App.vue', 'src/App.vue'],
    // webpack-internal:/// frames resolve to project-relative paths
    ['webpack-internal:///./src/App.vue', 'src/App.vue'],
    // Garbage that would 400 against SafeSourceFile drops to ''
    ['node:internal/process/task_queues.js', ''],
    ['data:text/javascript;base64,abc.js', ''],
    ['C:\\Users\\kurt\\src\\App.vue', ''],
    ['', ''],
  ]

  it.each(cases)('normalizes %j → %j', (input, expected) => {
    expect(normalizeStackFile(input)).toBe(expected)
  })
})

describe('useErrorMonitor.createErrorTask', () => {
  function makeMonitor() {
    const createTask = vi.fn(async (t: Record<string, unknown>) => ({ id: 't1', ...t }))
    const iframe = {
      onBridgeEvent: vi.fn(),
      getColorScheme: vi.fn(async () => null),
      getComponentChain: vi.fn(async () => null),
    } as unknown as ReturnType<typeof useIframeManager>
    const taskSystem = { tasks: ref([]), createTask } as unknown as ReturnType<typeof useTasks>
    const monitor = useErrorMonitor(iframe, taskSystem, ref('/'))
    return { monitor, createTask }
  }

  function entryWithStack(stack: string): ErrorEntry {
    return {
      id: 'e1', level: 'error', message: 'boom', stack,
      count: 1, firstSeen: 1, lastSeen: 1,
    }
  }

  it('normalizes dev-server URLs from the stack into repo-relative file anchors', async () => {
    const { monitor, createTask } = makeMonitor()
    await monitor.createErrorTask(entryWithStack(
      'Error: boom\n    at setup (http://localhost:5173/src/App.vue:42:10)',
    ))
    expect(createTask).toHaveBeenCalledTimes(1)
    const payload = createTask.mock.calls[0][0] as Record<string, unknown>
    // Before the fix this POSTed file="http://localhost:5173/src/App.vue",
    // which SafeSourceFile rejects with a 400 — silently.
    expect(payload.file).toBe('src/App.vue')
    expect(payload.line).toBe(42)
  })

  it('drops the anchor (file="", line=0) when the frame cannot be made repo-relative', async () => {
    const { monitor, createTask } = makeMonitor()
    await monitor.createErrorTask(entryWithStack(
      'Error: boom\n    at run (/@fs/home/kurt/code/app/src/App.vue:7:3)',
    ))
    const payload = createTask.mock.calls[0][0] as Record<string, unknown>
    // The task is still creatable — just without a source anchor.
    expect(payload.file).toBe('')
    expect(payload.line).toBe(0)
    expect(payload.type).toBe('error_fix')
  })
})
