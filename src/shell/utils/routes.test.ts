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

  it('drops query and hash', () => {
    expect(normalizeRoute('/foo?x=1')).toBe('/foo')
    expect(normalizeRoute('/foo#bar')).toBe('/foo')
    expect(normalizeRoute('/foo?x=1#bar')).toBe('/foo')
  })

  it('handles hash-only paths', () => {
    expect(normalizeRoute('#top')).toBe('/')
  })
})
