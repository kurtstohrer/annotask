import { describe, it, expect, afterEach } from 'vitest'
import { JSDOM } from 'jsdom'
import { bridgeClientScript } from '../bridge-client'

/**
 * Origin hardening for the in-iframe bridge (src/plugin/bridge/).
 *
 * The bridge runs inside the user's app page and talks to the shell via
 * postMessage. These tests pin the security contract:
 * - incoming commands are only accepted from LOCAL origins (localhost /
 *   127.0.0.1 / [::1]), mirroring the server's isLocalHostname — port-agnostic
 *   because the webpack standalone shell runs on a different port than the app
 * - the first validated sender locks shellOrigin; later messages from any
 *   other origin (even local ones) are ignored
 * - no app data is ever posted to '*': only the data-free bridge:ready
 *   handshake may broadcast; everything else queues (bounded) until lock.
 *
 * The bridge is a vanilla-JS IIFE string evaluated in the app page, so the
 * tests eval it inside a fresh JSDOM window per test (node environment —
 * the shared vitest jsdom global would leak listeners between tests because
 * the bridge guards itself with window.__ANNOTASK_BRIDGE__).
 */

interface Post {
  data: { type: string | null; payload: Record<string, unknown>; source: string; id?: string }
  origin: string
}

interface BridgeHarness {
  dom: JSDOM
  win: any
  posts: Post[]
}

const openWindows: JSDOM[] = []

function createBridgeWindow(): BridgeHarness {
  const dom = new JSDOM('<!doctype html><html><body><div id="app"></div></body></html>', {
    url: 'http://localhost:5173/',
    runScripts: 'outside-only',
    pretendToBeVisual: true,
  })
  openWindows.push(dom)
  const win = dom.window as any
  const posts: Post[] = []
  // Outside an iframe window.parent === window, so the bridge's
  // window.parent.postMessage(...) resolves to this interceptor — it records
  // exactly what the bridge sends "to the shell" and with which targetOrigin.
  win.postMessage = (data: Post['data'], origin: string) => {
    posts.push({ data, origin })
  }
  win.eval(bridgeClientScript())
  return { dom, win, posts }
}

/** Dispatch a message event as if a (possibly hostile) parent posted it. */
function shellMessage(win: any, origin: string, type: string, extra: Record<string, unknown> = {}) {
  win.dispatchEvent(
    new win.MessageEvent('message', {
      data: { source: 'annotask-shell', type, payload: {}, ...extra },
      origin,
    })
  )
}

afterEach(() => {
  // Close windows so the bridge's setInterval route poller doesn't keep the
  // worker alive across tests.
  while (openWindows.length > 0) openWindows.pop()!.window.close()
})

