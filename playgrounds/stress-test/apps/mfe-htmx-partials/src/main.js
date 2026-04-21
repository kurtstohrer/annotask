import '@annotask/stress-ui-tokens/tokens.css'
import '@picocss/pico/css/pico.min.css'
import './htmx.css'
import htmx from 'htmx.org'
import { bootstrapTheme } from '@annotask/stress-ui-tokens'

bootstrapTheme()

// Vite's ESM bundle of htmx exports it as default but doesn't assign
// window.htmx. Register it so the solo page (and anything expecting the
// global) behaves like the CDN/UMD drop-in.
if (typeof window !== 'undefined' && !window.htmx) {
  window.htmx = htmx
}

console.log('[htmx-partials] ready — Pico.css + htmx loaded')
