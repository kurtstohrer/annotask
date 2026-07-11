import type { IncomingMessage, ServerResponse } from 'node:http'
import fsp from 'node:fs/promises'
import crypto from 'node:crypto'
import nodePath from 'node:path'
import { isSafeScreenshot } from './validation.js'
import {
  CreateTaskBody,
  UpdateTaskBody,
  UploadScreenshotBody,
  UploadWireframeSnapshotBody,
  parseWith,
  assertTransition,
} from './schemas.js'
import { mergeRuntimeOrphansIntoEntries, findMatchingStaticEntries } from './runtime-endpoints.js'
import type { NetworkCall, RuntimeEndpoint, RuntimeEndpointCatalog } from '../schema.js'
import type { TaskThreadStore, ThreadMessage, ThreadRole, UpdateInput } from './task-thread.js'
import type { WorkStreamBlock } from '../shared/work-stream.js'
import type { AgentSpawnHandler } from './agent-spawn.js'
import type { AgentDetector } from './agent-detect.js'
import type { InitRunner, ScanOptions } from './init.js'
import type { UsageLedger } from './usage-ledger.js'
import type { AgentConfigs, AgentConfigEntry } from './agent-configs.js'
import { isWireframeDocument, WIREFRAME_SNAPSHOT_FILENAME_RE, type WireframeDocument } from '../shared/wireframe-types.js'
import { WireframeRevConflictError } from './wireframe-store.js'
import { isDesignSessionDocument, type DesignSessionDocument } from '../shared/design-session-types.js'
import { RevConflictError } from './json-cas-store.js'
import type { SnapshotStore } from './file-snapshots.js'
import { applyDesignSession, verifyAppliedEntries, revertApplyBatch, releaseApplyTask, acceptApplyTask, restampApplyEntries, closeWireframeLifecycle } from './apply-session.js'
import { PROVIDER_IDS, EFFORT_LEVELS } from '../embedded/provider-config.js'

export interface APIOptions {
  projectRoot: string
  /** Extra HTTP endpoints to probe for OpenAPI / GraphQL schemas. */
  apiSchemaUrls?: string[]
  /** Extra project-relative schema file paths. */
  apiSchemaFiles?: string[]
  /**
   * Hostnames allowed in the Host header beyond localhost / IP literals —
   * DNS-rebinding gate (see `isAllowedHost`). A function because the bind
   * host is only known after the dev server starts listening, which is after
   * this middleware is constructed.
   */
  allowedHosts?: () => readonly string[]
  getReport: () => unknown
  getConfig: () => unknown
  getDesignSpec: () => unknown
  getTasks: () => { version: string; tasks: Array<Record<string, unknown>> }
  updateTask: (
    id: string,
    updates: Record<string, unknown>,
    opts?: { guard?: (task: Record<string, unknown>) => string | null },
  ) => unknown | Promise<unknown>
  deleteTask: (id: string) => unknown | Promise<unknown>
  addTask: (task: Record<string, unknown>) => unknown | Promise<unknown>
  saveInteractionHistory: (taskId: string, snapshot: unknown) => Promise<void>
  readInteractionHistory: (taskId: string) => Promise<unknown | null>
  saveRenderedHtml: (taskId: string, html: string) => Promise<void>
  readRenderedHtml: (taskId: string) => Promise<string | null>
  getPerformance: () => unknown
  setPerformance: (data: unknown) => void
  /** Ingest iframe-captured network calls into the runtime endpoint catalog. */
  ingestNetworkCalls: (calls: NetworkCall[]) => void
  /** Read the aggregated runtime endpoint catalog. */
  getRuntimeEndpointCatalog: () => RuntimeEndpointCatalog
  /** Drop the runtime endpoint catalog. */
  clearRuntimeEndpoints: () => void
  /** Per-task conversation transcript store (chat messages). */
  taskThread: TaskThreadStore
  /** Spawns local CLIs (claude/codex/opencode/copilot) and streams their output. */
  agentSpawn: AgentSpawnHandler
  /** Probes for installed/logged-in local CLIs. */
  agentDetect: AgentDetector
  /** Drives the in-UI initialization pipeline. */
  initRunner: InitRunner
  /** Reads per-persona project directions from `.annotask/agents.json`. */
  getAgentConfigs: () => Promise<AgentConfigs>
  /** Writes one persona's project directions. */
  setAgentConfig: (personaId: string, entry: Partial<AgentConfigEntry>) => Promise<AgentConfigs>
  /** Reads the persisted multi-route wireframe document. */
  getWireframe: () => Promise<WireframeDocument>
  /** Replaces the wireframe document (whole-document PUT). */
  setWireframe: (doc: WireframeDocument) => Promise<WireframeDocument>
  /** Reads the persisted design-session journal. */
  getDesignSession: () => Promise<DesignSessionDocument>
  /** Replaces the design-session journal (CAS on rev). */
  setDesignSession: (doc: DesignSessionDocument) => Promise<DesignSessionDocument>
  /** Server-owned reset to a fresh empty session (discard). */
  clearDesignSession: () => Promise<DesignSessionDocument>
  /** File-snapshot engine — byte-exact undo/discard under the agent-apply loop. */
  snapshots: SnapshotStore
  /** Append-only token-usage ledger across init / task / apply runs. */
  usageLedger: UsageLedger
  /** Health of the tasks.json write path — surfaced via GET /api/status. */
  getPersistenceHealth?: () => { ok: boolean; consecutiveFailures: number; lastError: string | null }
}

const MAX_BODY_SIZE = 4_194_304
/** PNG uploads promise a 4MB *decoded* cap, but base64 inflates bytes ~4/3 —
 *  a legal ~4MB PNG arrives as a ~5.5MB JSON body. The upload routes read
 *  with this raised cap so the decoded-buffer check is the real boundary
 *  (without it, MAX_BODY_SIZE silently lowers the PNG cap to ~2.9MB). */
const MAX_IMAGE_BODY_SIZE = 6_291_456

function readBody(req: IncomingMessage, maxSize = MAX_BODY_SIZE): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = ''
    let size = 0
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > maxSize) { req.destroy(); reject(new Error('Request body too large')); return }
      body += chunk.toString()
    })
    req.on('end', () => resolve(body))
    req.on('error', reject)
  })
}

