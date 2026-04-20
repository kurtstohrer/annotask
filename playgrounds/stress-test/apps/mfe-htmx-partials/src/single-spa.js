// single-spa lifecycle entry for the htmx MFE. Loaded cross-origin by
// the host at http://localhost:4260/src/single-spa.js. We can't reuse
// the solo index.html — under single-spa we render an HTML fragment
// directly into the host's DOM and call htmx.process() on it.
//
// hx-get URLs are absolute (http://localhost:4360/...) because under
// single-spa there is no Vite proxy; the browser is on the host origin
// (:4200) and we need to reach the Rust service on :4360 directly.

import '@annotask/stress-ui-tokens/tokens.css'
import '@picocss/pico/css/pico.min.css'
import htmx from 'htmx.org'

// Vite's ESM bundle of htmx exports it as default but doesn't assign
// window.htmx. Under single-spa other code (annotask, Playwright probes)
// may expect the global — set it so we match the CDN/UMD behavior.
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

const HTML = `
<main class="container">
  <header>
    <hgroup>
      <h1>htmx Partials</h1>
      <p>MFE <code>htmx-partials</code> · mounted by single-spa · backed by Rust on :4360 · Pico.css</p>
    </hgroup>
  </header>

  <article>
    <h2>What this stresses</h2>
    <ul>
      <li>Server-driven HTML fragments via <code>hx-get</code></li>
      <li>DOM mutation after load — annotask must follow swapped elements</li>
      <li>Pico.css classless component styling on Rust-served fragments</li>
    </ul>
  </article>

  <article>
    <header>
      <hgroup>
        <h2>Upstream health</h2>
        <p>Swapped in from the Rust service.</p>
      </hgroup>
    </header>
    <div
      id="htmx-health"
      hx-get="http://localhost:4360/api/health-fragment"
      hx-trigger="load, click from:#htmx-refresh-btn"
      hx-swap="innerHTML"
    >
      <p><em>Loading health fragment…</em></p>
    </div>
    <footer>
      <button id="htmx-refresh-btn" type="button" class="secondary">Refresh</button>
      <small>If Rust is down the panel stays empty. Start with <code>just rust</code>.</small>
    </footer>
  </article>
</main>
`

let container = null

export async function bootstrap() {}

export async function mount(props) {
  container = document.getElementById(`single-spa-application:${props.name}`)
  if (!container) throw new Error('[htmx-partials] mount target not found')
  container.innerHTML = HTML
  htmx.process(container)

  // `hx-trigger="load"` only fires on elements htmx sees during
  // DOMContentLoaded. Under single-spa we inject the fragment after the
  // host has already loaded, so we kick off the initial fetch
  // explicitly. Clicking Refresh still uses the declarative
  // `click from:#htmx-refresh-btn` trigger.
  const health = container.querySelector('#htmx-health')
  if (health) {
    htmx.ajax('GET', 'http://localhost:4360/api/health-fragment', {
      target: health,
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
