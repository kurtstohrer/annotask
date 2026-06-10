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
- **Input validation:** API endpoints validate payload structure, size (max 4 MB request body; rendered-HTML sidecars capped at 200 KB), and field whitelists. POST and PATCH requests only accept known fields. Task status transitions are validated against a state machine. Screenshot filenames are validated with a strict regex. HTTP bodies and MCP tool args parse through shared zod schemas at the boundary.
- **WebSocket frames:** the WebSocket server enforces a per-frame size cap (`maxPayload`).
- **Screenshot file names:** uploads use `crypto.randomBytes(8)` filenames (16 hex chars). The `annotask_get_screenshot` MCP tool also routes `task.screenshot` through `isSafeScreenshot` before touching the filesystem, closing a path-traversal hole for maliciously constructed task records.
- **`server.json` permissions:** written with mode `0o600` so other users on shared machines cannot read the live PID and port.

### Localhost threat model and embedded agents

Any code running on the same machine — including the app being developed, its dependencies, and any other page served from `localhost` — shares the trust boundary with Annotask. In particular, same-origin app code can reach the Annotask API, including the agent spawn endpoint, since it runs on the same dev server. The mitigations are layered, not absolute:

- **Spawn routes are same-port-origin-gated.** `POST /api/agent/spawn` and `DELETE /api/agent/spawn/:runId` require the request `Origin` to match the server's own port (`origin_port_mismatch` otherwise), so a page on a *different* localhost port cannot spawn CLIs that have credential access. A page on the *same* origin still can — that is inherent to running an unauthenticated dev tool inside the app's own server.
- **`ANNOTASK_MAX_PERMISSION` is the server-side floor.** Spawned CLIs run with a permission mode (`plan` / `default` / `bypass`); the server refuses any spawn whose argv requests more than the configured ceiling, regardless of what the client asked for. In shared or locked-down environments, administrators should set `ANNOTASK_MAX_PERMISSION=plan` (read-only) or `default` so a compromised page cannot request `bypass`.
- **GET requests are Host-gated** (being added in this change set): read endpoints validate the `Host` header against local hostnames, narrowing DNS-rebinding-style reads.
- **Spawned binaries are allow-listed** (`claude`, `codex`, `opencode`, `copilot`); free-form binary names and absolute paths are rejected, processes start with `shell: false`, cwd is pinned to the project root, and `PATH`/`HOME` overrides are dropped.

None of this makes the dev server safe to expose beyond the developer's machine. If untrusted code runs in the app you are annotating, assume it can read Annotask state and drive agents up to the configured permission ceiling.

## Recommendations

- Do not expose the dev server to untrusted networks.
- Do not include `annotask` in production dependencies — it should be a `devDependency` only.
- If you need to share a running dev environment, use a VPN or SSH tunnel rather than binding to `0.0.0.0`.
