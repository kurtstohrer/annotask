import type { IncomingMessage, ServerResponse } from 'node:http'

export interface APIOptions {
  getReport: () => unknown
  getConfig: () => unknown
  getDesignSpec: () => unknown
  getTasks: () => unknown
  updateTask: (id: string, updates: Record<string, unknown>) => unknown
  addTask: (task: Record<string, unknown>) => unknown
}

const MAX_BODY_SIZE = 1_048_576
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

    if (path === 'tasks' && req.method === 'GET') {
      res.end(JSON.stringify(options.getTasks(), null, 2))
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
