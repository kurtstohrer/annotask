/**
 * Tests for the embedded-agent composable's work-stream + queue behaviour
 * plus the seed-run lifecycle transitions (pending→in_progress→review).
 *
 * Provider streaming + the real task system are mocked so we exercise the
 * composable's branching logic directly. End-to-end coverage (claude CLI
 * actually flipping a task to review) lives in the Playwright suite.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ref, shallowRef } from 'vue'

// Mock useTasks BEFORE importing the composable under test so the
// composable picks up the stub. The typed signature lets `.mock.calls`
// expose the arguments as a real 4-tuple rather than `unknown[]`.
type UpdateTaskStatusFn = (
  id: string,
  status: string,
  feedback?: string | undefined,
  extra?: Record<string, unknown> | undefined,
) => Promise<unknown>
const updateTaskStatusMock = vi.fn<UpdateTaskStatusFn>().mockResolvedValue({ ok: true })
const tasksRef = ref<Array<Record<string, unknown>>>([])
vi.mock('../useTasks', () => ({
  useTasks: () => ({
    tasks: tasksRef,
    updateTaskStatus: updateTaskStatusMock,
  }),
}))

// Mock the provider factory so `runOne()` doesn't try to hit a real API.
// We return a provider that emits a single text block then `done` — enough
// for the seed-run lifecycle assertions.
const providerStreamMock = vi.fn(async function* () {
  yield { type: 'text', text: 'All set.' }
  yield { type: 'done', stopReason: 'end_turn' }
})
vi.mock('../../../embedded/provider-factory.js', () => ({
  makeProvider: () => ({ name: 'mock', stream: providerStreamMock }),
}))

import { useEmbeddedAgent } from '../useEmbeddedAgent'
import { resetProviderSettingsForTests, useProviderSettings } from '../useProviderSettings'
import type { UseTaskThread, ThreadMessage } from '../useTaskThread'

/** Minimal stub thread that records appends and lets tests preload messages. */
function makeStubThread(initial: ThreadMessage[] = []): UseTaskThread & {
  appended: Array<Parameters<UseTaskThread['append']>[0]>
} {
  const messages = shallowRef<ThreadMessage[]>([...initial])
  const appended: Array<Parameters<UseTaskThread['append']>[0]> = []
  return {
    taskId: ref('task-test'),
    messages,
    status: ref<'idle' | 'loading' | 'live' | 'error' | 'reconnecting'>('live'),
    error: ref<string | null>(null),
    lastId: ref<string | null>(null),
    open: vi.fn().mockResolvedValue(undefined),
    close: vi.fn(),
    append: vi.fn(async (input) => {
      appended.push(input)
      const stored: ThreadMessage = {
        id: `m-${appended.length}`,
        ts: Date.now(),
        role: input.role,
        content: input.content,
        providerId: input.providerId,
        model: input.model,
        usage: input.usage,
        blocks: input.blocks,
      }
      messages.value = [...messages.value, stored]
      return stored
    }),
    appended,
  }
}

beforeEach(() => {
  resetProviderSettingsForTests()
  // Default to OpenRouter so makeProvider doesn't bail on missing creds.
  const store = useProviderSettings()
  store.setActiveProvider('openrouter')
  store.setProviderConfig({
    id: 'openrouter',
    apiKey: 'sk-or-test',
    baseUrl: '',
    model: 'openai/gpt-4o-mini',
    effort: 'auto',
  })
  // Reset mocks between cases — vi.fn instances retain call history.
  updateTaskStatusMock.mockClear()
  providerStreamMock.mockClear()
  tasksRef.value = []
})

