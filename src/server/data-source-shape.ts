/**
 * Shape resolution for the wireframe data-binding picker. Given a data-source
 * name from the scanner catalog, answer "what shape does this source yield?"
 * down an honesty ladder:
 *
 *   1. 'api-schema'     — the entry's endpoint matches a discovered API
 *                         operation (resolveEndpoint); walk its already-deref'd
 *                         response_schema into a DataShapeNode tree.
 *   2. 'source-details' — no schema match; surface the regex-inferred
 *                         return-type hints verbatim. NO tree — expanding a
 *                         type name into keys would fabricate shape.
 *   3. 'none'           — nothing known. The picker shows free-text entry,
 *                         visibly blind.
 *
 * Runtime-discovered entries are excluded up front: they have no code
 * identity (`file: ''`) the agent could import, and runtime endpoints carry
 * no response shapes (sample URLs only).
 */
import { scanDataSources } from './data-source-scanner.js'
import { scanApiSchemas, type ScanOptions } from './api-schema-scanner.js'
import { resolveEndpoint } from './api-schema-resolver.js'
import { resolveDataSourceDetails } from './data-source-details.js'
import type { DataShapeNode, DataSource, DataSourceShape, DataSourceShapeResult } from '../schema.js'

const MAX_SHAPE_DEPTH = 8

/**
 * Walk a (deref'd) JSON-schema-ish object into a DataShapeNode tree. Residual
 * `$ref` (cycle markers from resolveRefs) and GraphQL `$type` markers become
 * named ref leaves. `allOf` merges object children; `oneOf`/`anyOf` take the
 * first object-ish variant (minimal honest handling, unit-pinned).
 */
export function schemaToShape(schema: Record<string, unknown>, depth = 0): DataShapeNode {
  if (depth > MAX_SHAPE_DEPTH) return { kind: 'unknown' }

  const ref = schema.$ref
  if (typeof ref === 'string') {
    const tail = ref.split('/').pop()
    return { kind: 'ref', ref: tail || ref }
  }
  const gqlType = schema.$type
  if (typeof gqlType === 'string') return { kind: 'ref', ref: gqlType }

  // REAL contract sample value at this node (OpenAPI `example`/`default`), used
  // to preview bound props honestly. Spread onto each structural return below.
  const ex = schema.example !== undefined ? schema.example : schema.default
  const exField = ex !== undefined ? { example: ex } : {}

  const type = schema.type
  if (type === 'array' || (schema.items !== undefined && type === undefined)) {
    const items = schema.items
    const item = isPlainObject(items) ? schemaToShape(items, depth + 1) : { kind: 'unknown' as const }
    return { kind: 'array', item, ...exField }
  }

  if (type === 'object' || isPlainObject(schema.properties)) {
    const children: Record<string, DataShapeNode> = {}
    // Composition first — `{ type:'object', allOf:[…] }` and
    // `{ allOf:[…], properties:{…} }` are common OpenAPI inheritance forms;
    // own properties extend/override the inherited keys.
    if (Array.isArray(schema.allOf)) {
      for (const member of schema.allOf) {
        if (!isPlainObject(member)) continue
        const walked = schemaToShape(member, depth + 1)
        if (walked.kind === 'object' && walked.children) Object.assign(children, walked.children)
      }
    }
    const props = schema.properties
    if (isPlainObject(props)) {
      for (const [key, value] of Object.entries(props)) {
        children[key] = isPlainObject(value) ? schemaToShape(value, depth + 1) : { kind: 'unknown' }
      }
    }
    return { kind: 'object', children, ...exField }
  }

  if (Array.isArray(schema.allOf)) {
    const children: Record<string, DataShapeNode> = {}
    let sawObject = false
    for (const member of schema.allOf) {
      if (!isPlainObject(member)) continue
      const walked = schemaToShape(member, depth + 1)
      if (walked.kind === 'object' && walked.children) {
        sawObject = true
        Object.assign(children, walked.children)
      }
    }
    if (sawObject) return { kind: 'object', children, ...exField }
    return { kind: 'unknown' }
  }

  const variants = Array.isArray(schema.oneOf) ? schema.oneOf : Array.isArray(schema.anyOf) ? schema.anyOf : null
  if (variants) {
    // Count the structural variants so the picker can say "1 of N" — the tree
    // shows only the first, and hiding that it's a collapse would over-claim.
    const structural = variants.filter(isPlainObject).length
    for (const member of variants) {
      if (!isPlainObject(member)) continue
      const walked = schemaToShape(member, depth + 1)
      if (walked.kind === 'object' || walked.kind === 'array' || walked.kind === 'ref') {
        return structural > 1 ? { ...walked, variant_of: structural } : walked
      }
    }
    return { kind: 'unknown' }
  }

  if (typeof type === 'string') return { kind: 'scalar', scalar: type, ...exField }
  return { kind: 'unknown' }
}

