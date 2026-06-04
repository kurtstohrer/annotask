/**
 * Silent auto-run driver.
 *
 * Mounted once at the app root. Watches `useAgentMode().pendingAutoRun` and,
 * whenever a task id appears, runs the embedded agent against it without
 * opening any modal. The driver owns its own headless `useTaskThread` +
 * `useEmbeddedAgent` pair per task — the user's open Conversation tab (if
 * any) subscribes to the same persisted thread via SSE, so they see the
 * work-stream live without being interrupted.
 *
 * Concurrency cap: 1. Local CLIs (claude/codex/opencode) consume real CPU
 * and may grab file locks; serializing keeps cross-task chaos out of v1.
 * Queued ids run FIFO.
 *
 * Drains policy: the driver claims an id by calling `consumeAutoRun(id)` —
 * if a Conversation tab is already mounted for that task, it raced us and
 * we skip. Otherwise we run headlessly. The tab can attach later mid-run
 * and observe via the live SSE stream.
 */

import { watch } from 'vue'
import { useAgentMode, consumeAutoRun } from './useAgentMode'
import { useTaskThread } from './useTaskThread'
import { useEmbeddedAgent } from './useEmbeddedAgent'
import { useTasks } from './useTasks'
import { useProviderSettings } from './useProviderSettings'

let started = false
let runningId: string | null = null
// Cancel hooks for in-flight headless runs, keyed by task id. A Conversation
// tab observing a headless run can't reach that run's local `aborter` (the
// driver owns a separate agent instance), so it routes a cancel through here.
const cancelHooks = new Map<string, () => void>()

export function startAutoRunDriver(): void {
  if (started) return
  started = true

  const agentMode = useAgentMode()
  const taskSystem = useTasks()

  watch(
    agentMode.pendingAutoRun,
    () => { void drain(taskSystem) },
    { immediate: true },
  )
}

async function drain(taskSystem: ReturnType<typeof useTasks>): Promise<void> {
  if (runningId) return // already busy; we'll re-enter when this turn finishes

  // Skip the entire drain when the user is in skill/MCP mode. Tasks may
  // still enqueue (older code paths, tests), but the driver should not
  // spawn anything embedded. The queue stays put so flipping the toggle
  // back on doesn't lose work.
  const providerSettings = useProviderSettings()
  if (providerSettings.settings.value.embeddedAgentEnabled !== true) {
    // eslint-disable-next-line no-console
    console.warn('[annotask:autorun] drain skipped: embeddedAgentEnabled is not true')
    return
  }

  while (true) {
    const queue = useAgentMode().pendingAutoRun.value
    if (queue.size === 0) return

    // FIFO: take the first id in insertion order.
    let id: string | null = null
    for (const x of queue.keys()) { id = x; break }
    if (!id) return

    if (!consumeAutoRun(id, ['auto'])) {
      // Either another consumer already claimed this id, or it's a manual
      // run destined for the Conversation tab. Move on.
      // eslint-disable-next-line no-console
      console.warn(`[annotask:autorun] ${id} consumed by another consumer (likely manual run)`)
      continue
    }

    const task = taskSystem.tasks.value.find((t) => t.id === id)
    if (!task) {
      // Task vanished before we could run it (deleted?). Drop and continue.
      // eslint-disable-next-line no-console
      console.warn(`[annotask:autorun] ${id} not in tasks.value — dropping`)
      continue
    }

    const description = (task.description ?? '').trim()
    if (!description) {
      // eslint-disable-next-line no-console
      console.warn(`[annotask:autorun] ${id} has empty description — dropping`)
      continue
    }

    runningId = id
    // eslint-disable-next-line no-console
    console.log(`[annotask:autorun] starting ${id}`)
    try {
      await runHeadless(id, description)
      // eslint-disable-next-line no-console
      console.log(`[annotask:autorun] finished ${id}`)
    } catch (err) {
      // Without this catch, errors bubble through the `void drain(...)`
      // call in the watcher and vanish into unhandled-promise-rejection
      // limbo — leaving the user with a task stuck "running" and no UI
      // indication that anything went wrong.
      // eslint-disable-next-line no-console
      console.error(`[annotask:autorun] ${id} failed:`, err)
    } finally {
      runningId = null
    }
  }
}

async function runHeadless(taskId: string, prompt: string): Promise<void> {
  // Fresh thread + agent instance per run. The composables don't use
  // lifecycle hooks so they're safe to construct outside a component.
  const thread = useTaskThread()
  try {
    await thread.open(taskId)
    const agent = useEmbeddedAgent(thread)
    // Register a cancel hook so an observer tab can abort this headless run.
    cancelHooks.set(taskId, () => agent.abort())
    // Seed run — agent treats this prompt as its objective. On clean
    // completion the composable flips the task to `review`.
    await agent.send(prompt, { isSeed: true })
  } finally {
    cancelHooks.delete(taskId)
    thread.close()
  }
}

/**
 * Cancel an in-flight headless auto-run for a task. Returns true if a run was
 * found and asked to abort. Safe to call when nothing is running (no-op).
 */
export function requestAutoRunCancel(taskId: string): boolean {
  const hook = cancelHooks.get(taskId)
  if (!hook) return false
  hook()
  return true
}

/** Test seam — resets the singleton so unit tests can re-arm the driver. */
export function resetAutoRunDriverForTests(): void {
  started = false
  runningId = null
  cancelHooks.clear()
}
