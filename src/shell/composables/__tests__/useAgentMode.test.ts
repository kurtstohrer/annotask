import { describe, it, expect } from 'vitest'
import { requestAutoRun, consumeAutoRun, useAgentMode } from '../useAgentMode'

describe('useAgentMode', () => {
  it('enqueues a task id', () => {
    const id = `task-${Math.random().toString(36).slice(2)}`
    requestAutoRun(id)
    expect(useAgentMode().pendingAutoRun.value.has(id)).toBe(true)
  })

  it('consumeAutoRun returns true once then false', () => {
    const id = `task-${Math.random().toString(36).slice(2)}`
    requestAutoRun(id)
    expect(consumeAutoRun(id)).toBe(true)
    expect(consumeAutoRun(id)).toBe(false)
    expect(useAgentMode().pendingAutoRun.value.has(id)).toBe(false)
  })

  it('ignores empty ids', () => {
    const before = useAgentMode().pendingAutoRun.value.size
    requestAutoRun('')
    expect(useAgentMode().pendingAutoRun.value.size).toBe(before)
  })

  it('is idempotent on duplicate enqueue', () => {
    const id = `task-${Math.random().toString(36).slice(2)}`
    requestAutoRun(id)
    const sizeAfterFirst = useAgentMode().pendingAutoRun.value.size
    requestAutoRun(id)
    expect(useAgentMode().pendingAutoRun.value.size).toBe(sizeAfterFirst)
    expect(consumeAutoRun(id)).toBe(true)
  })

  it('defaults to auto source', () => {
    const id = `task-${Math.random().toString(36).slice(2)}`
    requestAutoRun(id)
    expect(useAgentMode().pendingAutoRun.value.get(id)).toBe('auto')
    consumeAutoRun(id)
  })

  it('stores manual source', () => {
    const id = `task-${Math.random().toString(36).slice(2)}`
    requestAutoRun(id, 'manual')
    expect(useAgentMode().pendingAutoRun.value.get(id)).toBe('manual')
    consumeAutoRun(id)
  })

  it('consumeAutoRun respects allowedSources filter', () => {
    const id = `task-${Math.random().toString(36).slice(2)}`
    requestAutoRun(id, 'manual')
    // The headless driver filters to 'auto' only — manual should be rejected
    expect(consumeAutoRun(id, ['auto'])).toBe(false)
    // The item is still in the queue
    expect(useAgentMode().pendingAutoRun.value.has(id)).toBe(true)
    // The Conversation tab consumes without filter — succeeds
    expect(consumeAutoRun(id)).toBe(true)
    expect(useAgentMode().pendingAutoRun.value.has(id)).toBe(false)
  })

  it('headless driver can consume auto-sourced items', () => {
    const id = `task-${Math.random().toString(36).slice(2)}`
    requestAutoRun(id, 'auto')
    expect(consumeAutoRun(id, ['auto'])).toBe(true)
    expect(useAgentMode().pendingAutoRun.value.has(id)).toBe(false)
  })
})
