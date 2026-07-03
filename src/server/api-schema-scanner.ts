/**
 * API schema discovery — OpenAPI / GraphQL / tRPC / plain JSON Schema.
 *
 * Two discovery modes:
 *   1. Filesystem scan — walk projectRoot for openapi.{json,yaml,yml},
 *      swagger.*, *.graphql / *.gql with a Query/Mutation type, *.schema.json.
 *   2. Dev-server HTTP probes — hit common schema URLs on the local dev
 *      server (localhost only, 500ms timeout, negative results cached).
 *      Also POSTs a GraphQL introspection query if a likely /graphql endpoint
 *      exists.
 *
 * Raw schema bodies pass through verbatim — no normalization between
 * OpenAPI / GraphQL / tRPC into a canonical shape. Agents consult `kind` to
 * understand the body they receive.
 *
 * Framework-neutral: works for any backend that publishes an OpenAPI / GraphQL
 * schema, which is the common case across Node, Python (FastAPI),
 * Java (Spring Boot), Go, Ruby on Rails, etc.
 */
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import nodePath from 'node:path'
import yaml from 'js-yaml'
import type { ApiSchema, ApiSchemaCatalog, ApiOperation } from '../schema.js'
import { resolveWorkspace } from './workspace.js'

const CACHE_TTL_MS = 60_000
const PROBE_TIMEOUT_MS = 500
const MAX_FILES_SCANNED = 5000
const MAX_SCHEMA_BYTES = 8 * 1024 * 1024   // 8MB hard cap per schema doc
const SCAN_EXTS = new Set(['.json', '.yaml', '.yml', '.graphql', '.gql', '.ts', '.tsx', '.js', '.mjs'])
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.annotask', '.next', '.nuxt', 'coverage', '.vite', '.turbo', '.svelte-kit', '.output'])

/** Dev-server paths we try for OpenAPI docs. Ordered by "most canonical first". */
const OPENAPI_PROBE_PATHS = [
  '/openapi.json',
  '/openapi.yaml',
  '/api-docs.json',
  '/api-docs',
  '/swagger.json',
  '/swagger/v1/swagger.json',
  '/v3/api-docs',              // Spring Boot default
  '/api/openapi',              // springdoc custom path (no extension)
  '/api/openapi.json',
  '/api/docs/openapi.json',
]

/** Dev-server paths we try for a GraphQL endpoint. We POST introspection to each. */
const GRAPHQL_PROBE_PATHS = ['/graphql', '/api/graphql', '/v1/graphql']

/** Minimal introspection — covers type names + field types without bloating the response. */
const INTROSPECTION_QUERY = `{
  __schema {
    queryType { name }
    mutationType { name }
    subscriptionType { name }
    types {
      kind name description
      fields {
        name description
        args { name type { kind name ofType { kind name ofType { kind name } } } }
        type { kind name ofType { kind name ofType { kind name } } }
      }
      inputFields { name type { kind name ofType { kind name ofType { kind name } } } }
    }
  }
}`

// ── Cache ────────────────────────────────────────────

let cachedCatalog: ApiSchemaCatalog | null = null
let cachedAt = 0
let inflight: Promise<ApiSchemaCatalog> | null = null
/**
 * URLs known to be dead, with the timestamp of that negative result. Entries
 * older than `NEGATIVE_PROBE_TTL_MS` are treated as expired and re-probed —
 * without a TTL a backend that starts up after the first scan stays invisible
 * for the dev-server's entire lifetime (only an explicit `clearApiSchemaCache`
 * call, which normal scanning never triggers, used to reset this).
 */
const negativeProbeCache = new Map<string, number>()
const NEGATIVE_PROBE_TTL_MS = CACHE_TTL_MS

function isNegativelyCached(url: string): boolean {
  const at = negativeProbeCache.get(url)
  if (at == null) return false
  if (Date.now() - at > NEGATIVE_PROBE_TTL_MS) {
    negativeProbeCache.delete(url)
    return false
  }
  return true
}

/**
 * Set once per scan when at least one probed base refused the connection
 * outright (backend down), as opposed to responding with 404s (backend up,
 * no schema published there). Lets callers distinguish "we looked and there's
 * nothing" from "we couldn't even reach a backend to look" — a bare `[]`
 * schema list can't tell those apart on its own.
 */
let lastScanHadUnreachableBase = false

/** Probe-health telemetry for the most recent scan — see `lastScanHadUnreachableBase`. */
export function getApiSchemaProbeHealth(): { backendUnreachable: boolean } {
  return { backendUnreachable: lastScanHadUnreachableBase }
}

export function clearApiSchemaCache() {
  cachedCatalog = null
  cachedAt = 0
  inflight = null
  negativeProbeCache.clear()
}

// ── Public API ──────────────────────────────────────

export interface ScanOptions {
  /** Dev-server base URL (e.g. http://localhost:5173). When present, HTTP probes are attempted. */
  devServerUrl?: string
  /** Explicit schema locations from .annotask/config.json (takes precedence over auto-discovery). */
  apiSchemaFiles?: string[]
  apiSchemaUrls?: string[]
}

export async function scanApiSchemas(
  projectRoot: string,
  opts: ScanOptions = {},
): Promise<ApiSchemaCatalog> {
  if (cachedCatalog && Date.now() - cachedAt < CACHE_TTL_MS) return cachedCatalog
  if (inflight) return inflight
  inflight = scanUncached(projectRoot, opts).finally(() => { inflight = null })
  const result = await inflight
  cachedCatalog = result
  cachedAt = Date.now()
  return result
}

/**
 * Directories that signal "this repo contains backend code" — used to mark
 * dev-server-probed schemas as `in_repo` even though we didn't read them off
 * disk. Framework-neutral: covers Next.js `app/api/`, Next.js `pages/api/`,
 * SvelteKit `routes/api/`, plus generic `api/`, `server/`, `backend/`.
 */
const BACKEND_DIR_HINTS = [
  'api',
  'server',
  'backend',
  'src/api',
  'src/server',
  'src/backend',
  'app/api',
  'pages/api',
  'routes/api',
]

async function detectBackendInRepo(root: string): Promise<boolean> {
  for (const rel of BACKEND_DIR_HINTS) {
    try {
      const stat = await fsp.stat(nodePath.join(root, rel))
      if (stat.isDirectory()) return true
    } catch { /* not present */ }
  }
  return false
}

