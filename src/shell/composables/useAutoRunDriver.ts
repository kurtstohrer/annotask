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
 * Queued ids run FIFO, except that a live batch chain (see `BatchChain`)
 * pulls chain-compatible ids forward so same-type tasks resume one CLI
 * session back-to-back instead of each paying a cold bootstrap.
 *
 * Drains policy: the driver claims an id by calling `consumeAutoRun(id)` —
 * if a Conversation tab is already mounted for that task, it raced us and
 * we skip. Otherwise we run headlessly. The tab can attach later mid-run
 * and observe via the live SSE stream.
 */

import { watch } from 'vue'
import { useAgentMode, consumeAutoRun } from './useAgentMode'
import { useTaskThread } from './useTaskThread'
import { useEmbeddedAgent, type ChainSessionHint } from './useEmbeddedAgent'
import { useTasks } from './useTasks'
import { useProviderSettings } from './useProviderSettings'

let started = false
let runningId: string | null = null
// Cancel hooks for in-flight headless runs, keyed by task id. A Conversation
// tab observing a headless run can't reach that run's local `aborter` (the
// driver owns a separate agent instance), so it routes a cancel through here.
const cancelHooks = new Map<string, () => void>()

/**
 * Cross-task batch chain: the CLI session left behind by the LAST headless
 * run. When the next queued task resolves to the same provider AND the same
 * task type (same composed skill prompt), its seed run resumes this session —
 * tasks 2..N of a "run pending" batch then skip the CLI bootstrap + the
 * 22-39KB skill prompt and inherit the warm repo context (files already
 * read). This is the bounded, safe version of "one session, feed tasks to
 * it": bounded because the chain recycles once the session's context passes
 * `CHAIN_RECYCLE_INPUT_TOKENS` (a long-lived session eventually costs more
 * per task than a cold spawn, and risks compaction), and safe because a
 * stale/failed resume silently falls back to a cold spawn provider-side.
 */
interface BatchChain extends ChainSessionHint {
  taskType: string
  /** Input tokens of the chain's last turn ≈ the session's context size. */
  lastInputTokens: number
}
let chain: BatchChain | null = null
/** Recycle the chain once the session context reaches this size — beyond it,
 *  cache-reading the accumulated context per task exceeds a fresh bootstrap. */
const CHAIN_RECYCLE_INPUT_TOKENS = 100_000

/** The chain hint for a task, or undefined when chaining doesn't apply
 *  (no live chain, resume disabled, different type/provider, or the chain's
 *  context has outgrown the recycle threshold). */
