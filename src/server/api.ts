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
import { enrichContextComponentRefs } from './component-context.js'

export interface APIOptions {
  projectRoot: string
  /** Extra HTTP endpoints to probe for OpenAPI / GraphQL schemas. */
  apiSchemaUrls?: string[]
  /** Extra project-relative schema file paths. */
  apiSchemaFiles?: string[]
  getReport: () => unknown
  getConfig: () => unknown
  getDesignSpec: () => unknown
  getTasks: () => { version: string; tasks: Array<Record<string, unknown>> }
  updateTask: (id: string, updates: Record<string, unknown>) => unknown | Promise<unknown>
  deleteTask: (id: string) => unknown | Promise<unknown>
  addTask: (task: Record<string, unknown>) => unknown | Promise<unknown>
  saveInteractionHistory: (taskId: string, snapshot: unknown) => Promise<void>
  readInteractionHistory: (taskId: string) => Promise<unknown | null>
  saveRenderedHtml: (taskId: string, html: string) => Promise<void>
  readRenderedHtml: (taskId: string) => Promise<string | null>
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
import { scanComponentLibraries, getCachedComponentCatalog } from './component-scanner.js'
import { filterTasksByMfe } from '../shared/task-summary.js'
import { getCodeContext } from './code-context.js'
import { getComponentExamples } from './component-examples.js'
import { scanComponentUsage } from './component-usage.js'
import { probeDataContext, resolveDataContext, resolveElementDataContext } from './data-context.js'
import { scanDataSources } from './data-source-scanner.js'
import { getDataSourceExamples } from './data-source-examples.js'
import { resolveDataSourceDetails } from './data-source-details.js'
import { resolveBindingGraph } from './binding-analysis/index.js'
import { scanApiSchemas } from './api-schema-scanner.js'
import { getWorkspaceCatalog } from './workspace-catalog.js'
import { resolveEndpoint } from './api-schema-resolver.js'
import { resolveWorkspace } from './workspace.js'
import type { DataSource } from '../schema.js'

/**
 * Look up the monorepo root (pnpm-workspace.yaml / npm `workspaces` / lerna.json)
 * above projectRoot. Returned only when a real workspace config is found;
 * single-package projects get `undefined`, which keeps `resolveProjectFile`
 * in its pre-workspace-aware mode (containment pinned to projectRoot).
 * The underlying `resolveWorkspace` is 60s-cached, so calling this per
 * request is cheap.
 */
async function getWorkspaceRoot(projectRoot: string): Promise<string | undefined> {
  try {
    const info = await resolveWorkspace(projectRoot)
    return info.isWorkspace ? info.root : undefined
  } catch {
    return undefined
  }
}

/** Build CORS origin value — reflect the request origin if it's local, otherwise omit */
function getCorsOrigin(req: IncomingMessage): string | null {
  const origin = req.headers.origin as string | undefined
  if (!origin) return null // same-origin, no CORS header needed
  return isLocalOrigin(origin) ? origin : null
}

/**
 * Best-effort dev-server URL from the incoming request. Annotask runs inside
 * the user's Vite/Webpack dev server, so the Host header tells us where it's
 * bound. Used to seed api-schema HTTP probes.
 */
function deriveDevServerUrl(req: IncomingMessage): string | undefined {
  const host = typeof req.headers.host === 'string' ? req.headers.host : ''
  if (!host) return undefined
  const proto = (req.headers['x-forwarded-proto'] as string | undefined) || 'http'
  return `${proto}://${host}`
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
      const payload = result.data as Record<string, unknown>
      // Enrich component refs nested in `context` (component / rendered.ancestors,
      // plus the arrow variants) with library/category from the scanner cache.
      // Use the non-blocking accessor: if the catalog isn't warm yet (first
      // request after restart), kick off a background scan and skip enrichment
      // for this one — library/category are strictly additive, so responding
      // immediately is preferable to waiting on a multi-second workspace walk.
      try {
        const catalog = getCachedComponentCatalog(options.projectRoot)
        if (catalog) {
          const enrichedContext = enrichContextComponentRefs(payload.context as Record<string, unknown> | undefined, catalog)
          if (enrichedContext) payload.context = enrichedContext
        }
      } catch { /* enrichment is best-effort */ }
      res.end(JSON.stringify(await options.addTask(payload), null, 2))
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

    // Sidecar: interaction-history. Keyed by task id so agents can retrieve the
    // user's pre-task navigation/click trace even when the task payload didn't
    // embed it (embedding is opt-in via the "Embed interaction history" toggle).
    {
      const sidecarMatch = path.match(/^tasks\/([^/]+)\/interaction-history$/)
      if (sidecarMatch) {
        const id = decodeURIComponent(sidecarMatch[1])
        if (req.method === 'POST') {
          let raw: string
          try { raw = await readBody(req) } catch { return sendError(res, 413, 'Request body too large', 'body_too_large') }
          const parsed = parseJSON(raw)
          if (!parsed.ok) return sendError(res, 400, 'Invalid JSON body', 'invalid_json')
          await options.saveInteractionHistory(id, parsed.data)
          res.end(JSON.stringify({ ok: true }))
          return
        }
        if (req.method === 'GET') {
          // Prefer the embedded copy on the task (present when the user opted
          // in) so the endpoint returns one consistent shape whether or not the
          // sidecar was written.
          const task = options.getTasks().tasks.find(t => t.id === id)
          if (!task) return sendError(res, 404, 'Task not found', 'not_found')
          if (task.interaction_history) {
            res.end(JSON.stringify(task.interaction_history, null, 2))
            return
          }
          const stored = await options.readInteractionHistory(id)
          if (stored == null) {
            res.end(JSON.stringify({ task_id: id, not_captured: true }, null, 2))
            return
          }
          res.end(JSON.stringify(stored, null, 2))
          return
        }
      }
    }

    // Sidecar: rendered-html. Stored as `{ html, captured_at }`; the wire
    // response unwraps to `{ task_id, rendered, source }` so it parallels
    // interaction-history's envelope-when-missing shape.
    {
      const sidecarMatch = path.match(/^tasks\/([^/]+)\/rendered-html$/)
      if (sidecarMatch) {
        const id = decodeURIComponent(sidecarMatch[1])
        if (req.method === 'POST') {
          let raw: string
          try { raw = await readBody(req) } catch { return sendError(res, 413, 'Request body too large', 'body_too_large') }
          const parsed = parseJSON(raw)
          if (!parsed.ok) return sendError(res, 400, 'Invalid JSON body', 'invalid_json')
          const body = parsed.data as { html?: unknown } | null
          if (!body || typeof body !== 'object' || typeof body.html !== 'string') {
            return sendError(res, 400, 'Expected { html: string } body', 'body_not_object')
          }
          // Pathological outerHTML (infinite lists, giant tables) would bloat
          // the on-disk sidecar and slow every subsequent agent read. Cap at
          // 200 KB — enough for any realistic selected element.
          if (body.html.length > 200_000) {
            return sendError(res, 413, 'Rendered HTML too large (max 200KB)', 'body_too_large')
          }
          await options.saveRenderedHtml(id, body.html)
          res.end(JSON.stringify({ ok: true }))
          return
        }
        if (req.method === 'GET') {
          const task = options.getTasks().tasks.find(t => t.id === id)
          if (!task) return sendError(res, 404, 'Task not found', 'not_found')
          const ctx = task.context as Record<string, unknown> | undefined
          const embedded = ctx && typeof ctx.rendered === 'string' ? ctx.rendered : null
          if (embedded) {
            res.end(JSON.stringify({ task_id: id, rendered: embedded, source: 'embedded' }, null, 2))
            return
          }
          const stored = await options.readRenderedHtml(id)
          if (stored == null) {
            res.end(JSON.stringify({ task_id: id, rendered: null, not_captured: true }, null, 2))
            return
          }
          res.end(JSON.stringify({ task_id: id, rendered: stored, source: 'sidecar' }, null, 2))
          return
        }
      }
    }

    if (path === 'components' && req.method === 'GET') {
      const catalog = await scanComponentLibraries(options.projectRoot)
      res.end(JSON.stringify(catalog, null, 2))
      return
    }

    if (path === 'component-usage' && req.method === 'GET') {
      const result = await scanComponentUsage(options.projectRoot)
      res.end(JSON.stringify(result, null, 2))
      return
    }

    if (path === 'status' && req.method === 'GET') {
      res.end(JSON.stringify({ status: 'ok', tool: 'annotask' }))
      return
    }

    if (path === 'workspace' && req.method === 'GET') {
      const catalog = await getWorkspaceCatalog(options.projectRoot)
      // absDir is an implementation detail — omit from the wire response.
      const packages = catalog.packages.map(({ absDir: _ignored, ...rest }) => rest)
      res.end(JSON.stringify({ root: catalog.root, isWorkspace: catalog.isWorkspace, packages }, null, 2))
      return
    }

    if (path.startsWith('code-context/') && req.method === 'GET') {
      const taskId = decodeURIComponent(path.replace('code-context/', ''))
      if (!taskId) return sendError(res, 400, 'Missing task id')
      const task = options.getTasks().tasks.find(t => t.id === taskId)
      if (!task) return sendError(res, 404, 'Task not found', 'not_found')
      const file = typeof task.file === 'string' ? task.file : ''
      const line = typeof task.line === 'number' ? task.line : 0
      if (!file) return sendError(res, 400, 'Task has no file reference')
      const urlObj = new URL(req.url!, `http://${req.headers.host || 'localhost'}`)
      const ctxLinesArg = Number(urlObj.searchParams.get('context_lines') || '15')
      const contextLines = Number.isFinite(ctxLinesArg) ? Math.max(0, Math.min(200, ctxLinesArg)) : 15
      const workspaceRoot = await getWorkspaceRoot(options.projectRoot)
      const result = await getCodeContext(options.projectRoot, file, line, contextLines, workspaceRoot)
      res.end(JSON.stringify(result, null, 2))
      return
    }

    // Direct file+line excerpt — no task lookup. Used by the Components view
    // to show a component's definition without minting a task.
    if (path === 'source-excerpt' && req.method === 'GET') {
      const urlObj = new URL(req.url!, `http://${req.headers.host || 'localhost'}`)
      const file = urlObj.searchParams.get('file') || ''
      const lineArg = Number(urlObj.searchParams.get('line') || '1')
      const line = Number.isFinite(lineArg) ? lineArg : 1
      if (!file) return sendError(res, 400, 'Missing file')
      const ctxLinesArg = Number(urlObj.searchParams.get('context_lines') || '15')
      const contextLines = Number.isFinite(ctxLinesArg) ? Math.max(0, Math.min(200, ctxLinesArg)) : 15
      const workspaceRoot = await getWorkspaceRoot(options.projectRoot)
      const result = await getCodeContext(options.projectRoot, file, line, contextLines, workspaceRoot)
      res.end(JSON.stringify(result, null, 2))
      return
    }

    if (path === 'data-context/probe' && req.method === 'GET') {
      const urlObj = new URL(req.url!, `http://${req.headers.host || 'localhost'}`)
      const file = urlObj.searchParams.get('file') || ''
      if (!file) return sendError(res, 400, 'Missing file parameter')
      const workspaceRoot = await getWorkspaceRoot(options.projectRoot)
      const result = await probeDataContext(options.projectRoot, file, workspaceRoot)
      res.end(JSON.stringify(result, null, 2))
      return
    }

    if (path === 'data-context/resolve' && req.method === 'GET') {
      const urlObj = new URL(req.url!, `http://${req.headers.host || 'localhost'}`)
      const file = urlObj.searchParams.get('file') || ''
      const lineArg = Number(urlObj.searchParams.get('line') || '0')
      if (!file) return sendError(res, 400, 'Missing file parameter')
      const workspaceRoot = await getWorkspaceRoot(options.projectRoot)
      const result = await resolveDataContext(
        options.projectRoot,
        file,
        Number.isFinite(lineArg) ? lineArg : 0,
        { devServerUrl: deriveDevServerUrl(req) },
        workspaceRoot,
      )
      res.end(JSON.stringify(result, null, 2))
      return
    }

    if (path === 'data-context/element' && req.method === 'GET') {
      const urlObj = new URL(req.url!, `http://${req.headers.host || 'localhost'}`)
      const file = urlObj.searchParams.get('file') || ''
      const lineArg = Number(urlObj.searchParams.get('line') || '0')
      if (!file) return sendError(res, 400, 'Missing file parameter')
      const workspaceRoot = await getWorkspaceRoot(options.projectRoot)
      const result = await resolveElementDataContext(
        options.projectRoot,
        file,
        Number.isFinite(lineArg) ? lineArg : 0,
        { devServerUrl: deriveDevServerUrl(req) },
        workspaceRoot,
      )
      res.end(JSON.stringify(result, null, 2))
      return
    }

    if (path.startsWith('data-context/') && req.method === 'GET') {
      const taskId = decodeURIComponent(path.replace('data-context/', ''))
      if (!taskId) return sendError(res, 400, 'Missing task id')
      const task = options.getTasks().tasks.find(t => t.id === taskId)
      if (!task) return sendError(res, 404, 'Task not found', 'not_found')
      // Return stored data_context if present; otherwise resolve freshly.
      const stored = task.data_context
      if (stored && typeof stored === 'object') {
        res.end(JSON.stringify(stored, null, 2))
        return
      }
      const file = typeof task.file === 'string' ? task.file : ''
      const line = typeof task.line === 'number' ? task.line : 0
      if (!file) return sendError(res, 400, 'Task has no file reference')
      const workspaceRoot = await getWorkspaceRoot(options.projectRoot)
      const result = await resolveDataContext(
        options.projectRoot,
        file,
        line,
        { devServerUrl: deriveDevServerUrl(req) },
        workspaceRoot,
      )
      res.end(JSON.stringify(result, null, 2))
      return
    }

    if (path === 'data-sources' && req.method === 'GET') {
      const urlObj = new URL(req.url!, `http://${req.headers.host || 'localhost'}`)
      const kind = urlObj.searchParams.get('kind') as DataSource['kind'] | null
      const library = urlObj.searchParams.get('library')
      const searchStr = (urlObj.searchParams.get('search') || '').toLowerCase()
      const usedOnly = urlObj.searchParams.get('used_only') === 'true' || urlObj.searchParams.get('used_only') === '1'
      const catalog = await scanDataSources(options.projectRoot)
      const libraries = library ? catalog.libraries.filter(l => l.name === library) : catalog.libraries
      let entries = catalog.project_entries
      if (kind) entries = entries.filter(e => e.kind === kind)
      if (searchStr) entries = entries.filter(e => e.name.toLowerCase().includes(searchStr))
      if (usedOnly) entries = entries.filter(e => e.used_count > 0)
      res.end(JSON.stringify({ libraries, project_entries: entries, scannedAt: catalog.scannedAt }, null, 2))
      return
    }

    if (path === 'api-schemas' && req.method === 'GET') {
      const urlObj = new URL(req.url!, `http://${req.headers.host || 'localhost'}`)
      const kindFilter = urlObj.searchParams.get('kind')
      const detail = urlObj.searchParams.get('detail') === 'true' || urlObj.searchParams.get('detail') === '1'
      const devServerUrl = deriveDevServerUrl(req)
      const catalog = await scanApiSchemas(options.projectRoot, {
        devServerUrl,
        apiSchemaUrls: options.apiSchemaUrls,
        apiSchemaFiles: options.apiSchemaFiles,
      })
      let schemas = catalog.schemas
      if (kindFilter) schemas = schemas.filter(s => s.kind === kindFilter)
      if (!detail) {
        schemas = schemas.map(s => ({ ...s, operations: [] }))
      }
      res.end(JSON.stringify({ schemas, scannedAt: catalog.scannedAt }, null, 2))
      return
    }

    if (path === 'api-operation' && req.method === 'GET') {
      const urlObj = new URL(req.url!, `http://${req.headers.host || 'localhost'}`)
      const opPath = urlObj.searchParams.get('path') || ''
      const method = urlObj.searchParams.get('method') || undefined
      const schemaLocation = urlObj.searchParams.get('schema_location') || undefined
      if (!opPath) return sendError(res, 400, 'Missing path parameter')
      const devServerUrl = deriveDevServerUrl(req)
      const catalog = await scanApiSchemas(options.projectRoot, {
        devServerUrl,
        apiSchemaUrls: options.apiSchemaUrls,
        apiSchemaFiles: options.apiSchemaFiles,
      })
      const normMethod = method ? method.toUpperCase() : undefined
      const matches: Array<{ schema_location: string; schema_kind: string; operation: unknown }> = []
      for (const schema of catalog.schemas) {
        if (schemaLocation && schema.location !== schemaLocation) continue
        for (const op of schema.operations) {
          if (op.path !== opPath) continue
          if (normMethod && op.method !== normMethod) continue
          matches.push({ schema_location: schema.location, schema_kind: schema.kind, operation: op })
        }
      }
      if (matches.length === 0) return sendError(res, 404, 'Operation not found', 'not_found')
      res.end(JSON.stringify(matches.length === 1 ? matches[0] : { ambiguous: true, candidates: matches }, null, 2))
      return
    }

    if (path === 'resolve-endpoint' && req.method === 'GET') {
      const urlObj = new URL(req.url!, `http://${req.headers.host || 'localhost'}`)
      const target = urlObj.searchParams.get('url') || ''
      const method = urlObj.searchParams.get('method') || undefined
      if (!target) return sendError(res, 400, 'Missing url parameter')
      const devServerUrl = deriveDevServerUrl(req)
      const catalog = await scanApiSchemas(options.projectRoot, {
        devServerUrl,
        apiSchemaUrls: options.apiSchemaUrls,
        apiSchemaFiles: options.apiSchemaFiles,
      })
      const match = resolveEndpoint(catalog, target, method)
      if (!match) {
        res.end(JSON.stringify({ match: null }, null, 2))
        return
      }
      res.end(JSON.stringify({ match }, null, 2))
      return
    }

    if (path.startsWith('data-source-examples/') && req.method === 'GET') {
      const name = decodeURIComponent(path.replace('data-source-examples/', ''))
      if (!name) return sendError(res, 400, 'Missing data source name')
      const urlObj = new URL(req.url!, `http://${req.headers.host || 'localhost'}`)
      const limitArg = Number(urlObj.searchParams.get('limit') || '3')
      const limit = Number.isFinite(limitArg) ? Math.max(1, Math.min(10, limitArg)) : 3
      const kind = (urlObj.searchParams.get('kind') || undefined) as DataSource['kind'] | undefined
      const result = await getDataSourceExamples(options.projectRoot, name, limit, kind)
      res.end(JSON.stringify(result, null, 2))
      return
    }

    if (path.startsWith('data-source-details/') && req.method === 'GET') {
      const name = decodeURIComponent(path.replace('data-source-details/', ''))
      if (!name) return sendError(res, 400, 'Missing data source name')
      const urlObj = new URL(req.url!, `http://${req.headers.host || 'localhost'}`)
      const kind = (urlObj.searchParams.get('kind') || undefined) as DataSource['kind'] | undefined
      const file = urlObj.searchParams.get('file') || undefined
      const contextLinesArg = Number(urlObj.searchParams.get('context_lines') || '15')
      const contextLines = Number.isFinite(contextLinesArg) ? contextLinesArg : 15
      const workspaceRoot = await getWorkspaceRoot(options.projectRoot)
      const result = await resolveDataSourceDetails({
        projectRoot: options.projectRoot,
        name,
        kind,
        file,
        contextLines,
        workspaceRoot,
      })
      res.end(JSON.stringify(result, null, 2))
      return
    }

    if (path.startsWith('data-source-bindings/') && req.method === 'GET') {
      const name = decodeURIComponent(path.replace('data-source-bindings/', ''))
      if (!name) return sendError(res, 400, 'Missing data source name')
      const urlObj = new URL(req.url!, `http://${req.headers.host || 'localhost'}`)
      const fileFilter = urlObj.searchParams.get('file') ?? ''
      // Look up the catalog entry so we can thread its `hint_symbols` into
      // the analyzer — for inline-fetch entries (name derived from the URL)
      // the fetch result variable name is the only identifier that actually
      // appears in template / JSX, so without this the analyzer returns 0
      // sites and the Data tab can't light up anything.
      //
      // Also pass the entry's file as `scopeFile` when we have one —
      // inline-fetch hints are short generic names (`health`, `workflows`)
      // that would otherwise match unrelated state in sibling MFEs; scoping
      // the analyzer to the declaring file keeps cross-MFE bleed at bay.
      const catalog = await scanDataSources(options.projectRoot)
      const entry = catalog.project_entries.find(e =>
        e.name === name && (!fileFilter || e.file === fileFilter),
      ) ?? catalog.project_entries.find(e => e.name === name)
      const hintSymbols = entry?.hint_symbols ?? []
      const scopeFile = entry && hintSymbols.length > 0 ? entry.file : undefined
      const result = await resolveBindingGraph(options.projectRoot, name, { hintSymbols, scopeFile })
      res.end(JSON.stringify(result, null, 2))
      return
    }

    if (path.startsWith('component-examples/') && req.method === 'GET') {
      const name = decodeURIComponent(path.replace('component-examples/', ''))
      if (!name) return sendError(res, 400, 'Missing component name')
      const urlObj = new URL(req.url!, `http://${req.headers.host || 'localhost'}`)
      const limitArg = Number(urlObj.searchParams.get('limit') || '3')
      const limit = Number.isFinite(limitArg) ? Math.max(1, Math.min(10, limitArg)) : 3
      const result = await getComponentExamples(options.projectRoot, name, limit)
      res.end(JSON.stringify(result, null, 2))
      return
    }

    res.statusCode = 404
    const body: ApiErrorBody = { error: { code: 'not_found', message: 'Not found' } }
    res.end(JSON.stringify(body))
  }
}
