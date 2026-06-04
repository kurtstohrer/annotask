/**
 * Working indicator for the embedded agent.
 *
 * Watches a boolean "is the agent running?" ref. While true:
 *   - shows a single static verb ("Annotasking")
 *   - tracks elapsed seconds since the run started
 * While false: returns null verb / zero seconds.
 *
 * The elapsed count anchors to an optional `startedAt` timestamp ref. Pass the
 * persisted run-start (the partial assistant message's `ts`) so the timer
 * survives a tab remount and is correct for a tab that attached mid-run —
 * without it, the count would reset to 0 on every mount. When no anchor is
 * supplied (e.g. an external skill/MCP run that creates no partial message)
 * it falls back to "now" at the moment the run was observed.
 */

import { ref, watch, type Ref } from 'vue'

const VERB = 'Annotasking'
const TICK_MS = 1000

export interface WorkingIndicator {
  verb: Ref<string | null>
  seconds: Ref<number>
}

export function useWorkingIndicator(
  isRunning: Ref<boolean>,
  startedAt?: Ref<number | null>,
): WorkingIndicator {
  const verb = ref<string | null>(null)
  const seconds = ref(0)
  let tickTimer: ReturnType<typeof setInterval> | null = null
  // Fallback anchor for runs with no persisted start (set at observe time).
  let fallbackStart = 0

  function anchor(): number {
    const persisted = startedAt?.value
    if (typeof persisted === 'number' && persisted > 0) return persisted
    return fallbackStart || Date.now()
  }

  function tick() {
    seconds.value = Math.max(0, Math.floor((Date.now() - anchor()) / 1000))
  }

  function start() {
    fallbackStart = Date.now()
    verb.value = VERB
    tick()
    if (tickTimer) clearInterval(tickTimer)
    tickTimer = setInterval(tick, TICK_MS)
  }

  function stop() {
    if (tickTimer) { clearInterval(tickTimer); tickTimer = null }
    verb.value = null
    seconds.value = 0
  }

  watch(isRunning, (next) => {
    if (next) start()
    else stop()
  }, { immediate: true })

  // If the persisted anchor resolves after the run was already observed
  // (snapshot loads a beat after mount), recompute immediately.
  if (startedAt) {
    watch(startedAt, () => { if (verb.value) tick() })
  }

  return { verb, seconds }
}
