# Security Model

Annotask is a **development-only** tool. It is not designed for production use and should never be deployed to public-facing servers.

## Threat Model

Annotask assumes a **trusted local environment**: the developer's machine, running a local dev server (Vite or Webpack), accessed via `localhost`.

### What is protected

- **Production builds:** All Annotask transforms, injected globals, toggle buttons, API endpoints, and WebSocket servers are gated to development mode only. In Vite, this uses `apply: 'serve'`. In Webpack, the plugin checks `compiler.options.mode`. Running `vite build` or a production Webpack build produces clean output with no Annotask artifacts.
- **File writes:** Annotask only writes to the `.annotask/` directory under the project root (design spec, task state). It never modifies source files directly.
- **HTML injection:** Placeholder rendering uses DOM APIs instead of `innerHTML` with interpolated values. Markdown output (task descriptions, feedback, agent messages) is sanitized with DOMPurify before rendering via `v-html`.

### What is NOT protected

- **Authentication:** API endpoints (`/__annotask/api/*`) and the WebSocket server (`/__annotask/ws`) have no authentication. This matches Vite's own HMR WebSocket, which is also unauthenticated. Non-browser clients (CLI, scripts) that omit the `Origin` header are trusted, since network-level binding to localhost is the primary access control.
- **Network exposure:** The standalone server binds to `127.0.0.1` by default. When using the Vite plugin, the server inherits Vite's host configuration. API and WebSocket endpoints perform origin validation — browser requests from non-localhost origins are rejected.
- **Input validation:** API endpoints validate payload structure, size (max 4MB), and field whitelists. POST and PATCH requests only accept known fields. Task status transitions are validated against a state machine. Screenshot filenames are validated with a strict regex.

## Recommendations

- Do not expose the dev server to untrusted networks.
- Do not include `annotask` in production dependencies — it should be a `devDependency` only.
- If you need to share a running dev environment, use a VPN or SSH tunnel rather than binding to `0.0.0.0`.
