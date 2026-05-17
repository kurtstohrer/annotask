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
})
