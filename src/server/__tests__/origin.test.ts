import { describe, it, expect } from 'vitest'
import { isLocalOrigin, originMatchesPort } from '../origin.js'

describe('isLocalOrigin', () => {
  it('accepts missing origin (same-origin / non-browser)', () => {
    expect(isLocalOrigin(undefined)).toBe(true)
  })

  it('accepts localhost origins on any port', () => {
    expect(isLocalOrigin('http://localhost:5173')).toBe(true)
    expect(isLocalOrigin('http://localhost:3000')).toBe(true)
    expect(isLocalOrigin('http://127.0.0.1:8080')).toBe(true)
  })

  it('rejects non-local origins', () => {
    expect(isLocalOrigin('http://evil.com')).toBe(false)
    expect(isLocalOrigin('http://192.168.1.1:5173')).toBe(false)
  })
})

describe('originMatchesPort', () => {
  it('accepts missing origin (same-origin / non-browser)', () => {
    expect(originMatchesPort(undefined, 5173)).toBe(true)
  })

  it('accepts matching localhost port', () => {
    expect(originMatchesPort('http://localhost:5173', 5173)).toBe(true)
    expect(originMatchesPort('http://127.0.0.1:5173', 5173)).toBe(true)
  })

  it('rejects different localhost port', () => {
    expect(originMatchesPort('http://localhost:3000', 5173)).toBe(false)
    expect(originMatchesPort('http://127.0.0.1:9999', 5173)).toBe(false)
  })

  it('rejects non-local origins even with matching port', () => {
    expect(originMatchesPort('http://evil.com:5173', 5173)).toBe(false)
  })

  it('falls back to port 80/443 when origin port is implicit', () => {
    expect(originMatchesPort('http://localhost', 80)).toBe(true)
    expect(originMatchesPort('https://localhost', 443)).toBe(true)
    expect(originMatchesPort('http://localhost', 5173)).toBe(false)
  })

  it('accepts any local port when server port is unknown', () => {
    expect(originMatchesPort('http://localhost:9999', undefined)).toBe(true)
  })
})
