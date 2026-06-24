import { describe, it, expect } from 'vitest'
import { normalizeRoute } from './routes'

describe('normalizeRoute', () => {
  it('empty → /', () => {
    expect(normalizeRoute('')).toBe('/')
  })

  it('preserves root', () => {
    expect(normalizeRoute('/')).toBe('/')
  })

  it('adds leading slash', () => {
    expect(normalizeRoute('foo/bar')).toBe('/foo/bar')
  })

  it('strips trailing slash except on root', () => {
    expect(normalizeRoute('/foo/')).toBe('/foo')
    expect(normalizeRoute('/foo/bar/')).toBe('/foo/bar')
    expect(normalizeRoute('/foo///')).toBe('/foo')
    expect(normalizeRoute('/')).toBe('/')
  })

  it('drops the query string', () => {
    expect(normalizeRoute('/foo?x=1')).toBe('/foo')
  })

  it('drops plain scroll anchors (no leading slash after #)', () => {
    expect(normalizeRoute('/foo#bar')).toBe('/foo')
    expect(normalizeRoute('/foo?x=1#bar')).toBe('/foo')
    expect(normalizeRoute('#top')).toBe('/')
  })

  it('keeps hash ROUTES (#/… — hash-history / single-spa)', () => {
    expect(normalizeRoute('/#/react')).toBe('/#/react')
    expect(normalizeRoute('#/vue')).toBe('/#/vue')
    expect(normalizeRoute('/#/react?tab=workflows')).toBe('/#/react?tab=workflows')
  })

  it('distinguishes hash routes so they no longer collapse to the pathname', () => {
    expect(normalizeRoute('/#/react')).not.toBe(normalizeRoute('/#/vue'))
  })
})
