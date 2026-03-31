import type { IncomingMessage, ServerResponse } from 'node:http'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
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
const VALID_TASK_STATUSES = new Set(['pending', 'in_progress', 'applied', 'review', 'accepted', 'denied'])

/** Fields that PATCH /tasks/:id is allowed to update */
const PATCHABLE_TASK_FIELDS = new Set([
  'status', 'description', 'notes', 'screenshot', 'feedback',
  'intent', 'action', 'context', 'viewport', 'interaction_history',
  'element_context', 'mfe',
])

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

/** Check if an Origin header is from localhost */
function isLocalOrigin(origin: string | undefined): boolean {
  if (!origin) return true // same-origin requests (no Origin header)
  try {
    const url = new URL(origin)
    const host = url.hostname
    return host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '::1'
  } catch {
    return false
  }
}

/** Build CORS origin value — reflect the request origin if it's local, otherwise omit */
function getCorsOrigin(req: IncomingMessage): string | null {
  const origin = req.headers.origin as string | undefined
  if (!origin) return null // same-origin, no CORS header needed
  return isLocalOrigin(origin) ? origin : null
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
      try {
        const data = await fsp.readFile(filePath)
        res.setHeader('Content-Type', 'image/png')
        res.setHeader('Cache-Control', 'public, max-age=3600')
        const corsOrigin = getCorsOrigin(req)
        if (corsOrigin) res.setHeader('Access-Control-Allow-Origin', corsOrigin)
        res.end(data)
      } catch {
        res.statusCode = 404; res.end('Not found')
      }
      return
    }

    if (!req.url?.startsWith('/__annotask/api/')) return next()

    const path = req.url.replace('/__annotask/api/', '')

    // CORS — only allow localhost origins
    const corsOrigin = getCorsOrigin(req)
    res.setHeader('Content-Type', 'application/json')
    if (corsOrigin) {
      res.setHeader('Access-Control-Allow-Origin', corsOrigin)
      res.setHeader('Vary', 'Origin')
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
    res.setHeader('Cache-Control', 'no-cache')

    if (req.method === 'OPTIONS') { res.statusCode = 200; res.end(); return }

    // Block mutating requests from non-local origins
    if ((req.method === 'POST' || req.method === 'PATCH') && !isLocalOrigin(req.headers.origin as string | undefined)) {
      return sendError(res, 403, 'Forbidden: non-local origin')
    }

    if (path === 'report' && req.method === 'GET') {
      const report = options.getReport() as any ?? { version: '1.0', changes: [] }
      const urlObj = new URL(req.url!, `http://${req.headers.host || 'localhost'}`)
      const mfeFilter = urlObj.searchParams.get('mfe')
      if (mfeFilter && report.changes) {
        const filtered = { ...report, changes: report.changes.filter((c: any) => c.mfe === mfeFilter) }
        res.end(JSON.stringify(filtered, null, 2))
      } else {
        res.end(JSON.stringify(report, null, 2))
      }
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
      if (buffer.length > 4 * 1024 * 1024) return sendError(res, 413, 'Screenshot too large (max 4MB)')
      const filename = `screenshot-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.png`
      const dir = nodePath.join(options.projectRoot, '.annotask', 'screenshots')
      await fsp.mkdir(dir, { recursive: true })
      await fsp.writeFile(nodePath.join(dir, filename), buffer)
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
      // Strip unknown fields — only allow whitelisted fields through
      const sanitized: Record<string, unknown> = {}
      for (const key of Object.keys(body)) {
        if (PATCHABLE_TASK_FIELDS.has(key)) {
          sanitized[key] = body[key]
        }
      }
      res.end(JSON.stringify(options.updateTask(id, sanitized), null, 2))
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
