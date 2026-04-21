/**
 * Tiny hash router for the Atlas explorer.
 * Routes:
 *   #/                       → list
 *   #/country/{cca2}         → detail
 *   #/compare                → compare view
 */

export interface Route {
  path: string
  params: Record<string, string>
}

function parseHash(): Route {
  const hash = window.location.hash.slice(1) || '/'
  if (hash === '/' || hash === '') {
    return { path: '/', params: {} }
  }
  const detailMatch = hash.match(/^\/country\/([A-Za-z]{2})$/)
  if (detailMatch) {
    return { path: '/country/:cca2', params: { cca2: detailMatch[1].toUpperCase() } }
  }
  if (hash === '/compare') {
    return { path: '/compare', params: {} }
  }
  return { path: '/', params: {} }
}

export function createRouter() {
  let current = $state<Route>(parseHash())
  const update = () => {
    current = parseHash()
  }
  window.addEventListener('hashchange', update)
  return {
    get current() {
      return current
    },
  }
}

export function navigate(path: string) {
  window.location.hash = path
}
