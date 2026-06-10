import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ref } from 'vue'

// drain() consults provider settings before touching the queue — force
// embedded mode on so the regression tests exercise the queue loop itself
// rather than the early-exit guard.
vi.mock('../useProviderSettings', async () => {
  const { ref } = await import('vue')
  return {
    useProviderSettings: () => ({
      settings: ref({ embeddedAgentEnabled: true }),
      ready: ref(true),
    }),
  }
})

import { requestAutoRunCancel, resetAutoRunDriverForTests, drainForTests } from '../useAutoRunDriver'
import { useAgentMode, requestAutoRun, consumeAutoRun } from '../useAgentMode'

function fakeTaskSystem() {
  // drain only reads tasks.value.find — an empty list sends consumed ids
  // down the "not in tasks.value — dropping" path, so no headless run spawns.
  return { tasks: ref([]) } as unknown as Parameters<typeof drainForTests>[0]
}

describe('useAutoRunDriver cancel registry', () => {
  beforeEach(() => {
    resetAutoRunDriverForTests()
  })

  it('requestAutoRunCancel is a harmless no-op when no headless run is registered', () => {
    // ConversationTab.cancelRun() always calls this alongside agent.abort();
    // when the run is a local (non-headless) one or nothing is running, it
    // must report false and do nothing rather than throw.
    expect(requestAutoRunCancel('task-not-running')).toBe(false)
  })

  it('reset clears the registry so a stale hook never fires for a reused id', () => {
    expect(requestAutoRunCancel('task-1')).toBe(false)
    resetAutoRunDriverForTests()
    expect(requestAutoRunCancel('task-1')).toBe(false)
  })
})

describe('useAutoRunDriver drain', () => {
  beforeEach(() => {
    resetAutoRunDriverForTests()
    // The auto-run queue is a module singleton — flush leftovers so each
    // test starts from an empty queue.
    const { pendingAutoRun } = useAgentMode()
    for (const id of [...pendingAutoRun.value.keys()]) consumeAutoRun(id)
    vi.restoreAllMocks()
  })

  it('returns instead of busy-looping when the only queued item is a manual run', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    requestAutoRun('task-manual', 'manual')

    // Regression: consumeAutoRun(id, ['auto']) refuses manual items WITHOUT
    // removing them. Before the skip-set fix, drain re-read the same queue
    // head and `continue`d with no await — a tight synchronous loop that
    // froze the tab whenever "Run with agent" enqueued a manual item before
    // ConversationTab could mount and claim it. This await never resolved.
    await drainForTests(fakeTaskSystem())

    // The manual item must stay queued for the Conversation tab to claim…
    expect(useAgentMode().pendingAutoRun.value.get('task-manual')).toBe('manual')
    // …and drain must have skipped it exactly once, not spun on it.
    const manualWarns = warnSpy.mock.calls.filter((c) => String(c[0]).includes('task-manual'))
    expect(manualWarns).toHaveLength(1)
  })

  it('skips past a manual head and still processes a later auto item', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    requestAutoRun('task-manual', 'manual')
    requestAutoRun('task-auto', 'auto')

    await drainForTests(fakeTaskSystem())

    const queue = useAgentMode().pendingAutoRun.value
    // The auto item behind the manual head was consumed (then dropped —
    // its task isn't in tasks.value)…
    expect(queue.has('task-auto')).toBe(false)
    // …while the manual one survived for the Conversation tab.
    expect(queue.get('task-manual')).toBe('manual')
  })
})
