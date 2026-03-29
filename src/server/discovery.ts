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
}

export function writeServerInfo(projectRoot: string, port: number) {
  const dir = path.join(projectRoot, '.annotask')
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  const info: ServerInfo = { url: `http://localhost:${port}`, port, pid: process.pid }
  fs.writeFileSync(path.join(dir, 'server.json'), JSON.stringify(info, null, 2))
}

export function readServerInfo(projectRoot: string): ServerInfo | null {
  try {
    const raw = fs.readFileSync(path.join(projectRoot, '.annotask', 'server.json'), 'utf-8')
    return JSON.parse(raw)
  } catch { return null }
}

export function removeServerInfo(projectRoot: string) {
  try { fs.unlinkSync(path.join(projectRoot, '.annotask', 'server.json')) } catch {}
}
