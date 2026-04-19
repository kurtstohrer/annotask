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

const CACHE_TTL_MS = 60_000
const PROBE_TIMEOUT_MS = 500
const MAX_FILES_SCANNED = 2000
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
/** URLs known to be dead so we don't re-probe every scan window. */
const negativeProbeCache = new Set<string>()

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

async function detectBackendInRepo(projectRoot: string): Promise<boolean> {
  for (const rel of BACKEND_DIR_HINTS) {
    try {
      const stat = await fsp.stat(nodePath.join(projectRoot, rel))
      if (stat.isDirectory()) return true
    } catch { /* not present */ }
  }
  return false
}

async function scanUncached(projectRoot: string, opts: ScanOptions): Promise<ApiSchemaCatalog> {
  const schemas: ApiSchema[] = []
  const backendInRepo = await detectBackendInRepo(projectRoot)

  // 1. Explicit config takes precedence — if set, we still do auto-discovery
  //    but skip directories we'd otherwise walk.
  if (opts.apiSchemaFiles && opts.apiSchemaFiles.length > 0) {
    for (const relPath of opts.apiSchemaFiles) {
      const parsed = await tryParseFile(projectRoot, relPath)
      if (parsed) schemas.push(parsed)
    }
  }
  if (opts.apiSchemaUrls && opts.apiSchemaUrls.length > 0) {
    for (const url of opts.apiSchemaUrls) {
      const parsed = await tryProbeUrl(url)
      if (parsed) {
        // Explicit config URLs — trust the user's configuration as "they know this is their API" when a backend dir is also present.
        parsed.in_repo = backendInRepo
        schemas.push(parsed)
      }
    }
  }
  const hasExplicit = (opts.apiSchemaFiles?.length ?? 0) + (opts.apiSchemaUrls?.length ?? 0) > 0

  // 2. Filesystem auto-discovery
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

  // 3. Dev-server probes — only when we have a URL AND we haven't already
  //    found schemas from explicit config (saves localhost churn).
  if (opts.devServerUrl && !hasExplicit) {
    // OpenAPI
    for (const p of OPENAPI_PROBE_PATHS) {
      const url = trimSlash(opts.devServerUrl) + p
      if (negativeProbeCache.has(url)) continue
      const s = await tryProbeUrl(url)
      if (s) {
        s.in_repo = backendInRepo
        if (!schemas.some(x => x.location === s.location)) schemas.push(s)
      } else {
        negativeProbeCache.add(url)
      }
    }
    // GraphQL introspection
    for (const p of GRAPHQL_PROBE_PATHS) {
      const url = trimSlash(opts.devServerUrl) + p
      if (negativeProbeCache.has(url)) continue
      const s = await tryProbeGraphQL(url)
      if (s) {
        s.in_repo = backendInRepo
        if (!schemas.some(x => x.location === s.location)) schemas.push(s)
      } else {
        negativeProbeCache.add(url)
      }
    }
  }

  return { schemas, scannedAt: Date.now() }
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
    if (!raw.includes('createTRPCRouter') && !/\btrpc\./.test(raw)) return null
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
 *     })
 * and emit one ApiOperation per procedure. Zod literals are converted to a
 * JSON-Schema-lite dict inline; we don't dynamically import the user's code.
 */
