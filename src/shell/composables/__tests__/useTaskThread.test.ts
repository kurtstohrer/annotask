import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { useTaskThread, type ThreadMessage } from '../useTaskThread'

/**
 * Minimal EventSource stub — jsdom doesn't implement it, and `open()` only
 * needs construction to succeed (we drive messages directly via append/update).
 */
class FakeEventSource {
  url: string
  constructor(url: string) { this.url = url }
  addEventListener() { /* no-op */ }
  close() { /* no-op */ }
}

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response
}

describe('useTaskThread', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.stubGlobal('EventSource', FakeEventSource)
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  async function openWithSnapshot(snapshot: ThreadMessage[]) {
    fetchMock.mockResolvedValueOnce(jsonResponse({ taskId: 'task-x', messages: snapshot }))
    const thread = useTaskThread()
    await thread.open('task-x')
    return thread
  }

  it('upserts by id: update() replaces the message in place instead of duplicating', async () => {
    const partial: ThreadMessage = { id: 'm1', ts: 1, role: 'assistant', content: '', isPartial: true }
    const thread = await openWithSnapshot([partial])
    expect(thread.messages.value).toHaveLength(1)

    // PATCH returns the merged record with the same id.
    fetchMock.mockResolvedValueOnce(jsonResponse({
      ...partial, content: 'streaming…', isPartial: true, lastEventAt: 5,
    }))
    await thread.update('m1', { content: 'streaming…', lastEventAt: 5 })

    expect(thread.messages.value).toHaveLength(1) // not duplicated
    expect(thread.messages.value[0].content).toBe('streaming…')
    expect(thread.messages.value[0].lastEventAt).toBe(5)

    // Final flush clears isPartial — still one entry, same id.
    fetchMock.mockResolvedValueOnce(jsonResponse({ ...partial, content: 'done', isPartial: false }))
    await thread.update('m1', { content: 'done', isPartial: false })
    expect(thread.messages.value).toHaveLength(1)
    expect(thread.messages.value[0].isPartial).toBe(false)
    expect(thread.messages.value[0].content).toBe('done')
  })

  it('append() adds a new entry but dedupes a repeat of the same id', async () => {
    const thread = await openWithSnapshot([])
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: 'u1', ts: 2, role: 'user', content: 'hi' }))
    await thread.append({ role: 'user', content: 'hi' })
    expect(thread.messages.value).toHaveLength(1)

    // A second append echoing the same id (e.g. SSE replay) must not duplicate.
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: 'u1', ts: 2, role: 'user', content: 'hi' }))
    await thread.append({ role: 'user', content: 'hi' })
    expect(thread.messages.value).toHaveLength(1)
  })

  it('gives up after repeated reconnect failures and surfaces an actionable error', async () => {
    // Controllable EventSource so we can drive `error` events deterministically.
    const listeners: Record<string, Array<(ev?: unknown) => void>> = {}
    let closed = false
    class ControllableES {
      url: string
      constructor(url: string) { this.url = url }
      addEventListener(type: string, fn: (ev?: unknown) => void) { (listeners[type] ??= []).push(fn) }
      close() { closed = true }
    }
    vi.stubGlobal('EventSource', ControllableES)

    fetchMock.mockResolvedValueOnce(jsonResponse({ taskId: 'task-x', messages: [] }))
    const thread = useTaskThread()
    await thread.open('task-x')

    const fireError = () => listeners.error?.forEach((fn) => fn())

    // First 5 failures: still trying, not given up.
    for (let i = 0; i < 5; i++) fireError()
    expect(thread.status.value).toBe('reconnecting')
    expect(closed).toBe(false)

    // 6th consecutive failure → give up with an actionable error.
    fireError()
    expect(thread.status.value).toBe('error')
    expect(thread.error.value).toMatch(/Lost connection/)
    expect(closed).toBe(true)
  })

  it('resets the reconnect counter on a successful (re)connect', async () => {
    const listeners: Record<string, Array<(ev?: unknown) => void>> = {}
    class ControllableES {
      url: string
      constructor(url: string) { this.url = url }
      addEventListener(type: string, fn: (ev?: unknown) => void) { (listeners[type] ??= []).push(fn) }
      close() { /* no-op */ }
    }
    vi.stubGlobal('EventSource', ControllableES)

    fetchMock.mockResolvedValueOnce(jsonResponse({ taskId: 'task-x', messages: [] }))
    const thread = useTaskThread()
    await thread.open('task-x')

    const fireError = () => listeners.error?.forEach((fn) => fn())
    const fireOpen = () => listeners.open?.forEach((fn) => fn())

    for (let i = 0; i < 5; i++) fireError()
    fireOpen() // recovered — counter resets
    expect(thread.status.value).toBe('live')
    for (let i = 0; i < 5; i++) fireError() // 5 more shouldn't trip the give-up
    expect(thread.status.value).toBe('reconnecting')
  })
})
