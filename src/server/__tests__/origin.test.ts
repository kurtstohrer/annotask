import { describe, it, expect, afterEach } from 'vitest'
import { isAllowedHost, isLocalOrigin, originMatchesPort } from '../origin.js'

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

describe('isAllowedHost (DNS-rebinding gate)', () => {
  afterEach(() => {
    delete process.env.ANNOTASK_ALLOWED_HOSTS
  })

  it('accepts a missing Host header (HTTP/1.0 / non-browser clients)', () => {
    expect(isAllowedHost(undefined)).toBe(true)
    expect(isAllowedHost('')).toBe(true)
  })

  it('accepts localhost hostnames on any port', () => {
    expect(isAllowedHost('localhost')).toBe(true)
    expect(isAllowedHost('localhost:5173')).toBe(true)
    expect(isAllowedHost('127.0.0.1:8080')).toBe(true)
    expect(isAllowedHost('[::1]:5173')).toBe(true)
  })

  it('accepts IP literals (a typed-in LAN address cannot be a rebound DNS name)', () => {
    expect(isAllowedHost('192.168.1.5:5173')).toBe(true)
    expect(isAllowedHost('10.0.0.7')).toBe(true)
    expect(isAllowedHost('[fe80::1]:5173')).toBe(true)
  })

  it('rejects non-local hostnames by default', () => {
    expect(isAllowedHost('evil.example')).toBe(false)
    expect(isAllowedHost('evil.example:5173')).toBe(false)
    expect(isAllowedHost('localhost.evil.example')).toBe(false)
  })

  it('rejects garbage Host values', () => {
    expect(isAllowedHost('   ')).toBe(false)
    expect(isAllowedHost('not a host')).toBe(false)
  })

  it('accepts hosts in extraAllowed (port-insensitive, case-insensitive)', () => {
    expect(isAllowedHost('dev.example.com:5173', ['dev.example.com'])).toBe(true)
    expect(isAllowedHost('DEV.Example.COM', ['dev.example.com'])).toBe(true)
    expect(isAllowedHost('dev.example.com', ['dev.example.com:9999'])).toBe(true)
    expect(isAllowedHost('other.example.com', ['dev.example.com'])).toBe(false)
  })

  it("supports '*' (Vite allowedHosts: true) and leading-dot suffix entries", () => {
    expect(isAllowedHost('anything.example', ['*'])).toBe(true)
    expect(isAllowedHost('app.example.com', ['.example.com'])).toBe(true)
    expect(isAllowedHost('example.com', ['.example.com'])).toBe(true)
    expect(isAllowedHost('notexample.com', ['.example.com'])).toBe(false)
  })

  it('honors ANNOTASK_ALLOWED_HOSTS (comma-separated)', () => {
    process.env.ANNOTASK_ALLOWED_HOSTS = 'tunnel.example, myhost.local'
    expect(isAllowedHost('tunnel.example:5173')).toBe(true)
    expect(isAllowedHost('myhost.local')).toBe(true)
    expect(isAllowedHost('evil.example')).toBe(false)
  })
})