describe('bridge postMessage origin validation', () => {
  it('posts bridge:ready to * on boot, and nothing else to *', () => {
    const { posts } = createBridgeWindow()
    const wildcard = posts.filter((p) => p.origin === '*')
    expect(wildcard.length).toBe(1)
    expect(wildcard[0].data.type).toBe('bridge:ready')
  })

  it('ignores commands from a non-local origin (no response, no execution, no lock)', () => {
    const { win, posts } = createBridgeWindow()

    shellMessage(win, 'https://evil.example', 'bridge:ping', { id: 'evil-ping' })
    // State-changing command must not execute either.
    shellMessage(win, 'https://evil.example', 'theme:inject-css', {
      id: 'evil-css',
      payload: { styleId: 'evil-style', css: 'body { display: none }' },
    })
    // Opaque origins (sandboxed iframes, file://) arrive as the string 'null'.
    shellMessage(win, 'null', 'bridge:ping', { id: 'opaque-ping' })

    expect(posts.some((p) => p.data.id === 'evil-ping')).toBe(false)
    expect(posts.some((p) => p.data.id === 'evil-css')).toBe(false)
    expect(posts.some((p) => p.data.id === 'opaque-ping')).toBe(false)
    expect(win.document.getElementById('evil-style')).toBeNull()

    // The rejected sender must not have locked the session: pushes still
    // queue rather than posting (shellOrigin would be the evil origin otherwise).
    win.console.error('post-evil boom')
    expect(posts.some((p) => p.data.type === 'error:console')).toBe(false)
  })

  it('processes a local-origin message and locks shellOrigin to it', () => {
    const { win, posts } = createBridgeWindow()

    shellMessage(win, 'http://localhost:5173', 'bridge:ping', { id: 'p1' })

    const reply = posts.find((p) => p.data.id === 'p1')
    expect(reply).toBeDefined()
    expect(reply!.origin).toBe('http://localhost:5173')
    expect(reply!.data.payload).toEqual({ ok: true })

    // Locked: pushes now go straight to the validated origin, never '*'.
    win.console.error('post-lock boom')
    const err = posts.find((p) => p.data.type === 'error:console')
    expect(err).toBeDefined()
    expect(err!.origin).toBe('http://localhost:5173')
  })

  it('accepts a different localhost port (webpack standalone topology)', () => {
    const { win, posts } = createBridgeWindow()
    shellMessage(win, 'http://127.0.0.1:24678', 'bridge:ping', { id: 'wp1' })
    const reply = posts.find((p) => p.data.id === 'wp1')
    expect(reply).toBeDefined()
    expect(reply!.origin).toBe('http://127.0.0.1:24678')
  })

  it('rejects messages from a different origin after lock, even local ones', () => {
    const { win, posts } = createBridgeWindow()
    shellMessage(win, 'http://localhost:5173', 'bridge:ping', { id: 'p1' })
    expect(posts.some((p) => p.data.id === 'p1')).toBe(true)

    // A second local-but-different context must not hijack the session.
    shellMessage(win, 'http://127.0.0.1:9999', 'bridge:ping', { id: 'hijack' })
    shellMessage(win, 'http://127.0.0.1:9999', 'theme:inject-css', {
      id: 'hijack-css',
      payload: { styleId: 'hijack-style', css: 'body { display: none }' },
    })

    expect(posts.some((p) => p.data.id === 'hijack')).toBe(false)
    expect(posts.some((p) => p.data.id === 'hijack-css')).toBe(false)
    expect(win.document.getElementById('hijack-style')).toBeNull()

    // Same origin keeps working.
    shellMessage(win, 'http://localhost:5173', 'bridge:ping', { id: 'p2' })
    const reply2 = posts.find((p) => p.data.id === 'p2')
    expect(reply2).toBeDefined()
    expect(reply2!.origin).toBe('http://localhost:5173')
  })

  it('queues pre-lock pushes instead of posting to *, then flushes to the locked origin', () => {
    const { win, posts } = createBridgeWindow()

    // The bridge patches console.error → sendToShell('error:console', ...).
    win.console.error('pre-lock boom')

    // Not posted anywhere yet — and in particular never to '*'.
    expect(posts.some((p) => p.data.type === 'error:console')).toBe(false)
    expect(posts.filter((p) => p.origin === '*').every((p) => p.data.type === 'bridge:ready')).toBe(true)

    shellMessage(win, 'http://localhost:5173', 'bridge:ping', { id: 'p1' })

    const err = posts.find((p) => p.data.type === 'error:console')
    expect(err).toBeDefined()
    expect(err!.origin).toBe('http://localhost:5173')
    expect(err!.data.payload.message).toContain('pre-lock boom')
  })

  it('bounds the pre-lock queue at 50 entries', () => {
    const { win, posts } = createBridgeWindow()
    for (let i = 0; i < 60; i++) win.console.error('flood ' + i)
    shellMessage(win, 'http://localhost:5173', 'bridge:ping', { id: 'p1' })

    const errs = posts.filter((p) => p.data.type === 'error:console')
    expect(errs.length).toBe(50)
    expect(errs.every((p) => p.origin === 'http://localhost:5173')).toBe(true)
  })

  it('never posts app data to * across the whole lifecycle', () => {
    const { win, posts } = createBridgeWindow()
    win.console.error('boom')
    shellMessage(win, 'https://evil.example', 'bridge:ping', { id: 'e1' })
    shellMessage(win, 'http://localhost:5173', 'bridge:ping', { id: 'p1' })
    win.console.warn('warn after lock')
    shellMessage(win, 'http://localhost:4000', 'bridge:ping', { id: 'p3' })

    for (const p of posts) {
      if (p.origin === '*') expect(p.data.type).toBe('bridge:ready')
    }
    // Sanity: lifecycle actually produced locked-origin traffic.
    expect(posts.some((p) => p.origin === 'http://localhost:5173')).toBe(true)
  })
})
