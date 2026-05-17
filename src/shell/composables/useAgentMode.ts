/**
 * Agent-mode auto-run queue.
 *
 * When the user creates a task with `agentMode` enabled and a ready
 * provider, `useTaskWorkflows` enqueues the task id here. App.vue watches
 * the queue and opens the task detail modal at the Conversation tab. The
 * Conversation tab itself drains the queue on mount and fires the first
 * `send()` with the task description, so the user sees the agent start
 * working as soon as the modal opens.
 *
 * Singleton — the queue is process-global within the shell. Drained once
 * per task id (consume returns true once and then forgets it).
 *
 * Why a queue rather than a single ref: two creation flows could race
 * (e.g. a stylesheet change that mints multiple tasks). One id at a time
 * is the dominant case, but the Set handles overlap without cross-talk.
 */

import { ref } from 'vue'

const pendingAutoRun = ref<Set<string>>(new Set())

/**
 * Task ids that currently have an in-flight agent turn. Different from
 * `task.status === 'in_progress'` — the agent doesn't always update the
 * task's status field, especially in chat-only flows. TaskCard reads this
 * set to render the live-activity dot independently of status.
 */
const activeRuns = ref<Set<string>>(new Set())

/** Mark a task as having an active agent run. Idempotent. */
export function markRunStarted(taskId: string): void {
  if (!taskId) return
  if (activeRuns.value.has(taskId)) return
  const next = new Set(activeRuns.value)
  next.add(taskId)
  activeRuns.value = next
}

/** Clear the active-run flag. Safe to call multiple times. */
export function markRunFinished(taskId: string): void {
  if (!activeRuns.value.has(taskId)) return
  const next = new Set(activeRuns.value)
  next.delete(taskId)
  activeRuns.value = next
}

/** Schedule a task for auto-run. Idempotent. */
export function requestAutoRun(taskId: string): void {
  if (!taskId) return
  if (pendingAutoRun.value.has(taskId)) return
  const next = new Set(pendingAutoRun.value)
  next.add(taskId)
  pendingAutoRun.value = next
}

/**
 * Atomically check-and-clear. Returns true if the task was queued (and the
 * caller now owns running it). Subsequent calls for the same id return false.
 */
export function consumeAutoRun(taskId: string): boolean {
  if (!pendingAutoRun.value.has(taskId)) return false
  const next = new Set(pendingAutoRun.value)
  next.delete(taskId)
  pendingAutoRun.value = next
  return true
}

/**
 * Reactive accessors. The auto-run queue feeds the silent driver; the
 * activeRuns set feeds the live-activity dot on task cards.
 */
export function useAgentMode() {
  return {
    pendingAutoRun,
    requestAutoRun,
    consumeAutoRun,
    activeRuns,
    markRunStarted,
    markRunFinished,
  }
}
