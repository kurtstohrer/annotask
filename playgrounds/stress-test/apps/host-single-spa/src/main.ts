import '@annotask/stress-ui-tokens/tokens.css'
import { bootstrapTheme } from '@annotask/stress-ui-tokens'
import { createApp } from 'vue'
import { registerApplication, start } from 'single-spa'
import App from './App.vue'

// Restore the stored theme onto <html data-theme> before anything else
// renders so the page never flashes the wrong colour scheme.
bootstrapTheme()

// Each MFE registers as a single-spa application. In dev, we load its
// lifecycle module straight from its own Vite server via cross-origin
// ESM import. `@vite-ignore` keeps Vite from trying to resolve the
// remote URL at the host's bundle time.

interface ContentMfe {
  name: string
  hash: string
  url: string
}

const CONTENT_MFES: ContentMfe[] = [
  { name: '@stress/vue-data-lab',        hash: '#/vue',    url: 'http://localhost:4220/src/single-spa.ts' },
  { name: '@stress/react-workflows',     hash: '#/react',  url: 'http://localhost:4210/src/single-spa.tsx' },
  { name: '@stress/svelte-streaming',    hash: '#/svelte', url: 'http://localhost:4230/src/single-spa.js' },
  { name: '@stress/solid-component-lab', hash: '#/solid',  url: 'http://localhost:4240/src/single-spa.tsx' },
  { name: '@stress/htmx-partials',       hash: '#/htmx',   url: 'http://localhost:4260/src/single-spa.js' },
]

const SIDEBAR_MFE = {
  name: '@stress/react-sidebar',
  url: 'http://localhost:4250/src/single-spa.tsx',
}

function activeForHash(hash: string) {
  return (loc: Location) => loc.hash === hash || loc.hash.startsWith(hash + '/')
}

// @vitejs/plugin-react-swc expects the React Fast Refresh runtime globals
// to be set before any JSX-transformed module runs. Under single-spa the
// React MFE's own index.html preamble never executes (we import its
// module cross-origin). We install the preamble eagerly here because the
// sidebar MFE is always active — when content React MFEs also activate
// they reuse the same prepared globals.
let reactPreamblePromise: Promise<void> | null = null
function ensureReactPreamble(refreshOrigin: string): Promise<void> {
  if (reactPreamblePromise) return reactPreamblePromise
  reactPreamblePromise = (async () => {
    const g = globalThis as unknown as Record<string, unknown>
    g.$RefreshReg$ = () => {}
    g.$RefreshSig$ = () => (type: unknown) => type
    g.__vite_plugin_react_preamble_installed__ = true
    try {
      const mod = await import(/* @vite-ignore */ `${refreshOrigin}/@react-refresh`)
      const RefreshRuntime = (mod as { default?: { injectIntoGlobalHook?: (w: unknown) => void } }).default ?? mod
      ;(RefreshRuntime as { injectIntoGlobalHook?: (w: unknown) => void }).injectIntoGlobalHook?.(window)
    } catch {
      // MFE not running — the preamble flag alone lets the SWC plugin's
      // runtime check pass, and $Refresh* globals are harmless no-ops.
    }
  })()
  return reactPreamblePromise
}

// Sidebar — always active on every route.
registerApplication({
  name: SIDEBAR_MFE.name,
  app: async () => {
    await ensureReactPreamble('http://localhost:4250')
    return import(/* @vite-ignore */ SIDEBAR_MFE.url)
  },
  activeWhen: () => true,
})

for (const mfe of CONTENT_MFES) {
  const isReact = mfe.name === '@stress/react-workflows'
  registerApplication({
    name: mfe.name,
    app: isReact
      ? async () => {
          await ensureReactPreamble('http://localhost:4210')
          return import(/* @vite-ignore */ mfe.url)
        }
      : () => import(/* @vite-ignore */ mfe.url),
    activeWhen: activeForHash(mfe.hash) as never,
  })
}

// Mount the Vue shell first so the mount-point divs exist before
// single-spa starts resolving applications.
createApp(App).mount('#root')
start()
