import { describe, it, expect } from 'vitest'
import {
  emptyDesignSessionDocument,
  isDesignSessionDocument,
  isSessionEntry,
  type DesignSessionDocument,
  type SessionEntry,
} from '../design-session-types'

function entry(id: string, extra: Partial<SessionEntry> = {}): SessionEntry {
  return {
    id,
    ordinal: 1,
    ts: 1,
    route: '/planets',
    change: {
      id: `c-${id}`,
      type: 'style_update',
      description: 'color change',
      file: 'src/pages/PlanetsPage.vue',
      section: 'template',
      line: 9,
      element: 'h1',
      property: 'color',
      before: 'red',
      after: 'blue',
    },
    anchor: { file: 'src/pages/PlanetsPage.vue', line: 9 },
    live: { status: 'pending' },
    ...extra,
  }
}

function docWith(entries: unknown[]): unknown {
  return { version: '1.0', sessionId: 'ds-1', startedAt: 1, updatedAt: 1, entries }
}

describe('emptyDesignSessionDocument', () => {
  it('produces a valid empty document', () => {
    expect(isDesignSessionDocument(emptyDesignSessionDocument('ds-1'))).toBe(true)
  })
})

describe('isSessionEntry', () => {
  it('accepts a minimal pending entry', () => {
    expect(isSessionEntry(entry('se-1'))).toBe(true)
  })

  it('accepts the full envelope (evidence, live states, cross-refs, breakpoint)', () => {
    expect(isSessionEntry(entry('se-1', {
      evidence: { classification: 'literal', excerptHash: 'abc123', loopCount: 4 },
      live: { status: 'written', applyBatchId: 'ab-1', writtenAt: 5 },
      instanceId: 'wfi-1',
      eid: 'eid-9',
      taskId: 'task-1',
      breakpointId: 'iphone-se',
    }))).toBe(true)
    // bound evidence names the binding; breakpointId null means base viewport
    expect(isSessionEntry(entry('se-2', {
      evidence: { classification: 'bound', binding: 'planet.name' },
      breakpointId: null,
    }))).toBe(true)
    expect(isSessionEntry(entry('se-3', {
      live: { status: 'failed', error: 'edit not found in source' },
    }))).toBe(true)
  })

  it('rejects missing/malformed envelope fields', () => {
    expect(isSessionEntry({ ...entry('se-1'), id: '' })).toBe(false)
    expect(isSessionEntry({ ...entry('se-1'), ordinal: '1' })).toBe(false)
    expect(isSessionEntry({ ...entry('se-1'), route: undefined })).toBe(false)
    expect(isSessionEntry({ ...entry('se-1'), change: null })).toBe(false)
    expect(isSessionEntry({ ...entry('se-1'), change: { description: 'no type' } })).toBe(false)
    expect(isSessionEntry({ ...entry('se-1'), anchor: { file: 'a.vue' } })).toBe(false)
    expect(isSessionEntry({ ...entry('se-1'), anchor: { file: 'a.vue', line: '9' } })).toBe(false)
    expect(isSessionEntry({ ...entry('se-1'), live: undefined })).toBe(false)
    expect(isSessionEntry({ ...entry('se-1'), live: { status: 'done' } })).toBe(false)
  })

  it('rejects malformed optional fields', () => {
    expect(isSessionEntry(entry('se-1', { evidence: { classification: 'maybe' } as never }))).toBe(false)
    expect(isSessionEntry(entry('se-1', { evidence: { classification: 'literal', loopCount: '4' } as never }))).toBe(false)
    expect(isSessionEntry(entry('se-1', { live: { status: 'written', writtenAt: 'now' } as never }))).toBe(false)
    expect(isSessionEntry(entry('se-1', { anchor: { file: 'a.vue', line: 9, position: 'inside' } as never }))).toBe(false)
    expect(isSessionEntry(entry('se-1', { instanceId: 42 as never }))).toBe(false)
    expect(isSessionEntry(entry('se-1', { taskId: 42 as never }))).toBe(false)
    expect(isSessionEntry(entry('se-1', { breakpointId: 7 as never }))).toBe(false)
  })
})

describe('isDesignSessionDocument', () => {
  it('accepts a well-formed document', () => {
    expect(isDesignSessionDocument(docWith([entry('se-1'), entry('se-2', { instanceId: 'wfi-1' })]))).toBe(true)
    expect(isDesignSessionDocument({ ...docWith([]) as Record<string, unknown>, rev: 3 })).toBe(true)
  })

  it('rejects malformed top-level fields', () => {
    expect(isDesignSessionDocument(null)).toBe(false)
    expect(isDesignSessionDocument({ ...docWith([]) as Record<string, unknown>, version: '0.9' })).toBe(false)
    expect(isDesignSessionDocument({ ...docWith([]) as Record<string, unknown>, sessionId: '' })).toBe(false)
    expect(isDesignSessionDocument({ ...docWith([]) as Record<string, unknown>, startedAt: 'yesterday' })).toBe(false)
    expect(isDesignSessionDocument({ ...docWith([]) as Record<string, unknown>, rev: '3' })).toBe(false)
    expect(isDesignSessionDocument({ ...docWith([]) as Record<string, unknown>, entries: 'nope' })).toBe(false)
  })

  it('one bad entry rejects the whole document (PUT boundary)', () => {
    expect(isDesignSessionDocument(docWith([entry('se-good'), { id: 'se-bad' }]))).toBe(false)
  })
})
