import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// Replace the shared WebSocket client so importing useTasks neither opens a
// real socket nor races reconnect timers. `__emit` is a test-only hook that
// fires synthetic events at subscribers (used for the `reconnected` resync).
vi.mock('../../services/wsClient', () => {
  const listeners = new Map<string, Set<(d?: unknown) => void>>()
  return {
    on: (event: string, handler: (d?: unknown) => void) => {
      if (!listeners.has(event)) listeners.set(event, new Set())
      listeners.get(event)!.add(handler)
      return () => { listeners.get(event)?.delete(handler) }
    },
    send: () => { /* no-op */ },
    isConnected: () => true,
    __emit: (event: string, data?: unknown) => {
      listeners.get(event)?.forEach((h) => h(data))
    },
  }
})

import * as wsClient from '../../services/wsClient'
import { useTasks } from '../useTasks'

const emitWs = (wsClient as unknown as { __emit: (event: string, data?: unknown) => void }).__emit

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response
}

describe('useTasks error handling', () => {
  let fetchMock: ReturnType<typeof vi.fn>
  let errorSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue(jsonResponse({ tasks: [] }))
    vi.stubGlobal('fetch', fetchMock)
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('createTask returns the created task and clears lastError on success', async () => {
    const ts = useTasks()
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: 't1', description: 'x' })) // POST
    const created = await ts.createTask({ type: 'annotation', description: 'x' })
    expect(created).toMatchObject({ id: 't1' })
    expect(ts.lastError.value).toBeNull()
  })

  it('createTask returns null and surfaces the server error body on a 400', async () => {
    const ts = useTasks()
    // The exact failure from the error_fix chain: SafeSourceFile rejecting a
    // dev-server URL as `file`. The old code returned this body as if it
    // were the created task, so /tasks/undefined sidecar POSTs followed.
    fetchMock.mockResolvedValueOnce(jsonResponse(
      { error: { code: 'validation_failed', message: 'URL-style paths are not allowed' } },
      400,
    ))
    const created = await ts.createTask({ type: 'error_fix', description: 'boom', file: 'http://localhost:5173/src/App.vue' })
    expect(created).toBeNull()
    expect(ts.lastError.value).toEqual({ code: 'validation_failed', message: 'URL-style paths are not allowed' })
    expect(errorSpy).toHaveBeenCalled()
  })

  it('createTask falls back to an http_error code when the failure body is not JSON', async () => {
    const ts = useTasks()
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => { throw new Error('not json') },
    } as unknown as Response)
    const created = await ts.createTask({ type: 'annotation', description: 'x' })
    expect(created).toBeNull()
    expect(ts.lastError.value).toEqual({ code: 'http_error', message: 'HTTP 500' })
  })

  it('createTask reports network failures as network_error', async () => {
    const ts = useTasks()
    fetchMock.mockRejectedValueOnce(new Error('ECONNREFUSED'))
    const created = await ts.createTask({ type: 'annotation', description: 'x' })
    expect(created).toBeNull()
    expect(ts.lastError.value?.code).toBe('network_error')
  })

  it('updateTask returns false + lastError on a rejected PATCH, true on success', async () => {
    const ts = useTasks()
    fetchMock.mockResolvedValueOnce(jsonResponse(
      { error: { code: 'validation_failed', message: 'Unknown field' } },
      400,
    ))
    expect(await ts.updateTask('t1', { status: 'review' })).toBe(false)
    expect(ts.lastError.value?.code).toBe('validation_failed')

    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true })) // PATCH
    expect(await ts.updateTask('t1', { status: 'review' })).toBe(true)
    expect(ts.lastError.value).toBeNull()
  })

  it('deleteTask returns false + lastError on a rejected DELETE', async () => {
    const ts = useTasks()
    fetchMock.mockResolvedValueOnce(jsonResponse(
      { error: { code: 'not_found', message: 'Not found' } },
      404,
    ))
    expect(await ts.deleteTask('missing')).toBe(false)
    expect(ts.lastError.value).toEqual({ code: 'not_found', message: 'Not found' })
  })

  it('refetches the task list when the WebSocket reconnects after a drop', async () => {
    useTasks() // ensure subscriptions are registered
    fetchMock.mockClear()
    emitWs('reconnected')
    // fetchTasks is fire-and-forget — flush the microtask queue.
    await Promise.resolve()
    expect(fetchMock).toHaveBeenCalledWith('/__annotask/api/tasks')
  })
})
