# Annotask

Visual UI design tool for Vue 3 apps. Developers make visual changes in the browser and Annotask generates structured reports that AI agents can apply to source code. Works with Vite and Webpack.

## Development

```bash
pnpm install
pnpm build                   # Build shell + plugin + CLI
pnpm dev:playground           # Start test app with Annotask
```

Then open:
- App: http://localhost:5173/
- Annotask: http://localhost:5173/__annotask/
- API: http://localhost:5173/__annotask/api/report

## Annotask API

When the Annotask design tool is running, you can interact with it:

- **HTTP**: `curl http://localhost:5173/__annotask/api/report` — get the current change report
- **WebSocket**: `ws://localhost:5173/__annotask/ws` — live change stream
- **CLI**: `annotask watch` / `annotask report` — terminal tools

Use `/apply-annotask` to fetch and apply pending visual changes to source code.

## Structure

- `src/plugin/` — Vite plugin (SFC transform, toggle button, bridge client)
- `src/server/` — HTTP API, WebSocket server, shell serving, project state
- `src/webpack/` — Webpack plugin and SFC transform loader
- `src/shell/` — Design tool UI (Vue 3 app, pre-built into dist/shell/)
- `src/shared/` — Shared types (postMessage bridge protocol)
- `src/schema.ts` — TypeScript types for change reports
- `src/cli/` — CLI tool for terminal interaction
- `playground/` — Vite test app with FastAPI backend
- `playground-webpack/` — Webpack test app
