/**
 * Runtime-observed endpoint aggregator.
 *
 * The iframe's network monitor posts batches of `NetworkCall` records to the
 * server. This module collapses those records into a per-(origin, method,
 * pattern) catalog that:
 *   1. Confirms static-scanner discoveries (regex scanner says `/api/health`
 *      exists; runtime confirms it was actually hit).
 *   2. Surfaces endpoints the scanner missed — dynamic URLs built from
 *      computed strings, generated API clients, indirection through helper
 *      libraries.
 *   3. Captures which routes produce which calls so the Data view can show
 *      "on this page, your app hit X, Y, Z".
 *
 * State lives both in memory (a Map for fast merge-on-ingest) and on disk at
 * `.annotask/runtime-endpoints.json` so the catalog survives restart. Writes
 * are debounced (500ms) to coalesce request bursts.
 */
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import type { NetworkCall, ProjectDataEntry, RuntimeEndpoint, RuntimeEndpointCatalog } from '../schema.js'

const CATALOG_FILENAME = 'runtime-endpoints.json'
const WRITE_DEBOUNCE_MS = 500
const MAX_SAMPLE_URLS = 5
const MAX_ROUTES_PER_ENDPOINT = 30
/**
 * Upper bound on distinct endpoints kept in the catalog. A pathological app
 * that generates unique URLs (tracking beacons, request IDs in the path) can
 * otherwise balloon this file indefinitely. FIFO eviction by `lastSeenAt`.
 */
const MAX_ENDPOINTS = 2000

/** Key used for aggregation — stable across calls with differing ids/queries. */
function endpointKey(origin: string, method: string, pattern: string): string {
  return `${origin}${method}${pattern}`
}

/**
 * Collapse dynamic path segments into `{id}` so `/api/users/42` and
 * `/api/users/43` aggregate into one row. Rules:
 *   - pure-digit segments → `{id}`
 *   - UUIDs (8-4-4-4-12 hex) → `{uuid}`
 *   - 24+ hex (Mongo ObjectId, ULID-ish) → `{hex}`
 *   - segments that look like a base64/ULID (≥16 chars, mixed case+digits)
 *     where ≥25% of the characters are digits → `{id}`
 *
 * Intentionally conservative: we'd rather under-collapse (two rows) than
 * over-collapse and hide endpoints with meaningfully-different paths.
 */
export function normalizePathPattern(pathNoQuery: string): string {
  if (!pathNoQuery) return pathNoQuery
  const parts = pathNoQuery.split('/')
  for (let i = 0; i < parts.length; i++) {
    const seg = parts[i]
    if (!seg) continue
    if (/^\d+$/.test(seg)) { parts[i] = '{id}'; continue }
    if (/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(seg)) {
      parts[i] = '{uuid}'
      continue
    }
    if (/^[0-9a-fA-F]{24,}$/.test(seg)) { parts[i] = '{hex}'; continue }
    if (seg.length >= 16 && /[A-Za-z]/.test(seg) && /\d/.test(seg)) {
      const digits = (seg.match(/\d/g) || []).length
      if (digits / seg.length >= 0.25) { parts[i] = '{id}'; continue }
    }
  }
  return parts.join('/')
}

export interface RuntimeEndpointStore {
  ingest(calls: NetworkCall[]): void
  getCatalog(): RuntimeEndpointCatalog
  clear(): void
  /** Flush any pending writes. Call before process shutdown. */
  flush(): Promise<void>
}

/**
 * Construct a store bound to a project root. Loads any existing catalog on
 * construction so earlier-session data survives dev-server restarts.
 */