async function scanUncached(projectRoot: string, opts: ScanOptions): Promise<ApiSchemaCatalog> {
  const schemas: ApiSchema[] = []
  lastScanHadUnreachableBase = false
  // Backend + schema discovery anchors on the workspace root so a monorepo's
  // `services/` folder (sibling of the MFE apps) is visible to every MFE's
  // annotask panel.
  const ws = await resolveWorkspace(projectRoot)
  const backendInRepo = await detectBackendInRepo(ws.root) || await detectBackendInRepo(projectRoot)

  // 1. Explicit config takes precedence — if set, we still do auto-discovery
  //    but skip directories we'd otherwise walk. Explicit paths remain
  //    relative to the declaring MFE for back-compat.
  let explicitParsedCount = 0
  if (opts.apiSchemaFiles && opts.apiSchemaFiles.length > 0) {
    for (const relPath of opts.apiSchemaFiles) {
      const parsed = await tryParseFile(projectRoot, relPath)
      if (parsed) { schemas.push(parsed); explicitParsedCount++ }
    }
  }
  if (opts.apiSchemaUrls && opts.apiSchemaUrls.length > 0) {
    for (const url of opts.apiSchemaUrls) {
      const { schema: parsed } = await tryProbeUrl(url)
      if (parsed) {
        // Explicit config URLs — trust the user's configuration as "they know this is their API" when a backend dir is also present.
        parsed.in_repo = backendInRepo
        schemas.push(parsed)
        explicitParsedCount++
      }
    }
  }
  // Reflects whether explicit config actually yielded a parsed schema, not
  // just that config *paths were configured* — a stale `apiSchemaFiles` entry
  // pointing at nothing must not suppress auto-discovery/probing below.
  const hasExplicit = explicitParsedCount > 0

  // 2. Filesystem auto-discovery — scope to the RUNNING package, not the whole
  //    workspace. Walking ws.root surfaced sibling apps' schema files (a Vue app
  //    showed unrelated go-api / rust-api openapi.json from other playgrounds) —
  //    the same over-reach fixed in the component + data-source scanners. The
  //    running app's real backend is still discovered at RUNTIME via the
  //    dev-server + docker-compose probes below, so a monorepo's shared
  //    services/ backend still "just works" without reading sibling files.
  if (!hasExplicit) {
    const files: string[] = []
    await walk(projectRoot, files, projectRoot)
    for (const fp of files) {
      const parsed = await tryParseFile(projectRoot, nodePath.relative(projectRoot, fp))
      if (parsed) {
        // Dedupe by location
        if (!schemas.some(s => s.location === parsed.location)) schemas.push(parsed)
      }
    }
  }

  // 3. Dev-server probes — only when we haven't already found schemas from
  //    explicit config (saves localhost churn). Probes the current Vite
  //    server AND any sibling backend services discovered via docker-compose
  //    at the workspace root, so a monorepo like stress-test (7 MFEs + 5
  //    backend services on their own ports) "just works" with zero config.
  if (!hasExplicit) {
    // A service may publish its OpenAPI both as a checked-in file AND as an
    // HTTP endpoint (Go/Rust do this with //go:embed / include_str!). Without
    // content-level dedup we'd surface the same API twice — once from the
    // filesystem walk and once from the probe. Fingerprint by title + sorted
    // operation paths so identical schemas collapse regardless of location.
    const seenFingerprints = new Set<string>()
    for (const s of schemas) seenFingerprints.add(schemaFingerprint(s))

    // Compose-discovered bases come from a docker-compose file that is
    // itself checked into this repo/workspace — those services are
    // genuinely in-repo regardless of the generic directory-name heuristic.
    // The plain dev-server URL falls back to that heuristic since it's an
    // arbitrary "is there a backend-shaped dir anywhere" signal.
    const composeBases = await discoverComposeServiceBases(projectRoot, ws.root)
    const composeBaseSet = new Set(composeBases)
    const probeBases = new Set<string>()
    if (opts.devServerUrl) probeBases.add(trimSlash(opts.devServerUrl))
    for (const base of composeBases) probeBases.add(base)

    for (const base of probeBases) {
      const baseInRepo = composeBaseSet.has(base) ? true : backendInRepo
      // Circuit breaker: once a base refuses the connection outright (no
      // backend listening at all), skip the remaining probe paths against it
      // instead of repeating the same failed connection up to 13 times per
      // scan — this is the main source of ECONNREFUSED console spam on
      // projects with no backend running.
      let baseUnreachable = false

      // OpenAPI
      for (const p of OPENAPI_PROBE_PATHS) {
        if (baseUnreachable) break
        const url = base + p
        if (isNegativelyCached(url)) continue
        const { schema: s, connectionRefused } = await tryProbeUrl(url)
        if (connectionRefused) { baseUnreachable = true; lastScanHadUnreachableBase = true }
        if (s) {
          s.in_repo = baseInRepo
          const fp = schemaFingerprint(s)
          if (!schemas.some(x => x.location === s.location) && !seenFingerprints.has(fp)) {
            schemas.push(s)
            seenFingerprints.add(fp)
          }
        } else {
          negativeProbeCache.set(url, Date.now())
        }
      }
      // GraphQL introspection
      for (const p of GRAPHQL_PROBE_PATHS) {
        if (baseUnreachable) break
        const url = base + p
        if (isNegativelyCached(url)) continue
        const { schema: s, connectionRefused } = await tryProbeGraphQL(url)
        if (connectionRefused) { baseUnreachable = true; lastScanHadUnreachableBase = true }
        if (s) {
          s.in_repo = baseInRepo
          const fp = schemaFingerprint(s)
          if (!schemas.some(x => x.location === s.location) && !seenFingerprints.has(fp)) {
            schemas.push(s)
            seenFingerprints.add(fp)
          }
        } else {
          negativeProbeCache.set(url, Date.now())
        }
      }
    }
  }

  return { schemas, scannedAt: Date.now() }
}

/**
 * Content-level identity for schema dedup. Two entries with the same kind,
 * title, and operation set (method+path, sorted) are the same API regardless
 * of whether one came from disk and the other from an HTTP probe. Falls back
 * to `kind|location` when there's no title and no operations so unrelated but
 * empty schemas stay distinct.
 */
function schemaFingerprint(s: ApiSchema): string {
  const ops = s.operations.map(o => `${o.method.toUpperCase()} ${o.path}`).sort().join(',')
  const title = s.title ?? ''
  if (!title && !ops) return `${s.kind}|${s.location}`
  return `${s.kind}|${title}|${ops}`
}

// ── docker-compose → probe bases ─────────────────────

const composeCache = new Map<string, { at: number; bases: string[] }>()
const COMPOSE_CACHE_TTL_MS = 60_000

async function discoverComposeServiceBases(projectRoot: string, workspaceRoot: string): Promise<string[]> {
  const cacheKey = `${projectRoot}\0${workspaceRoot}`
  const hit = composeCache.get(cacheKey)
  if (hit && Date.now() - hit.at < COMPOSE_CACHE_TTL_MS) return hit.bases
  const bases = new Set<string>()
  // Walk every directory from projectRoot up to workspaceRoot (inclusive) so
  // a compose file at a subpath of the workspace (e.g. playgrounds/x/docker-
  // compose.yml) is picked up even when the pnpm workspace lives higher.
  for (const dir of ancestorsUpTo(projectRoot, workspaceRoot)) {
    for (const base of await readComposeServiceBases(dir)) bases.add(base)
  }
  const list = [...bases]
  composeCache.set(cacheKey, { at: Date.now(), bases: list })
  return list
}

