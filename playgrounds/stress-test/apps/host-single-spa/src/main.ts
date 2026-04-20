import '@annotask/stress-ui-tokens/tokens.css'
import { createApp } from 'vue'
import { registerApplication, start } from 'single-spa'
import App from './App.vue'

// Each MFE registers as a single-spa application. In dev, we load its
// lifecycle module straight from its own Vite server via cross-origin
// ESM import. `@vite-ignore` keeps Vite from trying to resolve the
// remote URL at the host's bundle time.

interface Mfe {
  name: string
  hash: string
  url: string
}

const MFES: Mfe[] = [
  { name: '@stress/vue-data-lab',        hash: '#/vue',    url: 'http://localhost:4220/src/single-spa.ts' },
  { name: '@stress/react-workflows',     hash: '#/react',  url: 'http://localhost:4210/src/single-spa.tsx' },
  { name: '@stress/svelte-streaming',    hash: '#/svelte', url: 'http://localhost:4230/src/single-spa.js' },
  { name: '@stress/solid-component-lab', hash: '#/solid',  url: 'http://localhost:4240/src/single-spa.tsx' },
  { name: '@stress/htmx-partials',       hash: '#/htmx',   url: 'http://localhost:4260/src/single-spa.js' },
]

function activeForHash(hash: string) {
  return (loc: Location) => loc.hash === hash || loc.hash.startsWith(hash + '/')
}

// @vitejs/plugin-react-swc expects the React Fast Refresh runtime globals
// to be set before any JSX-transformed module runs. Under single-spa the
// React MFE's own index.html preamble never executes (we import its
// module cross-origin). We install the preamble lazily — only when the
// React route activates — so the host page isn't blocked on a fetch to
// :4210 when the React MFE isn't running. Matters for pages that iframe
// the host (like /__annotask/).
let reactPreamblePromise: Promise<void> | null = null
function ensureReactPreamble(): Promise<void> {
  if (reactPreamblePromise) return reactPreamblePromise
  reactPreamblePromise = (async () => {
    const g = globalThis as unknown as Record<string, unknown>
    g.$RefreshReg$ = () => {}
    g.$RefreshSig$ = () => (type: unknown) => type
    g.__vite_plugin_react_preamble_installed__ = true
    try {
      const mod = await import(/* @vite-ignore */ 'http://localhost:4210/@react-refresh')
      const RefreshRuntime = (mod as { default?: { injectIntoGlobalHook?: (w: unknown) => void } }).default ?? mod
      ;(RefreshRuntime as { injectIntoGlobalHook?: (w: unknown) => void }).injectIntoGlobalHook?.(window)
    } catch {
      // React MFE not running — the preamble flag alone lets the SWC
      // plugin's runtime check pass, and $Refresh* globals are harmless
      // no-ops. Hot-reload won't work cross-origin anyway.
    }
  })()
  return reactPreamblePromise
}

for (const mfe of MFES) {
  const isReact = mfe.name === '@stress/react-workflows'
  registerApplication({
    name: mfe.name,
    app: isReact
      ? async () => {
          await ensureReactPreamble()
          return import(/* @vite-ignore */ mfe.url)
        }
      : () => import(/* @vite-ignore */ mfe.url),
    activeWhen: activeForHash(mfe.hash) as never,
  })
}

// Blade is served by Laravel (SSR full-HTML, cross-origin). single-spa
// supports "legacy" apps via a custom lifecycle — here we manage an
// iframe. Same mount/unmount routing semantics as the ESM MFEs. Before
// iframing, probe /api/health so we can show a friendly fallback when
// the Laravel container isn't up (instead of a blank iframe).
registerApplication({
  name: '@stress/blade-legacy-lab',
  app: async () => ({
    bootstrap: async () => {},
    mount: async (props: { name: string }) => {
      const target = document.getElementById(`single-spa-application:${props.name}`)
      if (!target) return
      target.innerHTML = ''

      let healthy = false
      try {
        const res = await fetch('http://localhost:4350/api/health', { signal: AbortSignal.timeout(2000) })
        healthy = res.ok
      } catch {
        healthy = false
      }

      if (!healthy) {
        target.innerHTML = `
          <section style="padding:32px;max-width:720px;font-family:system-ui,sans-serif;color:#e8ecf1;">
            <h1 style="margin:0 0 8px;font-size:20px;">Blade Legacy Lab — service not running</h1>
            <p style="color:#8793a6;margin:0 0 16px;line-height:1.55;">
              The Laravel service on <code>:4350</code> didn't respond. Blade pages are
              rendered server-side by Laravel, which runs via Docker Compose.
              Start it from the stress-test directory:
            </p>
            <pre style="background:#0f1623;border:1px solid #1e2836;border-radius:8px;padding:14px 16px;margin:0 0 12px;color:#c6d1e1;font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:12px;">just laravel</pre>
            <p style="color:#8793a6;margin:0;font-size:13px;">
              Once <code>http://localhost:4350/api/health</code> returns 200, reload this route.
            </p>
          </section>
        `
        return
      }

      const iframe = document.createElement('iframe')
      iframe.src = 'http://localhost:4350/'
      iframe.title = 'Blade Legacy Lab'
      iframe.style.cssText = 'width:100%;height:100%;min-height:70vh;border:0;background:#fff;'
      target.appendChild(iframe)
    },
    unmount: async (props: { name: string }) => {
      const target = document.getElementById(`single-spa-application:${props.name}`)
      if (target) target.innerHTML = ''
    },
  }),
  activeWhen: activeForHash('#/blade') as never,
})

// Mount the Vue shell first so the mount-point divs exist before
// single-spa starts resolving applications.
createApp(App).mount('#root')
start()
