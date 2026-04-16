/**
 * Normalize a route path for comparison.
 *
 * - Treats missing path as '/'
 * - Drops query + hash fragments
 * - Ensures a leading slash
 * - Strips trailing slashes (except on the root)
 *
 * Shared between App.vue and any composable that matches tasks or annotations
 * to the current route — a consistent form keeps `"/foo" === "/foo/"` comparisons
 * from silently drifting behavior.
 */
export function normalizeRoute(path: string): string {
  if (!path) return '/'
  const base = path.split('#')[0].split('?')[0] || '/'
  const withSlash = base.startsWith('/') ? base : `/${base}`
  return withSlash.length > 1 ? withSlash.replace(/\/+$/, '') : withSlash
}