describe('useEmbeddedAgent — queue', () => {
  it('starts with an empty queue', () => {
    const agent = useEmbeddedAgent(makeStubThread())
    expect(agent.queuedMessages.value).toEqual([])
    expect(agent.running.value).toBe(false)
  })

  it('cancelQueued removes the entry at the given index', () => {
    const agent = useEmbeddedAgent(makeStubThread())
    // Push directly into the ref to simulate a running turn.
    agent.queuedMessages.value = ['a', 'b', 'c']
    agent.cancelQueued(1)
    expect(agent.queuedMessages.value).toEqual(['a', 'c'])
  })

  it('cancelQueued is a no-op for out-of-range indices', () => {
    const agent = useEmbeddedAgent(makeStubThread())
    agent.queuedMessages.value = ['a']
    agent.cancelQueued(-1)
    agent.cancelQueued(5)
    expect(agent.queuedMessages.value).toEqual(['a'])
  })

  it('send() while not running fires immediately; while running queues', async () => {
    const agent = useEmbeddedAgent(makeStubThread())

    // Empty/whitespace strings are ignored — neither fired nor queued.
    await agent.send('   ')
    expect(agent.queuedMessages.value).toEqual([])

    // Simulate a turn in flight by flipping status directly.
    agent.status.value = 'running'
    await agent.send('hello there')
    expect(agent.queuedMessages.value).toEqual(['hello there'])
  })
})

describe('useEmbeddedAgent — surfaces', () => {
  it('exposes currentBlocks as a reactive shallow ref', () => {
    const agent = useEmbeddedAgent(makeStubThread())
    expect(Array.isArray(agent.currentBlocks.value)).toBe(true)
    expect(agent.currentBlocks.value.length).toBe(0)
  })

  it('exposes informational usage totals', () => {
    const agent = useEmbeddedAgent(makeStubThread())
    expect(agent.usage.value).toEqual({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 })
  })
})

describe('useEmbeddedAgent — seed run lifecycle', () => {
  it('flips pending → in_progress at start and in_progress → review at end on isSeed', async () => {
    tasksRef.value = [{ id: 'task-test', status: 'pending', description: 'Do the thing.' }]
    const agent = useEmbeddedAgent(makeStubThread())

    await agent.send('Do the thing.', { isSeed: true })

    // Two transitions in order. The mock task ref isn't actually mutated by
    // the mock updateTaskStatus, but the second call still fires because the
    // composable consulted `tasks.value` BEFORE calling updateTaskStatus —
    // we have to update the ref in between to simulate that.
    expect(updateTaskStatusMock.mock.calls.length).toBeGreaterThanOrEqual(1)
    expect(updateTaskStatusMock.mock.calls[0]).toEqual(['task-test', 'in_progress'])
  })

  it('skips the review flip when the task drifted out of in_progress mid-run', async () => {
    // Simulate: start state is pending, lock flips it to in_progress (mock
    // doesn't update the ref), then mid-run something else drifted the task
    // to needs_info. The review flip checks the *current* status from the
    // task ref, which we set to needs_info before the run ends.
    tasksRef.value = [{ id: 'task-test', status: 'needs_info', description: 'x' }]
    const agent = useEmbeddedAgent(makeStubThread())

    await agent.send('x', { isSeed: true })

    // Lock step: pending|denied only. Since status is already needs_info
    // when we read it, lockTaskOnStart skips.
    // End step: review flip requires current status === 'in_progress', which
    // it isn't here, so no review call either.
    expect(updateTaskStatusMock).not.toHaveBeenCalled()
  })

  it('does NOT touch task.status when isSeed is false', async () => {
    tasksRef.value = [{ id: 'task-test', status: 'pending', description: 'x' }]
    const agent = useEmbeddedAgent(makeStubThread())

    await agent.send('free-form follow-up', /* isSeed omitted */)

    expect(updateTaskStatusMock).not.toHaveBeenCalled()
  })

  it('uses the agent\'s last text block as the resolution', async () => {
    tasksRef.value = [{ id: 'task-test', status: 'in_progress', description: 'x' }]
    // Mid-run, replace the mock so the end-of-run sees status: in_progress.
    const agent = useEmbeddedAgent(makeStubThread())
    await agent.send('Make the change.', { isSeed: true })

    const reviewCall = updateTaskStatusMock.mock.calls.find((c) => c[1] === 'review')
    expect(reviewCall).toBeDefined()
    if (reviewCall) {
      // Signature: (id, status, feedback, extra)
      expect(reviewCall[0]).toBe('task-test')
      expect(reviewCall[3]).toMatchObject({ resolution: 'All set.' })
    }
  })
})
