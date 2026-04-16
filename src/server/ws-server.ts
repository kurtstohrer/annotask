import { WebSocketServer, WebSocket } from 'ws'
import type { IncomingMessage } from 'node:http'
import type { Duplex } from 'node:stream'
import { isLocalOrigin } from './origin.js'

export interface AnnotaskWSServer {
  handleUpgrade: (req: IncomingMessage, socket: Duplex, head: Buffer) => void
  broadcast: (event: string, data: unknown) => void
  getReport: () => unknown
  dispose: () => void
  clients: Set<WebSocket>
}

const PING_INTERVAL = 30_000 // 30s
const MAX_WS_FRAME_BYTES = 1_048_576 // 1 MiB — reports rarely exceed this; guard against DoS

export function createWSServer(): AnnotaskWSServer {
  let currentReport: unknown = null
  const clients = new Set<WebSocket>()
  const alive = new WeakSet<WebSocket>()
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_WS_FRAME_BYTES })

  // Ping all clients periodically; terminate any that didn't pong since last ping
  const pingTimer = setInterval(() => {
    for (const client of clients) {
      if (!alive.has(client)) {
        client.terminate()
        clients.delete(client)
        continue
      }
      alive.delete(client)
      client.ping()
    }
  }, PING_INTERVAL)
  pingTimer.unref()

  wss.on('connection', (ws) => {
    clients.add(ws)
    alive.add(ws)

    ws.on('pong', () => { alive.add(ws) })

    if (currentReport) {
      ws.send(JSON.stringify({ event: 'report:current', data: currentReport, timestamp: Date.now() }))
    }

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString())
        if (msg.event === 'report:updated') {
          currentReport = msg.data
          for (const client of clients) {
            if (client !== ws && client.readyState === WebSocket.OPEN) {
              client.send(JSON.stringify({ event: 'report:updated', data: msg.data, timestamp: Date.now() }))
            }
          }
        }
        if (msg.event === 'changes:cleared') {
          currentReport = null
          for (const client of clients) {
            if (client !== ws && client.readyState === WebSocket.OPEN) {
              client.send(JSON.stringify({ event: 'changes:cleared', data: null, timestamp: Date.now() }))
            }
          }
        }
        if (msg.event === 'get:report') {
          ws.send(JSON.stringify({ event: 'report:current', data: currentReport, timestamp: Date.now() }))
        }
      } catch {}
    })

    ws.on('close', () => { clients.delete(ws) })
  })

  return {
    handleUpgrade(req, socket, head) {
      if (!isLocalOrigin(req.headers.origin as string | undefined)) {
        socket.write('HTTP/1.1 403 Forbidden\r\n\r\n')
        socket.destroy()
        return
      }
      wss.handleUpgrade(req, socket, head, (ws) => { wss.emit('connection', ws, req) })
    },
    broadcast(event, data) {
      const msg = JSON.stringify({ event, data, timestamp: Date.now() })
      for (const client of clients) {
        if (client.readyState === WebSocket.OPEN) client.send(msg)
      }
    },
    getReport() { return currentReport },
    dispose() { clearInterval(pingTimer) },
    clients,
  }
}
