/**
 * Shell-side postMessage bridge for communicating with the client script
 * running inside the user's app (potentially cross-origin iframe).
 */
import type { BridgeMessage } from '../../shared/bridge-types'

type Handler = (payload: any) => void
type PendingRequest = {
  resolve: (value: any) => void
  reject: (reason: any) => void
  timer: ReturnType<typeof setTimeout>
}

let counter = 0
const pending = new Map<string, PendingRequest>()
const listeners = new Map<string, Set<Handler>>()
let targetWindow: Window | null = null
let targetOrigin: string = '*'
let connected = false
let onReadyCallbacks: Array<() => void> = []

function handleMessage(event: MessageEvent) {
  const msg = event.data as BridgeMessage
  if (!msg || msg.source !== 'annotask-client') return

  // Verify the message came from our iframe, not an unrelated window
  if (targetWindow && event.source !== targetWindow) return

  // Store the origin from the first bridge:ready message
  if (msg.type === 'bridge:ready') {
    targetOrigin = event.origin || '*'
    connected = true
    for (const cb of onReadyCallbacks) cb()
    onReadyCallbacks = []
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
  connected = false
  targetOrigin = '*'
  window.addEventListener('message', handleMessage)
}

/** Clean up. Call when the shell unmounts or iframe navigates. */
export function destroyBridge() {
  window.removeEventListener('message', handleMessage)
  for (const [, p] of pending) {
    clearTimeout(p.timer)
    p.reject(new Error('bridge destroyed'))
  }
  pending.clear()
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
  targetOrigin = '*'
}

/** Register a callback for when the client sends bridge:ready */
export function onBridgeReady(cb: () => void) {
  if (connected) { cb(); return }
  onReadyCallbacks.push(cb)
}

/** Whether the bridge is currently connected */
export function isBridgeConnected(): boolean {
  return connected
}

/** Send a fire-and-forget message to the client */
export function send(type: string, payload: unknown = {}) {
  if (!targetWindow) return
  const msg: BridgeMessage = { type, payload, source: 'annotask-shell' }
  targetWindow.postMessage(msg, targetOrigin)
}

/** Send a request and wait for a response */
export function request<T = unknown>(type: string, payload: unknown = {}, timeout = 5000): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (!targetWindow) {
      reject(new Error('bridge not connected'))
      return
    }
    const id = `req-${++counter}`
    const timer = setTimeout(() => {
      pending.delete(id)
      reject(new Error(`bridge timeout: ${type}`))
    }, timeout)
    pending.set(id, { resolve: resolve as (v: any) => void, reject, timer })
    const msg: BridgeMessage = { type, id, payload, source: 'annotask-shell' }
    targetWindow.postMessage(msg, targetOrigin)
  })
}

/** Subscribe to push events from the client. Returns unsubscribe function. */
export function on(type: string, handler: Handler): () => void {
  if (!listeners.has(type)) listeners.set(type, new Set())
  listeners.get(type)!.add(handler)
  return () => { listeners.get(type)?.delete(handler) }
}
