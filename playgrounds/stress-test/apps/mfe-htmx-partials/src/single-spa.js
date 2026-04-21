// single-spa lifecycle entry for the htmx MFE. Loaded cross-origin by
// the host at http://localhost:4260/src/single-spa.js.
//
// We fetch the MFE's own index.html at mount time and lift its
// `.htmx-shell` body into the host's DOM. This reuses the HTML that
// Vite already transformed with annotask data-* attributes, so the
// arrow/select tools get real source attribution instead of resolving
// to an uninstrumented runtime template literal.
//
// Proxy-relative URLs (/api/*) are rewritten to the Rust service's
// absolute origin because the browser is on the host's origin (:4200)
// under single-spa — there is no Vite proxy.

import '@annotask/stress-ui-tokens/tokens.css'
import '@picocss/pico/css/pico.min.css'
import './htmx.css'
import htmx from 'htmx.org'
import { bootstrapTheme } from '@annotask/stress-ui-tokens'

bootstrapTheme()

if (typeof window !== 'undefined' && !window.htmx) {
  window.htmx = htmx
}

// htmx 2.x defaults `selfRequestsOnly = true`, which rejects any fetch
// to a different origin as `htmx:invalidPath`. Under single-spa the
// MFE runs on the host origin (:4200) and needs to reach the Rust
// service on :4360 — that's cross-origin by definition. Opt out.
if (htmx.config) {
  htmx.config.selfRequestsOnly = false
}

const MFE_ORIGIN = 'http://localhost:4260'
const RUST_ORIGIN = 'http://localhost:4360'

let container = null

async function fetchShellHtml() {
  const res = await fetch(`${MFE_ORIGIN}/`, { cache: 'no-store' })
  if (!res.ok) throw new Error(`[htmx-partials] fetch index.html failed: ${res.status}`)
  const text = await res.text()
  const doc = new DOMParser().parseFromString(text, 'text/html')
  const shell = doc.querySelector('.htmx-shell')
  if (!shell) throw new Error('[htmx-partials] .htmx-shell not found in fetched index.html')

  // Rewrite proxy-relative hx-get URLs to the Rust origin so they work
  // from the host (:4200) where no /api proxy exists.
  shell.querySelectorAll('[hx-get]').forEach((el) => {
    const url = el.getAttribute('hx-get') || ''
    if (url.startsWith('/api/')) el.setAttribute('hx-get', RUST_ORIGIN + url)
  })

  // The solo page uses id="health" / id="refresh-btn" / etc. — single-spa
  // mounts multiple apps into the same document, so keep the htmx- prefixed
  // ids stable. Map solo ids onto the namespaced versions expected below.
  const idRewrites = {
    health: 'htmx-health',
    'refresh-btn': 'htmx-refresh-btn',
    'component-usage': 'htmx-component-usage',
    'usage-refresh-btn': 'htmx-usage-refresh-btn',
  }
  for (const [from, to] of Object.entries(idRewrites)) {
    const node = shell.querySelector(`#${from}`)
    if (node) node.id = to
  }
  shell.querySelectorAll('[hx-trigger]').forEach((el) => {
    let trig = el.getAttribute('hx-trigger') || ''
    for (const [from, to] of Object.entries(idRewrites)) {
      trig = trig.replace(`from:#${from}`, `from:#${to}`)
    }
    el.setAttribute('hx-trigger', trig)
  })

  return shell.outerHTML
}

export async function bootstrap() {}

export async function mount(props) {
  container = document.getElementById(`single-spa-application:${props.name}`)
  if (!container) throw new Error('[htmx-partials] mount target not found')

  const shellHtml = await fetchShellHtml()
  container.innerHTML = shellHtml
  htmx.process(container)

  const health = container.querySelector('#htmx-health')
  if (health) {
    htmx.ajax('GET', `${RUST_ORIGIN}/api/health-fragment`, {
      target: health,
      swap: 'innerHTML',
    })
  }

  const usage = container.querySelector('#htmx-component-usage')
  if (usage) {
    htmx.ajax('GET', `${RUST_ORIGIN}/api/component-usage-fragment`, {
      target: usage,
      swap: 'innerHTML',
    })
  }
}

export async function unmount() {
  if (container) {
    container.innerHTML = ''
    container = null
  }
}
