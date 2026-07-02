/**
 * Cross-task session chaining in the auto-run driver.
 *
 * Pins the batch contract: after a headless run leaves a CLI session behind,
 * the NEXT queued task of the same type + provider receives it as
 * `chainSession` (skipping the cold bootstrap), a different-type task does
 * NOT, and a chain whose session context passed the recycle threshold is
 * dropped instead of resumed. useEmbeddedAgent/useTaskThread are mocked —
 * the driver's scheduling + harvest logic is what's under test.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ref, shallowRef } from 'vue'
import type { ThreadMessage } from '../useTaskThread'

vi.mock('../useProviderSettings', async () => {
  const { ref } = await import('vue')
  return {
    useProviderSettings: () => ({
      settings: ref({
        embeddedAgentEnabled: true,
        sessionResumeEnabled: true,
        activeProvider: 'claude-local',
        maxRunDurationMs: 0,
        idleTimeoutMs: 0,
      }),
      ready: ref(true),
      resolveProviderForTaskType: () => ({ providerId: 'claude-local' }),
    }),
  }
})

// One shared stub thread per runHeadless call. The fake agent's send() plants
// an assistant message carrying the session id + usage the driver should
// harvest — scripted per run via `plannedRuns`.
interface PlannedRun {
  sessionId?: string
  inputTokens?: number
}
const plannedRuns: PlannedRun[] = []
const sendCalls: Array<{ prompt: string; opts?: { isSeed?: boolean; chainSession?: { sessionId: string; providerId: string } } }> = []

const threads: Array<{ messages: ReturnType<typeof shallowRef<ThreadMessage[]>> }> = []
vi.mock('../useTaskThread', () => ({
  useTaskThread: () => {
    const messages = shallowRef<ThreadMessage[]>([])
    const t = {
      taskId: ref<string | null>(null),
      messages,
      status: ref('live'),
      error: ref(null),
      lastId: ref(null),
      open: vi.fn(async (id: string) => { t.taskId.value = id }),
      close: vi.fn(),
      append: vi.fn(),
      update: vi.fn(),
    }
    threads.push(t as never)
    return t
  },
}))

vi.mock('../useEmbeddedAgent', () => ({
  useEmbeddedAgent: (thread: { messages: { value: ThreadMessage[] } }) => ({
    send: vi.fn(async (prompt: string, opts?: { isSeed?: boolean; chainSession?: { sessionId: string; providerId: string } }) => {
      sendCalls.push({ prompt, opts })
      const plan = plannedRuns.shift() ?? {}
      if (plan.sessionId) {
        thread.messages.value = [...thread.messages.value, {
          id: `m-${sendCalls.length}`,
          ts: 1,
          role: 'assistant',
          content: 'done',
          providerId: 'claude-local',
          sessionId: plan.sessionId,
          usage: { inputTokens: plan.inputTokens ?? 1000, outputTokens: 50 },
        }]
      }
    }),
    abort: vi.fn(),
  }),
}))

import { resetAutoRunDriverForTests, drainForTests } from '../useAutoRunDriver'
import { useAgentMode, requestAutoRun, consumeAutoRun } from '../useAgentMode'

function taskSystemWith(tasks: Array<Record<string, unknown>>) {
  return { tasks: ref(tasks) } as unknown as Parameters<typeof drainForTests>[0]
}

beforeEach(() => {
  resetAutoRunDriverForTests()
  const { pendingAutoRun } = useAgentMode()
  for (const id of [...pendingAutoRun.value.keys()]) consumeAutoRun(id)
  plannedRuns.length = 0
  sendCalls.length = 0
  threads.length = 0
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

describe('auto-run batch chaining', () => {
  it('passes the previous run session to the next same-type task, none to the first', async () => {
    const tasks = [
      { id: 'task-a', type: 'a11y_fix', description: 'fix contrast' },
      { id: 'task-b', type: 'a11y_fix', description: 'fix labels' },
    ]
    plannedRuns.push({ sessionId: 'sess-A' }, { sessionId: 'sess-B' })
    requestAutoRun('task-a')
    requestAutoRun('task-b')

    await drainForTests(taskSystemWith(tasks))

    expect(sendCalls).toHaveLength(2)
    expect(sendCalls[0].opts?.chainSession).toBeUndefined()
    expect(sendCalls[1].opts?.chainSession).toEqual({ sessionId: 'sess-A', providerId: 'claude-local' })
  })

  it('does not chain across task types (different composed system prompt)', async () => {
    const tasks = [
      { id: 'task-a', type: 'a11y_fix', description: 'fix contrast' },
      { id: 'task-b', type: 'perf_fix', description: 'shrink bundle' },
    ]
    plannedRuns.push({ sessionId: 'sess-A' }, { sessionId: 'sess-B' })
    requestAutoRun('task-a')
    requestAutoRun('task-b')

    await drainForTests(taskSystemWith(tasks))

    expect(sendCalls).toHaveLength(2)
    expect(sendCalls[1].opts?.chainSession).toBeUndefined()
  })

  it('pulls a chain-compatible task forward past a mismatched FIFO head', async () => {
    const tasks = [
      { id: 'task-a', type: 'a11y_fix', description: 'fix contrast' },
      { id: 'task-b', type: 'perf_fix', description: 'shrink bundle' },
      { id: 'task-c', type: 'a11y_fix', description: 'fix labels' },
    ]
    plannedRuns.push({ sessionId: 'sess-A' }, { sessionId: 'sess-C' }, { sessionId: 'sess-B' })
    requestAutoRun('task-a')
    requestAutoRun('task-b')
    requestAutoRun('task-c')

    await drainForTests(taskSystemWith(tasks))

    // a runs first (FIFO); c jumps b to reuse a's session; b runs cold last.
    expect(sendCalls.map((c) => c.prompt)).toEqual(['fix contrast', 'fix labels', 'shrink bundle'])
    expect(sendCalls[1].opts?.chainSession).toEqual({ sessionId: 'sess-A', providerId: 'claude-local' })
    expect(sendCalls[2].opts?.chainSession).toBeUndefined()
  })

  it('recycles the chain once the session context passes the threshold', async () => {
    const tasks = [
      { id: 'task-a', type: 'a11y_fix', description: 'fix contrast' },
      { id: 'task-b', type: 'a11y_fix', description: 'fix labels' },
    ]
    // First run leaves a session whose last turn ingested 150K input tokens —
    // past the 100K recycle threshold, so task-b must start cold.
    plannedRuns.push({ sessionId: 'sess-A', inputTokens: 150_000 }, { sessionId: 'sess-B' })
    requestAutoRun('task-a')
    requestAutoRun('task-b')

    await drainForTests(taskSystemWith(tasks))

    expect(sendCalls).toHaveLength(2)
    expect(sendCalls[1].opts?.chainSession).toBeUndefined()
  })

  it('drops the chain when a run leaves no session behind', async () => {
    const tasks = [
      { id: 'task-a', type: 'a11y_fix', description: 'fix contrast' },
      { id: 'task-b', type: 'a11y_fix', description: 'fix labels' },
    ]
    plannedRuns.push({ /* no session harvested */ }, { sessionId: 'sess-B' })
    requestAutoRun('task-a')
    requestAutoRun('task-b')

    await drainForTests(taskSystemWith(tasks))

    expect(sendCalls).toHaveLength(2)
    expect(sendCalls[1].opts?.chainSession).toBeUndefined()
  })
})
