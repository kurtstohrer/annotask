import type { IncomingMessage, ServerResponse } from 'node:http'
import fs from 'node:fs'
import nodePath from 'node:path'

export interface APIOptions {
  projectRoot: string
  getReport: () => unknown
  getConfig: () => unknown
  getDesignSpec: () => unknown
  getTasks: () => { version: string; tasks: any[] }
  updateTask: (id: string, updates: Record<string, unknown>) => unknown
  addTask: (task: Record<string, unknown>) => unknown
}

const MAX_BODY_SIZE = 4_194_304
const VALID_TASK_STATUSES = new Set(['pending', 'applied', 'review', 'accepted', 'denied'])

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = ''
    let size = 0
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > MAX_BODY_SIZE) { req.destroy(); reject(new Error('Request body too large')); return }
      body += chunk.toString()
    })
    req.on('end', () => resolve(body))
    req.on('error', reject)
  })
}

function parseJSON(raw: string): { ok: true; data: unknown } | { ok: false } {
  try { return { ok: true, data: JSON.parse(raw) } } catch { return { ok: false } }
}

function sendError(res: ServerResponse, status: number, message: string) {
  res.statusCode = status
  res.end(JSON.stringify({ error: message }))
}

export function createAPIMiddleware(options: APIOptions) {
  return async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    // Serve screenshots (outside /api/ path)
    if (req.url?.startsWith('/__annotask/screenshots/') && req.method === 'GET') {
      const filename = (req.url.replace('/__annotask/screenshots/', '')).replace(/\?.*$/, '')
      if (!/^[a-zA-Z0-9_-]+\.png$/.test(filename)) {
        res.statusCode = 400; res.end('Invalid filename'); return
      }
      const filePath = nodePath.join(options.projectRoot, '.annotask', 'screenshots', filename)
      if (!fs.existsSync(filePath)) {
        res.statusCode = 404; res.end('Not found'); return
      }
      res.setHeader('Content-Type', 'image/png')
      res.setHeader('Cache-Control', 'public, max-age=3600')
      res.setHeader('Access-Control-Allow-Origin', '*')
      res.end(fs.readFileSync(filePath))
      return
    }

    if (!req.url?.startsWith('/__annotask/api/')) return next()

    const path = req.url.replace('/__annotask/api/', '')

    res.setHeader('Content-Type', 'application/json')
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
    res.setHeader('Cache-Control', 'no-cache')

    if (req.method === 'OPTIONS') { res.statusCode = 200; res.end(); return }

    if (path === 'report' && req.method === 'GET') {
      res.end(JSON.stringify(options.getReport() ?? { version: '1.0', changes: [] }, null, 2))
      return
    }

    if (path === 'config' && req.method === 'GET') {
      res.end(JSON.stringify(options.getConfig(), null, 2))
      return
    }

    if (path === 'design-spec' && req.method === 'GET') {
      res.end(JSON.stringify(options.getDesignSpec(), null, 2))
      return
    }

    if (path.startsWith('tasks') && !path.startsWith('tasks/') && req.method === 'GET') {
      const urlObj = new URL(req.url!, `http://${req.headers.host || 'localhost'}`)
      const mfeFilter = urlObj.searchParams.get('mfe')
      const taskData = options.getTasks()
      if (mfeFilter) {
        const filtered = { ...taskData, tasks: taskData.tasks.filter((t: any) => t.mfe === mfeFilter) }
        res.end(JSON.stringify(filtered, null, 2))
      } else {
        res.end(JSON.stringify(taskData, null, 2))
      }
      return
    }

    if (path === 'tasks' && req.method === 'POST') {
      let raw: string
      try { raw = await readBody(req) } catch { return sendError(res, 413, 'Request body too large') }
      const parsed = parseJSON(raw)
      if (!parsed.ok) return sendError(res, 400, 'Invalid JSON body')
      const body = parsed.data as Record<string, unknown>
      if (!body || typeof body !== 'object' || Array.isArray(body)) return sendError(res, 400, 'Request body must be a JSON object')
      if (typeof body.type !== 'string' || !body.type) return sendError(res, 400, 'Missing required field: type (string)')
      if (typeof body.description !== 'string') return sendError(res, 400, 'Missing required field: description (string)')
      res.end(JSON.stringify(options.addTask(body), null, 2))
      return
    }

    if (path === 'screenshots' && req.method === 'POST') {
      let raw: string
      try { raw = await readBody(req) } catch { return sendError(res, 413, 'Request body too large') }
      const parsed = parseJSON(raw)
      if (!parsed.ok) return sendError(res, 400, 'Invalid JSON body')
      const body = parsed.data as { data: string }
      if (!body.data || typeof body.data !== 'string') return sendError(res, 400, 'Missing data field')
      const match = body.data.match(/^data:image\/png;base64,(.+)$/)
      if (!match) return sendError(res, 400, 'Invalid PNG data URL')
      const buffer = Buffer.from(match[1], 'base64')
      if (buffer.length > 2 * 1024 * 1024) return sendError(res, 413, 'Screenshot too large (max 2MB)')
      const filename = `screenshot-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.png`
      const dir = nodePath.join(options.projectRoot, '.annotask', 'screenshots')
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
      fs.writeFileSync(nodePath.join(dir, filename), buffer)
      res.end(JSON.stringify({ filename }))
      return
    }

    if (path.startsWith('tasks/') && req.method === 'PATCH') {
      const id = path.replace('tasks/', '')
      let raw: string
      try { raw = await readBody(req) } catch { return sendError(res, 413, 'Request body too large') }
      const parsed = parseJSON(raw)
      if (!parsed.ok) return sendError(res, 400, 'Invalid JSON body')
      const body = parsed.data as Record<string, unknown>
      if (!body || typeof body !== 'object' || Array.isArray(body)) return sendError(res, 400, 'Request body must be a JSON object')
      if (body.status !== undefined && !VALID_TASK_STATUSES.has(body.status as string)) {
        return sendError(res, 400, `Invalid status. Must be one of: ${[...VALID_TASK_STATUSES].join(', ')}`)
      }
      res.end(JSON.stringify(options.updateTask(id, body), null, 2))
      return
    }

    if (path === 'status' && req.method === 'GET') {
      res.end(JSON.stringify({ status: 'ok', tool: 'annotask' }))
      return
    }

    res.statusCode = 404
    res.end(JSON.stringify({ error: 'Not found' }))
  }
}