export function createRuntimeEndpointStore(projectRoot: string): RuntimeEndpointStore {
  const catalogPath = path.join(projectRoot, '.annotask', CATALOG_FILENAME)
  const endpoints = new Map<string, RuntimeEndpoint>()
  let updatedAt = 0
  let dirty = false
  let writeTimer: NodeJS.Timeout | null = null
  let writeChain: Promise<void> = Promise.resolve()

  // Load any existing catalog synchronously so the first getCatalog() after
  // boot returns the full state even if no new calls have arrived yet.
  try {
    const raw = fs.readFileSync(catalogPath, 'utf-8')
    const parsed = JSON.parse(raw) as RuntimeEndpointCatalog
    if (parsed && Array.isArray(parsed.endpoints)) {
      for (const ep of parsed.endpoints) {
        endpoints.set(endpointKey(ep.origin, ep.method, ep.pattern), ep)
      }
      updatedAt = typeof parsed.updatedAt === 'number' ? parsed.updatedAt : 0
    }
  } catch { /* fresh catalog */ }

  function ingest(calls: NetworkCall[]): void {
    if (!Array.isArray(calls) || calls.length === 0) return
    let changed = false
    const now = Date.now()
    for (const call of calls) {
      if (!call || typeof call.method !== 'string' || typeof call.pathNoQuery !== 'string') continue
      const method = call.method.toUpperCase()
      const origin = (call.origin || '').toLowerCase()
      const pattern = normalizePathPattern(call.pathNoQuery)
      const key = endpointKey(origin, method, pattern)
      let ep = endpoints.get(key)
      if (!ep) {
        ep = {
          origin,
          method,
          path: call.pathNoQuery,
          pattern,
          count: 0,
          firstSeenAt: call.startedAt || now,
          lastSeenAt: call.startedAt || now,
          routes: [],
          sampleUrls: [],
        }
        endpoints.set(key, ep)
      }
      ep.count += 1
      ep.lastSeenAt = call.startedAt || now
      if (typeof call.status === 'number') {
        ep.lastStatus = call.status
        if (!ep.statuses) ep.statuses = []
        if (!ep.statuses.includes(call.status)) ep.statuses.push(call.status)
      }
      // Streaming mean of latency — only fold in calls that actually
      // reported a duration (in-flight requests have no `durationMs` yet).
      // Stable across reload because we persist both the running avg and
      // the sample count.
      if (typeof call.durationMs === 'number' && call.durationMs >= 0) {
        const prevSamples = ep.latencySamples ?? 0
        const prevAvg = ep.avgMs ?? 0
        ep.avgMs = (prevAvg * prevSamples + call.durationMs) / (prevSamples + 1)
        ep.latencySamples = prevSamples + 1
        ep.maxMs = Math.max(ep.maxMs ?? 0, call.durationMs)
      }
      // Track per-route hits.
      const route = typeof call.route === 'string' ? call.route : ''
      if (route) {
        let rEntry = ep.routes.find(r => r.route === route)
        if (!rEntry) {
          if (ep.routes.length >= MAX_ROUTES_PER_ENDPOINT) {
            // Drop the oldest route — keeps the catalog bounded on wide apps.
            ep.routes.sort((a, b) => a.lastSeenAt - b.lastSeenAt)
            ep.routes.shift()
          }
          rEntry = { route, count: 0, lastSeenAt: 0 }
          ep.routes.push(rEntry)
        }
        rEntry.count += 1
        rEntry.lastSeenAt = call.startedAt || now
      }
      // Keep a small rotating sample of concrete URLs — useful for debugging
      // when the pattern collapses several distinct ids.
      if (typeof call.url === 'string' && !ep.sampleUrls.includes(call.url)) {
        ep.sampleUrls.unshift(call.url)
        if (ep.sampleUrls.length > MAX_SAMPLE_URLS) ep.sampleUrls.pop()
      }
      changed = true
    }
    if (changed) {
      updatedAt = now
      dirty = true
      scheduleWrite()
    }
  }

  function evictIfNeeded(): void {
    if (endpoints.size <= MAX_ENDPOINTS) return
    // Drop the least-recently-seen endpoints — keeps the catalog fresh under
    // pathological URL generators (cache-busting tokens etc.).
    const sorted = [...endpoints.entries()].sort((a, b) => a[1].lastSeenAt - b[1].lastSeenAt)
    const toDrop = sorted.length - MAX_ENDPOINTS
    for (let i = 0; i < toDrop; i++) endpoints.delete(sorted[i][0])
  }

  function getCatalog(): RuntimeEndpointCatalog {
    evictIfNeeded()
    const list = [...endpoints.values()].sort((a, b) => b.lastSeenAt - a.lastSeenAt)
    return { version: '1.0', updatedAt, endpoints: list }
  }

  function clear(): void {
    endpoints.clear()
    updatedAt = Date.now()
    dirty = true
    scheduleWrite()
  }

  function scheduleWrite(): void {
    if (writeTimer) return
    writeTimer = setTimeout(() => {
      writeTimer = null
      if (!dirty) return
      dirty = false
      const snapshot = getCatalog()
      const payload = JSON.stringify(snapshot, null, 2)
      writeChain = writeChain.then(async () => {
        try {
          await fsp.mkdir(path.dirname(catalogPath), { recursive: true })
          const tmp = catalogPath + `.tmp.${process.pid}.${Date.now()}`
          await fsp.writeFile(tmp, payload, 'utf-8')
          await fsp.rename(tmp, catalogPath)
        } catch (err) {
          // Non-fatal — runtime catalog is a cache; the in-memory copy remains
          // authoritative until the next successful write.
          console.warn('[Annotask] runtime-endpoints write failed:', err)
        }
      })
    }, WRITE_DEBOUNCE_MS)
    writeTimer.unref?.()
  }

  async function flush(): Promise<void> {
    if (writeTimer) {
      clearTimeout(writeTimer)
      writeTimer = null
      // Force an immediate write if there are unflushed changes.
      if (dirty) {
        dirty = false
        const snapshot = getCatalog()
        const payload = JSON.stringify(snapshot, null, 2)
        writeChain = writeChain.then(async () => {
          try {
            await fsp.mkdir(path.dirname(catalogPath), { recursive: true })
            const tmp = catalogPath + `.tmp.${process.pid}.${Date.now()}`
            await fsp.writeFile(tmp, payload, 'utf-8')
            await fsp.rename(tmp, catalogPath)
          } catch { /* see scheduleWrite */ }
        })
      }
    }
    await writeChain
  }

  return { ingest, getCatalog, clear, flush }
}

