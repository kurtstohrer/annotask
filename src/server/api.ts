import type { IncomingMessage, ServerResponse } from 'node:http'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import nodePath from 'node:path'

export interface APIOptions {
  projectRoot: string
  getReport: () => unknown
  getConfig: () => unknown
  getDesignSpec: () => unknown
  getTasks: () => { version: string; tasks: Array<Record<string, unknown>> }
  updateTask: (id: string, updates: Record<string, unknown>) => unknown
  deleteTask: (id: string) => unknown
  addTask: (task: Record<string, unknown>) => unknown
  getPerformance: () => unknown
  setPerformance: (data: unknown) => void
}

const MAX_BODY_SIZE = 4_194_304
const VALID_TASK_STATUSES = new Set(['pending', 'in_progress', 'applied', 'review', 'accepted', 'denied', 'needs_info', 'blocked'])
const SAFE_SCREENSHOT_RE = /^[a-zA-Z0-9_-]+\.png$/

/** Valid state transitions — from current status to allowed next statuses */
const VALID_TRANSITIONS: Record<string, Set<string>> = {
  pending:     new Set(['in_progress', 'denied']),
  in_progress: new Set(['applied', 'review', 'needs_info', 'blocked', 'denied']),
  applied:     new Set(['review', 'in_progress']),
  review:      new Set(['accepted', 'denied', 'in_progress']),
  needs_info:  new Set(['in_progress', 'denied']),
  blocked:     new Set(['in_progress', 'denied']),
  denied:      new Set(['pending', 'in_progress']),
}

/** Fields that POST /tasks is allowed to set (server controls id, status, timestamps) */
const POSTABLE_TASK_FIELDS = new Set([
  'type', 'description', 'file', 'line', 'component', 'mfe', 'route',
  'intent', 'action', 'context', 'viewport', 'color_scheme', 'interaction_history',
  'element_context', 'screenshot', 'visual',
])

/** Fields that PATCH /tasks/:id is allowed to update */
const PATCHABLE_TASK_FIELDS = new Set([
  'status', 'description', 'notes', 'screenshot', 'feedback',
  'intent', 'action', 'context', 'viewport', 'color_scheme', 'interaction_history',
  'element_context', 'mfe', 'agent_feedback', 'blocked_reason', 'resolution',
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
    res.setHeader('Cache-Control', 'no-cache')

    if (req.method === 'OPTIONS') { res.statusCode = 200; res.end(); return }

    // Block mutating requests from non-local origins
    if ((req.method === 'POST' || req.method === 'PATCH' || req.method === 'DELETE') && !isLocalOrigin(req.headers.origin as string | undefined)) {
      return sendError(res, 403, 'Forbidden: non-local origin')
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
      try { raw = await readBody(req) } catch { return sendError(res, 413, 'Request body too large') }
      const parsed = parseJSON(raw)
      if (!parsed.ok) return sendError(res, 400, 'Invalid JSON body')
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
      try { raw = await readBody(req) } catch { return sendError(res, 413, 'Request body too large') }
      const parsed = parseJSON(raw)
      if (!parsed.ok) return sendError(res, 400, 'Invalid JSON body')
      const body = parsed.data as Record<string, unknown>
      if (!body || typeof body !== 'object' || Array.isArray(body)) return sendError(res, 400, 'Request body must be a JSON object')
      if (typeof body.type !== 'string' || !body.type) return sendError(res, 400, 'Missing required field: type (string)')
      if (typeof body.description !== 'string') return sendError(res, 400, 'Missing required field: description (string)')
      // Strip unknown fields — only allow whitelisted fields through
      const sanitized: Record<string, unknown> = {}
      for (const key of Object.keys(body)) {
        if (POSTABLE_TASK_FIELDS.has(key)) {
          sanitized[key] = body[key]
        }
      }
      res.end(JSON.stringify(options.addTask(sanitized), null, 2))
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

    if (path.startsWith('tasks/') && req.method === 'GET') {
      const id = decodeURIComponent(path.replace('tasks/', ''))
      if (!id) return sendError(res, 400, 'Missing task id')
      const taskData = options.getTasks()
      const task = taskData.tasks.find(t => t.id === id)
      if (!task) return sendError(res, 404, 'Task not found')
      res.end(JSON.stringify(task, null, 2))
      return
    }

    if (path.startsWith('tasks/') && req.method === 'PATCH') {
      const id = decodeURIComponent(path.replace('tasks/', ''))
      if (!id) return sendError(res, 400, 'Missing task id')
      let raw: string
      try { raw = await readBody(req) } catch { return sendError(res, 413, 'Request body too large') }
      const parsed = parseJSON(raw)
      if (!parsed.ok) return sendError(res, 400, 'Invalid JSON body')
      const body = parsed.data as Record<string, unknown>
      if (!body || typeof body !== 'object' || Array.isArray(body)) return sendError(res, 400, 'Request body must be a JSON object')
      if (body.status !== undefined && !VALID_TASK_STATUSES.has(body.status as string)) {
        return sendError(res, 400, `Invalid status. Must be one of: ${[...VALID_TASK_STATUSES].join(', ')}`)
      }
      // Validate state transition
      if (body.status !== undefined) {
        const currentTask = options.getTasks().tasks.find(t => t.id === id)
        if (currentTask) {
          const allowed = VALID_TRANSITIONS[String(currentTask.status)]
          if (allowed && !allowed.has(body.status as string)) {
            return sendError(res, 400, `Invalid state transition: ${String(currentTask.status)} → ${body.status}. Allowed: ${[...allowed].join(', ')}`)
          }
        }
      }
      // Validate agent_feedback structure
      if (body.agent_feedback !== undefined) {
        const af = body.agent_feedback
        if (!Array.isArray(af)) return sendError(res, 400, 'agent_feedback must be an array')
        for (const entry of af as any[]) {
          if (!entry || typeof entry !== 'object') return sendError(res, 400, 'agent_feedback entries must be objects')
          if (typeof entry.asked_at !== 'number') return sendError(res, 400, 'agent_feedback entry requires asked_at (number)')
          if (!Array.isArray(entry.questions) || entry.questions.length === 0) return sendError(res, 400, 'agent_feedback entry requires non-empty questions array')
          for (const q of entry.questions) {
            if (typeof q.id !== 'string' || typeof q.text !== 'string') return sendError(res, 400, 'Each question requires id (string) and text (string)')
            if (q.type !== 'text' && q.type !== 'choice') return sendError(res, 400, 'Question type must be "text" or "choice"')
            if (q.type === 'choice' && (!Array.isArray(q.options) || q.options.length === 0)) return sendError(res, 400, 'Choice questions require non-empty options array')
          }
          if (entry.answers !== undefined) {
            if (!Array.isArray(entry.answers)) return sendError(res, 400, 'answers must be an array')
            for (const a of entry.answers) {
              if (typeof a.id !== 'string' || typeof a.value !== 'string') return sendError(res, 400, 'Each answer requires id (string) and value (string)')
            }
          }
        }
      }
      // Validate screenshot filename if provided
      if (body.screenshot !== undefined && typeof body.screenshot === 'string' && !SAFE_SCREENSHOT_RE.test(body.screenshot)) {
        return sendError(res, 400, 'Invalid screenshot filename')
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

    if (path.startsWith('tasks/') && req.method === 'DELETE') {
      const id = path.replace('tasks/', '')
      res.end(JSON.stringify(options.deleteTask(id), null, 2))
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
    res.end(JSON.stringify({ error: 'Not found' }))
  }
}
