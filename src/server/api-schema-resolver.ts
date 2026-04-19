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
 * when given, matching operations score higher. Returns `null` when no
 * candidates cross a minimum-confidence threshold.
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

  let best: ResolveMatch | null = null
  for (const schema of catalog.schemas) {
    for (const op of schema.operations) {
      const score = scoreOperationMatch(op, schema, pathOnly, normMethod)
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
      }
    }
  }
  return best && best.confidence >= 0.1 ? best : null
}

function scoreOperationMatch(op: ApiOperation, schema: ApiSchema, url: string, method: string | undefined): number | null {
  // GraphQL / jsonschema / tRPC: there's no URL path to match. Fall back to
  // matching only when the URL's last segment equals the operation path.
  if (schema.kind !== 'openapi') {
    const tail = url.split('/').filter(Boolean).pop()
    if (tail && tail === op.path) return 0.6
    return null
  }

  // OpenAPI: check method first.
  if (method && op.method !== method && op.method !== 'HEAD') {
    // Still allow a method mismatch to match but deranked.
    return scoreOpenApiPath(op.path, url) * 0.25
  }
  return scoreOpenApiPath(op.path, url)
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
