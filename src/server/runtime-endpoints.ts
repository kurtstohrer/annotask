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
import type { ApiSchemaCatalog, NetworkCall, ProjectDataEntry, RuntimeEndpoint, RuntimeEndpointCatalog } from '../schema.js'
import { resolveEndpoint } from './api-schema-resolver.js'

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
/**
 * A runtime endpoint whose `lastSeenAt` is older than this is flagged
 * `stale` when merged into the data-sources catalog. Dev-server sessions are
 * short-lived; a persisted endpoint from days/weeks ago is real history, not
 * something the app is currently doing — presenting it unflagged reads as a
 * fresh, healthy hit.
 */
const RUNTIME_STALE_MS = 24 * 60 * 60 * 1000

/**
 * `lastContentType`/`htmlFallback` (captured at ingest, see `ingest()`) and
 * `last_seen_at`/`stale` (added when promoting orphans, see
 * `mergeRuntimeOrphansIntoEntries`) are new fields this module needs on
 * types whose canonical declarations live in `../schema.ts` — out of scope
 * for this fix. Declaration merging extends those interfaces in place;
 * TypeScript treats this identically to editing the original declaration.
 */
declare module '../schema.js' {
  interface RuntimeEndpoint {
    /** Content-type of the most recently observed response, when known. */
    lastContentType?: string
    /**
     * True when the most recently observed response was `text/html` — a
     * strong signal this is an SPA-fallback hit (dev server serving
     * `index.html` for an unmatched route) rather than a real API endpoint.
     * Flagged endpoints are excluded from `mergeRuntimeOrphansIntoEntries`
     * so a client-side route miss can't masquerade as a healthy API hit.
     */
    htmlFallback?: boolean
  }
  interface ProjectDataEntry {
    /** Epoch ms of the most recent runtime observation (`discovered_by: 'runtime'` rows only). */
    last_seen_at?: number
    /** True when `last_seen_at` is older than `RUNTIME_STALE_MS`. */
    stale?: boolean
  }
}

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
 *   - ISO date segments (`2026-07-03`) → `{date}`
 *   - prefixed ids (`user_abc123`, `order-4521` — a short entity prefix
 *     joined to a digit-bearing id) → `{id}`
 *   - segments that look like a base64/ULID (≥16 chars, mixed case+digits)
 *     where ≥25% of the characters are digits → `{id}`
 *   - slugs (≥3 hyphen/underscore-separated words, no digits, ≥12 chars) → `{slug}`
 *
 * Intentionally conservative: we'd rather under-collapse (two rows) than
 * over-collapse and hide endpoints with meaningfully-different paths. The
 * prefixed-id and slug rules in particular are scoped tightly (digit
 * requirement, word-count + length floors) so real static segments like
 * `v2`, `page-1`, or `user-settings` don't get swallowed.
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
    // ISO-style date segments (`/api/events/2026-07-03`) — otherwise every
    // calendar day mints a fresh catalog row for the same logical endpoint.
    if (/^\d{4}-\d{2}-\d{2}$/.test(seg)) { parts[i] = '{date}'; continue }
    // Prefixed ids (`user_abc123`, `order-4521`): exactly one separator, a
    // short letters-only prefix, and an id-part that actually contains a
    // digit (excludes version/pagination segments like `v2`, `page-1`,
    // which have no digit in a ≥4-char id-part).
    const prefixedId = seg.match(/^([A-Za-z]{2,12})[_-]([A-Za-z0-9]{4,})$/)
    if (prefixedId && /\d/.test(prefixedId[2])) { parts[i] = '{id}'; continue }
    if (seg.length >= 16 && /[A-Za-z]/.test(seg) && /\d/.test(seg)) {
      const digits = (seg.match(/\d/g) || []).length
      if (digits / seg.length >= 0.25) { parts[i] = '{id}'; continue }
    }
    // Slugs (`my-blog-post-title`): ≥3 words with no digits to key off of.
    // The word-count and length floors keep real 2-word static segments
    // (`user-settings`) from being misread as generated slugs.
    if (seg.length >= 12 && !/\d/.test(seg) && /^[a-z0-9]+(?:[-_][a-z0-9]+){2,}$/i.test(seg)) {
      parts[i] = '{slug}'
      continue
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
      // Capture content-type so downstream consumers can tell a real API
      // response from an SPA-fallback `index.html` served with a 200 for an
      // unmatched client route (e.g. Vite serving `index.html` for
      // `/stat/planets`). Without this, the fallback reads as a healthy API
      // hit and gets promoted into the data-sources catalog as a real orphan.
      if (typeof call.contentType === 'string' && call.contentType) {
        ep.lastContentType = call.contentType
        ep.htmlFallback = /^\s*text\/html\b/i.test(call.contentType)
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
    // Match on the ORIGINAL endpoint, not the proxy-resolved one. A relative
    // endpoint (`/api/...`) is a same-origin call from the browser — its origin
    // is '' and matches the same-origin '' the iframe reports for Vite-proxied
    // fetches. resolved_endpoint's proxy-target host (e.g. :8888) is a
    // server-side detail; gating on it makes every proxied same-origin call
    // miss its static entry (so the Network tab showed only orphans).
    const decomp = decomposeEndpoint(entry.endpoint)
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

/** Sanitize an origin (`http://localhost:4310`) into a name-safe suffix (`localhost_4310`). */
function originNameSuffix(origin: string): string {
  return origin.replace(/^[a-zA-Z]+:\/\//, '').replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '')
}

/**
 * Append orphan runtime endpoints (those with no matching static entry AND
 * no matching discovered API schema operation) to a ProjectDataEntry list as
 * synthetic rows. Exists so the Hooks list, MCP `annotask_get_data_sources`,
 * and the CLI all surface APIs the regex scanner missed — runtime capture
 * fills the gap the static pass can't.
 *
 * Matching is structural: a runtime endpoint is considered "covered" by a
 * static entry when the method agrees (a method-less legacy-scanner entry
 * covers every method — matching `findMatchingStaticEntries`'s enrichment
 * rule, so an endpoint can't simultaneously get `matchedSources` populated
 * for enrichment purposes and still be reported as an orphan here) and
 * either (a) the pattern matches the entry's endpoint pattern exactly, or
 * (b) the paths align literally. It's additionally considered covered when
 * `apiSchemaCatalog` is supplied and `resolveEndpoint` finds a matching
 * OpenAPI/GraphQL/tRPC operation — reconciliation was previously
 * runtime↔static-scan only, so a schema-documented endpoint with no in-repo
 * call-site match was wrongly reported as an orphan.
 *
 * Endpoints flagged `htmlFallback` (see `ingest()`) are skipped entirely —
 * an SPA-fallback `index.html` response is not a real API hit.
 *
 * Runtime-only entries carry `discovered_by: 'runtime'`, `file: ''`, a
 * `used_count` equal to their live call count, `last_seen_at`, and `stale`
 * when `last_seen_at` is older than `RUNTIME_STALE_MS` — so a persisted
 * endpoint from a prior session isn't presented as freshly observed. `name`
 * is disambiguated by origin (mirroring the static scanner's `apiHealth_4310`
 * convention) since it's the lookup key other tools use — without this,
 * multiple MFEs hitting the same pattern on different ports collide onto one
 * `name` and only one of them is reachable by name-based lookups. Consumers
 * that need a code location (binding analysis, examples, details) must
 * filter runtime-only entries out.
 */
export function mergeRuntimeOrphansIntoEntries(
  staticEntries: ProjectDataEntry[],
  runtimeEndpoints: RuntimeEndpoint[],
  apiSchemaCatalog?: ApiSchemaCatalog,
): ProjectDataEntry[] {
  if (runtimeEndpoints.length === 0) return staticEntries
  const out = staticEntries.slice()

  // Pre-compute covered (method, origin, pattern) tuples from static entries.
  // An entry with a relative endpoint covers every origin (origin: ''); an
  // absolute entry only covers its own origin. Without origin in the key, a
  // single static `apiHealth_4310` would mark every MFE's `:43XX/api/health`
  // call as "covered" and they'd never surface as orphans even though no
  // static row points at them. A method-less entry uses the `*` wildcard so
  // it covers every method here too — matching `findMatchingStaticEntries`,
  // which already treats a missing `entry.method` as "any method".
  const covered = new Set<string>()
  for (const entry of staticEntries) {
    if (!entry.endpoint) continue
    const methodKey = entry.method ? entry.method.toUpperCase() : '*'
    // Original endpoint, not proxy-resolved (see findMatchingStaticEntries):
    // a relative entry's origin is '' so it covers same-origin '' runtime calls
    // via `relKey` — which is how the iframe reports Vite-proxied fetches. Using
    // the resolved :PORT host here would orphan every proxied call (duplicate
    // synthetic rows alongside the real static entry).
    const decomp = decomposeEndpoint(entry.endpoint)
    if (!decomp.path) continue
    covered.add(`${methodKey}|${decomp.origin}|${decomp.pattern}`)
  }

  // Dedup synthetic entries by (method, origin, pattern). Two MFEs hitting
  // `/api/foo` on different ports get two rows — the static scanner already
  // emits one entry per origin (suffixed with the port), so the runtime side
  // matches that contract and avoids dropping a real call site.
  const emitted = new Set<string>()
  const now = Date.now()
  for (const ep of runtimeEndpoints) {
    // SPA-fallback HTML response — not a real API endpoint, don't promote it.
    if (ep.htmlFallback) continue
    const epOrigin = (ep.origin || '').toLowerCase()
    const exactKey = `${ep.method}|${epOrigin}|${ep.pattern}`
    const wildKey = `*|${epOrigin}|${ep.pattern}`
    const relKey = `${ep.method}||${ep.pattern}`
    const relWildKey = `*||${ep.pattern}`
    if (covered.has(exactKey) || covered.has(wildKey) || covered.has(relKey) || covered.has(relWildKey) || emitted.has(exactKey)) continue
    // Consult discovered API schemas too — a schema-documented operation is
    // a known, real API even when the regex scanner found no call site.
    if (apiSchemaCatalog) {
      const sampleUrl = ep.sampleUrls[0] || ep.path
      if (resolveEndpoint(apiSchemaCatalog, sampleUrl, ep.method)) continue
    }
    emitted.add(exactKey)
    const baseName = deriveRuntimeEntryName(ep.method, ep.pattern)
    const name = ep.origin ? `${baseName}_${originNameSuffix(ep.origin)}` : baseName
    out.push({
      kind: 'fetch',
      name,
      display_name: ep.origin ? `${ep.method} ${ep.origin.replace(/^https?:\/\//i, '')} ${ep.pattern}` : `${ep.method} ${ep.pattern}`,
      file: '',
      endpoint: ep.pattern,
      method: ep.method,
      resolved_endpoint: ep.origin ? `${ep.origin}${ep.pattern}` : undefined,
      used_count: ep.count,
      discovered_by: 'runtime',
      last_seen_at: ep.lastSeenAt,
      stale: now - ep.lastSeenAt > RUNTIME_STALE_MS,
    })
  }
  return out
}
