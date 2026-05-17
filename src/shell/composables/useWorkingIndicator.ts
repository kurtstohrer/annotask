/**
 * Working indicator for the embedded agent.
 *
 * Watches a boolean "is the agent running?" ref. While true:
 *   - shows a single static verb ("Annotasking")
 *   - tracks elapsed seconds since the run started
 * While false: returns null verb / zero seconds.
 */

import { ref, watch, type Ref } from 'vue'

const VERB = 'Annotasking'
const TICK_MS = 1000

export interface WorkingIndicator {
  verb: Ref<string | null>
  seconds: Ref<number>
}

export function useWorkingIndicator(isRunning: Ref<boolean>): WorkingIndicator {
  const verb = ref<string | null>(null)
  const seconds = ref(0)
  let startedAt = 0
  let tickTimer: ReturnType<typeof setInterval> | null = null

  function start() {
    startedAt = Date.now()
    seconds.value = 0
    verb.value = VERB
    if (tickTimer) clearInterval(tickTimer)
    tickTimer = setInterval(() => {
      seconds.value = Math.max(0, Math.floor((Date.now() - startedAt) / 1000))
    }, TICK_MS)
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

  return { verb, seconds }
}
