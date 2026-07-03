/**
 * Pure logic behind DataBindingPicker.vue — kept out of the component so the
 * shape-tree flattening, field candidates, and binding construction are
 * unit-testable (no @vue/test-utils in this repo).
 *
 * Path grammar (matches the WireframeDataBinding contract):
 *   object child `k` of `parent`  →  `parent.k` (or `k` at the root)
 *   array nodes append `[]`       →  `planets[]`, `data.items[]`
 */
import type { DataShapeNode, ProjectDataEntry } from '../../schema'
import { isWireframeDataBinding, type WireframeDataBinding } from '../../shared/wireframe-types'

export interface ShapeRow {
  /** Drill-down path for the binding (e.g. "planets[]", "data.user"). */
  path: string
  /** Display key for the row ("planets", "user", "(items)"). */
  key: string
  depth: number
  node: DataShapeNode
  /** Rows the user can pick as the binding path. */
  selectable: boolean
  /** Rows that have children to expand into. */
  expandable: boolean
}

/**
 * Flatten a shape tree into ordered rows for the picker. `expanded` holds the
 * paths the user has opened; the root row is always present, collapsed
 * children are skipped. Arrays expand into their ITEM shape (one synthetic
 * row), objects into their keys.
 */
export function flattenShape(root: DataShapeNode, expanded: ReadonlySet<string>, rootKey = '(response)'): ShapeRow[] {
  const rows: ShapeRow[] = []
  walk(root, rootKey, '', 0)
  return rows

  function walk(node: DataShapeNode, key: string, parentPath: string, depth: number): void {
    const path = pathFor(node, key, parentPath, depth)
    rows.push({
      path,
      key,
      depth,
      node,
      selectable: node.kind === 'object' || node.kind === 'array' || node.kind === 'ref',
      expandable: (node.kind === 'object' && !!node.children && Object.keys(node.children).length > 0)
        || (node.kind === 'array' && !!node.item),
    })
    if (!expanded.has(path)) return
    if (node.kind === 'array' && node.item) {
      // The item shape rides under the array's own path — selecting a leaf
      // inside it reads naturally: planets[].name
      if (node.item.kind === 'object' && node.item.children) {
        for (const [k, child] of Object.entries(node.item.children)) walk(child, k, path, depth + 1)
      } else {
        walk(node.item, '(item)', path, depth + 1)
      }
      return
    }
    if (node.kind === 'object' && node.children) {
      for (const [k, child] of Object.entries(node.children)) walk(child, k, path, depth + 1)
    }
  }

  function pathFor(node: DataShapeNode, key: string, parentPath: string, depth: number): string {
    if (depth === 0) return node.kind === 'array' ? '[]' : ''
    const joined = parentPath ? `${parentPath}.${key}` : key
    return node.kind === 'array' ? `${joined}[]` : joined
  }
}

/**
 * Leaf keys of the node the user drilled to — the multi-select source for
 * `fields`. Arrays offer their item-object's keys; objects their own.
 * Scalars/refs count as displayable leaves.
 */
export function fieldCandidates(node: DataShapeNode): string[] {
  const obj = node.kind === 'array' ? node.item : node
  if (!obj || obj.kind !== 'object' || !obj.children) return []
  return Object.entries(obj.children)
    .filter(([, child]) => child.kind === 'scalar' || child.kind === 'ref')
    .map(([key]) => key)
}

