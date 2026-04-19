import '@annotask/stress-ui-tokens/tokens.css'
import '@picocss/pico/css/pico.min.css'
import 'htmx.org'

// htmx self-registers on import; this module also loads the Pico.css theme
// + shared tokens so server-rendered fragments from Rust land in a styled
// page. Console-log confirms HMR reloads pick us up.
console.log('[htmx-partials] ready — Pico.css + htmx loaded')