function chainFor(task: { type?: string }): ChainSessionHint | undefined {
  if (!chain) return undefined
  const providerSettings = useProviderSettings()
  if (providerSettings.settings.value.sessionResumeEnabled === false) return undefined
  if (String(task.type ?? '') !== chain.taskType) return undefined
  // Same provider the runner will resolve for this task type — personas can
  // pin providers per type, so this must mirror the runner's routing.
  const routed = providerSettings.resolveProviderForTaskType?.(task.type)
  const providerId = routed ? routed.providerId : providerSettings.settings.value.activeProvider
  if (providerId !== chain.providerId) return undefined
  if (chain.lastInputTokens >= CHAIN_RECYCLE_INPUT_TOKENS) return undefined
  return { sessionId: chain.sessionId, providerId: chain.providerId }
}

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
  if (runningId) {
    // Already busy; we'll re-enter when this turn finishes. Warn (don't stay
    // silent) so a stuck runningId — the failure mode where every later auto
    // task sits unstarted until the user opens its Conversation tab — is
    // diagnosable from the console instead of looking like nothing happened.
    // eslint-disable-next-line no-console
    console.warn(`[annotask:autorun] drain skipped: a run is already in flight (runningId=${runningId})`)
    return
  }

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

  // Ids that refused consumption this drain pass — manual runs owned by the
  // Conversation tab, or ids another consumer raced us for. They stay in the
  // queue (the tab consumes manual items on mount), but we must iterate past
  // them: re-reading the head after a failed consume was a tight synchronous
  // loop with no await, freezing the tab whenever "Run with agent" enqueued
  // a manual item before ConversationTab could mount and claim it.
  const skipped = new Set<string>()

  while (true) {
    const queue = useAgentMode().pendingAutoRun.value

    // Prefer a chain-compatible entry (same task type + provider as the live
    // batch session) so a mixed-type "run pending" queue still chains the
    // matching tasks back-to-back; fall back to strict FIFO. Reordering is
    // safe — queued auto tasks are independent by construction.
    let id: string | null = null
    if (chain) {
      for (const x of queue.keys()) {
        if (skipped.has(x)) continue
        const t = taskSystem.tasks.value.find((tt) => tt.id === x)
        if (t && chainFor(t)) { id = x; break }
      }
    }
    // FIFO among entries we haven't already skipped this pass.
    if (!id) {
      for (const x of queue.keys()) {
        if (!skipped.has(x)) { id = x; break }
      }
    }
    // Nothing consumable left — either the queue is empty or every remaining
    // item belongs to a different consumer. Exit; manual items are the
    // Conversation tab's to drain.
    if (!id) return

    if (!consumeAutoRun(id, ['auto'])) {
      // Either another consumer already claimed this id, or it's a manual
      // run destined for the Conversation tab. Skip it for the rest of this
      // pass and move on to the next queued id.
      // eslint-disable-next-line no-console
      console.warn(`[annotask:autorun] ${id} consumed by another consumer (likely manual run)`)
      skipped.add(id)
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
      const harvested = await runHeadless(id, description, chainFor(task))
      // The run's own session becomes the chain for the NEXT compatible task.
      // No session harvested (HTTP provider, failed run, resume-free CLI) —
      // drop the chain rather than resuming something stale.
      chain = harvested
        ? { ...harvested, taskType: String(task.type ?? '') }
        : null
      // eslint-disable-next-line no-console
      console.log(`[annotask:autorun] finished ${id}`)
    } catch (err) {
      chain = null
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

/** Session info harvested from a completed headless run, for chaining. */
interface HarvestedSession extends ChainSessionHint {
  lastInputTokens: number
}

async function runHeadless(taskId: string, prompt: string, chainSession?: ChainSessionHint): Promise<HarvestedSession | null> {
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
    //
    // Hard ceiling: a `send()` that never settles (a provider that hangs with
    // the run watchdog disabled, or an abort that fails to break the stream)
    // would pin the module-global `runningId` forever and wedge the FIFO — every
    // later auto task then sits unstarted until the user opens its Conversation
    // tab. Race the send against an absolute ceiling sized generously ABOVE the
    // user's configured run watchdog so it never pre-empts a legitimate long
    // run; on expiry abort the agent and reject so `drain`'s finally releases
    // `runningId`.
    const s = useProviderSettings().settings.value
    const watchdogMs = Math.max(s.maxRunDurationMs, s.idleTimeoutMs, 0)
    const ceilingMs = watchdogMs > 0 ? watchdogMs + 60_000 : 20 * 60_000
    let timer: ReturnType<typeof setTimeout> | null = null
    const sendPromise = agent.send(prompt, { isSeed: true, chainSession })
    // Swallow a late rejection so aborting via the ceiling doesn't surface as an
    // unhandled rejection after the race already settled.
    void sendPromise.catch(() => {})
    try {
      await Promise.race([
        sendPromise,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            agent.abort()
            reject(new Error(`headless run exceeded the ${Math.round(ceilingMs / 60_000)}-minute driver ceiling`))
          }, ceilingMs)
        }),
      ])
    } finally {
      if (timer) clearTimeout(timer)
    }
    // Harvest the run's CLI session for cross-task chaining. The last
    // session-bearing assistant turn carries the id to resume and — as its
    // usage.inputTokens — a serviceable measure of the session's context
    // size, which drives the recycle threshold.
    const msgs = thread.messages.value
    for (let i = msgs.length - 1; i >= 0; i--) {
      const m = msgs[i]
      if (m.role === 'assistant' && m.sessionId && m.providerId) {
        return { sessionId: m.sessionId, providerId: m.providerId, lastInputTokens: m.usage?.inputTokens ?? 0 }
      }
    }
    return null
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
  chain = null
  cancelHooks.clear()
}

/** Test seam — drives one drain pass directly, bypassing the watcher. */
export function drainForTests(taskSystem: ReturnType<typeof useTasks>): Promise<void> {
  return drain(taskSystem)
}
