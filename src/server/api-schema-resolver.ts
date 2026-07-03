/**
 * Endpoint → ApiOperation matcher. Given a concrete URL like
 * `/api/users/42`, find the declared operation pattern (`/api/users/{id}`)
 * across all discovered API schemas and score matches so the best one wins.
 *
 * Scoring favors:
 *   - More literal (non-placeholder) segments.
 *   - Matching HTTP method when provided.
 *   - Schemas of kind 'openapi' over other kinds for REST URLs.
 */
import type { ApiOperation, ApiSchema, ApiSchemaCatalog } from '../schema.js'

export interface ResolveMatch {
  schema_location: string
  schema_kind: ApiSchema['kind']
  /** Whether the matched schema's backing API source lives in this repo. */
  schema_in_repo: boolean
  operation: ApiOperation
  /** 0..1 — higher is better. 1.0 = exact literal match on all segments. */
  confidence: number
  /** Short type name agents can pass to annotask_get_api_operation for detail. */
  response_schema_ref?: string
  /**
   * True when at least one other operation scored identically to this one —
   * the pick is a coin-flip among ≥2 real candidates, not a confident match.
   * Callers should surface this as "ambiguous" rather than silently trusting
   * the first-found operation.
   */
  ambiguous?: boolean
}

/**
 * Short name we attach to `DataSource.response_schema_ref`. Strategy:
 *   1. If the operation has `schema_refs`, use the first one (common case:
 *      response is a named type like `Cat` or `User`).
 *   2. Else if the operation has an `id`, use that.
 *   3. Else `method path` as a fallback.
 */
export function derivedSchemaRef(op: ApiOperation): string | undefined {
  if (op.schema_refs && op.schema_refs.length > 0) {
    const base = op.schema_refs[0]
    // Response is an array of that type?
    const resp = op.response_schema as Record<string, unknown> | undefined
    if (resp && (resp.type === 'array' || (typeof resp.$type === 'string' && resp.$type.startsWith('[')))) {
      return `${base}[]`
    }
    return base
  }
  if (op.id) return op.id
  return `${op.method} ${op.path}`
}

/**
 * Find the best matching operation across all schemas. `method` is optional —
 * when given, matching operations score higher (and a disagreeing method
 * excludes the candidate entirely — see `scoreOperationMatch`). Returns
 * `null` when no candidates cross a minimum-confidence threshold. When two
 * or more operations tie for the top score, the winner carries
 * `ambiguous: true` instead of being presented as a confident first-wins pick.
 */
export function resolveEndpoint(
  catalog: ApiSchemaCatalog,
  url: string,
  method?: string,
): ResolveMatch | null {
  if (!catalog.schemas.length) return null
  const normMethod = method ? method.toUpperCase() : undefined
  const pathOnly = stripQueryAndOrigin(url)
  if (!pathOnly) return null
  const reqOrigin = extractRequestOrigin(url)

  let best: ResolveMatch | null = null
  let tied = false
  for (const schema of catalog.schemas) {
    for (const op of schema.operations) {
      const score = scoreOperationMatch(op, schema, pathOnly, normMethod, reqOrigin)
      if (score == null) continue
      if (!best || score > best.confidence) {
        best = {
          schema_location: schema.location,
          schema_kind: schema.kind,
          schema_in_repo: schema.in_repo,
          operation: op,
          confidence: score,
          response_schema_ref: derivedSchemaRef(op),
        }
        tied = false
      } else if (score === best.confidence && (schema.location !== best.schema_location || op !== best.operation)) {
        tied = true
      }
    }
  }
  if (!best || best.confidence < 0.1) return null
  return tied ? { ...best, ambiguous: true } : best
}

/** HEAD mirrors GET (same route, no body) — every other method pair must agree exactly. */
function methodsAgree(opMethod: string, reqMethod: string): boolean {
  if (opMethod === reqMethod) return true
  return (opMethod === 'HEAD' && reqMethod === 'GET') || (opMethod === 'GET' && reqMethod === 'HEAD')
}

function scoreOperationMatch(
  op: ApiOperation,
  schema: ApiSchema,
  url: string,
  method: string | undefined,
  reqOrigin: string | undefined,
): number | null {
  // Absolute-URL inputs carry their own origin. When both the request and the
  // schema declare one and they disagree, this operation belongs to a
  // different backend entirely — never match across backends, regardless of
  // how well the path/method otherwise line up.
  if (reqOrigin && schema.origin && schema.origin !== reqOrigin) return null
  const originAgrees = !!(reqOrigin && schema.origin && schema.origin === reqOrigin)

  // GraphQL / tRPC: there's no URL path to match, only a field/procedure
  // name. Fall back to matching when the URL's last segment equals the
  // operation path. Restricted to these two kinds — an OpenAPI/JSON-Schema
  // entry whose last path segment happens to equal a URL's last segment
  // (e.g. a Pinia `defineStore('user')`) is coincidence, not evidence.
  if (schema.kind === 'graphql' || schema.kind === 'trpc') {
    const tail = url.split('/').filter(Boolean).pop()
    if (tail && tail === op.path) return originAgrees ? 0.7 : 0.6
    return null
  }
  if (schema.kind !== 'openapi') return null

  // OpenAPI: method must agree when both sides declare one. A wrong-method
  // exact-path match is not "this operation, less confidently" — it's a
  // different operation on the same path (or no operation at all).
  if (method && !methodsAgree(op.method, method)) return null

  const pathScore = scoreOpenApiPath(op.path, url)
  if (pathScore <= 0) return null
  return originAgrees ? Math.min(1, pathScore * 1.1) : pathScore
}

function scoreOpenApiPath(pattern: string, url: string): number {
  const patternParts = pattern.split('/').filter(Boolean)
  const urlParts = url.split('/').filter(Boolean)
  if (patternParts.length !== urlParts.length) return 0
  let literalHits = 0
  for (let i = 0; i < patternParts.length; i++) {
    const p = patternParts[i]
    if (p.startsWith('{') && p.endsWith('}')) continue                          // placeholder — accept anything
    if (p.startsWith(':')) continue                                             // Express-style placeholder
    if (p === urlParts[i]) literalHits++
    else return 0                                                               // literal mismatch
  }
  if (patternParts.length === 0) return 0
  return literalHits / patternParts.length
}

function stripQueryAndOrigin(url: string): string {
  // Accept both `/api/users/42` and full URLs like `http://localhost:3000/api/users/42`.
  let u = url.trim()
  try {
    if (/^https?:\/\//i.test(u)) u = new URL(u).pathname
  } catch { /* fall through */ }
  const q = u.indexOf('?')
  if (q >= 0) u = u.slice(0, q)
  const h = u.indexOf('#')
  if (h >= 0) u = u.slice(0, h)
  if (!u.startsWith('/')) u = '/' + u
  return u.replace(/\/+$/, '') || '/'
}

/** Origin of an absolute-URL input (e.g. `http://localhost:4330`), or `undefined` for a bare path. */
function extractRequestOrigin(url: string): string | undefined {
  const u = url.trim()
  if (!/^https?:\/\//i.test(u)) return undefined
  try { return new URL(u).origin } catch { return undefined }
}
