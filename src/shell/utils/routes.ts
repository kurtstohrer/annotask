/**
 * Normalize a route path for comparison.
 *
 * - Treats missing path as '/'
 * - Drops the query string
 * - Keeps a hash ROUTE (`#/foo` — hash-history / single-spa, where the hash IS
 *   the route) but drops a plain scroll ANCHOR (`#section`), distinguished by
 *   the leading slash after `#`. Without this, every hash route collapsed to
 *   the pathname (`/`), so a hash-routed app looked like one frozen route —
 *   wireframes, annotations, and tasks all keyed to the same bucket.
 * - Ensures a leading slash
 * - Strips trailing slashes on the path part (except on the root)
 *
 * Shared between App.vue and any composable that matches tasks or annotations
 * to the current route — a consistent form keeps `"/foo" === "/foo/"` comparisons
 * from silently drifting behavior.
 */
export function normalizeRoute(path: string): string {
  if (!path) return '/'
  const hashIdx = path.indexOf('#')
  const rawHash = hashIdx >= 0 ? path.slice(hashIdx) : ''
  const beforeHash = hashIdx >= 0 ? path.slice(0, hashIdx) : path
  // Hash ROUTES start with `#/`; plain anchors (`#section`, `#top`) are dropped.
  const routeHash = rawHash.startsWith('#/') ? rawHash : ''
  const base = beforeHash.split('?')[0] || '/'
  const withSlash = base.startsWith('/') ? base : `/${base}`
  const trimmed = withSlash.length > 1 ? withSlash.replace(/\/+$/, '') : withSlash
  return trimmed + routeHash
}
