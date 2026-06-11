/**
 * Prop-widget inference for ComponentPreview's sample-prop editor — the
 * type-string heuristics that turn scanned prop metadata into input widgets.
 */

export interface WidgetProp {
  name: string
  type: string | null
  required?: boolean
  default?: unknown
  description?: string | null
}

export type PropWidgetKind = 'boolean' | 'number' | 'enum' | 'string' | 'json'

/** Parse a single-line default-value expression (e.g. `'small'`, `true`, `42`)
 *  into a real JS value. Falls back to the raw string if parsing fails. Keeps
 *  initial values honest to the extracted type. */
export function parseDefault(raw: unknown, type: string | null): unknown {
  if (raw == null) return undefined
  const s = String(raw).trim()
  if (!s || s === 'undefined' || s === 'null') return undefined
  if (s === 'true') return true
  if (s === 'false') return false
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s)
  // Quoted string
  const m = s.match(/^['"`](.*)['"`]$/)
  if (m) return m[1]
  // For enum types like 'a' | 'b', use the first
  if (type && /'[^']+'/.test(type)) {
    const first = type.match(/'([^']+)'/)
    if (first) return first[1]
  }
  return s
}

export function inferWidget(p: WidgetProp): PropWidgetKind {
  const t = (p.type || '').toLowerCase()
  if (t === 'boolean' || t === 'bool') return 'boolean'
  if (t === 'number' || t === 'int' || t === 'float') return 'number'
  if (/^(['"][\w-]+['"]\s*\|\s*)+['"][\w-]+['"]\s*$/.test(p.type || '')) return 'enum'
  if (t === 'string' || t.startsWith('string')) return 'string'
  // Complex types (objects, arrays, functions) — give the user a JSON escape hatch
  return 'json'
}

export function enumValues(p: WidgetProp): string[] {
  if (!p.type) return []
  return [...p.type.matchAll(/'([^']+)'/g)].map(m => m[1])
}