function tryAsTrpcRouter(raw: string, location: string): ApiSchema | null {
  const routerRe = /createTRPCRouter\s*\(\s*\{([\s\S]*?)\}\s*\)/g
  const operations: ApiOperation[] = []
  let m: RegExpExecArray | null
  while ((m = routerRe.exec(raw)) !== null) {
    const body = m[1]
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

function collectTrpcProcedures(body: string, operations: ApiOperation[]): void {
  // Each procedure is roughly: `name: base.input(...).output(...).query(...)`
  // We allow any chain of .input/.output/.use/.meta; the final .query / .mutation
  // determines the method. Capture lazily, one procedure per outermost key.
  const keyRe = /\b(\w+)\s*:\s*([a-zA-Z_$][\w$.]*(?:\s*\.\s*\w+\s*\([^()]*(?:\([^()]*\)[^()]*)*\))*)/g
  let km: RegExpExecArray | null
  while ((km = keyRe.exec(body)) !== null) {
    const name = km[1]
    const chain = km[2]
    if (!/\.(query|mutation|subscription)\s*\(/.test(chain)) continue
    const method = /\.mutation\s*\(/.test(chain) ? 'mutation' : /\.subscription\s*\(/.test(chain) ? 'subscription' : 'query'
    const request_schema = parseFirstZodArg(extractCallArg(chain, 'input'))
    const response_schema = parseFirstZodArg(extractCallArg(chain, 'output'))
    operations.push({
      id: name,
      method,
      path: name,
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
  const info = (d.info && typeof d.info === 'object') ? d.info as Record<string, unknown> : {}
  const title = typeof info.title === 'string' ? info.title : undefined
  const infoVersion = typeof info.version === 'string' ? info.version : undefined
  const components = (d.components && typeof d.components === 'object') ? (d.components as Record<string, unknown>).schemas as Record<string, unknown> | undefined : undefined
  const definitions = (d.definitions && typeof d.definitions === 'object') ? d.definitions as Record<string, unknown> : undefined
  const refPool: Record<string, unknown> = { ...(components ?? {}), ...(definitions ?? {}) }

  const operations: ApiOperation[] = []
  const paths = (d.paths && typeof d.paths === 'object') ? d.paths as Record<string, unknown> : {}
  const METHODS = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options']
  for (const [path, pathItem] of Object.entries(paths)) {
    if (!pathItem || typeof pathItem !== 'object' || Array.isArray(pathItem)) continue
    const item = pathItem as Record<string, unknown>
    for (const method of METHODS) {
      const op = item[method]
      if (!op || typeof op !== 'object' || Array.isArray(op)) continue
      const o = op as Record<string, unknown>
      const opId = typeof o.operationId === 'string' ? o.operationId : undefined
      const summary = typeof o.summary === 'string' ? o.summary : (typeof o.description === 'string' ? o.description as string : undefined)
      const request_schema = extractOpenApiRequestBody(o, refPool)
      const { response_schema, schema_refs } = extractOpenApiResponse(o, refPool)
      operations.push({
        id: opId,
        method: method.toUpperCase(),
        path,
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
    title,
    version: infoVersion ?? version,
    in_repo: source === 'file',
    operation_count: operations.length,
    operations,
  }
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

function resolveRefs(schema: Record<string, unknown>, refPool: Record<string, unknown>, depth = 0, seen = new Set<string>()): unknown {
  if (depth > 8) return schema
  const ref = schema.$ref
  if (typeof ref === 'string') {
    const tail = ref.split('/').pop()
    if (!tail || !(tail in refPool)) return schema
    if (seen.has(tail)) return { $ref: `#/components/schemas/${tail}` }
    seen.add(tail)
    const target = refPool[tail]
    if (target && typeof target === 'object' && !Array.isArray(target)) {
      return resolveRefs(target as Record<string, unknown>, refPool, depth + 1, seen)
    }
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
    const body = m[3]
    // Each field inside: `  fieldName(args): ReturnType!`  — keep it lenient.
    const fieldRe = /^\s*(\w+)\s*(?:\(([^)]*)\))?\s*:\s*([^\n#]+?)\s*(?:#.*)?$/gm
    let f: RegExpExecArray | null
    while ((f = fieldRe.exec(body)) !== null) {
      const name = f[1]
      if (name.startsWith('#')) continue
      const args = f[2]
      const returnType = f[3].trim().replace(/[!,]/g, '')
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

async function tryProbeGraphQL(url: string): Promise<ApiSchema | null> {
  if (!isLocalUrl(url)) return null
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS)
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ query: INTROSPECTION_QUERY }),
      signal: controller.signal,
    })
    clearTimeout(timer)
    if (!res.ok) return null
    const body = await res.json() as { data?: { __schema?: Record<string, unknown> } }
    const sch = body?.data?.__schema
    if (!sch) return null
    return gqlIntrospectionToSchema(sch, url)
  } catch {
    return null
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

async function tryProbeUrl(url: string): Promise<ApiSchema | null> {
  if (!isLocalUrl(url)) return null
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS)
    const res = await fetch(url, { signal: controller.signal, headers: { Accept: 'application/json, application/yaml' } })
    clearTimeout(timer)
    if (!res.ok) return null
    const ct = res.headers.get('content-type') ?? ''
    const text = await res.text()
    if (text.length > MAX_SCHEMA_BYTES) return null
    const looksYaml = ct.includes('yaml') || url.endsWith('.yaml') || url.endsWith('.yml')
    const parsed = looksYaml ? (safeYamlParse(text) ?? safeJsonParse(text)) : (safeJsonParse(text) ?? safeYamlParse(text))
    if (!parsed) return null
    const openapi = tryAsOpenApi(parsed, url, 'dev-server')
    if (openapi) return openapi
    const js = tryAsJsonSchema(parsed, url)
    if (js) {
      js.source = 'dev-server'
      return js
    }
    return null
  } catch {
    return null
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