export interface ShapeArgs {
  projectRoot: string
  name: string
  kind?: DataSource['kind']
  file?: string
  /** Disambiguators for a name+kind+file collision (e.g. a GET query and a
   *  mutation sharing all three): `method` picks by request verb, `line` by
   *  the definition line. Either narrows an otherwise-ambiguous candidate set
   *  to one before the shape ladder runs. */
  method?: string
  line?: number
  workspaceRoot?: string
  /** Schema-scan options (devServerUrl, explicit files/urls). Explicit
   *  files/urls skip dev-server probes — tests stay offline. */
  schemaScan?: ScanOptions
}

/** Rung-1 admission floor: a match below this is too weak to present as a real
 *  contract — one literal segment of three (0.33) is a coincidence, not
 *  evidence. Method disagreement is already excluded upstream (resolver returns
 *  null), so a surviving match ≥0.5 means "≥half the path literally agrees and
 *  the method didn't disagree." */
const RUNG1_MIN_CONFIDENCE = 0.5

export async function resolveDataSourceShape(args: ShapeArgs): Promise<DataSourceShapeResult> {
  const { projectRoot, name, kind, file, method, line, workspaceRoot } = args

  const catalog = await scanDataSources(projectRoot)
  // Runtime-promoted entries have no code identity to bind to — exclude.
  let candidates = catalog.project_entries.filter(e => e.name === name && e.discovered_by !== 'runtime')
  if (kind) candidates = candidates.filter(e => e.kind === kind)
  if (file) candidates = candidates.filter(e => e.file === file)
  // Disambiguate a still-colliding set by request method / definition line
  // before declaring ambiguity — a GET+mutation pair sharing name+kind+file is
  // resolvable, not permanently blind.
  if (candidates.length > 1 && method) {
    const m = method.toUpperCase()
    const byMethod = candidates.filter(e => (e.method ?? 'GET').toUpperCase() === m)
    if (byMethod.length > 0) candidates = byMethod
  }
  if (candidates.length > 1 && line != null) {
    const byLine = candidates.filter(e => (e.line ?? 1) === line)
    if (byLine.length > 0) candidates = byLine
  }

  if (candidates.length === 0) return { error: 'not_found', name }
  if (candidates.length > 1) {
    return {
      error: 'ambiguous',
      candidates: candidates.map(c => ({ name: c.name, kind: c.kind, file: c.file, line: c.line ?? 1, method: c.method })),
    }
  }

  const entry = candidates[0]
  const base: DataSourceShape = {
    name: entry.name,
    kind: entry.kind,
    file: entry.file,
    ...(entry.endpoint ? { endpoint: entry.endpoint } : {}),
    ...(entry.method ? { method: entry.method } : {}),
    shape_source: 'none',
  }

  // Rung 1 — a real API contract behind the entry's endpoint. Admit only a
  // match at or above the confidence floor: below it (a single literal segment
  // agreeing by chance) the "green" tier would over-claim, so fall through to
  // the regex tier instead. Method disagreement is already excluded upstream.
  const url = entry.resolved_endpoint ?? entry.endpoint
  if (url) {
    const schemas = await scanApiSchemas(projectRoot, args.schemaScan ?? {})
    const match = resolveEndpoint(schemas, url, entry.method)
    if (match?.operation.response_schema && match.confidence >= RUNG1_MIN_CONFIDENCE) {
      return {
        ...base,
        shape_source: 'api-schema',
        shape: schemaToShape(match.operation.response_schema),
        ...(match.response_schema_ref ? { schema_ref: match.response_schema_ref } : {}),
        schema_kind: match.schema_kind,
        schema_location: match.schema_location,
        op: { method: match.operation.method, path: match.operation.path },
        resolved_endpoint: url,
        match_confidence: match.confidence,
      }
    }
  }

  // Rung 2 — regex-inferred hints, verbatim. Require an actual return-position
  // type annotation (`return_type`) before promoting out of 'none' — bare
  // `referenced_types` alone can be sourced from parameter types with nothing
  // said about what the source yields, which would be a fabricated promotion.
  const details = await resolveDataSourceDetails({ projectRoot, name: entry.name, kind: entry.kind, file: entry.file, workspaceRoot })
  if (!('error' in details) && details.return_type) {
    return {
      ...base,
      shape_source: 'source-details',
      details_confidence: details.confidence,
      ...(details.return_type ? { return_type: details.return_type } : {}),
      ...(details.referenced_types?.length ? { referenced_types: details.referenced_types } : {}),
      ...(details.signature ? { signature: details.signature } : {}),
    }
  }

  // Rung 3 — honestly nothing.
  return base
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}
