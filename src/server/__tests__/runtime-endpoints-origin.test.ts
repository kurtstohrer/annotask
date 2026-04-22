import { describe, it, expect } from 'vitest'
import { findMatchingStaticEntries, mergeRuntimeOrphansIntoEntries } from '../runtime-endpoints.js'
import type { ProjectDataEntry, RuntimeEndpoint } from '../../schema.js'

const staticEntries: Array<{ name: string; method?: string; endpoint?: string; resolved_endpoint?: string }> = [
  // Two MFEs each declare the same path under different ports.
  { name: 'apiHealth_4310', method: 'GET', endpoint: 'http://localhost:4310/api/health' },
  { name: 'apiHealth_4320', method: 'GET', endpoint: 'http://localhost:4320/api/health' },
  // A relative entry should match every origin.
  { name: 'apiUsers',       method: 'GET', endpoint: '/api/users' },
]

function ep(method: string, origin: string, pattern: string): { method: string; origin: string; pattern: string; path: string } {
  return { method, origin, pattern, path: pattern }
}

describe('findMatchingStaticEntries (origin-aware)', () => {
  it('matches only the same-origin entry when the entry has an absolute origin', () => {
    const matches = findMatchingStaticEntries(ep('GET', 'http://localhost:4320', '/api/health'), staticEntries)
    expect(matches.map(e => e.name)).toEqual(['apiHealth_4320'])
  })

  it('does not bleed across MFE origins', () => {
    const matches = findMatchingStaticEntries(ep('GET', 'http://localhost:4310', '/api/health'), staticEntries)
    expect(matches.map(e => e.name)).toEqual(['apiHealth_4310'])
  })

  it('relative entries match any origin', () => {
    const fromA = findMatchingStaticEntries(ep('GET', 'http://localhost:4310', '/api/users'), staticEntries)
    const fromB = findMatchingStaticEntries(ep('GET', 'http://localhost:4320', '/api/users'), staticEntries)
    expect(fromA.map(e => e.name)).toEqual(['apiUsers'])
    expect(fromB.map(e => e.name)).toEqual(['apiUsers'])
  })

  it('still respects method (GET vs POST should not match)', () => {
    const matches = findMatchingStaticEntries(ep('POST', 'http://localhost:4320', '/api/health'), staticEntries)
    expect(matches).toEqual([])
  })

  it('case-insensitive origin compare (URL hosts may differ in case)', () => {
    const matches = findMatchingStaticEntries(ep('GET', 'HTTP://Localhost:4320', '/api/health'), staticEntries)
    expect(matches.map(e => e.name)).toEqual(['apiHealth_4320'])
  })

  it('same-origin runtime calls (origin: "") never match absolute-origin entries', () => {
    // The iframe hitting its own host is a distinct call from any MFE's
    // cross-origin fetch — must not light up the apiHealth_43XX rows.
    const matches = findMatchingStaticEntries(ep('GET', '', '/api/health'), staticEntries)
    expect(matches.map(e => e.name)).toEqual([])
  })

  it('same-origin runtime calls still match relative-endpoint entries', () => {
    const matches = findMatchingStaticEntries(ep('GET', '', '/api/users'), staticEntries)
    expect(matches.map(e => e.name)).toEqual(['apiUsers'])
  })
})

describe('mergeRuntimeOrphansIntoEntries (origin-aware)', () => {
  it('emits one synthetic row per (method, origin, pattern) when no static covers it', () => {
    const runtime: RuntimeEndpoint[] = [
      { method: 'GET', origin: 'http://localhost:4310', path: '/api/foo', pattern: '/api/foo', count: 1, firstSeenAt: 0, lastSeenAt: 0, routes: [], sampleUrls: [] },
      { method: 'GET', origin: 'http://localhost:4320', path: '/api/foo', pattern: '/api/foo', count: 1, firstSeenAt: 0, lastSeenAt: 0, routes: [], sampleUrls: [] },
    ]
    const out = mergeRuntimeOrphansIntoEntries([], runtime)
    expect(out.filter(e => e.discovered_by === 'runtime')).toHaveLength(2)
  })

  it('treats relative-endpoint static rows as covering every origin', () => {
    const staticRel: ProjectDataEntry[] = [
      { kind: 'fetch', name: 'apiFoo', file: 'x.ts', endpoint: '/api/foo', method: 'GET', used_count: 1 },
    ]
    const runtime: RuntimeEndpoint[] = [
      { method: 'GET', origin: 'http://localhost:4310', path: '/api/foo', pattern: '/api/foo', count: 1, firstSeenAt: 0, lastSeenAt: 0, routes: [], sampleUrls: [] },
      { method: 'GET', origin: 'http://localhost:4320', path: '/api/foo', pattern: '/api/foo', count: 1, firstSeenAt: 0, lastSeenAt: 0, routes: [], sampleUrls: [] },
    ]
    const out = mergeRuntimeOrphansIntoEntries(staticRel, runtime)
    expect(out.filter(e => e.discovered_by === 'runtime')).toHaveLength(0)
  })

  it('does not let a same-pattern entry from a different origin claim coverage', () => {
    // Static row pinned to :4310 should NOT cover a runtime call against :4320.
    const staticAbs: ProjectDataEntry[] = [
      { kind: 'fetch', name: 'apiFoo_4310', file: 'a.ts', endpoint: 'http://localhost:4310/api/foo', method: 'GET', used_count: 1 },
    ]
    const runtime: RuntimeEndpoint[] = [
      { method: 'GET', origin: 'http://localhost:4320', path: '/api/foo', pattern: '/api/foo', count: 1, firstSeenAt: 0, lastSeenAt: 0, routes: [], sampleUrls: [] },
    ]
    const out = mergeRuntimeOrphansIntoEntries(staticAbs, runtime)
    const orphans = out.filter(e => e.discovered_by === 'runtime')
    expect(orphans).toHaveLength(1)
    expect(orphans[0].resolved_endpoint).toBe('http://localhost:4320/api/foo')
  })
})