function parseJSON(raw: string): { ok: true; data: unknown } | { ok: false } {
  try { return { ok: true, data: JSON.parse(raw) } } catch { return { ok: false } }
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

/**
 * Decode a `data:image/png;base64,…` URL into a buffer, verifying the PNG
 * signature — Buffer.from() tolerates malformed base64 (it pads/drops bytes),
 * so a bare regex match isn't enough to keep garbage out of the .png files
 * we serve back to the shell.
 */
function decodePngDataUrl(dataUrl: string): Buffer | null {
  const match = dataUrl.match(/^data:image\/png;base64,(.+)$/)
  if (!match) return null
  const buffer = Buffer.from(match[1], 'base64')
  if (buffer.length < PNG_SIGNATURE.length || !buffer.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) return null
  return buffer
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
  | 'forbidden_host'
  | 'origin_port_mismatch'
  | 'not_found'
  | 'missing_field'
  | 'invalid_id'
  | 'invalid_body'
  | 'conflict'

export interface ApiErrorBody {
  error: { code: ApiErrorCode; message: string }
}

function sendError(res: ServerResponse, status: number, message: string, code: ApiErrorCode = 'validation_failed') {
  res.statusCode = status
  const body: ApiErrorBody = { error: { code, message } }
  res.end(JSON.stringify(body))
}

import { isAllowedHost, isLocalOrigin, originMatchesPort } from './origin.js'
import { scanComponentLibraries, scanProjectComponents, clearComponentCache, revalidate as revalidateComponentCatalog } from './component-scanner.js'
import { filterTasksByMfe } from '../shared/task-summary.js'
import { getCodeContext } from './code-context.js'
import { classifyBindings } from './binding-classify.js'
import { getComponentExamples } from './component-examples.js'
import { resolveFingerprint, hasUsableEvidence } from './resolve-fingerprint.js'
import { scanComponentUsage } from './component-usage.js'
import { probeDataContext, resolveDataContext, resolveElementDataContext } from './data-context.js'
import { scanDataSources, clearDataSourceCache } from './data-source-scanner.js'
import { getDataSourceExamples } from './data-source-examples.js'
import { resolveDataSourceDetails } from './data-source-details.js'
import { resolveDataSourceShape } from './data-source-shape.js'
import { resolveBindingGraph } from './binding-analysis/index.js'
import { scanApiSchemas } from './api-schema-scanner.js'
import { getWorkspaceCatalog } from './workspace-catalog.js'
import { resolveEndpoint } from './api-schema-resolver.js'
import { resolveWorkspace } from './workspace.js'
import { getSystemPrompt } from '../skills/index.js'
import { TASK_TYPES, type DataSource } from '../schema.js'
import { listAgentModels, type ProvideredId } from './agent-models.js'

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

/** Extract the port number from the Host header (e.g. "localhost:5173" → 5173). */
function deriveServerPort(req: IncomingMessage): number | undefined {
  const host = typeof req.headers.host === 'string' ? req.headers.host : ''
  if (!host) return undefined
  const colonIdx = host.lastIndexOf(':')
  if (colonIdx === -1) return undefined
  const p = parseInt(host.slice(colonIdx + 1), 10)
  return Number.isFinite(p) ? p : undefined
}

/**
 * Server-side wireframe lifecycle closure. When a `wireframe_apply` task is
 * ACCEPTED its placements are done — remove them from wireframe.json so the
 * shell never re-mounts a wireframe copy next to the agent's real component.
 * When the task is DELETED the work was abandoned — revert its instances to
 * 'placed' (and clear `taskId`) so the user can rebuild them. (A DENIED task
 * keeps 'building': the agent retries the same task.)
 *
 * Best-effort by design: the task mutation has already committed, so a
 * wireframe failure must not fail the response. CAS conflicts (another tab
 * writing concurrently) retry the read-modify-write a few times; the worst
 * case after exhausting retries is a stale placement the user can delete from
 * the placements panel. `setWireframe` broadcasts `wireframe:updated`, so live
 * shells re-load without polling.
 */
export function createAPIMiddleware(options: APIOptions) {
  // `scanProjectComponents` (component-scanner.ts) caches its result for 60s
  // and returns the SAME object reference while warm, a NEW object on every
  // real rescan. We track that identity here (rather than minting
  // `Date.now()` on every request) so `GET project-components` advertises
  // the actual scan time instead of always looking "just scanned" — a
  // response used to claim freshness even when serving a component that had
  // been deleted from disk a minute earlier.
  let lastProjectLibraryRef: Awaited<ReturnType<typeof scanProjectComponents>> | null = null
  let lastProjectLibraryScannedAt = 0

  return async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    // DNS-rebinding gate — runs FIRST, for ALL methods. The Origin checks
    // below only cover mutating requests; without a Host check a rebound page
    // can read every GET endpoint (read-file, source excerpts, tasks,
    // screenshots, transcripts). Vite's own allowedHosts middleware never
    // sees /__annotask/* because Annotask registers ahead of it, so this is
    // the only host gate these routes get. Covers the screenshot route too
    // (it lives in this middleware, above the /api/ prefix check).
    if (req.url?.startsWith('/__annotask/') && !isAllowedHost(req.headers.host, options.allowedHosts?.() ?? [])) {
      res.setHeader('Content-Type', 'application/json')
      return sendError(res, 403, 'Forbidden: host not allowed (see ANNOTASK_ALLOWED_HOSTS)', 'forbidden_host')
    }

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

    // Serve wireframe canvas snapshots (outside /api/ path) — same containment
    // discipline as screenshots; filenames are shell-minted ids, never paths.
    if (req.url?.startsWith('/__annotask/wireframe-snapshots/') && req.method === 'GET') {
      const filename = (req.url.replace('/__annotask/wireframe-snapshots/', '')).replace(/\?.*$/, '')
      if (!WIREFRAME_SNAPSHOT_FILENAME_RE.test(filename)) {
        res.statusCode = 400; res.end('Invalid filename'); return
      }
      const snapshotsDir = nodePath.resolve(options.projectRoot, '.annotask', 'wireframe-snapshots')
      const filePath = nodePath.resolve(snapshotsDir, filename)
      if (!filePath.startsWith(snapshotsDir + nodePath.sep)) {
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

    // System prompt for the embedded agent. Composes the base `annotask-apply`
    // skill body with the optional task-type companion (A11Y_RULES.md, etc.)
    // so the in-shell runner gets the same prompt external editors see via
    // MCP `initialize.instructions`, plus per-task-type guidance.
    if (path === 'system-prompt' && req.method === 'GET') {
      const urlObj = new URL(req.url!, `http://${req.headers.host || 'localhost'}`)
      const taskType = urlObj.searchParams.get('task_type') || undefined
      if (taskType && !(TASK_TYPES as readonly string[]).includes(taskType)) {
        return sendError(res, 400, `Unknown task type: ${taskType}`)
      }
      let prompt = ''
      try {
        prompt = getSystemPrompt({ taskType })
      } catch {
        // Bundled skills missing — return an empty prompt so the runner can
        // fall back to its built-in placeholder rather than 500.
        prompt = ''
      }
      res.end(JSON.stringify({ prompt, taskType: taskType ?? null }, null, 2))
      return
    }

    // Project-wide token usage summary. GET /usage → aggregate totals,
    // per-scope (task/init/apply/chat), and per-provider tallies. The Providers
    // settings panel reads this to show cumulative spend, complementing the
    // per-conversation budget cap.
    if (path === 'usage' && req.method === 'GET') {
      const summary = await options.usageLedger.summary()
      res.end(JSON.stringify(summary, null, 2))
      return
    }
    // GET /usage/recent?limit=N → most recent entries, newest first. Used by
    // the activity log in Settings.
    if (path === 'usage/recent' && req.method === 'GET') {
      const urlObj = new URL(req.url!, `http://${req.headers.host || 'localhost'}`)
      const rawLimit = urlObj.searchParams.get('limit')
      const parsedLimit = rawLimit ? Number(rawLimit) : 50
      const limit = Number.isFinite(parsedLimit) && parsedLimit > 0
        ? Math.min(500, Math.floor(parsedLimit))
        : 50
      const entries = await options.usageLedger.recent(limit)
      res.end(JSON.stringify({ entries }, null, 2))
      return
    }

    if (path === 'init/state' && req.method === 'GET') {
      res.end(JSON.stringify(options.initRunner.getState(), null, 2))
      return
    }

    // Per-scan-target metadata for the wizard's Re-scan UI. Only the two
    // durable artifacts (design-spec.json — covers tokens/themes/framework
    // produced from the components, data-source, and api-schema scans —
    // and agents.json) are reported, so users can see when each was last
    // written before picking which scanners to re-run.
    if (path === 'init/scan-targets' && req.method === 'GET') {
      const targets: Array<{ id: 'designSpec' | 'agentConfigs'; file: string }> = [
        { id: 'designSpec',   file: 'design-spec.json' },
        { id: 'agentConfigs', file: 'agents.json' },
      ]
      const out: Record<string, { exists: boolean; mtime: number | null }> = {}
      for (const t of targets) {
        const fp = nodePath.join(options.projectRoot, '.annotask', t.file)
        try {
          const stat = await fsp.stat(fp)
          out[t.id] = { exists: true, mtime: stat.mtimeMs }
        } catch {
          out[t.id] = { exists: false, mtime: null }
        }
      }
      res.end(JSON.stringify(out, null, 2))
      return
    }

    if (path === 'init/start' && req.method === 'POST') {
      let scanOptions: ScanOptions = {}
      try {
        const raw = await readBody(req)
        if (raw.trim()) {
          const parsed = parseJSON(raw)
          if (parsed.ok && parsed.data && typeof parsed.data === 'object' && !Array.isArray(parsed.data)) {
            const b = parsed.data as Record<string, unknown>
            scanOptions = {
              skipAgentScan: b.skipAgentScan === true,
              skipAgentConfigs: b.skipAgentConfigs === true,
              skipComponents: b.skipComponents === true,
              skipDataSources: b.skipDataSources === true,
              skipApiSchemas: b.skipApiSchemas === true,
              requestedProviderId: typeof b.requestedProviderId === 'string' && (PROVIDER_IDS as readonly string[]).includes(b.requestedProviderId)
                ? b.requestedProviderId as ScanOptions['requestedProviderId']
                : undefined,
              requestedModel: typeof b.requestedModel === 'string' ? b.requestedModel : undefined,
              requestedEffort: typeof b.requestedEffort === 'string' && (EFFORT_LEVELS as readonly string[]).includes(b.requestedEffort)
                ? b.requestedEffort as ScanOptions['requestedEffort']
                : undefined,
            }
          }
        }
      } catch { /* no body is fine */ }
      const state = options.initRunner.start(scanOptions)
      res.end(JSON.stringify(state, null, 2))
      return
    }

    if (path === 'init/cancel' && req.method === 'POST') {
      options.initRunner.cancel()
      res.end(JSON.stringify(options.initRunner.getState(), null, 2))
      return
    }

    // Mark as initialized without committing token data — used when the user
    // prefers to run the annotask-init skill in their editor agent instead.
    if (path === 'init/skip' && req.method === 'POST') {
      const state = await options.initRunner.skip()
      res.end(JSON.stringify(state, null, 2))
      return
    }

    if (path === 'init/commit' && req.method === 'POST') {
      let raw: string
      try { raw = await readBody(req) } catch { return sendError(res, 413, 'Request body too large', 'body_too_large') }
      let body: Record<string, unknown> = {}
      if (raw.trim().length > 0) {
        const parsed = parseJSON(raw)
        if (!parsed.ok) return sendError(res, 400, 'Invalid JSON body', 'invalid_json')
        if (!parsed.data || typeof parsed.data !== 'object' || Array.isArray(parsed.data)) {
          return sendError(res, 400, 'Request body must be a JSON object', 'body_not_object')
        }
        body = parsed.data as Record<string, unknown>
      }
      const commitBody = {
        spec: typeof body.spec === 'object' && body.spec !== null && !Array.isArray(body.spec)
          ? body.spec as Record<string, unknown>
          : undefined,
        styleGuide: typeof body.styleGuide === 'string' ? body.styleGuide : undefined,
        overwriteStyleGuide: body.overwriteStyleGuide === true,
      }
      const state = await options.initRunner.commit(commitBody)
      if (state.result === 'error') {
        return sendError(res, 400, state.error ?? 'Commit failed')
      }
      res.end(JSON.stringify(state, null, 2))
      return
    }

    // Per-persona project directions written by the init agent and editable in Settings.
    if (path === 'agent-configs' && req.method === 'GET') {
      const configs = await options.getAgentConfigs()
      res.end(JSON.stringify(configs, null, 2))
      return
    }

    {
      const m = path.match(/^agent-configs\/([^/]+)$/)
      if (m && req.method === 'PATCH') {
        const personaId = decodeURIComponent(m[1])
        if (!/^[a-z0-9-]+$/.test(personaId)) return sendError(res, 400, 'Invalid persona id', 'invalid_id')
        let raw: string
        try { raw = await readBody(req) } catch { return sendError(res, 413, 'Request body too large', 'body_too_large') }
        const parsed = parseJSON(raw)
        if (!parsed.ok) return sendError(res, 400, 'Invalid JSON body', 'invalid_json')
        if (!parsed.data || typeof parsed.data !== 'object' || Array.isArray(parsed.data)) {
          return sendError(res, 400, 'Request body must be a JSON object', 'body_not_object')
        }
        const b = parsed.data as Record<string, unknown>
        const entry: Partial<AgentConfigEntry> = {}
        if ('projectDirections' in b) {
          if (typeof b.projectDirections !== 'string') {
            return sendError(res, 400, 'Invalid projectDirections field', 'invalid_body')
          }
          entry.projectDirections = b.projectDirections
        }
        if ('providerId' in b) {
          if (typeof b.providerId !== 'string' || !(PROVIDER_IDS as readonly string[]).includes(b.providerId)) {
            return sendError(res, 400, 'Invalid providerId', 'invalid_body')
          }
          entry.providerId = b.providerId as AgentConfigEntry['providerId']
        }
        if ('model' in b) {
          if (typeof b.model !== 'string') {
            return sendError(res, 400, 'Invalid model field', 'invalid_body')
          }
          entry.model = b.model
        }
        if ('effort' in b) {
          if (typeof b.effort !== 'string' || !(EFFORT_LEVELS as readonly string[]).includes(b.effort)) {
            return sendError(res, 400, 'Invalid effort', 'invalid_body')
          }
          entry.effort = b.effort as AgentConfigEntry['effort']
        }
        if (Object.keys(entry).length === 0) {
          return sendError(res, 400, 'Body must include at least one of projectDirections, providerId, model, effort', 'invalid_body')
        }
        const result = await options.setAgentConfig(personaId, entry)
        res.end(JSON.stringify(result, null, 2))
        return
      }
    }

    // ── Wireframe document (.annotask/wireframe.json) ──
    // GET returns the whole multi-route doc, or just one route's slice with
    // `?route=PATH`. PUT replaces the whole document (the shell owns the
    // in-memory merge and PUTs the full doc — small, single-writer file).
    if (path === 'wireframe' && req.method === 'GET') {
      const urlObj = new URL(req.url!, `http://${req.headers.host || 'localhost'}`)
      const route = urlObj.searchParams.get('route')
      const doc = await options.getWireframe()
      if (route) {
        res.end(JSON.stringify({ ...doc, routes: doc.routes.filter(r => r.route === route) }, null, 2))
        return
      }
      res.end(JSON.stringify(doc, null, 2))
      return
    }

    if (path === 'wireframe' && req.method === 'PUT') {
      let raw: string
      try { raw = await readBody(req) } catch { return sendError(res, 413, 'Request body too large', 'body_too_large') }
      const parsed = parseJSON(raw)
      if (!parsed.ok) return sendError(res, 400, 'Invalid JSON body', 'invalid_json')
      if (!parsed.data || typeof parsed.data !== 'object' || Array.isArray(parsed.data)) {
        return sendError(res, 400, 'Request body must be a JSON object', 'body_not_object')
      }
      if (!isWireframeDocument(parsed.data)) {
        return sendError(res, 400, 'Body must be a wireframe document { version: "1.0", updatedAt, routes[] } with well-formed instances', 'validation_failed')
      }
      try {
        const saved = await options.setWireframe(parsed.data)
        res.end(JSON.stringify(saved, null, 2))
      } catch (err) {
        // Stale/missing rev — another writer (tab, accept hook) committed
        // first. The client must re-GET and merge; never auto-retry the write.
        if (err instanceof WireframeRevConflictError) {
          return sendError(res, 409, err.message, 'conflict')
        }
        throw err
      }
      return
    }

    // ── Design-session journal (.annotask/design-session.json) ──
    // The ordered record of what the user did in the design tool. The shell
    // owns the in-memory journal and PUTs the whole document (CAS on rev, like
    // the wireframe doc). DELETE is the server-owned "discard session": it also
    // removes the session's wireframe placements so a discard from any tab —
    // even a fresh one after a crash — fully unwinds the session.
    if (path === 'design-session' && req.method === 'GET') {
      const doc = await options.getDesignSession()
      res.end(JSON.stringify(doc, null, 2))
      return
    }

    if (path === 'design-session' && req.method === 'PUT') {
      let raw: string
      try { raw = await readBody(req) } catch { return sendError(res, 413, 'Request body too large', 'body_too_large') }
      const parsed = parseJSON(raw)
      if (!parsed.ok) return sendError(res, 400, 'Invalid JSON body', 'invalid_json')
      if (!parsed.data || typeof parsed.data !== 'object' || Array.isArray(parsed.data)) {
        return sendError(res, 400, 'Request body must be a JSON object', 'body_not_object')
      }
      if (!isDesignSessionDocument(parsed.data)) {
        return sendError(res, 400, 'Body must be a design-session document { version: "1.0", sessionId, startedAt, updatedAt, entries[] } with well-formed entries', 'validation_failed')
      }
      try {
        const saved = await options.setDesignSession(parsed.data)
        res.end(JSON.stringify(saved, null, 2))
      } catch (err) {
        if (err instanceof RevConflictError) {
          return sendError(res, 409, err.message, 'conflict')
        }
        throw err
      }
      return
    }

    if (path === 'design-session' && req.method === 'DELETE') {
      // Never discard over a live, unsealed apply — reverting its files would
      // clobber the agent's in-progress bytes (no hash guard yet). The shell
      // disables Discard while a run is in flight; this backstops other callers.
      const snap = await options.snapshots.state()
      if (snap.batches.some((b) => b.status === 'running')) {
        return sendError(res, 409, 'An apply is still running — wait for it to finish before discarding', 'conflict')
      }
      const doc = await options.getDesignSession()
      const instanceIds = new Set(doc.entries.map((e) => e.instanceId).filter((id): id is string => typeof id === 'string'))
      let removedInstances = 0
      // Discard is a full session reset: the session's placements AND every
      // route's wireframe-canvas sketch go — same retry discipline as
      // closeWireframeLifecycle (best-effort, CAS-retried).
      const snapshotFiles: string[] = []
      for (let attempt = 0; attempt < 3; attempt++) {
        const wf = await options.getWireframe()
        let touched = false
        let removed = 0
        const routes = wf.routes.map((route) => {
          const hasInstances = route.instances.some((i) => instanceIds.has(i.id))
          if (!hasInstances && !route.canvas) return route
          touched = true
          const instances = route.instances.filter((i) => {
            if (instanceIds.has(i.id)) { removed++; return false }
            return true
          })
          if (route.canvas) {
            for (const b of route.canvas.blocks) if (b.image) snapshotFiles.push(b.image)
            if (route.canvas.fullImage) snapshotFiles.push(route.canvas.fullImage)
          }
          return { ...route, instances, canvas: undefined, updatedAt: Date.now() }
        })
        if (!touched) break
        try {
          await options.setWireframe({ ...wf, routes, updatedAt: Date.now() })
          removedInstances = removed
          break
        } catch (err) {
          snapshotFiles.length = 0
          if (!(err instanceof WireframeRevConflictError)) {
            console.warn('[Annotask] design-session discard: wireframe cleanup failed:', err)
            break
          }
        }
      }
      // Snapshot PNGs are sketch material — drop them with the sketches.
      const snapshotsDir = nodePath.resolve(options.projectRoot, '.annotask', 'wireframe-snapshots')
      for (const f of new Set(snapshotFiles)) {
        if (!WIREFRAME_SNAPSHOT_FILENAME_RE.test(f)) continue
        const p = nodePath.resolve(snapshotsDir, f)
        if (!p.startsWith(snapshotsDir + nodePath.sep)) continue
        fsp.unlink(p).catch(() => { /* already gone */ })
      }
      // Restore every snapshot-tracked file to its session-base bytes
      // (hash-guarded — files the user edited outside Annotask are skipped
      // and reported, never clobbered).
      let revertedFiles: string[] = []
      let failedFiles: string[] = []
      try {
        const result = await options.snapshots.revertAll()
        revertedFiles = result.reverted
        failedFiles = result.skipped
      } catch (err) {
        console.warn('[Annotask] design-session discard: snapshot restore failed:', err)
      }
      await options.clearDesignSession()
      res.end(JSON.stringify({ revertedFiles, failedFiles, removedInstances }, null, 2))
      return
    }

    // ── Agent-apply loop ──
    // "Apply now": snapshot the touched files, create ONE wireframe_apply task
    // (context.wireframe placements + context.session panel edits), stamp
    // statuses. The shell then drives the embedded agent on the returned task
    // through the existing spawn pipeline; the PATCH→review hook below runs
    // the verification pass and seals the batch.
    if (path === 'design-session/apply' && req.method === 'POST') {
      let raw: string
      try { raw = await readBody(req) } catch { return sendError(res, 413, 'Request body too large', 'body_too_large') }
      const parsed = parseJSON(raw)
      if (!parsed.ok) return sendError(res, 400, 'Invalid JSON body', 'invalid_json')
      const b = (parsed.data && typeof parsed.data === 'object' && !Array.isArray(parsed.data)) ? parsed.data as Record<string, unknown> : null
      if (!b || typeof b.route !== 'string') return sendError(res, 400, 'Body must include route', 'invalid_body')
      // Optional before/after composite — already uploaded via /screenshots;
      // only a safe filename rides through to the task.
      const screenshot = typeof b.screenshot === 'string' && isSafeScreenshot(b.screenshot) ? b.screenshot : undefined
      const result = await applyDesignSession(options, b.route, screenshot ? { screenshot } : undefined)
      if ('error' in result) return sendError(res, 400, result.error, 'invalid_body')
      res.end(JSON.stringify(result, null, 2))
      return
    }

    if (path === 'design-session/undo-batch' && req.method === 'POST') {
      let raw: string
      try { raw = await readBody(req) } catch { return sendError(res, 413, 'Request body too large', 'body_too_large') }
      const parsed = parseJSON(raw)
      if (!parsed.ok) return sendError(res, 400, 'Invalid JSON body', 'invalid_json')
      const b = (parsed.data && typeof parsed.data === 'object' && !Array.isArray(parsed.data)) ? parsed.data as Record<string, unknown> : null
      if (!b || typeof b.batchId !== 'string') return sendError(res, 400, 'Body must include batchId', 'invalid_body')
      try {
        const result = await revertApplyBatch(options, b.batchId)
        res.end(JSON.stringify(result, null, 2))
      } catch (err) {
        return sendError(res, 409, (err as Error).message, 'conflict')
      }
      return
    }

    if (path === 'design-session/detach-file' && req.method === 'POST') {
      let raw: string
      try { raw = await readBody(req) } catch { return sendError(res, 413, 'Request body too large', 'body_too_large') }
      const parsed = parseJSON(raw)
      if (!parsed.ok) return sendError(res, 400, 'Invalid JSON body', 'invalid_json')
      const b = (parsed.data && typeof parsed.data === 'object' && !Array.isArray(parsed.data)) ? parsed.data as Record<string, unknown> : null
      if (!b || typeof b.file !== 'string') return sendError(res, 400, 'Body must include file', 'invalid_body')
      await options.snapshots.detachFile(b.file)
      res.end(JSON.stringify(await options.snapshots.state(), null, 2))
      return
    }

    if (path === 'design-session/snapshots' && req.method === 'GET') {
      res.end(JSON.stringify(await options.snapshots.state(), null, 2))
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
      res.end(JSON.stringify(await options.addTask(payload), null, 2))
      return
    }

    if (path === 'screenshots' && req.method === 'POST') {
      let raw: string
      try { raw = await readBody(req, MAX_IMAGE_BODY_SIZE) } catch { return sendError(res, 413, 'Request body too large', 'body_too_large') }
      const parsed = parseJSON(raw)
      if (!parsed.ok) return sendError(res, 400, 'Invalid JSON body', 'invalid_json')
      const bodyResult = parseWith(UploadScreenshotBody, parsed.data)
      if (!bodyResult.ok) return sendError(res, 400, bodyResult.error)
      const buffer = decodePngDataUrl(bodyResult.data.data)
      if (!buffer) return sendError(res, 400, 'Invalid PNG data URL')
      if (buffer.length > 4 * 1024 * 1024) return sendError(res, 413, 'Screenshot too large (max 4MB)')
      const filename = `screenshot-${Date.now()}-${crypto.randomBytes(8).toString('hex')}.png`
      const dir = nodePath.join(options.projectRoot, '.annotask', 'screenshots')
      await fsp.mkdir(dir, { recursive: true })
      await fsp.writeFile(nodePath.join(dir, filename), buffer)
      res.end(JSON.stringify({ filename }))
      return
    }

    // Wireframe canvas snapshot PNGs. Upload is id-addressed (the shell mints
    // block ids and re-uploads under the same id on recapture); delete is
    // best-effort cleanup when a palette/placeholder block is removed.
    if (path === 'wireframe-snapshots' && req.method === 'POST') {
      let raw: string
      try { raw = await readBody(req, MAX_IMAGE_BODY_SIZE) } catch { return sendError(res, 413, 'Request body too large', 'body_too_large') }
      const parsed = parseJSON(raw)
      if (!parsed.ok) return sendError(res, 400, 'Invalid JSON body', 'invalid_json')
      const bodyResult = parseWith(UploadWireframeSnapshotBody, parsed.data)
      if (!bodyResult.ok) return sendError(res, 400, bodyResult.error)
      const buffer = decodePngDataUrl(bodyResult.data.data)
      if (!buffer) return sendError(res, 400, 'Invalid PNG data URL')
      if (buffer.length > 4 * 1024 * 1024) return sendError(res, 413, 'Snapshot too large (max 4MB)')
      const filename = `${bodyResult.data.id}.png`
      const dir = nodePath.join(options.projectRoot, '.annotask', 'wireframe-snapshots')
      await fsp.mkdir(dir, { recursive: true })
      await fsp.writeFile(nodePath.join(dir, filename), buffer)
      res.end(JSON.stringify({ filename }))
      return
    }

    if (path.startsWith('wireframe-snapshots/') && req.method === 'DELETE') {
      const filename = decodeURIComponent(path.replace('wireframe-snapshots/', ''))
      if (!WIREFRAME_SNAPSHOT_FILENAME_RE.test(filename)) return sendError(res, 400, 'Invalid filename')
      const dir = nodePath.resolve(options.projectRoot, '.annotask', 'wireframe-snapshots')
      const filePath = nodePath.resolve(dir, filename)
      if (!filePath.startsWith(dir + nodePath.sep)) return sendError(res, 403, 'Forbidden')
      try { await fsp.unlink(filePath) } catch { /* already gone */ }
      res.end(JSON.stringify({ deleted: filename }))
      return
    }

    // Bare task-by-id GET. Subpaths (`tasks/:id/messages`, `tasks/:id/interaction-history`, …)
    // are handled by their own dedicated blocks farther down — this catchall
    // would otherwise short-circuit them with a "task not found" 404 because
    // it'd try to look up "task-XXX/messages" as a literal task id.
    if (path.startsWith('tasks/') && !path.slice('tasks/'.length).includes('/') && req.method === 'GET') {
      const id = decodeURIComponent(path.replace('tasks/', ''))
      if (!id) return sendError(res, 400, 'Missing task id')
      const taskData = options.getTasks()
      const task = taskData.tasks.find(t => t.id === id)
      if (!task) return sendError(res, 404, 'Task not found', 'not_found')
      res.end(JSON.stringify(task, null, 2))
      return
    }

    if (path.startsWith('tasks/') && !path.slice('tasks/'.length).includes('/') && req.method === 'PATCH') {
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
      // Transition validity is asserted INSIDE the task lock (state.updateTask
      // runs the guard against the task it actually loads under the mutex).
      // Checking here against options.getTasks() would be a TOCTOU race: two
      // concurrent PATCHes (e.g. both pending → in_progress) could each pass
      // the pre-check before either commits, and both would lock the task.
      const guard = updates.status !== undefined
        ? (task: Record<string, unknown>) => assertTransition(task.status, updates.status)
        : undefined
      // Capture the type BEFORE updating — an accepted task is removed from
      // the store by state.updateTask, so it can't be looked up afterwards.
      const taskBefore = options.getTasks().tasks.find(t => t.id === id)
      const updated = await options.updateTask(id, updates as Record<string, unknown>, guard ? { guard } : undefined) as any
      if (updated && typeof updated === 'object' && updated.error === 'Task not found') {
        return sendError(res, 404, 'Task not found', 'not_found')
      }
      if (updated && typeof updated === 'object' && updated.error === 'Invalid transition') {
        return sendError(res, 400, updated.reason ?? 'Invalid state transition', 'invalid_transition')
      }
      // Lifecycle closure: accepting a wireframe_apply task retires its
      // placements so they never re-mount beside the now-real component, and
      // commits the apply batch (bytes are the new baseline — snapshots drop,
      // session entries clear, an emptied session rotates to a fresh id).
      if (updates.status === 'accepted' && taskBefore?.type === 'wireframe_apply') {
        await closeWireframeLifecycle(options, id, 'remove')
        try {
          const { rotated } = await acceptApplyTask(options, id)
          if (rotated) await options.clearDesignSession()
        } catch (err) { console.warn('[Annotask] apply accept closure failed:', err) }
      }
      // Agent-apply verification: the agent finished (review) — re-read the
      // source per session entry, flip written|failed, seal the batch's
      // post-apply hashes. Best-effort: the task mutation already committed.
      if (updates.status === 'review' && taskBefore?.type === 'wireframe_apply') {
        try { await verifyAppliedEntries(options, id) }
        catch (err) { console.warn('[Annotask] apply verification failed:', err) }
      }
      // Exit from a live in_progress run that isn't →review (verify seals) or
      // →accepted (commit). The batch MUST be sealed either way — a 'running'
      // batch left unsealed wedges undo + discard + re-apply all at once.
      //   pending/blocked: the run gave up (crash/abort/stall) — fully abandon:
      //     release 'applying' entries back to pending AND unlock the canvas
      //     (releaseApplyTask now does both), so the sketch is editable again.
      //   denied/needs_info: keep the entries + canvas for a retry/resume, but
      //     still seal so undo/discard work while the user decides.
      if (taskBefore?.type === 'wireframe_apply' && taskBefore?.status === 'in_progress') {
        if (updates.status === 'pending' || updates.status === 'blocked') {
          try { await releaseApplyTask(options, id) }
          catch (err) { console.warn('[Annotask] apply release failed:', err) }
        } else if (updates.status === 'denied' || updates.status === 'needs_info') {
          try { await options.snapshots.sealBatchByTask(id, { failed: true }) }
          catch (err) { console.warn('[Annotask] apply seal failed:', err) }
        }
      }
      // Retry / resume (denied|blocked|needs_info|review → in_progress) re-arms
      // verification: entries written/failed on the first review return to
      // 'applying' so the next review re-checks them instead of showing stale
      // verdicts. No-op on a first run (entries are already 'applying').
      if (updates.status === 'in_progress' && taskBefore?.type === 'wireframe_apply'
        && taskBefore?.status !== 'pending') {
        try { await restampApplyEntries(options, id) }
        catch (err) { console.warn('[Annotask] apply re-stamp failed:', err) }
      }
      res.end(JSON.stringify(updated, null, 2))
      return
    }

    if (path.startsWith('tasks/') && !path.slice('tasks/'.length).includes('/') && req.method === 'DELETE') {
      const id = decodeURIComponent(path.replace('tasks/', ''))
      // Capture the type BEFORE deleting — the record is gone afterwards.
      const taskBefore = options.getTasks().tasks.find(t => t.id === id)
      const deleted = await options.deleteTask(id) as any
      if (deleted && typeof deleted === 'object' && deleted.error === 'Task not found') {
        return sendError(res, 404, 'Task not found', 'not_found')
      }
      // Lifecycle closure: deleting a wireframe_apply task abandons the batch.
      // releaseApplyTask seals the (possibly half-written) batch so it stays
      // revertible, returns its session entries to 'pending', and reverts its
      // placements to 'placed' + unlocks the canvas sketch for editing.
      if (taskBefore?.type === 'wireframe_apply') {
        try { await releaseApplyTask(options, id) }
        catch (err) { console.warn('[Annotask] apply release failed:', err) }
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

    // Embedded chat: per-task conversation thread.
    // GET    /tasks/:id/messages              → full snapshot (optional ?after=<id>)
    // POST   /tasks/:id/messages              → append; broadcasts to subscribers
    // GET    /tasks/:id/messages/stream       → SSE; honours Last-Event-ID for resume
    {
      const m = path.match(/^tasks\/([^/]+)\/messages(\/stream)?$/)
      if (m) {
        const id = decodeURIComponent(m[1])
        const isStream = !!m[2]
        if (isStream && req.method === 'GET') {
          await handleThreadStream(req, res, options.taskThread, id)
          return
        }
        if (req.method === 'GET') {
          const urlObj = new URL(req.url!, `http://${req.headers.host || 'localhost'}`)
          const afterId = urlObj.searchParams.get('after') || undefined
          const msgs = await options.taskThread.read(id, { afterId })
          res.end(JSON.stringify({ taskId: id, messages: msgs }, null, 2))
          return
        }
        if (req.method === 'POST') {
          let raw: string
          try { raw = await readBody(req) } catch { return sendError(res, 413, 'Request body too large', 'body_too_large') }
          const parsed = parseJSON(raw)
          if (!parsed.ok) return sendError(res, 400, 'Invalid JSON body', 'invalid_json')
          const validated = validateThreadAppend(parsed.data)
          if (typeof validated === 'string') return sendError(res, 400, validated)
          const msg = await options.taskThread.append(id, validated)
          res.end(JSON.stringify(msg, null, 2))
          return
        }
      }
    }

    // PATCH /tasks/:id/messages/:msgId → update a message in place. Used by
    // the embedded agent to stream a partial assistant turn (append once,
    // then patch the same line as events arrive). Distinct matcher from the
    // `messages(/stream)?` block above so the two never collide.
    {
      const m = path.match(/^tasks\/([^/]+)\/messages\/([^/]+)$/)
      if (m && req.method === 'PATCH') {
        const id = decodeURIComponent(m[1])
        const msgId = decodeURIComponent(m[2])
        let raw: string
        try { raw = await readBody(req) } catch { return sendError(res, 413, 'Request body too large', 'body_too_large') }
        const parsed = parseJSON(raw)
        if (!parsed.ok) return sendError(res, 400, 'Invalid JSON body', 'invalid_json')
        const validated = validateThreadPatch(parsed.data)
        if (typeof validated === 'string') return sendError(res, 400, validated)
        const msg = await options.taskThread.update(id, msgId, validated)
        if (!msg) return sendError(res, 404, 'Message not found', 'not_found')
        res.end(JSON.stringify(msg, null, 2))
        return
      }
    }

    // Embedded chat: spawn a local CLI provider as a subprocess.
    // Spawn routes get a stricter same-port origin check (the general mutating
    // gate above only checks localhost hostname). This prevents a page on a
    // different localhost port from spawning CLIs that have credential access.
    if (path === 'agent/spawn' && req.method === 'POST') {
      if (!originMatchesPort(req.headers.origin as string | undefined, deriveServerPort(req))) {
        return sendError(res, 403, 'Forbidden: origin port mismatch', 'origin_port_mismatch')
      }
      let raw: string
      try { raw = await readBody(req) } catch { return sendError(res, 413, 'Request body too large', 'body_too_large') }
      const parsed = parseJSON(raw)
      if (!parsed.ok) return sendError(res, 400, 'Invalid JSON body', 'invalid_json')
      // handleSpawn writes its own SSE headers; we hand it the parsed body
      // and let it drive the response from here on out.
      await options.agentSpawn.handleSpawn(req, res, parsed.data, options.projectRoot)
      return
    }
    {
      const m = path.match(/^agent\/spawn\/([^/]+)$/)
      if (m && req.method === 'DELETE') {
        if (!originMatchesPort(req.headers.origin as string | undefined, deriveServerPort(req))) {
          return sendError(res, 403, 'Forbidden: origin port mismatch', 'origin_port_mismatch')
        }
        const runId = decodeURIComponent(m[1])
        const ok = options.agentSpawn.registry.abort(runId)
        if (!ok) return sendError(res, 404, 'Run not found', 'not_found')
        res.end(JSON.stringify({ ok: true }))
        return
      }
    }

    // Embedded chat: detect installed/logged-in local CLIs.
    if (path === 'agent/detect' && req.method === 'GET') {
      const snapshot = await options.agentDetect.detect()
      res.end(JSON.stringify(snapshot, null, 2))
      return
    }

    // Per-provider model catalog. Best-effort live probe (opencode supports
    // listing today); curated fallback for CLIs without a list command.
    if (path === 'agent/models' && req.method === 'GET') {
      const urlObj = new URL(req.url!, `http://${req.headers.host || 'localhost'}`)
      const cli = urlObj.searchParams.get('cli') as ProvideredId | null
      if (!cli) return sendError(res, 400, 'Missing `cli` query parameter')
      // `?refresh=1` forces a fresh probe — used by the shell's "Refresh"
      // button on the model picker. Defaults to the 5-min in-process cache.
      const refresh = urlObj.searchParams.get('refresh') === '1'
      const catalog = await listAgentModels(cli, { refresh })
      res.end(JSON.stringify(catalog, null, 2))
      return
    }

    if (path === 'components' && req.method === 'GET') {
      const urlObj = new URL(req.url!, `http://${req.headers.host || 'localhost'}`)
      // `?refresh=1` bypasses the in-memory/disk cache and forces a real
      // rescan before responding. Without this, a component deleted from
      // disk kept being served as "live" for the full cache window with no
      // escape hatch — clearComponentCache existed but had zero production
      // callers. `revalidate` (not scanComponentLibraries) is used on the
      // refresh path because scanComponentLibraries can still hand back a
      // stale on-disk envelope while it revalidates in the background.
      const refresh = urlObj.searchParams.get('refresh') === '1' || urlObj.searchParams.get('refresh') === 'true'
      if (refresh) clearComponentCache()
      const catalog = refresh
        ? await revalidateComponentCatalog(options.projectRoot)
        : await scanComponentLibraries(options.projectRoot)
      const body = JSON.stringify(catalog)
      const etag = `"${crypto.createHash('sha1').update(body).digest('hex')}"`
      res.setHeader('ETag', etag)
      if (!refresh && req.headers['if-none-match'] === etag) {
        res.statusCode = 304
        res.end()
        return
      }
      res.end(body)
      return
    }

    // The project's own src/ components as a ScannedLibrary — the palette's
    // pinned "Project" group, and the prop-metadata source for local
    // components in the properties panel.
    if (path === 'project-components' && req.method === 'GET') {
      const urlObj = new URL(req.url!, `http://${req.headers.host || 'localhost'}`)
      const refresh = urlObj.searchParams.get('refresh') === '1' || urlObj.searchParams.get('refresh') === 'true'
      if (refresh) clearComponentCache()
      const library = await scanProjectComponents(options.projectRoot)
      if (library !== lastProjectLibraryRef) {
        lastProjectLibraryRef = library
        lastProjectLibraryScannedAt = Date.now()
      }
      res.end(JSON.stringify({ library, scannedAt: lastProjectLibraryScannedAt }, null, 2))
      return
    }

    if (path === 'component-usage' && req.method === 'GET') {
      const result = await scanComponentUsage(options.projectRoot)
      res.end(JSON.stringify(result, null, 2))
      return
    }

    // Read .annotask/STYLE_GUIDE.md — used by the init wizard's review step.
    if (path === 'style-guide' && req.method === 'GET') {
      const sgPath = nodePath.join(options.projectRoot, '.annotask', 'STYLE_GUIDE.md')
      try {
        const content = await fsp.readFile(sgPath, 'utf-8')
        res.end(JSON.stringify({ content, exists: true }))
      } catch {
        res.end(JSON.stringify({ content: '', exists: false }))
      }
      return
    }

    // Read an arbitrary project file by relative path — used for the style-guide override input.
    if (path === 'read-file' && req.method === 'GET') {
      const urlObj = new URL(req.url!, `http://${req.headers.host || 'localhost'}`)
      const relPath = urlObj.searchParams.get('path') ?? ''
      if (!relPath) return sendError(res, 400, 'Missing path parameter', 'missing_field')
      // Prevent directory traversal
      const resolved = nodePath.resolve(options.projectRoot, relPath)
      if (!resolved.startsWith(options.projectRoot + nodePath.sep) && resolved !== options.projectRoot) {
        return sendError(res, 403, 'Path must be within the project root', 'forbidden_origin')
      }
      try {
        const content = await fsp.readFile(resolved, 'utf-8')
        res.end(JSON.stringify({ content, path: relPath }))
      } catch {
        return sendError(res, 404, 'File not found', 'not_found')
      }
      return
    }

    if (path === 'status' && req.method === 'GET') {
      // Surface a session-reset flag when `.annotask/.session-reset` is
      // present on disk. The justfile's `clear-init` target writes this
      // sentinel so the shell can detect a developer-initiated reset and
      // wipe browser-side state (localStorage) without the developer
      // having to paste a snippet into DevTools.
      const sentinel = nodePath.resolve(options.projectRoot, '.annotask', '.session-reset')
      let sessionReset = false
      try {
        await fsp.access(sentinel)
        sessionReset = true
      } catch { /* not present — normal case */ }
      const persistenceHealth = options.getPersistenceHealth?.()
      res.end(JSON.stringify({
        status: 'ok',
        tool: 'annotask',
        sessionReset,
        // 'degraded' = task mutations are ACKed but failing to reach disk —
        // a restart would lose them. Shell/CLI should surface this loudly.
        persistence: persistenceHealth && !persistenceHealth.ok
          ? { state: 'degraded', consecutiveFailures: persistenceHealth.consecutiveFailures, lastError: persistenceHealth.lastError }
          : { state: 'ok' },
      }))
      return
    }

    if (path === 'session-reset' && req.method === 'DELETE') {
      // Acknowledged by the shell after it wipes localStorage. We delete
      // the on-disk sentinel so subsequent status polls report `false`
      // and we don't re-clear on every reload.
      const sentinel = nodePath.resolve(options.projectRoot, '.annotask', '.session-reset')
      try { await fsp.unlink(sentinel) } catch { /* already gone — fine */ }
      res.end(JSON.stringify({ ok: true }))
      return
    }

    if (path === 'workspace' && req.method === 'GET') {
      const catalog = await getWorkspaceCatalog(options.projectRoot)
      // absDir is an implementation detail — omit from the wire response.
      const packages = catalog.packages.map(({ absDir: _ignored, ...rest }) => rest)
      // Workspace-relative dir of the package running this dev server. The
      // shell prefixes bridge-reported `data-annotask-file` values (which are
      // emitted relative to vite's root — the package dir) so they line up
      // with the workspace-rooted paths the component-usage scanner records.
      const currentDir = nodePath.relative(catalog.root, options.projectRoot).replace(/\\/g, '/')
      res.end(JSON.stringify({ root: catalog.root, isWorkspace: catalog.isWorkspace, packages, currentDir }, null, 2))
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

    // Round-trip honesty classification for one element — drives the
    // properties panel's editable/read-only gating. file+line come from the
    // element's data-annotask-* attrs; tag narrows when several elements share
    // a line.
    if (path === 'binding-classify' && req.method === 'GET') {
      const urlObj = new URL(req.url!, `http://${req.headers.host || 'localhost'}`)
      const file = urlObj.searchParams.get('file') || ''
      const lineArg = Number(urlObj.searchParams.get('line') || '0')
      if (!file) return sendError(res, 400, 'Missing file')
      if (!Number.isFinite(lineArg) || lineArg < 1) return sendError(res, 400, 'Missing or invalid line')
      const tag = urlObj.searchParams.get('tag') || undefined
      const workspaceRoot = await getWorkspaceRoot(options.projectRoot)
      const result = await classifyBindings(options.projectRoot, file, lineArg, { tag, workspaceRoot })
      res.end(JSON.stringify(result, null, 2))
      return
    }

    // DOM-evidence → source-location resolver for anchorless wireframe
    // blocks. `classes` is comma-separated; `text` only counts as evidence at
    // >= 3 chars after trimming; `tag` is a weak tiebreak, never sufficient
    // alone — hence the 400 when neither classes nor text is usable.
    if (path === 'resolve-fingerprint' && req.method === 'GET') {
      const urlObj = new URL(req.url!, `http://${req.headers.host || 'localhost'}`)
      const classes = (urlObj.searchParams.get('classes') || '').split(',').map(s => s.trim()).filter(Boolean)
      const text = urlObj.searchParams.get('text') || ''
      const tag = urlObj.searchParams.get('tag') || undefined
      if (!hasUsableEvidence(classes, text)) {
        return sendError(res, 400, 'No usable evidence: provide classes or text (>= 3 chars after trimming)')
      }
      const limitArg = Number(urlObj.searchParams.get('limit') || '5')
      const limit = Number.isFinite(limitArg) ? Math.max(1, Math.min(20, limitArg)) : 5
      const result = await resolveFingerprint(options.projectRoot, { classes, text, tag, limit })
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

    // Runtime-observed endpoints — aggregated iframe network calls. POST to
    // append, GET to read, DELETE to reset. The iframe's injected bridge
    // client pushes batches to the shell, which relays to this endpoint.
    if (path === 'runtime-endpoints' && req.method === 'GET') {
      const urlObj = new URL(req.url!, `http://${req.headers.host || 'localhost'}`)
      const mergeStatic = urlObj.searchParams.get('merge_static') === 'true' || urlObj.searchParams.get('merge_static') === '1'
      const route = urlObj.searchParams.get('route') || undefined
      // Previously parsed nowhere on this route — HTTP silently ignored it
      // while MCP/CLI at least attempted to honor it. `orphans_only` needs
      // enrichment to know whether an endpoint matched anything, so it forces
      // enrichment on even when `merge_static` wasn't requested.
      const orphansOnly = urlObj.searchParams.get('orphans_only') === 'true' || urlObj.searchParams.get('orphans_only') === '1'
      // `?refresh=1` forces a fresh static/data-source scan before enriching —
      // clearDataSourceCache previously had zero production callers.
      const refresh = urlObj.searchParams.get('refresh') === '1' || urlObj.searchParams.get('refresh') === 'true'
      if (refresh) clearDataSourceCache()
      const catalog = options.getRuntimeEndpointCatalog()
      let endpoints = catalog.endpoints
      if (route) {
        endpoints = endpoints.filter(ep => ep.routes.some(r => r.route === route))
      }
      if (mergeStatic || orphansOnly) {
        const staticCat = await scanDataSources(options.projectRoot)
        const schemaCat = await scanApiSchemas(options.projectRoot, {
          devServerUrl: deriveDevServerUrl(req),
          apiSchemaUrls: options.apiSchemaUrls,
          apiSchemaFiles: options.apiSchemaFiles,
        })
        endpoints = endpoints.map(ep => enrichEndpoint(ep, staticCat.project_entries, schemaCat))
      }
      // Surface only endpoints with no matching static entry AND no matching
      // API schema — the highest-value gaps for an agent to fill in.
      if (orphansOnly) {
        endpoints = endpoints.filter(ep => (!ep.matchedSources || ep.matchedSources.length === 0) && !ep.matchedSchemaLocation)
      }
      res.end(JSON.stringify({ ...catalog, endpoints }, null, 2))
      return
    }

    if (path === 'runtime-endpoints' && req.method === 'POST') {
      let raw: string
      try { raw = await readBody(req) } catch { return sendError(res, 413, 'Request body too large', 'body_too_large') }
      const parsed = parseJSON(raw)
      if (!parsed.ok) return sendError(res, 400, 'Invalid JSON body', 'invalid_json')
      const body = parsed.data as { calls?: unknown } | null
      if (!body || typeof body !== 'object' || !Array.isArray((body as { calls?: unknown }).calls)) {
        return sendError(res, 400, 'Expected { calls: NetworkCall[] } body', 'body_not_object')
      }
      const rawCalls = (body as { calls: unknown[] }).calls
      const calls: NetworkCall[] = []
      for (const c of rawCalls) {
        if (!c || typeof c !== 'object') continue
        const rec = c as Record<string, unknown>
        if (typeof rec.method !== 'string' || typeof rec.pathNoQuery !== 'string') continue
        calls.push(rec as unknown as NetworkCall)
      }
      options.ingestNetworkCalls(calls)
      res.end(JSON.stringify({ ok: true, ingested: calls.length }))
      return
    }

    if (path === 'runtime-endpoints' && req.method === 'DELETE') {
      options.clearRuntimeEndpoints()
      res.end(JSON.stringify({ ok: true }))
      return
    }

    if (path === 'data-sources' && req.method === 'GET') {
      const urlObj = new URL(req.url!, `http://${req.headers.host || 'localhost'}`)
      const kind = urlObj.searchParams.get('kind') as DataSource['kind'] | null
      const library = urlObj.searchParams.get('library')
      const searchStr = (urlObj.searchParams.get('search') || '').toLowerCase()
      const usedOnly = urlObj.searchParams.get('used_only') === 'true' || urlObj.searchParams.get('used_only') === '1'
      const includeRuntime = urlObj.searchParams.get('include_runtime') === 'true' || urlObj.searchParams.get('include_runtime') === '1'
      // Orphan runtime endpoints get promoted into project_entries by default —
      // the whole point of capturing them was to fill gaps the regex scanner
      // misses. Callers that want static-only can pass ?merge_runtime=false.
      const mergeRuntime = urlObj.searchParams.get('merge_runtime') !== 'false' && urlObj.searchParams.get('merge_runtime') !== '0'
      // `?refresh=1` forces a fresh scan — clearDataSourceCache previously
      // had zero production callers, so a deleted/renamed data source kept
      // being served from the 60s in-memory cache with no escape hatch.
      const refresh = urlObj.searchParams.get('refresh') === '1' || urlObj.searchParams.get('refresh') === 'true'
      if (refresh) clearDataSourceCache()
      const catalog = await scanDataSources(options.projectRoot)
      const libraries = library ? catalog.libraries.filter(l => l.name === library) : catalog.libraries
      let entries = catalog.project_entries
      if (mergeRuntime) {
        const runtimeCat = options.getRuntimeEndpointCatalog()
        entries = mergeRuntimeOrphansIntoEntries(entries, runtimeCat.endpoints)
      }
      if (kind) entries = entries.filter(e => e.kind === kind)
      if (searchStr) entries = entries.filter(e => e.name.toLowerCase().includes(searchStr))
      if (usedOnly) entries = entries.filter(e => e.used_count > 0)
      const body: Record<string, unknown> = { libraries, project_entries: entries, scannedAt: catalog.scannedAt }
      if (includeRuntime) {
        const runtimeCat = options.getRuntimeEndpointCatalog()
        const schemaCat = await scanApiSchemas(options.projectRoot, {
          devServerUrl: deriveDevServerUrl(req),
          apiSchemaUrls: options.apiSchemaUrls,
          apiSchemaFiles: options.apiSchemaFiles,
        })
        body.runtime_endpoints = runtimeCat.endpoints.map(ep =>
          enrichEndpoint(ep, catalog.project_entries, schemaCat),
        )
        body.runtime_updated_at = runtimeCat.updatedAt
      }
      res.end(JSON.stringify(body, null, 2))
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
      // `method`/`line` disambiguators — the same `name`/`kind`/`file` can
      // still collide (e.g. one endpoint called with GET and POST, or
      // re-declared at multiple lines in the same file). resolveDataSourceDetails
      // narrows its ambiguous-candidate set with them.
      const method = urlObj.searchParams.get('method') || undefined
      const lineArg = urlObj.searchParams.get('line')
      const line = lineArg != null && Number.isFinite(Number(lineArg)) ? Number(lineArg) : undefined
      const workspaceRoot = await getWorkspaceRoot(options.projectRoot)
      const result = await resolveDataSourceDetails({
        projectRoot: options.projectRoot,
        name,
        kind,
        file,
        contextLines,
        workspaceRoot,
        method,
        line,
      })
      res.end(JSON.stringify(result, null, 2))
      return
    }

    // Shape resolution for the wireframe binding picker. Query-param style
    // (like api-operation) because kind/file disambiguators ride along.
    if (path === 'data-source-shape' && req.method === 'GET') {
      const urlObj = new URL(req.url!, `http://${req.headers.host || 'localhost'}`)
      const name = urlObj.searchParams.get('name') || ''
      if (!name) return sendError(res, 400, 'Missing name parameter', 'missing_field')
      const kind = (urlObj.searchParams.get('kind') || undefined) as DataSource['kind'] | undefined
      const file = urlObj.searchParams.get('file') || undefined
      // `method`/`line` disambiguators — same purpose as data-source-details
      // above: resolveDataSourceShape narrows an ambiguous name+kind+file set
      // by request verb / definition line.
      const method = urlObj.searchParams.get('method') || undefined
      const lineArg = urlObj.searchParams.get('line')
      const line = lineArg != null && Number.isFinite(Number(lineArg)) ? Number(lineArg) : undefined
      const workspaceRoot = await getWorkspaceRoot(options.projectRoot)
      const result = await resolveDataSourceShape({
        projectRoot: options.projectRoot,
        name,
        kind,
        file,
        workspaceRoot,
        method,
        line,
        schemaScan: {
          devServerUrl: deriveDevServerUrl(req),
          apiSchemaUrls: options.apiSchemaUrls,
          apiSchemaFiles: options.apiSchemaFiles,
        },
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
      // Optional library filter — prevents same-name components from
      // different libraries (Mantine Button vs Radix Button) from cross-
      // contaminating the examples list. Shell threads this from the
      // currently-selected library; CLI accepts `--library`; MCP has
      // `library` on the tool input.
      const library = urlObj.searchParams.get('library') || undefined
      const result = await getComponentExamples(options.projectRoot, name, limit, library)
      res.end(JSON.stringify(result, null, 2))
      return
    }

    res.statusCode = 404
    const body: ApiErrorBody = { error: { code: 'not_found', message: 'Not found' } }
    res.end(JSON.stringify(body))
  }
}

/**
 * `RuntimeEndpoint` plus the schema-match diagnostics `resolveEndpoint`
 * computes but the base type doesn't carry — kept local to this enrichment
 * boundary. Previously the resolved match's confidence (and which
 * method/path actually matched) was computed and then thrown away, leaving
 * callers unable to tell a confident exact match from a low-confidence
 * method-mismatched guess.
 */
type EnrichedRuntimeEndpoint = RuntimeEndpoint & {
  matchConfidence?: number
  matchedOperationMethod?: string
  matchedOperationPath?: string
}

/**
 * Annotate a runtime endpoint with the matching static sources and OpenAPI
 * operation when one exists. Keeps the enrichment cheap (simple path/method
 * equality + `resolveEndpoint`), since this runs on every GET.
 */
function enrichEndpoint(
  ep: RuntimeEndpoint,
  staticEntries: Array<{ name: string; method?: string; endpoint?: string; resolved_endpoint?: string }>,
  schemaCatalog: Awaited<ReturnType<typeof scanApiSchemas>>,
): EnrichedRuntimeEndpoint {
  const out: EnrichedRuntimeEndpoint = { ...ep }
  // Match static `ProjectDataEntry` rows whose declared endpoint lines up
  // with this runtime call. Origin-aware (see `findMatchingStaticEntries`):
  // a runtime call to `:4320/api/health` won't pick up `apiHealth_4310` from
  // a sibling MFE just because they share a path. Without that gate, the
  // Network tab's overlay used to union sites across every MFE that had a
  // same-path entry.
  const matched: string[] = []
  for (const entry of findMatchingStaticEntries(ep, staticEntries)) {
    if (!matched.includes(entry.name)) matched.push(entry.name)
  }
  if (matched.length > 0) out.matchedSources = matched

  // Match against the discovered API schemas. Prefer the concrete URL (has
  // real ids) so OpenAPI templated matching works; fall back to the pattern.
  const sampleUrl = ep.sampleUrls[0] || ep.path
  const match = resolveEndpoint(schemaCatalog, sampleUrl, ep.method)
  if (match) {
    out.matchedSchemaLocation = match.schema_location
    if (match.operation.id) out.matchedOperationId = match.operation.id
    out.matchConfidence = match.confidence
    out.matchedOperationMethod = match.operation.method
    out.matchedOperationPath = match.operation.path
  }
  return out
}

/**
 * Validate a `POST /tasks/:id/messages` body. Returns either the normalised
 * append input or a human-readable error string.
 */
interface ThreadAppendBody {
  role: ThreadRole
  content: string
  providerId?: string
  model?: string
  usage?: ThreadMessage['usage']
  toolCalls?: ThreadMessage['toolCalls']
  toolUseId?: string
  sessionId?: string
  blocks?: WorkStreamBlock[]
  isPartial?: boolean
  lastEventAt?: number
}

/** CLI session ids are short opaque tokens (UUIDs, ULIDs). Cap defensively so
 *  a hostile body can't stuff kilobytes into every thread line. */
const MAX_SESSION_ID_CHARS = 200

function validateThreadAppend(raw: unknown): ThreadAppendBody | string {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return 'body must be an object'
  const body = raw as Record<string, unknown>
  if (body.role !== 'user' && body.role !== 'assistant' && body.role !== 'system' && body.role !== 'tool') {
    return '`role` must be one of: user, assistant, system, tool'
  }
  if (typeof body.content !== 'string') return '`content` must be a string'
  const out: ThreadAppendBody = {
    role: body.role,
    content: body.content,
  }
  if (typeof body.providerId === 'string') out.providerId = body.providerId
  if (typeof body.model === 'string') out.model = body.model
  if (typeof body.toolUseId === 'string') out.toolUseId = body.toolUseId
  if (typeof body.sessionId === 'string' && body.sessionId.length > 0 && body.sessionId.length <= MAX_SESSION_ID_CHARS) {
    out.sessionId = body.sessionId
  }
  const usage = parseUsage(body.usage)
  if (usage) out.usage = usage
  if (Array.isArray(body.toolCalls)) {
    out.toolCalls = []
    for (const tc of body.toolCalls) {
      if (tc && typeof tc === 'object') {
        const t = tc as Record<string, unknown>
        if (typeof t.id === 'string' && typeof t.name === 'string') {
          out.toolCalls.push({ id: t.id, name: t.name, input: t.input })
        }
      }
    }
  }
  if (Array.isArray(body.blocks)) {
    const validated = validateBlocks(body.blocks)
    if (validated.length > 0) out.blocks = validated
  }
  if (typeof body.isPartial === 'boolean') out.isPartial = body.isPartial
  if (typeof body.lastEventAt === 'number') out.lastEventAt = body.lastEventAt
  return out
}

/** Parse a loose `usage` object into the typed shape, or `undefined`. */
function parseUsage(raw: unknown): ThreadMessage['usage'] | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const u = raw as Record<string, unknown>
  if (typeof u.inputTokens !== 'number' || typeof u.outputTokens !== 'number') return undefined
  return {
    inputTokens: u.inputTokens,
    outputTokens: u.outputTokens,
    cacheReadTokens: typeof u.cacheReadTokens === 'number' ? u.cacheReadTokens : undefined,
    cacheCreationTokens: typeof u.cacheCreationTokens === 'number' ? u.cacheCreationTokens : undefined,
    estimated: u.estimated === true ? true : undefined,
  }
}

/**
 * Validate a `PATCH /tasks/:id/messages/:msgId` body — the in-place update
 * used to stream a partial assistant turn. All fields optional; only the
 * mutable subset is accepted (role/id/ts are immutable).
 */
function validateThreadPatch(raw: unknown): UpdateInput | string {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return 'body must be an object'
  const body = raw as Record<string, unknown>
  const out: UpdateInput = {}
  if (typeof body.content === 'string') out.content = body.content
  if (typeof body.providerId === 'string') out.providerId = body.providerId
  if (typeof body.model === 'string') out.model = body.model
  if (typeof body.sessionId === 'string' && body.sessionId.length > 0 && body.sessionId.length <= MAX_SESSION_ID_CHARS) {
    out.sessionId = body.sessionId
  }
  if (typeof body.isPartial === 'boolean') out.isPartial = body.isPartial
  if (typeof body.lastEventAt === 'number') out.lastEventAt = body.lastEventAt
  const usage = parseUsage(body.usage)
  if (usage) out.usage = usage
  if (Array.isArray(body.blocks)) out.blocks = validateBlocks(body.blocks)
  return out
}

/**
 * Loose validator for the `blocks` array. The wire shape is a discriminated
 * union on `kind`; we accept the known kinds and silently drop unknown ones
 * so a future block kind doesn't break older servers.
 */
function validateBlocks(raw: unknown[]): WorkStreamBlock[] {
  const out: WorkStreamBlock[] = []
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue
    const b = entry as Record<string, unknown>
    if (b.kind === 'text' && typeof b.text === 'string') {
      out.push({ kind: 'text', text: b.text })
    } else if (
      b.kind === 'tool_call'
      && typeof b.id === 'string'
      && typeof b.name === 'string'
      && typeof b.summary === 'string'
    ) {
      out.push({ kind: 'tool_call', id: b.id, name: b.name, input: b.input ?? {}, summary: b.summary })
    } else if (
      b.kind === 'tool_result'
      && typeof b.toolUseId === 'string'
      && typeof b.summary === 'string'
      && typeof b.raw === 'string'
    ) {
      out.push({
        kind: 'tool_result',
        toolUseId: b.toolUseId,
        summary: b.summary,
        raw: b.raw,
        isError: b.isError === true ? true : undefined,
      })
    } else if (
      b.kind === 'agent_question'
      && typeof b.entryIndex === 'number'
      && typeof b.label === 'string'
    ) {
      out.push({ kind: 'agent_question', entryIndex: b.entryIndex, label: b.label })
    }
  }
  return out
}

/**
 * SSE handler for `GET /tasks/:id/messages/stream`.
 *
 * Behaviour:
 *   1. Honour `Last-Event-ID` (or `?after=`) — replay any messages added
 *      since the client disconnected before going live.
 *   2. Subscribe to the in-process listener set and forward new appends.
 *   3. Heartbeat every 15s so reverse proxies don't drop idle connections.
 *   4. On client disconnect, unsubscribe.
 */
async function handleThreadStream(
  req: IncomingMessage,
  res: ServerResponse,
  store: TaskThreadStore,
  taskId: string,
): Promise<void> {
  res.statusCode = 200
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no')
  res.flushHeaders?.()

  function send(event: string, msg: ThreadMessage | string) {
    const data = typeof msg === 'string' ? msg : JSON.stringify(msg)
    const id = typeof msg === 'string' ? '' : `id: ${msg.id}\n`
    res.write(`${id}event: ${event}\n`)
    for (const line of data.split('\n')) res.write(`data: ${line}\n`)
    res.write('\n')
  }

  // Replay anything the client missed.
  const lastEventId = (req.headers['last-event-id'] as string | undefined) || undefined
  const urlObj = new URL(req.url!, `http://${req.headers.host || 'localhost'}`)
  const afterId = lastEventId ?? urlObj.searchParams.get('after') ?? undefined
  const replay = await store.read(taskId, { afterId: afterId || undefined })
  for (const m of replay) send('message', m)

  // Heartbeat so reverse proxies don't drop the idle SSE connection.
  const hb = setInterval(() => {
    try { res.write(': heartbeat\n\n') } catch { /* socket closed */ }
  }, 15_000)
  hb.unref()

  const unsubscribe = store.subscribe(taskId, (m) => send('message', m))
  req.on('close', () => {
    clearInterval(hb)
    unsubscribe()
    try { res.end() } catch { /* already ended */ }
  })
}
