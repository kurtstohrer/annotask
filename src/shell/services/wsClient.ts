/**
 * Shared WebSocket client for the Annotask shell.
 *
 * Replaces 3 separate connections (useStyleEditor, useDesignSpec, useTasks)
 * with a single connection to /__annotask/ws. Provides event-based
 * subscribe/send with exponential backoff reconnection.
 *
 * Background-tab resilience:
 * - The server pings every 30s; the browser auto-replies with pong.
 * - On visibilitychange → visible, we check the socket state and
 *   reconnect immediately if it's gone stale while backgrounded.
 */

type Handler = (data: unknown) => void

let ws: WebSocket | null = null
let attempt = 0
let reconnectTimer: ReturnType<typeof setTimeout> | null = null
const listeners = new Map<string, Set<Handler>>()

function getUrl() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${protocol}//${window.location.host}/__annotask/ws`
}

function connect() {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return

  try {
    ws = new WebSocket(getUrl())

    ws.onopen = () => {
      attempt = 0
      console.log('[Annotask] WebSocket connected')
    }

    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data)
        if (msg.event) {
          const handlers = listeners.get(msg.event)
          if (handlers) {
            for (const handler of handlers) handler(msg.data)
          }
        }
      } catch { /* ignore parse errors */ }
    }

    ws.onclose = () => {
      ws = null
      scheduleReconnect()
    }

    ws.onerror = () => { /* onclose will fire */ }
  } catch {
    scheduleReconnect()
  }
}

function scheduleReconnect() {
  if (reconnectTimer) return
  attempt++
  const delay = Math.min(1000 * Math.pow(2, attempt - 1), 30000)
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null
    connect()
  }, delay)
}

/** Immediately reconnect if the connection is dead */
function ensureConnected() {
  if (ws?.readyState === WebSocket.OPEN) return
  // Cancel any pending slow backoff timer and reconnect now
  if (reconnectTimer) {
    clearTimeout(reconnectTimer)
    reconnectTimer = null
  }
  attempt = 0
  connect()
}

// When the tab becomes visible again, verify the connection is alive.
// Background tabs can miss the close event if the OS/browser killed the socket.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') ensureConnected()
})

export function on(event: string, handler: Handler): () => void {
  if (!listeners.has(event)) listeners.set(event, new Set())
  listeners.get(event)!.add(handler)
  return () => { listeners.get(event)?.delete(handler) }
}

export function send(event: string, data: unknown) {
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ event, data, timestamp: Date.now() }))
  }
}

export function isConnected(): boolean {
  return ws?.readyState === WebSocket.OPEN
}

// Auto-connect on first import
connect()
