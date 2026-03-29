# Security Model

Annotask is a **development-only** tool. It is not designed for production use and should never be deployed to public-facing servers.

## Threat Model

Annotask assumes a **trusted local environment**: the developer's machine, running a local dev server (Vite or Webpack), accessed via `localhost`.

### What is protected

- **Production builds:** All Annotask transforms, injected globals, toggle buttons, API endpoints, and WebSocket servers are gated to development mode only. In Vite, this uses `apply: 'serve'`. In Webpack, the plugin checks `compiler.options.mode`. Running `vite build` or a production Webpack build produces clean output with no Annotask artifacts.
- **File writes:** Annotask only writes to the `.annotask/` directory under the project root (design spec, task state). It never modifies source files directly.
- **HTML injection:** Placeholder rendering uses DOM APIs instead of `innerHTML` with interpolated values, preventing XSS from catalog data.

### What is NOT protected

- **Authentication:** API endpoints (`/__annotask/api/*`) and the WebSocket server (`/__annotask/ws`) have no authentication. This matches Vite's own HMR WebSocket, which is also unauthenticated.
- **Network exposure:** By default, dev servers listen on `localhost` only. If the developer configures `--host 0.0.0.0`, Annotask endpoints become network-accessible. This is the same risk as exposing the dev server itself.
- **Input validation:** API endpoints validate payload structure and size (max 1MB), but do not perform deep sanitization. This is acceptable for local dev tools.

## Recommendations

- Do not expose the dev server to untrusted networks.
- Do not include `annotask` in production dependencies — it should be a `devDependency` only.
- If you need to share a running dev environment, use a VPN or SSH tunnel rather than binding to `0.0.0.0`.
