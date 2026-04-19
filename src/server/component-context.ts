import type { ComponentCatalog } from './component-scanner.js'
import type { ComponentRef } from '../schema.js'

/**
 * Build a name → (library, category) lookup from the component scanner
 * catalog. First match wins when a name appears in multiple libraries — in
 * practice that's rare for library components (e.g., `Button` in a single
 * Vue UI kit) and the agent can disambiguate from the entry's `file`.
 */
function buildLookup(catalog: ComponentCatalog): Map<string, { library: string; category?: string }> {
  const lookup = new Map<string, { library: string; category?: string }>()
  for (const lib of catalog.libraries) {
    for (const comp of lib.components) {
      if (!lookup.has(comp.name)) {
        lookup.set(comp.name, {
          library: lib.name,
          ...(comp.category ? { category: comp.category } : {}),
        })
      }
    }
  }
  return lookup
}

export function enrichComponentRef(
  ref: ComponentRef | undefined,
  catalog: ComponentCatalog,
  lookupCache?: Map<string, { library: string; category?: string }>,
): ComponentRef | undefined {
  if (!ref || !ref.name) return ref
  if (ref.library) return ref
  const lookup = lookupCache ?? buildLookup(catalog)
  const hit = lookup.get(ref.name)
  if (!hit) return ref
  const out: ComponentRef = { ...ref, library: hit.library }
  if (hit.category && !ref.category) out.category = hit.category
  return out
}

/**
 * Enrich the `component` and `rendered.ancestors` entries inside a task's
 * `context` object. Fills `library` / `category` from the scanner catalog
 * so agents can tell a library component from a project-local one without
 * re-reading the file. Pure and synchronous; callers pass the cached
 * catalog — no I/O on this path.
 */
export function enrichContextComponentRefs(
  context: Record<string, unknown> | undefined,
  catalog: ComponentCatalog,
): Record<string, unknown> | undefined {
  if (!context || typeof context !== 'object' || Array.isArray(context)) return context
  const lookup = buildLookup(catalog)
  const out: Record<string, unknown> = { ...context }
  const keysToEnrich: Array<'component' | 'to_component'> = ['component', 'to_component']
  for (const k of keysToEnrich) {
    const v = out[k]
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const enriched = enrichComponentRef(v as ComponentRef, catalog, lookup)
      if (enriched) out[k] = enriched
    }
  }
  // `rendered` / `to_rendered` are now raw HTML strings — nothing to enrich.
  return out
}
