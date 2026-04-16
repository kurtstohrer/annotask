import type { BridgeMessage } from '../../shared/bridge-types'

type PendingRequest = {
  resolve: (value: any) => void
  reject: (reason?: any) => void
  timer: ReturnType<typeof setTimeout>
}

const listeners = new Map<string, Set<(payload: any) => void>>()
const pending = new Map<string, PendingRequest>()

let targetWindow: Window | null = null
/**
 * The concrete origin to post to. '' means "unknown — do not send yet". Historically this
 * defaulted to '*', which leaked messages for any send that happened before the client
 * responded with bridge:ready. Callers (useIframeManager) now pass the iframe's src origin
 * up front, and we refuse to post to an unresolved origin.
 */
let targetOrigin: string = ''
let connected = false
let onReadyCallbacks: Array<() => void> = []
let requestSeq = 0

function flushReadyCallbacks() {
  if (onReadyCallbacks.length === 0) return
  const cbs = onReadyCallbacks
  onReadyCallbacks = []
  for (const cb of cbs) cb()
}

function isOriginCompatible(candidate: string): boolean {
  // Accept the pre-declared origin, or upgrade from unknown once the client announces itself.
  if (!targetOrigin) return true
  return candidate === targetOrigin
}

function handleMessage(event: MessageEvent) {
  const msg = event.data as BridgeMessage
  if (!msg || msg.source !== 'annotask-client') return

  // Verify the message came from our iframe window, not an unrelated window
  if (targetWindow && event.source !== targetWindow) return

  // Verify the message origin matches our expected origin (tightens a previous loophole
  // where the first message could set targetOrigin to any value).
  if (!isOriginCompatible(event.origin)) return

  if (msg.type === 'bridge:ready') {
    // Only adopt a concrete origin; never downgrade a known-good origin to ''.
    if (event.origin) targetOrigin = event.origin
    connected = true
    flushReadyCallbacks()
    emit('bridge:ready', msg.payload)
    return
  }

  // Response to a pending request
  if (msg.id && pending.has(msg.id)) {
    const p = pending.get(msg.id)!
    clearTimeout(p.timer)
    pending.delete(msg.id)
    p.resolve(msg.payload)
    return
  }

  // Event from client (no id = push event)
  emit(msg.type, msg.payload)
}

function emit(type: string, payload: unknown) {
  const handlers = listeners.get(type)
  if (handlers) {
    for (const h of handlers) h(payload)
  }
}

function deriveOriginFromIframe(win: Window): string {
  // Try the contentWindow first (fails cross-origin, which is fine — fall through).
  try {
    const o = (win as any).location?.origin as string | undefined
    if (typeof o === 'string' && o && o !== 'null') return o
  } catch { /* cross-origin access, drop through */ }
  return ''
}

/** Initialize the bridge. Call once when the shell mounts.
 *  `expectedOrigin` — if provided, caller knows the iframe's origin (e.g. from iframe.src)
 *  and we pin targetOrigin up front. Otherwise we try to derive it from the window,
 *  and fall back to waiting for the client's bridge:ready message. */
export function initBridge(iframeWindow: Window, expectedOrigin?: string) {
  targetWindow = iframeWindow
  if (expectedOrigin) targetOrigin = expectedOrigin
  else if (!targetOrigin) targetOrigin = deriveOriginFromIframe(iframeWindow)
  window.addEventListener('message', handleMessage)
}

/** Destroy the bridge */
export function destroyBridge() {
  window.removeEventListener('message', handleMessage)
  targetWindow = null
  targetOrigin = ''
  connected = false
  onReadyCallbacks = []
}

/** Reset bridge state for iframe reload (new page load).
 *  If `expectedOrigin` is provided we pin it; otherwise we keep the previously-known
 *  origin (most reloads stay on the same origin) so we don't reopen the '*' window. */
export function resetBridge(iframeWindow: Window, expectedOrigin?: string) {
  // Cancel pending requests
  for (const [, p] of pending) {
    clearTimeout(p.timer)
    p.reject(new Error('bridge reset'))
  }
  pending.clear()
  targetWindow = iframeWindow
  connected = false
  onReadyCallbacks = []
  if (expectedOrigin) targetOrigin = expectedOrigin
  else {
    const derived = deriveOriginFromIframe(iframeWindow)
    if (derived) targetOrigin = derived
    // else keep the previously-adopted origin — safer than reverting to unknown
  }
}

/** Register a callback for when the client sends bridge:ready */
export function onBridgeReady(cb: () => void) {
  if (connected) { cb(); return }
  onReadyCallbacks.push(cb)
}

/** Whether the bridge is currently connected */
export function isConnected() { return connected }

/** Probe the bridge — send a ping to check if client is alive.
 *  If it responds, mark as connected and flush ready callbacks. */
export function probeBridge() {
  if (connected) { flushReadyCallbacks(); return }
  if (!targetWindow) return
  if (!targetOrigin) return // can't probe until we know where to post
  request('bridge:ping', {}, 1500)
    .then(() => {
      connected = true
      flushReadyCallbacks()
    })
    .catch(() => { /* client not ready yet — will get bridge:ready later */ })
}

function nextRequestId(): string {
  requestSeq = (requestSeq + 1) | 0
  return `req-${Date.now().toString(36)}-${requestSeq.toString(36)}`
}

/** Send a request to the bridge client and wait for response */
export function request<T = any>(type: string, payload: unknown = {}, timeout = 3000): Promise<T> {
  return new Promise((resolve, reject) => {
    if (!targetWindow) return reject(new Error('no target window'))
    if (!targetOrigin) return reject(new Error('bridge target origin unknown — refusing to post'))
    const id = nextRequestId()
    const timer = setTimeout(() => {
      pending.delete(id)
      reject(new Error(`bridge request '${type}' timed out`))
    }, timeout)
    pending.set(id, { resolve, reject, timer })
    targetWindow.postMessage({ source: 'annotask-shell', type, id, payload }, targetOrigin)
  })
}

/** Send a fire-and-forget message to the bridge client (no response expected) */
export function send(type: string, payload: unknown = {}) {
  if (!targetWindow || !targetOrigin) return
  targetWindow.postMessage({ source: 'annotask-shell', type, payload }, targetOrigin)
}

/** Listen for events from the bridge client */
export function on(type: string, handler: (payload: any) => void) {
  if (!listeners.has(type)) listeners.set(type, new Set())
  listeners.get(type)!.add(handler)
}

/** Remove an event listener */
export function off(type: string, handler: (payload: any) => void) {
  listeners.get(type)?.delete(handler)
}