function ancestorsUpTo(from: string, to: string): string[] {
  const fromAbs = nodePath.resolve(from)
  const toAbs = nodePath.resolve(to)
  const out: string[] = []
  let dir = fromAbs
  while (true) {
    out.push(dir)
    if (dir === toAbs) break
    const parent = nodePath.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return out
}

/**
 * Parse docker-compose.yml (and common variants) at `dir` and return
 * http://localhost:{hostPort} for every mapped port. Supports the short form
 * (`"4320:4320"`) and the long form (`{ published: 4320 }`). Ignores non-
 * HTTP-ish ports (< 80) to avoid probing e.g. Postgres 5432.
 */
async function readComposeServiceBases(dir: string): Promise<string[]> {
  const candidates = ['docker-compose.yml', 'docker-compose.yaml', 'compose.yml', 'compose.yaml']
  let doc: unknown = null
  for (const name of candidates) {
    const full = nodePath.join(dir, name)
    try {
      if (!fs.existsSync(full)) continue
      doc = yaml.load(await fsp.readFile(full, 'utf-8'))
      if (doc) break
    } catch { /* ignore malformed compose files */ }
  }
  if (!doc || typeof doc !== 'object') return []
  const services = (doc as { services?: Record<string, unknown> }).services
  if (!services || typeof services !== 'object') return []
  const bases = new Set<string>()
  for (const svc of Object.values(services)) {
    if (!svc || typeof svc !== 'object') continue
    const ports = (svc as { ports?: unknown[] }).ports
    if (!Array.isArray(ports)) continue
    for (const entry of ports) {
      const port = extractHostPort(entry)
      if (port && port >= 80) bases.add(`http://localhost:${port}`)
    }
  }
  return [...bases]
}

function extractHostPort(entry: unknown): number | null {
  if (typeof entry === 'number') return entry
  if (typeof entry === 'string') {
    // Accept "4320", "4320:4320", "127.0.0.1:4320:4320", "4320-4321:4320-4321"
    const trimmed = entry.trim()
    const parts = trimmed.split(':')
    const hostSide = parts.length === 1 ? parts[0] : parts[parts.length - 2]
    if (!hostSide) return null
    const first = hostSide.split('-')[0]
    const n = Number(first)
    return Number.isFinite(n) ? n : null
  }
  if (entry && typeof entry === 'object') {
    const pub = (entry as { published?: unknown }).published
    if (typeof pub === 'number') return pub
    if (typeof pub === 'string') {
      const n = Number(pub.split('-')[0])
      return Number.isFinite(n) ? n : null
    }
  }
  return null
}

// ── Filesystem scanning ──────────────────────────────

async function walk(dir: string, acc: string[], root: string): Promise<void> {
  if (acc.length >= MAX_FILES_SCANNED) return
  let entries: fs.Dirent[]
  try { entries = await fsp.readdir(dir, { withFileTypes: true }) } catch { return }
  for (const entry of entries) {
    if (acc.length >= MAX_FILES_SCANNED) return
    if (SKIP_DIRS.has(entry.name)) continue
    if (entry.name.startsWith('.')) continue
    const full = nodePath.join(dir, entry.name)
    if (entry.isDirectory()) {
      await walk(full, acc, root)
    } else if (entry.isFile()) {
      if (SCAN_EXTS.has(nodePath.extname(entry.name))) acc.push(full)
    }
  }
}

async function tryParseFile(projectRoot: string, relPath: string): Promise<ApiSchema | null> {
  const abs = nodePath.join(projectRoot, relPath)
  let stat: fs.Stats
  try { stat = await fsp.stat(abs) } catch { return null }
  if (stat.size > MAX_SCHEMA_BYTES) return null
  const ext = nodePath.extname(abs).toLowerCase()

  if (ext === '.json' || ext === '.yaml' || ext === '.yml') {
    const raw = await readText(abs)
    if (raw == null) return null
    const parsed = parseJsonOrYaml(raw, ext)
    if (!parsed) return null
    // Is this an OpenAPI doc?
    const openapi = tryAsOpenApi(parsed, relPath)
    if (openapi) return openapi
    // Is it a JSON schema (has $schema or top-level type)?
    const js = tryAsJsonSchema(parsed, relPath)
    if (js) return js
    return null
  }

  if (ext === '.graphql' || ext === '.gql') {
    const raw = await readText(abs)
    if (raw == null) return null
    return tryAsGraphQlSdl(raw, relPath)
  }

  if (ext === '.ts' || ext === '.tsx' || ext === '.js' || ext === '.mjs') {
    const raw = await readText(abs)
    if (raw == null) return null
    // Broadened beyond `createTRPCRouter`/`trpc.` literals: the equally-common
    // convention destructures `router`/`publicProcedure` off `initTRPC` and
    // never spells "trpc." anywhere in the file, which used to make this gate
    // silently reject the standard tRPC style entirely.
    const looksTrpc = raw.includes('createTRPCRouter')
      || /\btrpc\./.test(raw)
      || raw.includes('initTRPC')
      || /\.procedure\s*\.(?:input|output|query|mutation|subscription|use|meta)\s*\(/.test(raw)
    if (!looksTrpc) return null
    return tryAsTrpcRouter(raw, relPath)
  }

  return null
}

// ── tRPC parsing ─────────────────────────────────────

/**
 * Best-effort regex parse of a tRPC router file. We look for
 *     createTRPCRouter({
 *       foo: publicProcedure.input(z.object({...})).output(z.object({...})).query(...),
 *       bar: t.procedure.mutation(async ({ input }) => ...),
 *       nested: router({ list: publicProcedure.query(({ input }) => ...) }),
 *     })
 * and emit one ApiOperation per procedure (dotted `nested.list` for entries
 * under an inline nested router). Zod literals are converted to a
 * JSON-Schema-lite dict inline; we don't dynamically import the user's code.
 */
function tryAsTrpcRouter(raw: string, location: string): ApiSchema | null {
  const operations: ApiOperation[] = []
  for (const body of findRouterObjectBodies(raw)) {
    collectTrpcProcedures(body, operations)
  }
  if (operations.length === 0) return null
  return {
    kind: 'trpc',
    source: 'file',
    location,
    title: 'tRPC router',
    in_repo: true,
    operation_count: operations.length,
    operations,
  }
}

/**
 * Find every top-level `createTRPCRouter({...})` / `router({...})` /
 * `t.router({...})` call and return its object-literal body, using proper
 * brace-depth counting rather than a non-greedy regex. The previous
 * `\{([\s\S]*?)\}\s*\)` pattern truncated at the *first* `})` it saw —
 * which a router body full of `z.object({ id: z.string() })` calls hits
 * almost immediately, well before the router's own closing brace.
 */
function findRouterObjectBodies(raw: string): string[] {
  const bodies: string[] = []
  const callRe = /\b(?:createTRPCRouter|(?:[\w$]+\.)?router)\s*\(/g
  let m: RegExpExecArray | null
  while ((m = callRe.exec(raw)) !== null) {
    let i = callRe.lastIndex
    while (i < raw.length && /\s/.test(raw[i])) i++
    if (raw[i] !== '{') continue
    let depth = 0
    let j = i
    for (; j < raw.length; j++) {
      const c = raw[j]
      if (c === '{') depth++
      else if (c === '}') { depth--; if (depth === 0) { j++; break } }
    }
    if (depth !== 0) continue // unbalanced — bail on this call
    bodies.push(raw.slice(i + 1, j - 1))
    callRe.lastIndex = j // don't re-descend into this body as a new top-level call
  }
  return bodies
}

/**
 * A router entry whose value is itself a nested router call
 * (`users: router({ list: ..., create: ... })`) — returns the inner object
 * body so the caller can recurse with a dotted path prefix. `null` when the
 * chain isn't a nested-router call.
 */
function extractNestedRouterBody(chain: string): string | null {
  const c = chain.trim()
  const m = /^(?:createTRPCRouter|(?:[\w$]+\.)?router)\s*\(/.exec(c)
  if (!m) return null
  const inner = extractParenContent(c, m[0])
  if (!inner) return null
  const trimmed = inner.trim()
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) return null
  return trimmed.slice(1, -1)
}

function collectTrpcProcedures(body: string, operations: ApiOperation[], prefix = ''): void {
  // Split on top-level commas (brace/paren/bracket-aware) so each entry is
  // `name: <chain>` as a whole, however deep the handler body's own control
  // flow / call nesting goes — a naive single regex over the whole chain
  // (including the `.query(async ({ input }) => { ... })` handler body) broke
  // on any handler containing more than one level of nested parens, which is
  // the common case (`.map(x => ({ id: x.id }))`, `.filter(...).map(...)`, …).
  for (const entry of splitTopLevel(body, ',')) {
    const colonIdx = findTopLevel(entry, ':')
    if (colonIdx < 0) continue
    const name = entry.slice(0, colonIdx).trim().replace(/^['"]|['"]$/g, '')
    if (!/^[A-Za-z_$][\w$]*$/.test(name)) continue
    const chain = entry.slice(colonIdx + 1).trim()
    const path = prefix ? `${prefix}.${name}` : name

    const nestedBody = extractNestedRouterBody(chain)
    if (nestedBody != null) {
      collectTrpcProcedures(nestedBody, operations, path)
      continue
    }

    if (!/\.(query|mutation|subscription)\s*\(/.test(chain)) continue
    const method = /\.mutation\s*\(/.test(chain) ? 'mutation' : /\.subscription\s*\(/.test(chain) ? 'subscription' : 'query'
    // `extractCallArg` is balanced-paren-aware, so it finds `.input(...)` /
    // `.output(...)` correctly regardless of what the handler body (which
    // sits inside `.query(...)`/`.mutation(...)`, elsewhere in the chain)
    // contains — standard `({ input }) => {...}` handlers included.
    const request_schema = parseFirstZodArg(extractCallArg(chain, 'input'))
    const response_schema = parseFirstZodArg(extractCallArg(chain, 'output'))
    operations.push({
      id: path,
      method,
      path,
      request_schema,
      response_schema,
    })
  }
}

function extractCallArg(chain: string, methodName: string): string | null {
  // Find `.methodName(` and return the content up to the matching closing paren.
  const re = new RegExp(`\\.${methodName}\\s*\\(`)
  const m = re.exec(chain)
  if (!m) return null
  let depth = 1
  let i = m.index + m[0].length
  const start = i
  while (i < chain.length && depth > 0) {
    const c = chain[i]
    if (c === '(') depth++
    else if (c === ')') depth--
    if (depth === 0) return chain.slice(start, i)
    i++
  }
  return null
}

/** Parse a zod expression like `z.object({...})` into JSON-Schema-lite. Best-effort. */
function parseFirstZodArg(src: string | null): Record<string, unknown> | undefined {
  if (!src) return undefined
  const trimmed = src.trim()
  if (!trimmed) return undefined
  return parseZodExpr(trimmed)
}

function parseZodExpr(expr: string): Record<string, unknown> | undefined {
  const e = expr.trim()
  // z.string() / z.number() / z.boolean() / z.date() / z.bigint() / z.any()
  const simple = e.match(/^z\.(string|number|boolean|date|bigint|any|unknown|null|undefined|void)\s*\(\s*\)/)
  if (simple) {
    const t = simple[1]
    if (t === 'number' || t === 'bigint') return { type: 'number' }
    if (t === 'boolean') return { type: 'boolean' }
    if (t === 'date') return { type: 'string', format: 'date-time' }
    if (t === 'any' || t === 'unknown') return {}
    if (t === 'null') return { type: 'null' }
    if (t === 'void' || t === 'undefined') return { type: 'undefined' }
    return { type: 'string' }
  }
  // z.literal(x)
  const lit = e.match(/^z\.literal\s*\(\s*(.+?)\s*\)/)
  if (lit) {
    const raw = lit[1]
    if (raw.startsWith("'") || raw.startsWith('"')) return { const: raw.slice(1, -1) }
    if (raw === 'true' || raw === 'false') return { const: raw === 'true' }
    const n = Number(raw)
    if (!Number.isNaN(n)) return { const: n }
    return { const: raw }
  }
  // z.enum([...])
  const en = e.match(/^z\.enum\s*\(\s*\[([\s\S]*?)\]\s*\)/)
  if (en) {
    const items = en[1].split(',').map(s => s.trim()).filter(Boolean).map(s => s.replace(/^['"]|['"]$/g, ''))
    return { type: 'string', enum: items }
  }
  // z.array(inner) — find the matching paren content
  if (e.startsWith('z.array(')) {
    const inner = extractParenContent(e, 'z.array(')
    return { type: 'array', items: inner ? parseZodExpr(inner) ?? {} : {} }
  }
  // z.record(inner)
  if (e.startsWith('z.record(')) {
    const inner = extractParenContent(e, 'z.record(')
    return { type: 'object', additionalProperties: inner ? parseZodExpr(inner) ?? {} : {} }
  }
  // z.union([...])
  if (e.startsWith('z.union(')) {
    const inner = extractParenContent(e, 'z.union(')
    if (!inner) return {}
    const arr = inner.trim().replace(/^\[|\]$/g, '')
    return { oneOf: splitTopLevel(arr, ',').map(x => parseZodExpr(x) ?? {}) }
  }
  // z.object({ ... })
  if (e.startsWith('z.object(')) {
    const inner = extractParenContent(e, 'z.object(')
    if (!inner) return { type: 'object' }
    const body = inner.trim().replace(/^\{|\}$/g, '')
    const properties: Record<string, unknown> = {}
    const required: string[] = []
    for (const pair of splitTopLevel(body, ',')) {
      const colonIdx = findTopLevel(pair, ':')
      if (colonIdx < 0) continue
      const key = pair.slice(0, colonIdx).trim().replace(/^['"]|['"]$/g, '')
      let val = pair.slice(colonIdx + 1).trim()
      // Handle modifiers: .optional(), .nullable(), .default(...)
      let isOptional = false
      if (/\.optional\s*\(\s*\)\s*$/.test(val)) { isOptional = true; val = val.replace(/\.optional\s*\(\s*\)\s*$/, '') }
      if (/\.nullable\s*\(\s*\)\s*$/.test(val)) { val = val.replace(/\.nullable\s*\(\s*\)\s*$/, '') }
      if (/\.default\s*\([^)]*\)\s*$/.test(val)) { isOptional = true; val = val.replace(/\.default\s*\([^)]*\)\s*$/, '') }
      const sub = parseZodExpr(val) ?? {}
      properties[key] = sub
      if (!isOptional) required.push(key)
    }
    const out: Record<string, unknown> = { type: 'object', properties }
    if (required.length > 0) out.required = required
    return out
  }
  // Imported named schema (e.g. UserInput) — emit a reference-shaped marker.
  const named = e.match(/^([A-Z][\w$]*)\s*$/)
  if (named) return { $ref: `#/local/${named[1]}` }
  // Unknown shape — pass through so agents can at least see the raw expression.
  return { $unparsed: e.length > 200 ? e.slice(0, 200) + '…' : e }
}

function extractParenContent(expr: string, prefix: string): string | null {
  if (!expr.startsWith(prefix)) return null
  let depth = 1
  let i = prefix.length
  const start = i
  while (i < expr.length && depth > 0) {
    const c = expr[i]
    if (c === '(') depth++
    else if (c === ')') depth--
    if (depth === 0) return expr.slice(start, i)
    i++
  }
  return null
}

/** Split on top-level `sep` characters — ignores ones nested inside {}, [], (). */
function splitTopLevel(src: string, sep: string): string[] {
  const parts: string[] = []
  let depth = 0
  let last = 0
  for (let i = 0; i < src.length; i++) {
    const c = src[i]
    if (c === '{' || c === '[' || c === '(') depth++
    else if (c === '}' || c === ']' || c === ')') depth--
    else if (depth === 0 && c === sep) {
      parts.push(src.slice(last, i))
      last = i + 1
    }
  }
  parts.push(src.slice(last))
  return parts.map(p => p.trim()).filter(Boolean)
}

function findTopLevel(src: string, ch: string): number {
  let depth = 0
  for (let i = 0; i < src.length; i++) {
    const c = src[i]
    if (c === '{' || c === '[' || c === '(') depth++
    else if (c === '}' || c === ']' || c === ')') depth--
    else if (depth === 0 && c === ch) return i
  }
  return -1
}

async function readText(abs: string): Promise<string | null> {
  try { return await fsp.readFile(abs, 'utf-8') } catch { return null }
}

function parseJsonOrYaml(raw: string, ext: string): unknown {
  try {
    if (ext === '.json') return JSON.parse(raw)
    return yaml.load(raw)
  } catch {
    return null
  }
}

// ── OpenAPI parsing ──────────────────────────────────

function tryAsOpenApi(doc: unknown, location: string, source: ApiSchema['source'] = 'file'): ApiSchema | null {
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return null
  const d = doc as Record<string, unknown>
  const version = typeof d.openapi === 'string' ? d.openapi : typeof d.swagger === 'string' ? d.swagger : undefined
  if (!version) return null
  const isSwagger2 = typeof d.swagger === 'string'
  const info = (d.info && typeof d.info === 'object') ? d.info as Record<string, unknown> : {}
  const title = typeof info.title === 'string' ? info.title : undefined
  const infoVersion = typeof info.version === 'string' ? info.version : undefined
  const origin = extractOpenApiOrigin(d, location, source)
  const basePathPrefix = extractOpenApiBasePath(d, isSwagger2)

  // Full-ref-path keyed pool (`#/components/schemas/User`, `#/definitions/User`,
  // `#/components/pathItems/Foo`) so resolution isn't just a name-tail lookup
  // against a single flattened pool — a `components.schemas.User` and a
  // `definitions.User` no longer silently collide into one entry.
  const refPool: Record<string, unknown> = {}
  const componentsObj = (d.components && typeof d.components === 'object') ? d.components as Record<string, unknown> : undefined
  const componentSchemas = (componentsObj?.schemas && typeof componentsObj.schemas === 'object') ? componentsObj.schemas as Record<string, unknown> : undefined
  const pathItems = (componentsObj?.pathItems && typeof componentsObj.pathItems === 'object') ? componentsObj.pathItems as Record<string, unknown> : undefined
  const definitions = (d.definitions && typeof d.definitions === 'object') ? d.definitions as Record<string, unknown> : undefined
  if (componentSchemas) for (const [k, v] of Object.entries(componentSchemas)) refPool[`#/components/schemas/${k}`] = v
  if (definitions) for (const [k, v] of Object.entries(definitions)) refPool[`#/definitions/${k}`] = v
  if (pathItems) for (const [k, v] of Object.entries(pathItems)) refPool[`#/components/pathItems/${k}`] = v

  const operations: ApiOperation[] = []
  const paths = (d.paths && typeof d.paths === 'object') ? d.paths as Record<string, unknown> : {}
  const METHODS = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options']
  for (const [path, pathItemRaw] of Object.entries(paths)) {
    if (!pathItemRaw || typeof pathItemRaw !== 'object' || Array.isArray(pathItemRaw)) continue
    let item = pathItemRaw as Record<string, unknown>
    // Path items can themselves be a `$ref` (OpenAPI 3.1 `components.pathItems`,
    // or some Swagger tooling) — resolve it before reading HTTP methods off it,
    // instead of silently seeing zero operations for that path.
    if (typeof item.$ref === 'string') {
      const resolved = lookupRef(item.$ref, refPool)
      if (!resolved || typeof resolved !== 'object' || Array.isArray(resolved)) continue
      item = resolved as Record<string, unknown>
    }
    const fullPath = basePathPrefix ? basePathPrefix + (path.startsWith('/') ? path : '/' + path) : path
    for (const method of METHODS) {
      const op = item[method]
      if (!op || typeof op !== 'object' || Array.isArray(op)) continue
      const o = op as Record<string, unknown>
      const opId = typeof o.operationId === 'string' ? o.operationId : undefined
      const summary = typeof o.summary === 'string' ? o.summary : (typeof o.description === 'string' ? o.description as string : undefined)
      const request_schema = isSwagger2 ? extractSwagger2RequestBody(o, refPool) : extractOpenApiRequestBody(o, refPool)
      const { response_schema, schema_refs } = isSwagger2 ? extractSwagger2Response(o, refPool) : extractOpenApiResponse(o, refPool)
      operations.push({
        id: opId,
        method: method.toUpperCase(),
        path: fullPath,
        summary,
        request_schema,
        response_schema,
        schema_refs: schema_refs.length > 0 ? schema_refs : undefined,
      })
    }
  }

  return {
    kind: 'openapi',
    source,
    location,
    origin,
    title,
    version: infoVersion ?? version,
    in_repo: source === 'file',
    operation_count: operations.length,
    operations,
  }
}

/**
 * Origin this schema describes — the base URL callers hit. For dev-server
 * probes we parse it off `location` (e.g. `http://localhost:4320/openapi.json`
 * → `http://localhost:4320`). For filesystem specs we read `servers[0].url`;
 * localhost URLs in `servers` are common in dev-focused OpenAPI files. Returns
 * `undefined` when no usable origin can be derived. Strictly scheme+host+port
 * — any path component on `servers[].url` is a base path, handled separately
 * by `extractOpenApiBasePath` and baked into each operation's `path`.
 */
function extractOpenApiOrigin(doc: Record<string, unknown>, location: string, source: ApiSchema['source']): string | undefined {
  if (source === 'dev-server') {
    try { return new URL(location).origin } catch { /* fall through */ }
  }
  const servers = doc.servers
  if (Array.isArray(servers)) {
    for (const s of servers) {
      if (!s || typeof s !== 'object') continue
      const rawUrl = (s as Record<string, unknown>).url
      if (typeof rawUrl !== 'string') continue
      try { return new URL(rawUrl).origin } catch { /* try next */ }
    }
  }
  return undefined
}

/**
 * Base path every operation is actually served behind — OpenAPI 3.x
 * `servers[0].url`'s path component (absolute or relative: `/api/v1`,
 * `https://api.example.com/v1`), or Swagger 2.0's `basePath`. Without this,
 * a spec's `/users/{id}` never matches a runtime request to
 * `/api/v1/users/42`. Baked directly into each operation's `path` at parse
 * time (rather than stored as a separate field) so the resolver's existing
 * literal-segment matching just works, unmodified, against real URLs.
 */
function extractOpenApiBasePath(doc: Record<string, unknown>, isSwagger2: boolean): string {
  if (isSwagger2) {
    const bp = doc.basePath
    if (typeof bp === 'string' && bp) return bp.replace(/\/+$/, '')
    return ''
  }
  const servers = doc.servers
  if (Array.isArray(servers)) {
    for (const s of servers) {
      if (!s || typeof s !== 'object') continue
      const rawUrl = (s as Record<string, unknown>).url
      if (typeof rawUrl !== 'string' || !rawUrl) continue
      try {
        // A base of `http://placeholder.invalid` lets relative server URLs
        // (the common case: `servers: [{ url: '/api/v1' }]`) parse too.
        const u = new URL(rawUrl, 'http://placeholder.invalid')
        const p = u.pathname.replace(/\/+$/, '')
        return p === '/' ? '' : p
      } catch { /* try next */ }
    }
  }
  return ''
}

function extractOpenApiRequestBody(op: Record<string, unknown>, refPool: Record<string, unknown>): Record<string, unknown> | undefined {
  const body = op.requestBody
  if (!body || typeof body !== 'object') return undefined
  const content = (body as Record<string, unknown>).content
  if (!content || typeof content !== 'object') return undefined
  const c = content as Record<string, unknown>
  const pick = c['application/json'] ?? c['application/x-www-form-urlencoded'] ?? Object.values(c)[0]
  if (!pick || typeof pick !== 'object') return undefined
  const schema = (pick as Record<string, unknown>).schema
  if (!schema || typeof schema !== 'object') return undefined
  return resolveRefs(schema as Record<string, unknown>, refPool) as Record<string, unknown>
}

function extractOpenApiResponse(op: Record<string, unknown>, refPool: Record<string, unknown>): { response_schema?: Record<string, unknown>; schema_refs: string[] } {
  const responses = op.responses
  if (!responses || typeof responses !== 'object') return { schema_refs: [] }
  const r = responses as Record<string, unknown>
  // Prefer 200, then 201, then first 2xx, then default.
  const pickKey = ['200', '201', ...Object.keys(r).filter(k => k.startsWith('2')), 'default'].find(k => k in r)
  if (!pickKey) return { schema_refs: [] }
  const resp = r[pickKey]
  if (!resp || typeof resp !== 'object') return { schema_refs: [] }
  const content = (resp as Record<string, unknown>).content
  if (!content || typeof content !== 'object') return { schema_refs: [] }
  const c = content as Record<string, unknown>
  const pick = c['application/json'] ?? Object.values(c)[0]
  if (!pick || typeof pick !== 'object') return { schema_refs: [] }
  const schema = (pick as Record<string, unknown>).schema
  if (!schema || typeof schema !== 'object') return { schema_refs: [] }
  const refs = collectRefNames(schema as Record<string, unknown>)
  const resolved = resolveRefs(schema as Record<string, unknown>, refPool) as Record<string, unknown>
  return { response_schema: resolved, schema_refs: [...new Set(refs)] }
}

/**
 * Swagger 2.0 request body — carried as a `parameters[]` entry with
 * `in: 'body'` rather than OpenAPI 3's `requestBody.content[...].schema`.
 */
function extractSwagger2RequestBody(op: Record<string, unknown>, refPool: Record<string, unknown>): Record<string, unknown> | undefined {
  const params = op.parameters
  if (!Array.isArray(params)) return undefined
  for (const p of params) {
    if (!p || typeof p !== 'object') continue
    const po = p as Record<string, unknown>
    if (po.in === 'body' && po.schema && typeof po.schema === 'object') {
      return resolveRefs(po.schema as Record<string, unknown>, refPool) as Record<string, unknown>
    }
  }
  return undefined
}

/**
 * Swagger 2.0 response — the schema sits directly on `responses[code].schema`,
 * not behind a `content['application/json']` wrapper like OpenAPI 3.
 */
function extractSwagger2Response(op: Record<string, unknown>, refPool: Record<string, unknown>): { response_schema?: Record<string, unknown>; schema_refs: string[] } {
  const responses = op.responses
  if (!responses || typeof responses !== 'object') return { schema_refs: [] }
  const r = responses as Record<string, unknown>
  const pickKey = ['200', '201', ...Object.keys(r).filter(k => k.startsWith('2')), 'default'].find(k => k in r)
  if (!pickKey) return { schema_refs: [] }
  const resp = r[pickKey]
  if (!resp || typeof resp !== 'object') return { schema_refs: [] }
  const schema = (resp as Record<string, unknown>).schema
  if (!schema || typeof schema !== 'object') return { schema_refs: [] }
  const refs = collectRefNames(schema as Record<string, unknown>)
  const resolved = resolveRefs(schema as Record<string, unknown>, refPool) as Record<string, unknown>
  return { response_schema: resolved, schema_refs: [...new Set(refs)] }
}

function collectRefNames(node: unknown, acc: string[] = []): string[] {
  if (!node) return acc
  if (Array.isArray(node)) {
    for (const item of node) collectRefNames(item, acc)
    return acc
  }
  if (typeof node !== 'object') return acc
  const obj = node as Record<string, unknown>
  const ref = obj.$ref
  if (typeof ref === 'string') {
    const tail = ref.split('/').pop()
    if (tail) acc.push(tail)
  }
  for (const v of Object.values(obj)) collectRefNames(v, acc)
  return acc
}

/**
 * Resolve a `$ref` string against the full-path-keyed pool, falling back to a
 * name-tail match (against both `components/schemas` and `definitions`) for
 * refs that don't carry the exact section prefix we indexed under.
 */
function lookupRef(ref: string, refPool: Record<string, unknown>): unknown {
  if (ref in refPool) return refPool[ref]
  const tail = ref.split('/').pop()
  if (!tail) return undefined
  const schemaKey = `#/components/schemas/${tail}`
  if (schemaKey in refPool) return refPool[schemaKey]
  const defKey = `#/definitions/${tail}`
  if (defKey in refPool) return refPool[defKey]
  const pathItemKey = `#/components/pathItems/${tail}`
  if (pathItemKey in refPool) return refPool[pathItemKey]
  return undefined
}

/**
 * Depth-limited `$ref` expansion. `seen` tracks the ref chain of the CURRENT
 * branch only — it's cloned (not mutated in place) at the point a ref is
 * followed, so two sibling properties that both reference the same shared,
 * non-cyclic type (`{ author: {$ref: '#/…/User'}, editor: {$ref: '#/…/User'} }`)
 * each get the full expansion instead of the second one falsely reading as a
 * cycle because the first branch's visit was never rolled back.
 */
function resolveRefs(schema: Record<string, unknown>, refPool: Record<string, unknown>, depth = 0, seen: ReadonlySet<string> = new Set<string>()): unknown {
  if (depth > 8) return schema
  const ref = schema.$ref
  if (typeof ref === 'string') {
    const target = lookupRef(ref, refPool)
    if (target === undefined) return schema
    if (seen.has(ref)) return { $ref: ref } // genuine cycle along this branch
    if (target && typeof target === 'object' && !Array.isArray(target)) {
      const nextSeen = new Set(seen)
      nextSeen.add(ref)
      return resolveRefs(target as Record<string, unknown>, refPool, depth + 1, nextSeen)
    }
    return schema
  }
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(schema)) {
    if (Array.isArray(v)) out[k] = v.map(item => typeof item === 'object' && item ? resolveRefs(item as Record<string, unknown>, refPool, depth + 1, seen) : item)
    else if (v && typeof v === 'object') out[k] = resolveRefs(v as Record<string, unknown>, refPool, depth + 1, seen)
    else out[k] = v
  }
  return out
}

// ── GraphQL SDL parsing ──────────────────────────────

function tryAsGraphQlSdl(raw: string, location: string, source: ApiSchema['source'] = 'file'): ApiSchema | null {
  if (!/\btype\s+(Query|Mutation|Subscription)\b/.test(raw) && !/\bextend\s+type\s+(Query|Mutation|Subscription)\b/.test(raw)) return null
  const operations: ApiOperation[] = []
  const schemaRefsByField = new Map<string, string[]>()

  // Match `type Query { ... }` / `type Mutation { ... }` / etc. (non-greedy body).
  const typeBlockRe = /\b(extend\s+)?type\s+(Query|Mutation|Subscription)\b[^{]*\{([\s\S]*?)\}/g
  let m: RegExpExecArray | null
  while ((m = typeBlockRe.exec(raw)) !== null) {
    const opType = m[2].toLowerCase() as 'query' | 'mutation' | 'subscription'
    // Strip GraphQL description docstrings (`"""...multi-line..."""` blocks
    // and standalone single-line `"..."` descriptions) before scanning for
    // fields — a description line that happens to contain a colon (e.g.
    // `"""Example: GET /users/1"""`) was previously misread as a field named
    // "Example" with response type "GET /users/1", minting a phantom operation.
    const body = m[3]
      .replace(/"""[\s\S]*?"""/g, '')
      .replace(/^[ \t]*"[^"\n]*"\s*$/gm, '')
    // Each field inside: `  fieldName(args): ReturnType!`  — keep it lenient.
    const fieldRe = /^\s*(\w+)\s*(?:\(([^)]*)\))?\s*:\s*([^\n#]+?)\s*(?:#.*)?$/gm
    let f: RegExpExecArray | null
    while ((f = fieldRe.exec(body)) !== null) {
      const name = f[1]
      if (name.startsWith('#')) continue
      const args = f[2]
      // A trailing `@directive(...)` (e.g. `@deprecated(reason: "...")`) is
      // not part of the type — strip it before further processing so it
      // doesn't leak into the response type / schema_refs.
      const atIdx = f[3].indexOf('@')
      const typeOnly = atIdx >= 0 ? f[3].slice(0, atIdx) : f[3]
      const returnType = typeOnly.trim().replace(/[!,]/g, '')
      const inner = returnType.replace(/[\[\]!]/g, '').trim()
      const request_schema = args ? parseGqlArgsToSchema(args) : undefined
      operations.push({
        method: opType,
        path: name,
        id: name,
        request_schema,
        response_schema: { $type: returnType },
        schema_refs: inner && /^[A-Z]/.test(inner) ? [inner] : undefined,
      })
      if (inner && /^[A-Z]/.test(inner)) {
        const existing = schemaRefsByField.get(name) ?? []
        existing.push(inner)
        schemaRefsByField.set(name, existing)
      }
    }
  }

  if (operations.length === 0) return null

  return {
    kind: 'graphql',
    source,
    location,
    title: 'GraphQL schema',
    in_repo: source === 'file',
    operation_count: operations.length,
    operations,
  }
}

function parseGqlArgsToSchema(args: string): Record<string, unknown> {
  // `id: ID!, filter: CatFilter` → { type: 'object', properties: { id: { type: 'ID', required: true }, filter: { type: 'CatFilter' } } }
  const properties: Record<string, unknown> = {}
  const required: string[] = []
  for (const part of args.split(',')) {
    const m = part.trim().match(/^(\w+)\s*:\s*([^\s=]+)/)
    if (!m) continue
    const [, name, type] = m
    const isRequired = type.endsWith('!')
    if (isRequired) required.push(name)
    properties[name] = { type: type.replace(/[!]/g, '') }
  }
  return { type: 'object', properties, ...(required.length ? { required } : {}) }
}

// ── GraphQL introspection ─────────────────────────────

async function tryProbeGraphQL(url: string): Promise<ProbeResult> {
  if (!isLocalUrl(url)) return { schema: null, connectionRefused: false }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ query: INTROSPECTION_QUERY }),
      signal: controller.signal,
    })
    if (!res.ok) return { schema: null, connectionRefused: false }
    const body = await res.json() as { data?: { __schema?: Record<string, unknown> } }
    const sch = body?.data?.__schema
    if (!sch) return { schema: null, connectionRefused: false }
    return { schema: gqlIntrospectionToSchema(sch, url), connectionRefused: false }
  } catch (err) {
    return { schema: null, connectionRefused: isConnectionRefused(err) }
  } finally {
    // Always clear immediately — leaving the timer pending after the fetch
    // has already rejected (the common case for ECONNREFUSED, which fires
    // near-instantly) means `controller.abort()` fires ~500ms later against
    // an already-settled request, which is its own source of console noise.
    clearTimeout(timer)
  }
}

function gqlIntrospectionToSchema(root: Record<string, unknown>, url: string): ApiSchema {
  const qType = (root.queryType as { name?: string } | null)?.name
  const mType = (root.mutationType as { name?: string } | null)?.name
  const sType = (root.subscriptionType as { name?: string } | null)?.name
  const types = Array.isArray(root.types) ? root.types as Array<Record<string, unknown>> : []
  const operations: ApiOperation[] = []

  for (const t of types) {
    const name = typeof t.name === 'string' ? t.name : undefined
    if (!name) continue
    const opType: 'query' | 'mutation' | 'subscription' | undefined =
      name === qType ? 'query' : name === mType ? 'mutation' : name === sType ? 'subscription' : undefined
    if (!opType) continue
    const fields = Array.isArray(t.fields) ? t.fields as Array<Record<string, unknown>> : []
    for (const f of fields) {
      const fname = typeof f.name === 'string' ? f.name : undefined
      if (!fname) continue
      const retShape = flattenGqlTypeRef(f.type)
      const args = Array.isArray(f.args) ? f.args as Array<Record<string, unknown>> : []
      const request_schema = args.length > 0
        ? {
            type: 'object',
            properties: Object.fromEntries(args.map(a => [String(a.name), { type: flattenGqlTypeRef(a.type).displayType }])),
          }
        : undefined
      operations.push({
        id: fname,
        method: opType,
        path: fname,
        summary: typeof f.description === 'string' ? f.description as string : undefined,
        request_schema,
        response_schema: { $type: retShape.displayType },
        schema_refs: retShape.namedType ? [retShape.namedType] : undefined,
      })
    }
  }

  return {
    kind: 'graphql',
    source: 'dev-server',
    location: url,
    title: 'GraphQL introspection',
    in_repo: false,  // overridden by scanUncached when a backend dir is present
    operation_count: operations.length,
    operations,
  }
}

function flattenGqlTypeRef(ref: unknown): { displayType: string; namedType?: string } {
  if (!ref || typeof ref !== 'object') return { displayType: 'unknown' }
  let node = ref as { kind?: string; name?: string; ofType?: unknown }
  const wrappers: string[] = []
  while (node && (node.kind === 'NON_NULL' || node.kind === 'LIST')) {
    wrappers.push(node.kind)
    node = (node.ofType as typeof node) ?? { kind: undefined }
  }
  const name = node?.name ?? 'unknown'
  let display = name
  for (let i = wrappers.length - 1; i >= 0; i--) {
    if (wrappers[i] === 'LIST') display = `[${display}]`
    else if (wrappers[i] === 'NON_NULL') display = `${display}!`
  }
  const isNamedType = /^[A-Z]/.test(name) && name !== 'unknown' && !['String', 'Int', 'Float', 'Boolean', 'ID'].includes(name)
  return { displayType: display, namedType: isNamedType ? name : undefined }
}

// ── JSON Schema files ────────────────────────────────

function tryAsJsonSchema(doc: unknown, location: string): ApiSchema | null {
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return null
  const d = doc as Record<string, unknown>
  // Heuristic: has $schema field OR top-level `type` + `properties`
  const hasSchemaHint = typeof d.$schema === 'string'
  const looksLikeSchema = typeof d.type === 'string' && typeof d.properties === 'object'
  if (!hasSchemaHint && !looksLikeSchema) return null
  const title = typeof d.title === 'string' ? d.title : undefined
  return {
    kind: 'jsonschema',
    source: 'file',
    location,
    title,
    in_repo: true,
    operation_count: 1,
    operations: [
      {
        method: 'schema',
        path: title ?? nodePath.basename(location),
        response_schema: d,
      },
    ],
  }
}

// ── HTTP probes ──────────────────────────────────────

/**
 * A probe's outcome, discriminating "we got a clean negative" (404, non-schema
 * body, timeout) from "the connection itself was refused" — the latter means
 * no backend is listening at all, which callers use both to short-circuit
 * further probes against the same base (fewer redundant connection attempts
 * → less ECONNREFUSED console noise) and, via `getApiSchemaProbeHealth`, to
 * tell "no API" apart from "couldn't even reach a backend".
 */
interface ProbeResult {
  schema: ApiSchema | null
  connectionRefused: boolean
}

function isConnectionRefused(err: unknown): boolean {
  const e = err as { cause?: { code?: string }; code?: string; message?: string } | null | undefined
  const code = e?.cause?.code ?? e?.code
  if (code === 'ECONNREFUSED' || code === 'ENOTFOUND' || code === 'EHOSTUNREACH' || code === 'ECONNRESET') return true
  return typeof e?.message === 'string' && /ECONNREFUSED/.test(e.message)
}

async function tryProbeUrl(url: string): Promise<ProbeResult> {
  if (!isLocalUrl(url)) return { schema: null, connectionRefused: false }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS)
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { Accept: 'application/json, application/yaml' } })
    if (!res.ok) return { schema: null, connectionRefused: false }
    const ct = res.headers.get('content-type') ?? ''
    const text = await res.text()
    if (text.length > MAX_SCHEMA_BYTES) return { schema: null, connectionRefused: false }
    const looksYaml = ct.includes('yaml') || url.endsWith('.yaml') || url.endsWith('.yml')
    const parsed = looksYaml ? (safeYamlParse(text) ?? safeJsonParse(text)) : (safeJsonParse(text) ?? safeYamlParse(text))
    if (!parsed) return { schema: null, connectionRefused: false }
    const openapi = tryAsOpenApi(parsed, url, 'dev-server')
    if (openapi) return { schema: openapi, connectionRefused: false }
    const js = tryAsJsonSchema(parsed, url)
    if (js) {
      js.source = 'dev-server'
      return { schema: js, connectionRefused: false }
    }
    return { schema: null, connectionRefused: false }
  } catch (err) {
    return { schema: null, connectionRefused: isConnectionRefused(err) }
  } finally {
    clearTimeout(timer)
  }
}

function safeJsonParse(raw: string): unknown {
  try { return JSON.parse(raw) } catch { return null }
}

function safeYamlParse(raw: string): unknown {
  try { return yaml.load(raw) } catch { return null }
}

function trimSlash(s: string): string {
  return s.endsWith('/') ? s.slice(0, -1) : s
}

function isLocalUrl(url: string): boolean {
  try {
    const u = new URL(url)
    const host = u.hostname
    return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '0.0.0.0'
  } catch {
    return false
  }
}