/**
 * Derive a synthetic identifier name for a runtime-only endpoint — e.g.
 * `GET /api/users/{id}` → `apiUsersId`, `POST /users` → `postUsers`. Keeps
 * the name grep-able and close to what the static scanner would have emitted
 * had it discovered the call site.
 */
export function deriveRuntimeEntryName(method: string, pattern: string): string {
  // Split path into segments, unwrap placeholders, then camelCase across
  // intra-segment word boundaries (hyphens, underscores, dots) so
  // `/api/orphan-discovery` → `apiOrphanDiscovery` instead of `apiOrphandiscovery`.
  const camelSeg = (seg: string): string => {
    const words = seg.split(/[^a-zA-Z0-9]+/).filter(Boolean)
    if (words.length === 0) return ''
    return words[0] + words.slice(1).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join('')
  }
  const segs = pattern.split('/').filter(Boolean).map(seg => {
    if (seg.startsWith('{') && seg.endsWith('}')) return camelSeg(seg.slice(1, -1))
    if (seg.startsWith(':')) return camelSeg(seg.slice(1))
    return camelSeg(seg)
  }).filter(Boolean)
  if (segs.length === 0) {
    return method.toLowerCase() + 'Root'
  }
  const camel = segs[0].charAt(0).toLowerCase() + segs[0].slice(1)
    + segs.slice(1).map(s => s.charAt(0).toUpperCase() + s.slice(1)).join('')
  // Prefix non-GET verbs so a GET and a PATCH against the same path stay distinct.
  if (method === 'GET') return camel
  return method.toLowerCase() + camel.charAt(0).toUpperCase() + camel.slice(1)
}

/**
 * Decompose a static-entry endpoint string into `(origin, pattern)`. `origin`
 * is the lower-cased `protocol//host[:port]` when the endpoint is absolute,
 * otherwise empty. `pattern` is the path with `{id}`-style placeholders
 * collapsed via `normalizePathPattern` so it lines up with runtime keys.
 */
function decomposeEndpoint(raw: string): { origin: string; pattern: string; path: string } {
  if (!raw) return { origin: '', pattern: '', path: '' }
  if (/^https?:\/\//i.test(raw)) {
    try {
      const u = new URL(raw)
      const path = u.pathname
      return { origin: `${u.protocol}//${u.host}`.toLowerCase(), pattern: normalizePathPattern(path), path }
    } catch { /* fall through */ }
  }
  const q = raw.indexOf('?')
  const path = q >= 0 ? raw.slice(0, q) : raw
  return { origin: '', pattern: normalizePathPattern(path), path }
}

/**
 * Find every static `ProjectDataEntry` whose endpoint should be considered
 * the call site for this runtime endpoint. Method must match. Origin must
 * also match when the entry's endpoint is absolute (e.g. `http://localhost:4310/api/health`)
 * — without that constraint, a runtime call to `:4310/api/health` ends up
 * matched to every MFE that declares an `apiHealth_*` entry, and the Network
 * tab's overlay union spans MFEs that didn't actually fire the call. Entries
 * with relative endpoints (`/api/users`) match any origin because relative
 * URLs resolve against the iframe's origin at runtime.
 */
