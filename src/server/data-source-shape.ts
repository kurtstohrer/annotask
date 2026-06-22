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
    for (const member of variants) {
      if (!isPlainObject(member)) continue
      const walked = schemaToShape(member, depth + 1)
      if (walked.kind === 'object' || walked.kind === 'array' || walked.kind === 'ref') return walked
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
  workspaceRoot?: string
  /** Schema-scan options (devServerUrl, explicit files/urls). Explicit
   *  files/urls skip dev-server probes — tests stay offline. */
  schemaScan?: ScanOptions
}

export async function resolveDataSourceShape(args: ShapeArgs): Promise<DataSourceShapeResult> {
  const { projectRoot, name, kind, file, workspaceRoot } = args

  const catalog = await scanDataSources(projectRoot)
  // Runtime-promoted entries have no code identity to bind to — exclude.
  let candidates = catalog.project_entries.filter(e => e.name === name && e.discovered_by !== 'runtime')
  if (kind) candidates = candidates.filter(e => e.kind === kind)
  if (file) candidates = candidates.filter(e => e.file === file)

  if (candidates.length === 0) return { error: 'not_found', name }
  if (candidates.length > 1) {
    return {
      error: 'ambiguous',
      candidates: candidates.map(c => ({ name: c.name, kind: c.kind, file: c.file, line: c.line ?? 1 })),
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

  // Rung 1 — a real API contract behind the entry's endpoint.
  const url = entry.resolved_endpoint ?? entry.endpoint
  if (url) {
    const schemas = await scanApiSchemas(projectRoot, args.schemaScan ?? {})
    const match = resolveEndpoint(schemas, url, entry.method)
    if (match?.operation.response_schema) {
      return {
        ...base,
        shape_source: 'api-schema',
        shape: schemaToShape(match.operation.response_schema),
        ...(match.response_schema_ref ? { schema_ref: match.response_schema_ref } : {}),
        schema_kind: match.schema_kind,
        match_confidence: match.confidence,
      }
    }
  }

  // Rung 2 — regex-inferred hints, verbatim.
  const details = await resolveDataSourceDetails({ projectRoot, name: entry.name, kind: entry.kind, file: entry.file, workspaceRoot })
  if (!('error' in details) && (details.return_type || (details.referenced_types?.length ?? 0) > 0)) {
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
