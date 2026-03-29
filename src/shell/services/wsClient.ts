/**
 * Shared WebSocket client for the Annotask shell.
 *
 * Replaces 3 separate connections (useStyleEditor, useDesignSpec, useTasks)
 * with a single connection to /__annotask/ws. Provides event-based
 * subscribe/send with exponential backoff reconnection.
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
