import type { IncomingMessage, ServerResponse } from 'node:http'
import fsp from 'node:fs/promises'
import crypto from 'node:crypto'
import nodePath from 'node:path'
import { isSafeScreenshot } from './validation.js'
import {
  CreateTaskBody,
  UpdateTaskBody,
  UploadScreenshotBody,
  parseWith,
  assertTransition,
} from './schemas.js'

export interface APIOptions {
  projectRoot: string
  getReport: () => unknown
  getConfig: () => unknown
  getDesignSpec: () => unknown
  getTasks: () => { version: string; tasks: Array<Record<string, unknown>> }
  updateTask: (id: string, updates: Record<string, unknown>) => unknown | Promise<unknown>
  deleteTask: (id: string) => unknown | Promise<unknown>
  addTask: (task: Record<string, unknown>) => unknown | Promise<unknown>
  getPerformance: () => unknown
  setPerformance: (data: unknown) => void
}

const MAX_BODY_SIZE = 4_194_304

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

/**
 * Error-response codes. Clients key off `error.code` to localize or react programmatically;
 * `error.message` is for human display and debugging.
 */
export type ApiErrorCode =
  | 'invalid_json'
  | 'body_too_large'
  | 'body_not_object'
  | 'validation_failed'
  | 'invalid_transition'
  | 'forbidden_origin'
  | 'not_found'
  | 'missing_field'

export interface ApiErrorBody {
  error: { code: ApiErrorCode; message: string }
}

function sendError(res: ServerResponse, status: number, message: string, code: ApiErrorCode = 'validation_failed') {
  res.statusCode = status
  const body: ApiErrorBody = { error: { code, message } }
  res.end(JSON.stringify(body))
}

