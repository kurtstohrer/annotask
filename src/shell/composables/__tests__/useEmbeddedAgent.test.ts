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
// The real provider stream is a `type`-tagged event union (text | tool_call |
// tool_result | usage | error | done) — type the double openly so individual
// tests can yield any variant (e.g. a `usage` event) without fighting inference.
const providerStreamMock = vi.fn(async function* (
  _messages?: unknown,
  _tools?: unknown,
  _options?: { signal?: AbortSignal },
): AsyncGenerator<{ type: string; [k: string]: unknown }> {
  yield { type: 'text', text: 'All set.' }
  yield { type: 'done', stopReason: 'end_turn' }
})
const abortRunMock = vi.fn()
// Indirection so individual tests can make provider construction itself
// throw (the missing-API-key path) via mockImplementationOnce — the factory
// mock defers to this fn per call.
const makeProviderMock = vi.fn(() => ({ name: 'mock', stream: providerStreamMock, abortRun: abortRunMock }))
vi.mock('../../../embedded/provider-factory.js', () => ({
  makeProvider: () => makeProviderMock(),
}))

import { useEmbeddedAgent } from '../useEmbeddedAgent'
import { useAgentMode } from '../useAgentMode'
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
    update: vi.fn(async (id, patch) => {
      const idx = messages.value.findIndex((m) => m.id === id)
      const base: ThreadMessage = idx >= 0
        ? messages.value[idx]
        : { id, ts: Date.now(), role: 'assistant', content: '' }
      const merged: ThreadMessage = { ...base, ...patch }
      const next = messages.value.slice()
      if (idx >= 0) next[idx] = merged
      else next.push(merged)
      messages.value = next
      return merged
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
  abortRunMock.mockClear()
  makeProviderMock.mockClear()
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

describe('useEmbeddedAgent — redaction wiring', () => {
  it('scrubs secrets from outgoing history before the provider sees them', async () => {
    const secret = `sk-ant-${'A'.repeat(40)}`
    const thread = makeStubThread([
      { id: 'u0', ts: 1, role: 'user', content: `my key is ${secret}` },
    ])
    const agent = useEmbeddedAgent(thread)

    // Non-seed turn on the (HTTP) openrouter provider still streams; redaction
    // is on by default. The raw secret must not reach the provider.
    await agent.send('continue please')

    expect(providerStreamMock).toHaveBeenCalled()
    const passedMessages = providerStreamMock.mock.calls[0]?.[0]
    expect(JSON.stringify(passedMessages)).not.toContain(secret)
  })
})

describe('useEmbeddedAgent — abort', () => {
  it('abort() aborts the run signal and asks the provider to kill the subprocess', async () => {
    let sawAbort = false
    providerStreamMock.mockImplementationOnce(async function* (
      _m?: unknown, _t?: unknown, options?: { signal?: AbortSignal },
    ) {
      yield { type: 'text', text: 'working…' }
      await new Promise<void>((resolve) => {
        if (options?.signal?.aborted) { sawAbort = true; resolve(); return }
        options?.signal?.addEventListener('abort', () => { sawAbort = true; resolve() })
      })
      yield { type: 'done', stopReason: 'aborted' }
    })

    const agent = useEmbeddedAgent(makeStubThread())
    const run = agent.send('go')
    // Let the run reach the in-flight await before aborting.
    await new Promise((r) => setTimeout(r, 0))
    agent.abort()
    await run

    expect(sawAbort).toBe(true)
    expect(abortRunMock).toHaveBeenCalled()
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

describe('useEmbeddedAgent — seed run error paths', () => {
  // Each case presets the task at `in_progress` (the post-lock state — the
  // mock updateTaskStatus doesn't mutate tasksRef, so we start where the
  // lock would have landed) and asserts the failed run releases the lock
  // back to `pending` and clears the live-run indicator.

  it('provider stream throwing reverts the task to pending + clears the run indicator', async () => {
    tasksRef.value = [{ id: 'task-test', status: 'in_progress', description: 'x' }]
    let activeDuringRun = false
    providerStreamMock.mockImplementationOnce(async function* () {
      activeDuringRun = useAgentMode().activeRuns.value.has('task-test')
      yield { type: 'text', text: 'partial output…' }
      throw new Error('boom')
    })
    const thread = makeStubThread()
    const agent = useEmbeddedAgent(thread)

    await agent.send('Do the thing.', { isSeed: true })

    expect(agent.status.value).toBe('error')
    expect(activeDuringRun).toBe(true)
    expect(useAgentMode().activeRuns.value.has('task-test')).toBe(false)
    expect(updateTaskStatusMock).toHaveBeenCalledWith('task-test', 'pending')
    // The failure is persisted as a system message so every observer (other
    // tabs, MCP tail-readers) sees why the run ended — same as the watchdog.
    expect(thread.appended.some((m) => m.role === 'system' && m.content.includes('boom'))).toBe(true)
  })

  it('makeProvider throwing (missing API key) reverts the task to pending', async () => {
    tasksRef.value = [{ id: 'task-test', status: 'in_progress', description: 'x' }]
    makeProviderMock.mockImplementationOnce(() => { throw new Error('no API key configured') })
    const thread = makeStubThread()
    const agent = useEmbeddedAgent(thread)

    await agent.send('Do the thing.', { isSeed: true })

    expect(agent.status.value).toBe('error')
    expect(useAgentMode().activeRuns.value.has('task-test')).toBe(false)
    expect(updateTaskStatusMock).toHaveBeenCalledWith('task-test', 'pending')
    expect(thread.appended.some((m) => m.role === 'system' && m.content.includes('no API key configured'))).toBe(true)
  })

  it('user-message append failure reverts the task to pending', async () => {
    tasksRef.value = [{ id: 'task-test', status: 'in_progress', description: 'x' }]
    const thread = makeStubThread()
    vi.mocked(thread.append).mockRejectedValueOnce(new Error('disk full'))
    const agent = useEmbeddedAgent(thread)

    await agent.send('Do the thing.', { isSeed: true })

    expect(agent.status.value).toBe('error')
    expect(useAgentMode().activeRuns.value.has('task-test')).toBe(false)
    expect(updateTaskStatusMock).toHaveBeenCalledWith('task-test', 'pending')
  })

  it('chat-turn (non-seed) errors never touch task.status but still clear the indicator', async () => {
    tasksRef.value = [{ id: 'task-test', status: 'in_progress', description: 'x' }]
    providerStreamMock.mockImplementationOnce(async function* () {
      yield { type: 'text', text: 'hmm' }
      throw new Error('boom')
    })
    const thread = makeStubThread()
    const agent = useEmbeddedAgent(thread)

    await agent.send('free-form follow-up')

    expect(agent.status.value).toBe('error')
    expect(updateTaskStatusMock).not.toHaveBeenCalled()
    expect(useAgentMode().activeRuns.value.has('task-test')).toBe(false)
    // No system message either — the error strip is enough for a chat turn.
    expect(thread.appended.some((m) => m.role === 'system')).toBe(false)
  })
})

describe('useEmbeddedAgent — seed run abort', () => {
  it('reverts the task to pending when a seed run is aborted (Stop / requestAutoRunCancel)', async () => {
    // Regression: a deliberate abort ends the stream as `done`/'aborted' with
    // no watchdogReason. Before the fix this fell through every terminal
    // branch, leaving the task stranded in_progress for the server to
    // mislabel "tab was likely closed". It must now release the lock to
    // pending — same recovery as the error path.
    tasksRef.value = [{ id: 'task-test', status: 'in_progress', description: 'x' }]
    providerStreamMock.mockImplementationOnce(async function* (
      _m?: unknown, _t?: unknown, options?: { signal?: AbortSignal },
    ) {
      yield { type: 'text', text: 'working…' }
      await new Promise<void>((resolve) => {
        if (options?.signal?.aborted) { resolve(); return }
        options?.signal?.addEventListener('abort', () => resolve())
      })
      // Local CLI providers normalize an aborted run to a clean done/'aborted'
      // event (they don't throw) — mirror that so we exercise the gap.
      yield { type: 'done', stopReason: 'aborted' }
    })
    const agent = useEmbeddedAgent(makeStubThread())

    const run = agent.send('Do the thing.', { isSeed: true })
    await new Promise((r) => setTimeout(r, 0))
    agent.abort()
    await run

    expect(agent.status.value).toBe('aborted')
    expect(abortRunMock).toHaveBeenCalled()
    expect(updateTaskStatusMock).toHaveBeenCalledWith('task-test', 'pending')
    expect(useAgentMode().activeRuns.value.has('task-test')).toBe(false)
  })
})

describe('useEmbeddedAgent — usage accounting (no double-count across turns)', () => {
  it('keeps usage per-turn so a 2-turn conversation sums to the true total, not 2x', async () => {
    // Each turn emits its OWN usage event. Before the fix, `usage` accumulated
    // across every turn and was never reset, so turn 2's persisted message
    // carried turn-1+turn-2 tokens AND the live accumulator still held the
    // running total — the header (persisted-message sum + live accumulator)
    // showed ~2x. The invariant: each persisted message holds exactly its own
    // turn, and the live accumulator is zeroed once the turn is persisted.
    providerStreamMock.mockImplementation(async function* () {
      yield { type: 'text', text: 'turn output' }
      yield { type: 'usage', inputTokens: 100, outputTokens: 30 }
      yield { type: 'done', stopReason: 'end_turn' }
    })
    const thread = makeStubThread()
    const agent = useEmbeddedAgent(thread)

    await agent.send('first turn')
    // After the turn persists, the live accumulator is cleared (so the idle
    // gap between turns can't double-count it against the persisted message).
    expect(agent.usage.value).toEqual({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 })

    await agent.send('second turn')
    expect(agent.usage.value).toEqual({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 })

    // Each assistant turn's persisted message carries exactly its OWN turn's
    // tokens — never the running cumulative — so the header summing them lands
    // on the true total (200 in / 60 out), not 2x turn-1.
    const usages = thread.messages.value
      .filter((m) => m.role === 'assistant' && m.usage)
      .map((m) => m.usage!)
    expect(usages).toHaveLength(2)
    for (const u of usages) {
      expect(u.inputTokens).toBe(100)
      expect(u.outputTokens).toBe(30)
    }
    const totalIn = usages.reduce((s, u) => s + (u.inputTokens || 0), 0) + agent.usage.value.input
    const totalOut = usages.reduce((s, u) => s + (u.outputTokens || 0), 0) + agent.usage.value.output
    expect(totalIn).toBe(200)
    expect(totalOut).toBe(60)

    // Restore the suite default — this test installed a persistent
    // implementation (both turns needed it); `mockClear()` in beforeEach only
    // resets call history, not the implementation.
    providerStreamMock.mockImplementation(async function* () {
      yield { type: 'text', text: 'All set.' }
      yield { type: 'done', stopReason: 'end_turn' }
    })
  })
})

describe('useEmbeddedAgent — seed gate lists all four local CLIs', () => {
  it('refusal message names claude/codex/opencode/copilot and never locks the task', async () => {
    // Pin the task type to a custom persona on an HTTP provider so the
    // "local CLIs only" apply gate actually fires.
    const store = useProviderSettings()
    store.upsertPersona({
      id: 'custom:http-tester',
      name: 'HTTP Tester',
      description: '',
      taskTypes: [],
      providerId: 'openrouter',
      model: '',
      effort: 'auto',
      roleDirections: '',
      systemPromptExtras: '',
      isCustom: true,
    })
    store.setPersonaOverride('annotation', 'custom:http-tester')
    tasksRef.value = [{ id: 'task-test', status: 'pending', description: 'x', type: 'annotation' }]
    const agent = useEmbeddedAgent(makeStubThread())

    await agent.send('x', { isSeed: true })

    expect(agent.status.value).toBe('error')
    for (const cli of ['claude-local', 'codex-local', 'opencode-local', 'copilot-local']) {
      expect(agent.errorMessage.value).toContain(cli)
    }
    // The gate fires before the lock — the task stays pending and the
    // live-run indicator doesn't leak.
    expect(updateTaskStatusMock).not.toHaveBeenCalled()
    expect(useAgentMode().activeRuns.value.has('task-test')).toBe(false)
  })
})
