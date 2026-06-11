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

/**
 * Assemble a plain-JSON WireframeDataBinding from a catalog entry + the
 * picker's selection. Validates before returning — an invalid binding here is
 * a programmer error (the validator at the PUT boundary would reject the
 * whole doc), so throw loudly instead of persisting garbage.
 */
export function buildBinding(
  entry: Pick<ProjectDataEntry, 'kind' | 'name' | 'file' | 'endpoint'>,
  sel: { path?: string; fields?: string[]; shape_source: WireframeDataBinding['shape_source'] },
): WireframeDataBinding {
  const fields = (sel.fields ?? []).map(f => f.trim()).filter(Boolean)
  const path = sel.path?.trim()
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
  }
  const plain = JSON.parse(JSON.stringify(binding)) as WireframeDataBinding
  if (!isWireframeDataBinding(plain)) {
    throw new Error(`buildBinding produced an invalid WireframeDataBinding for "${entry.name}"`)
  }
  return plain
}