export function findMatchingStaticEntries<T extends { name: string; method?: string; endpoint?: string; resolved_endpoint?: string }>(
  ep: { method: string; origin: string; pattern: string; path: string },
  staticEntries: readonly T[],
): T[] {
  const out: T[] = []
  for (const entry of staticEntries) {
    if (!entry.endpoint) continue
    if (entry.method && entry.method.toUpperCase() !== ep.method) continue
    const decomp = decomposeEndpoint(entry.resolved_endpoint || entry.endpoint)
    if (!decomp.path) continue
    // Path must match either as normalized pattern or as a literal.
    if (decomp.pattern !== ep.pattern && decomp.path !== ep.path) continue
    // Origin gate: when the entry pinned an absolute origin, only accept
    // runtime endpoints with the SAME origin. A same-origin runtime call
    // (`ep.origin === ''`) is the iframe hitting its own host — that's a
    // distinct call from any MFE's cross-origin fetch, so it must not
    // match an absolute entry pinned to a different host. Relative entries
    // (`decomp.origin === ''`) match every origin since their resolved
    // host is decided at runtime by the iframe.
    if (decomp.origin) {
      if (decomp.origin !== ep.origin.toLowerCase()) continue
    }
    out.push(entry)
  }
  return out
}

/**
 * Append orphan runtime endpoints (those with no matching static entry) to a
 * ProjectDataEntry list as synthetic rows. Exists so the Hooks list, MCP
 * `annotask_get_data_sources`, and the CLI all surface APIs the regex
 * scanner missed — runtime capture fills the gap the static pass can't.
 *
 * Matching is structural: a runtime endpoint is considered "covered" by a
 * static entry when the method agrees and either (a) the pattern matches
 * the entry's endpoint pattern exactly, or (b) the entry has no method set
 * (legacy scanner output) and the paths align.
 *
 * Runtime-only entries carry `discovered_by: 'runtime'`, `file: ''`, and a
 * `used_count` equal to their live call count. Consumers that need a code
 * location (binding analysis, examples, details) must filter them out.
 */
export function mergeRuntimeOrphansIntoEntries(
  staticEntries: ProjectDataEntry[],
  runtimeEndpoints: RuntimeEndpoint[],
): ProjectDataEntry[] {
  if (runtimeEndpoints.length === 0) return staticEntries
  const out = staticEntries.slice()

  // Pre-compute covered (method, origin, pattern) tuples from static entries.
  // An entry with a relative endpoint covers every origin (origin: ''); an
  // absolute entry only covers its own origin. Without origin in the key, a
  // single static `apiHealth_4310` would mark every MFE's `:43XX/api/health`
  // call as "covered" and they'd never surface as orphans even though no
  // static row points at them.
  const covered = new Set<string>()
  for (const entry of staticEntries) {
    if (!entry.endpoint) continue
    const method = (entry.method || 'GET').toUpperCase()
    const decomp = decomposeEndpoint(entry.resolved_endpoint || entry.endpoint)
    if (!decomp.path) continue
    covered.add(`${method}|${decomp.origin}|${decomp.pattern}`)
  }

  // Dedup synthetic entries by (method, origin, pattern). Two MFEs hitting
  // `/api/foo` on different ports get two rows — the static scanner already
  // emits one entry per origin (suffixed with the port), so the runtime side
  // matches that contract and avoids dropping a real call site.
  const emitted = new Set<string>()
  for (const ep of runtimeEndpoints) {
    const epOrigin = (ep.origin || '').toLowerCase()
    const exactKey = `${ep.method}|${epOrigin}|${ep.pattern}`
    const relKey = `${ep.method}||${ep.pattern}`
    if (covered.has(exactKey) || covered.has(relKey) || emitted.has(exactKey)) continue
    emitted.add(exactKey)
    const name = deriveRuntimeEntryName(ep.method, ep.pattern)
    out.push({
      kind: 'fetch',
      name,
      display_name: `${ep.method} ${ep.pattern}`,
      file: '',
      endpoint: ep.pattern,
      method: ep.method,
      resolved_endpoint: ep.origin ? `${ep.origin}${ep.pattern}` : undefined,
      used_count: ep.count,
      discovered_by: 'runtime',
    })
  }
  return out
}