function asScalar(v: unknown): string | number | boolean | undefined {
  return (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') ? v : undefined
}

/**
 * Up to `n` REAL example rows for the picked node, drawn from the API contract's
 * `example`/`default` values (never synthesized). Used to preview bound props on
 * the wireframe canvas. Precedence: an array example of objects (distinct rows)
 * → a single object example → per-field examples on the item's children. Returns
 * [] when the contract carries no examples (the caller falls back to `{field}`
 * tokens). Only scalar field values are kept, so a row is a flat prop bag.
 */
export function sampleRows(node: DataShapeNode | null | undefined, fields: string[], n: number): Record<string, unknown>[] {
  if (!node || n <= 0) return []
  const item = node.kind === 'array' ? node.item : node
  const keys = fields.length > 0 ? fields : fieldCandidates(node)
  if (keys.length === 0) return []

  const pick = (obj: unknown): Record<string, unknown> | null => {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null
    const row: Record<string, unknown> = {}
    let any = false
    for (const k of keys) {
      const v = asScalar((obj as Record<string, unknown>)[k])
      if (v !== undefined) { row[k] = v; any = true }
    }
    return any ? row : null
  }

  // 1) Array example of objects — the richest source (distinct rows).
  const arrEx = node.kind === 'array' ? node.example : undefined
  if (Array.isArray(arrEx)) {
    const rows = arrEx.slice(0, n).map(pick).filter((r): r is Record<string, unknown> => !!r)
    if (rows.length) return rows
  }
  // 2) A single object example (the item shape, or the node itself).
  const objRow = pick(item?.example ?? (node.kind === 'object' ? node.example : undefined))
  if (objRow) return [objRow]
  // 3) Per-field examples on the item's children.
  if (item?.kind === 'object' && item.children) {
    const row: Record<string, unknown> = {}
    let any = false
    for (const k of keys) {
      const v = asScalar(item.children[k]?.example)
      if (v !== undefined) { row[k] = v; any = true }
    }
    if (any) return [row]
  }
  return []
}

/**
 * Assemble a plain-JSON WireframeDataBinding from a catalog entry + the
 * picker's selection. Validates before returning — an invalid binding here is
 * a programmer error (the validator at the PUT boundary would reject the
 * whole doc), so throw loudly instead of persisting garbage.
 */
export function buildBinding(
  entry: Pick<ProjectDataEntry, 'kind' | 'name' | 'file' | 'endpoint'>,
  sel: {
    path?: string
    fields?: string[]
    shape_source: WireframeDataBinding['shape_source']
    /** How `path` was obtained — 'schema-picked' (drilled from a real tree),
     *  'user-typed' (unverified free text), or 'none' (no path). */
    path_source?: WireframeDataBinding['path_source']
    /** REAL contract example rows (api-schema tier) for the preview. */
    sample?: Record<string, unknown>[]
    /** Sketch instance count for a list binding. */
    repeat?: number
    /** prop→field map (usually set later in the popover, preserved here). */
    propMap?: Record<string, string>
    /** Verifiable evidence carried straight from the resolved DataSourceShape
     *  so the persisted binding re-grounds against the same contract. */
    match_confidence?: number
    schema_location?: string
    schema_kind?: WireframeDataBinding['schema_kind']
    op?: { method: string; path: string }
    method?: string
    resolved_endpoint?: string
    details_confidence?: WireframeDataBinding['details_confidence']
  },
): WireframeDataBinding {
  const fields = (sel.fields ?? []).map(f => f.trim()).filter(Boolean)
  const path = sel.path?.trim()
  // Path provenance is a first-class honesty signal: if a path was picked from
  // a real schema tree it's 'schema-picked'; typed by hand it's 'user-typed';
  // absent it's 'none'. Default from the shape tier when the caller didn't say.
  const path_source: WireframeDataBinding['path_source'] = sel.path_source
    ?? (!path ? 'none' : sel.shape_source === 'api-schema' ? 'schema-picked' : 'user-typed')
  const binding: WireframeDataBinding = {
    kind: entry.kind,
    name: entry.name,
    // The catalog has no module field — the defining file IS the import
    // identity the agent re-grounds against.
    ...(entry.file ? { module: entry.file } : {}),
    ...(entry.endpoint ? { endpoint: entry.endpoint } : {}),
    ...(path ? { path } : {}),
    ...(fields.length > 0 ? { fields } : {}),
    shape_source: sel.shape_source,
    path_source,
    ...(sel.match_confidence != null ? { match_confidence: sel.match_confidence } : {}),
    ...(sel.schema_location ? { schema_location: sel.schema_location } : {}),
    ...(sel.schema_kind ? { schema_kind: sel.schema_kind } : {}),
    ...(sel.op ? { op: sel.op } : {}),
    ...(sel.method ? { method: sel.method } : {}),
    ...(sel.resolved_endpoint ? { resolved_endpoint: sel.resolved_endpoint } : {}),
    ...(sel.details_confidence ? { details_confidence: sel.details_confidence } : {}),
    ...(sel.sample && sel.sample.length > 0 ? { sample: sel.sample } : {}),
    ...(sel.repeat && sel.repeat > 1 ? { repeat: sel.repeat } : {}),
    ...(sel.propMap && Object.keys(sel.propMap).length > 0 ? { propMap: sel.propMap } : {}),
  }
  const plain = JSON.parse(JSON.stringify(binding)) as WireframeDataBinding
  if (!isWireframeDataBinding(plain)) {
    throw new Error(`buildBinding produced an invalid WireframeDataBinding for "${entry.name}"`)
  }
  return plain
}
