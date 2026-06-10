// @vitest-environment jsdom
// wsClient dereferences `window.location` at import time (auto-connect), so
// this suite needs a DOM-flavored global — the rest of the composable tests
// run fine under node.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'

/**
 * Controllable WebSocket stub — jsdom's implementation actually tries to
 * connect, and we need to drive open/close transitions deterministically.
 * Statics mirror the readyState constants wsClient reads off the global.
 */
class FakeWebSocket {
  static instances: FakeWebSocket[] = []
  static CONNECTING = 0
  static OPEN = 1
  static CLOSING = 2
  static CLOSED = 3
  url: string
  readyState = FakeWebSocket.CONNECTING
  onopen: (() => void) | null = null
  onclose: (() => void) | null = null
  onerror: (() => void) | null = null
  onmessage: ((e: { data: string }) => void) | null = null
  constructor(url: string) {
    this.url = url
    FakeWebSocket.instances.push(this)
  }
  send(): void { /* no-op */ }
  close(): void { /* no-op */ }
}

describe('wsClient reconnected event', () => {
  let on: typeof import('../../services/wsClient')['on']

  beforeAll(async () => {
    vi.useFakeTimers()
    vi.stubGlobal('WebSocket', FakeWebSocket)
    vi.spyOn(console, 'log').mockImplementation(() => {})
    // Import AFTER stubbing — the module auto-connects at import time.
    ;({ on } = await import('../../services/wsClient'))
  })
  afterAll(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('fires only on a re-open after a drop, never on the initial connect', () => {
    let reconnects = 0
    on('reconnected', () => { reconnects++ })

    const first = FakeWebSocket.instances[0]
    expect(first).toBeDefined()

    // Initial open: consumers fetch on init, so no resync signal.
    first.readyState = FakeWebSocket.OPEN
    first.onopen?.()
    expect(reconnects).toBe(0)

    // Drop → backoff timer → re-open: resync signal fires exactly once.
    first.readyState = FakeWebSocket.CLOSED
    first.onclose?.()
    vi.advanceTimersByTime(1000) // first backoff step (1000 * 2^0)
    const second = FakeWebSocket.instances[1]
    expect(second).toBeDefined()
    second.readyState = FakeWebSocket.OPEN
    second.onopen?.()
    expect(reconnects).toBe(1)

    // A second drop/re-open cycle fires again — the flag is "ever
    // connected", not a one-shot.
    second.readyState = FakeWebSocket.CLOSED
    second.onclose?.()
    vi.advanceTimersByTime(1000)
    const third = FakeWebSocket.instances[2]
    expect(third).toBeDefined()
    third.readyState = FakeWebSocket.OPEN
    third.onopen?.()
    expect(reconnects).toBe(2)
  })

  it('keeps the on/off contract: unsubscribing stops reconnected delivery', () => {
    let seen = 0
    const off = on('reconnected', () => { seen++ })
    off()

    const current = FakeWebSocket.instances[FakeWebSocket.instances.length - 1]
    current.readyState = FakeWebSocket.CLOSED
    current.onclose?.()
    vi.advanceTimersByTime(1000)
    const next = FakeWebSocket.instances[FakeWebSocket.instances.length - 1]
    next.readyState = FakeWebSocket.OPEN
    next.onopen?.()
    expect(seen).toBe(0)
  })
})
