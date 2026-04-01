import type { BridgeMessage } from '../../shared/bridge-types'

type PendingRequest = {
  resolve: (value: any) => void
  reject: (reason?: any) => void
  timer: ReturnType<typeof setTimeout>
}

const listeners = new Map<string, Set<(payload: any) => void>>()
const pending = new Map<string, PendingRequest>()

let targetWindow: Window | null = null
let targetOrigin: string = '*'
let connected = false
let onReadyCallbacks: Array<() => void> = []

function flushReadyCallbacks() {
  if (onReadyCallbacks.length === 0) return
  const cbs = onReadyCallbacks
  onReadyCallbacks = []
  for (const cb of cbs) cb()
}

function handleMessage(event: MessageEvent) {
  const msg = event.data as BridgeMessage
  if (!msg || msg.source !== 'annotask-client') return

  // Verify the message came from our iframe, not an unrelated window
  if (targetWindow && event.source !== targetWindow) return

  // Store the origin from the first bridge:ready message
  if (msg.type === 'bridge:ready') {
    targetOrigin = event.origin || '*'
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

/** Initialize the bridge. Call once when the shell mounts. */
export function initBridge(iframeWindow: Window) {
  targetWindow = iframeWindow
  window.addEventListener('message', handleMessage)
}

/** Destroy the bridge */
export function destroyBridge() {
  window.removeEventListener('message', handleMessage)
  targetWindow = null
  connected = false
  onReadyCallbacks = []
}

/** Reset bridge state for iframe reload (new page load) */
export function resetBridge(iframeWindow: Window) {
  // Cancel pending requests
  for (const [, p] of pending) {
    clearTimeout(p.timer)
    p.reject(new Error('bridge reset'))
  }
  pending.clear()
  targetWindow = iframeWindow
  connected = false
  onReadyCallbacks = []
  targetOrigin = '*'
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
  // Send a ping request; if the client responds, we know it's ready
  request('bridge:ping', {}, 1500)
    .then(() => {
      connected = true
      flushReadyCallbacks()
    })
    .catch(() => { /* client not ready yet — will get bridge:ready later */ })
}

/** Send a request to the bridge client and wait for response */
export function request<T = any>(type: string, payload: unknown = {}, timeout = 3000): Promise<T> {
  return new Promise((resolve, reject) => {
    if (!targetWindow) return reject(new Error('no target window'))
    const id = `req-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
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
  if (!targetWindow) return
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
