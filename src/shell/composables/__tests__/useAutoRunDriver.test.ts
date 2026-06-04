import { describe, it, expect, beforeEach } from 'vitest'
import { requestAutoRunCancel, resetAutoRunDriverForTests } from '../useAutoRunDriver'

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
