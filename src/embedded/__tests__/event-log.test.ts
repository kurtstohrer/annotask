import { describe, it, expect, vi } from 'vitest'
import { EventLog, type PersistenceSink } from '../event-log.js'

function memorySink(): PersistenceSink & { store: Map<string, string> } {
  const store = new Map<string, string>()
  return {
    store,
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => {
      store.set(k, v)
    },
    removeItem: (k) => {
      store.delete(k)
    },
  }
}

describe('EventLog', () => {
  it('appends rows with monotonic ids and an injected clock', () => {
    let t = 100
    const log = new EventLog({ now: () => t++ })
    const a = log.append({
      kind: 'turn',
      conversationId: 'c1',
      provider: 'anthropic',
      model: 'claude-sonnet-4-5',
      inputTokens: 100,
      outputTokens: 50,
      latencyMs: 200,
    })
    const b = log.append({
      kind: 'turn',
      conversationId: 'c1',
      provider: 'anthropic',
      model: 'claude-sonnet-4-5',
      inputTokens: 100,
      outputTokens: 50,
      latencyMs: 200,
    })
    expect(a.id).toBe(1)
    expect(b.id).toBe(2)
    expect(a.ts).toBe(100)
    expect(b.ts).toBe(101)
    expect(log.list()).toHaveLength(2)
  })

  it('appendToolCall captures top-level keys but not values', () => {
    const log = new EventLog()
    const row = log.appendToolCall({
      conversationId: 'c1',
      provider: 'anthropic',
      model: 'claude-sonnet-4-5',
      toolName: 'edit_file',
      toolUseId: 'tu_1',
      input: { path: '/secrets/x', text: 'sk-ant-…' },
    })
    expect(row.inputKeys.sort()).toEqual(['path', 'text'])
    // No values stored anywhere on the row.
    expect(JSON.stringify(row)).not.toContain('/secrets/x')
    expect(JSON.stringify(row)).not.toContain('sk-ant-')
  })

  it('aggregates per-conversation token totals', () => {
    const log = new EventLog()
    log.append({
      kind: 'turn',
      conversationId: 'c1',
      provider: 'anthropic',
      model: 'm',
      inputTokens: 100,
      outputTokens: 50,
      cacheReadTokens: 10,
      cacheCreationTokens: 5,
      latencyMs: 200,
    })
    log.append({
      kind: 'turn',
      conversationId: 'c1',
      provider: 'anthropic',
      model: 'm',
      inputTokens: 40,
      outputTokens: 30,
      latencyMs: 200,
    })
    log.append({
      kind: 'turn',
      conversationId: 'c2',
      provider: 'anthropic',
      model: 'm',
      inputTokens: 999,
      outputTokens: 999,
      latencyMs: 200,
    })
    const t = log.totalsByConversation('c1')
    expect(t.inputTokens).toBe(140)
    expect(t.outputTokens).toBe(80)
    expect(t.cacheReadTokens).toBe(10)
    expect(t.cacheCreationTokens).toBe(5)
    expect(t.turns).toBe(2)
  })

  it('evicts oldest rows when capacity is exceeded', () => {
    const log = new EventLog({ capacity: 3 })
    for (let i = 0; i < 5; i++) {
      log.append({
        kind: 'turn',
        conversationId: 'c',
        provider: 'p',
        model: 'm',
        inputTokens: i,
        outputTokens: 0,
        latencyMs: 1,
      })
    }
    const rows = log.list()
    expect(rows).toHaveLength(3)
    // The two oldest rows (ids 1 and 2) were evicted; we kept 3, 4, 5.
    expect(rows.map((r) => r.id)).toEqual([3, 4, 5])
  })

  it('notifies subscribers on append and clear', () => {
    const log = new EventLog()
    const seen: number[] = []
    const unsubscribe = log.subscribe((rows) => seen.push(rows.length))
    log.append({
      kind: 'turn',
      conversationId: 'c',
      provider: 'p',
      model: 'm',
      inputTokens: 1,
      outputTokens: 1,
      latencyMs: 1,
    })
    log.append({
      kind: 'tool_result',
      conversationId: 'c',
      toolUseId: 'tu_1',
      toolName: 'edit',
      isError: false,
      latencyMs: 5,
    })
    log.clear()
    unsubscribe()
    log.append({
      kind: 'turn',
      conversationId: 'c',
      provider: 'p',
      model: 'm',
      inputTokens: 1,
      outputTokens: 1,
      latencyMs: 1,
    })
    expect(seen).toEqual([1, 2, 0])
  })

  it('persists to an injected sink and rehydrates on construction', () => {
    const sink = memorySink()
    const a = new EventLog({ persistence: sink })
    a.append({
      kind: 'turn',
      conversationId: 'c1',
      provider: 'anthropic',
      model: 'm',
      inputTokens: 100,
      outputTokens: 50,
      latencyMs: 200,
    })
    const b = new EventLog({ persistence: sink })
    expect(b.list()).toHaveLength(1)
    // Continue numbering from where we left off so reloads don't reset ids.
    const next = b.append({
      kind: 'turn',
      conversationId: 'c1',
      provider: 'anthropic',
      model: 'm',
      inputTokens: 100,
      outputTokens: 50,
      latencyMs: 200,
    })
    expect(next.id).toBeGreaterThan(1)
  })

  it('survives corrupt persisted state by clearing it', () => {
    const sink = memorySink()
    sink.store.set('annotask:ai:eventLog', '{not valid json')
    const log = new EventLog({ persistence: sink })
    expect(log.list()).toEqual([])
    expect(sink.store.has('annotask:ai:eventLog')).toBe(false)
  })

  it('does NOT touch the network — listener-free fetch surface', () => {
    // Sanity check that the module does not reach for `fetch`. We spy on
    // the global; any call would fail this test.
    const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
      throw new Error('EventLog touched the network')
    })
    try {
      const log = new EventLog()
      log.append({
        kind: 'turn',
        conversationId: 'c',
        provider: 'p',
        model: 'm',
        inputTokens: 1,
        outputTokens: 1,
        latencyMs: 1,
      })
      log.append({
        kind: 'error',
        conversationId: 'c',
        provider: 'p',
        model: 'm',
        reason: 'rate_limit',
      })
      log.clear()
      expect(spy).not.toHaveBeenCalled()
    } finally {
      spy.mockRestore()
    }
  })

  it('filter returns matching rows', () => {
    const log = new EventLog()
    log.append({
      kind: 'turn',
      conversationId: 'c',
      provider: 'p',
      model: 'm',
      inputTokens: 1,
      outputTokens: 1,
      latencyMs: 1,
    })
    log.append({
      kind: 'error',
      conversationId: 'c',
      provider: 'p',
      model: 'm',
      reason: 'rate_limit',
    })
    expect(log.filter((r) => r.kind === 'error')).toHaveLength(1)
  })

  it('rejects capacity <= 0', () => {
    expect(() => new EventLog({ capacity: 0 })).toThrow()
    expect(() => new EventLog({ capacity: -10 })).toThrow()
  })
})
