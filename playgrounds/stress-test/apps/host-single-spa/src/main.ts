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

for (const mfe of MFES) {
  registerApplication({
    name: mfe.name,
    app: () => import(/* @vite-ignore */ mfe.url),
    activeWhen: activeForHash(mfe.hash) as never,
  })
}

// Blade is served by Laravel (SSR full-HTML, cross-origin). single-spa
// supports "legacy" apps via a custom lifecycle — here we manage an
// iframe. Same mount/unmount routing semantics as the ESM MFEs.
registerApplication({
  name: '@stress/blade-legacy-lab',
  app: async () => ({
    bootstrap: async () => {},
    mount: async (props: { name: string }) => {
      const target = document.getElementById(`single-spa-application:${props.name}`)
      if (!target) return
      target.innerHTML = ''
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
