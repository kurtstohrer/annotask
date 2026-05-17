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

let started = false
let runningId: string | null = null

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

  while (true) {
    const queue = useAgentMode().pendingAutoRun.value
    if (queue.size === 0) return

    // FIFO: take the first id in insertion order.
    let id: string | null = null
    for (const x of queue) { id = x; break }
    if (!id) return

    if (!consumeAutoRun(id)) {
      // Another consumer (typically a ConversationTab that mounted faster)
      // already claimed this id. Move on.
      continue
    }

    const task = taskSystem.tasks.value.find((t) => t.id === id)
    if (!task) {
      // Task vanished before we could run it (deleted?). Drop and continue.
      continue
    }

    const description = (task.description ?? '').trim()
    if (!description) continue

    runningId = id
    try {
      await runHeadless(id, description)
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
    // Seed run — agent treats this prompt as its objective. On clean
    // completion the composable flips the task to `review`.
    await agent.send(prompt, { isSeed: true })
  } finally {
    thread.close()
  }
}

/** Test seam — resets the singleton so unit tests can re-arm the driver. */
export function resetAutoRunDriverForTests(): void {
  started = false
  runningId = null
}
