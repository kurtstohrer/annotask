/**
 * Server discovery file — .annotask/server.json
 * Written on startup so skills and CLI know where to connect.
 */
import fs from 'node:fs'
import path from 'node:path'

export interface ServerInfo {
  url: string
  port: number
  pid: number
  mfe?: string
}

export function writeServerInfo(projectRoot: string, port: number, host?: string) {
  const dir = path.join(projectRoot, '.annotask')
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  // Wildcard/unspecified addresses aren't routable — resolve to localhost
  const resolvedHost = (host && host !== '0.0.0.0' && host !== '::' && host !== '::1') ? host : 'localhost'
  const info: ServerInfo = { url: `http://${resolvedHost}:${port}`, port, pid: process.pid }
  // 0o600: contains a live PID + port; on shared machines other users have no reason to read it.
  fs.writeFileSync(path.join(dir, 'server.json'), JSON.stringify(info, null, 2), { mode: 0o600 })
}

export function readServerInfo(projectRoot: string): ServerInfo | null {
  try {
    const raw = fs.readFileSync(path.join(projectRoot, '.annotask', 'server.json'), 'utf-8')
    return JSON.parse(raw)
  } catch { return null }
}

export function writeMfeServerInfo(projectRoot: string, serverUrl: string, mfe: string) {
  const dir = path.join(projectRoot, '.annotask')
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  const url = new URL(serverUrl)
  const info: ServerInfo = { url: serverUrl, port: parseInt(url.port) || 80, pid: 0, mfe }
  fs.writeFileSync(path.join(dir, 'server.json'), JSON.stringify(info, null, 2), { mode: 0o600 })
}

export function removeServerInfo(projectRoot: string) {
  try { fs.unlinkSync(path.join(projectRoot, '.annotask', 'server.json')) } catch {}
}