import { isLocalOrigin } from './origin.js'
import { scanComponentLibraries } from './component-scanner.js'
import { filterTasksByMfe } from '../shared/task-summary.js'

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
      if (!isSafeScreenshot(filename)) {
        res.statusCode = 400; res.end('Invalid filename'); return
      }
      const screenshotsDir = nodePath.resolve(options.projectRoot, '.annotask', 'screenshots')
      const filePath = nodePath.resolve(screenshotsDir, filename)
      if (!filePath.startsWith(screenshotsDir + nodePath.sep)) {
        res.statusCode = 403; res.end('Forbidden'); return
      }
      try {
        const data = await fsp.readFile(filePath)
        res.setHeader('Content-Type', 'image/png')
        res.setHeader('Cache-Control', 'private, max-age=3600')
        const corsOrigin = getCorsOrigin(req)
        if (corsOrigin) res.setHeader('Access-Control-Allow-Origin', corsOrigin)
        res.end(data)
      } catch {
        res.statusCode = 404; res.end('Not found')
      }
      return
    }

    if (!req.url?.startsWith('/__annotask/api/')) return next()

    const pathWithQuery = req.url.replace('/__annotask/api/', '')
    const path = pathWithQuery.split('?')[0]

    // CORS — only allow localhost origins
    const corsOrigin = getCorsOrigin(req)
    res.setHeader('Content-Type', 'application/json')
    if (corsOrigin) {
      res.setHeader('Access-Control-Allow-Origin', corsOrigin)
      res.setHeader('Vary', 'Origin')
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
    res.setHeader('Cache-Control', 'no-store')

    if (req.method === 'OPTIONS') { res.statusCode = 200; res.end(); return }

    // Block mutating requests from non-local origins
    if ((req.method === 'POST' || req.method === 'PATCH' || req.method === 'DELETE') && !isLocalOrigin(req.headers.origin as string | undefined)) {
      return sendError(res, 403, 'Forbidden: non-local origin', 'forbidden_origin')
    }

    if (path === 'report' && req.method === 'GET') {
      const report = options.getReport() as any ?? { version: '1.0', changes: [] }
      const perf = options.getPerformance()
      if (perf) report.performance = perf
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

    if (path === 'performance' && req.method === 'GET') {
      const perf = options.getPerformance()
      res.end(JSON.stringify(perf ?? null, null, 2))
      return
    }

    if (path === 'performance' && req.method === 'POST') {
      let raw: string
      try { raw = await readBody(req) } catch { return sendError(res, 413, 'Request body too large', 'body_too_large') }
      const parsed = parseJSON(raw)
      if (!parsed.ok) return sendError(res, 400, 'Invalid JSON body', 'invalid_json')
      options.setPerformance(parsed.data)
      res.end(JSON.stringify({ ok: true }))
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
      const urlObj = new URL(req.url!, `http://${req.headers.host || 'localhost'}`)
      const mfeFilter = urlObj.searchParams.get('mfe')
      const taskData = options.getTasks()
      if (mfeFilter) {
        const filtered = { ...taskData, tasks: filterTasksByMfe(taskData.tasks, mfeFilter) }
        res.end(JSON.stringify(filtered, null, 2))
      } else {
        res.end(JSON.stringify(taskData, null, 2))
      }
      return
    }

    if (path === 'tasks' && req.method === 'POST') {
      let raw: string
      try { raw = await readBody(req) } catch { return sendError(res, 413, 'Request body too large', 'body_too_large') }
      const parsed = parseJSON(raw)
      if (!parsed.ok) return sendError(res, 400, 'Invalid JSON body', 'invalid_json')
      if (!parsed.data || typeof parsed.data !== 'object' || Array.isArray(parsed.data)) {
        return sendError(res, 400, 'Request body must be a JSON object', 'body_not_object')
      }
      const result = parseWith(CreateTaskBody, parsed.data)
      if (!result.ok) return sendError(res, 400, result.error)
      res.end(JSON.stringify(await options.addTask(result.data as Record<string, unknown>), null, 2))
      return
    }

    if (path === 'screenshots' && req.method === 'POST') {
      let raw: string
      try { raw = await readBody(req) } catch { return sendError(res, 413, 'Request body too large', 'body_too_large') }
      const parsed = parseJSON(raw)
      if (!parsed.ok) return sendError(res, 400, 'Invalid JSON body', 'invalid_json')
      const bodyResult = parseWith(UploadScreenshotBody, parsed.data)
      if (!bodyResult.ok) return sendError(res, 400, bodyResult.error)
      const match = bodyResult.data.data.match(/^data:image\/png;base64,(.+)$/)
      if (!match) return sendError(res, 400, 'Invalid PNG data URL')
      const buffer = Buffer.from(match[1], 'base64')
      if (buffer.length > 4 * 1024 * 1024) return sendError(res, 413, 'Screenshot too large (max 4MB)')
      const filename = `screenshot-${Date.now()}-${crypto.randomBytes(8).toString('hex')}.png`
      const dir = nodePath.join(options.projectRoot, '.annotask', 'screenshots')
      await fsp.mkdir(dir, { recursive: true })
      await fsp.writeFile(nodePath.join(dir, filename), buffer)
      res.end(JSON.stringify({ filename }))
      return
    }

    if (path.startsWith('tasks/') && req.method === 'GET') {
      const id = decodeURIComponent(path.replace('tasks/', ''))
      if (!id) return sendError(res, 400, 'Missing task id')
      const taskData = options.getTasks()
      const task = taskData.tasks.find(t => t.id === id)
      if (!task) return sendError(res, 404, 'Task not found', 'not_found')
      res.end(JSON.stringify(task, null, 2))
      return
    }

    if (path.startsWith('tasks/') && req.method === 'PATCH') {
      const id = decodeURIComponent(path.replace('tasks/', ''))
      if (!id) return sendError(res, 400, 'Missing task id')
      let raw: string
      try { raw = await readBody(req) } catch { return sendError(res, 413, 'Request body too large', 'body_too_large') }
      const parsed = parseJSON(raw)
      if (!parsed.ok) return sendError(res, 400, 'Invalid JSON body', 'invalid_json')
      if (!parsed.data || typeof parsed.data !== 'object' || Array.isArray(parsed.data)) {
        return sendError(res, 400, 'Request body must be a JSON object', 'body_not_object')
      }
      const result = parseWith(UpdateTaskBody, parsed.data)
      if (!result.ok) return sendError(res, 400, result.error)
      const updates = result.data
      if (updates.status !== undefined) {
        const currentTask = options.getTasks().tasks.find(t => t.id === id)
        if (currentTask) {
          const reason = assertTransition(currentTask.status, updates.status)
          if (reason) return sendError(res, 400, reason, 'invalid_transition')
        }
      }
      const updated = await options.updateTask(id, updates as Record<string, unknown>) as any
      if (updated && typeof updated === 'object' && updated.error === 'Task not found') {
        return sendError(res, 404, 'Task not found', 'not_found')
      }
      res.end(JSON.stringify(updated, null, 2))
      return
    }

    if (path.startsWith('tasks/') && req.method === 'DELETE') {
      const id = decodeURIComponent(path.replace('tasks/', ''))
      const deleted = await options.deleteTask(id) as any
      if (deleted && typeof deleted === 'object' && deleted.error === 'Task not found') {
        return sendError(res, 404, 'Task not found', 'not_found')
      }
      res.end(JSON.stringify(deleted, null, 2))
      return
    }

    if (path === 'components' && req.method === 'GET') {
      const catalog = await scanComponentLibraries(options.projectRoot)
      res.end(JSON.stringify(catalog, null, 2))
      return
    }

    if (path === 'status' && req.method === 'GET') {
      res.end(JSON.stringify({ status: 'ok', tool: 'annotask' }))
      return
    }

    res.statusCode = 404
    const body: ApiErrorBody = { error: { code: 'not_found', message: 'Not found' } }
    res.end(JSON.stringify(body))
  }
}
