# Setup Guide

## Requirements

- Node.js 18+
- Vite 4+ or Webpack 5+
- A supported app stack: Vue, React, Svelte, Solid, Astro, HTML, or htmx

Annotask runs only in development.

Astro, HTML, and htmx are Vite-first paths. Webpack support is aimed at the non-Astro integration path.

## Install

```bash
npm install -D annotask
# or
pnpm add -D annotask
```

## Configure Vite

Add Annotask after the framework plugin.

### Vue

```ts
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { annotask } from 'annotask'

export default defineConfig({
  plugins: [vue(), annotask()],
})
```

### React

```ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { annotask } from 'annotask'

export default defineConfig({
  plugins: [react(), annotask()],
})
```

### Svelte

```ts
import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { annotask } from 'annotask'

export default defineConfig({
  plugins: [svelte(), annotask()],
})
```

### Solid

```ts
import { defineConfig } from 'vite'
import solid from 'vite-plugin-solid'
import { annotask } from 'annotask'

export default defineConfig({
  plugins: [solid(), annotask()],
})
```

### Plain HTML Or htmx

```ts
import { defineConfig } from 'vite'
import { annotask } from 'annotask'

export default defineConfig({
  plugins: [annotask()],
})
```

### Astro

```ts
import { defineConfig } from 'astro/config'
import { annotask } from 'annotask'

export default defineConfig({
  vite: {
    plugins: [annotask()],
  },
})
```

## Configure Webpack

```ts
import { AnnotaskWebpackPlugin } from 'annotask/webpack'

export default {
  plugins: [new AnnotaskWebpackPlugin()],
}
```

The Webpack plugin starts a standalone Annotask server on port `24678` by default and injects a dev-server proxy for `/__annotask` routes.

## Plugin Options

Current `annotask()` and `AnnotaskWebpackPlugin` options:

- `mfe` - micro-frontend identity stored on rendered elements and tasks
- `server` - remote Annotask server URL for MFE child apps
- `apiSchemaUrls` - extra HTTP schema endpoints to probe
- `apiSchemaFiles` - extra project-relative schema file paths to scan

Example MFE child config:

```ts
annotask({
  mfe: '@myorg/catalog',
  server: 'http://localhost:24678',
})
```

When `server` is set, the child app skips starting its own Annotask server and writes `.annotask/server.json` pointing at the root server instead.

## Start The Dev Server

```bash
npm run dev
```

Typical URLs:

| URL | Purpose |
|-----|---------|
| `http://localhost:5173/` | Your app with Annotask instrumentation |
| `http://localhost:5173/__annotask/` | Annotask shell |
| `http://localhost:5173/__annotask/api/status` | health check |
| `http://localhost:5173/__annotask/mcp` | MCP endpoint |

## Connect An Agent

Annotask supports MCP and bundled skills.

### MCP

Recommended for Claude Code, Cursor, VS Code, and Windsurf.

```bash
npx annotask init-mcp --editor=claude
```

Supported values for `--editor`:

- `claude`
- `cursor`
- `vscode`
- `windsurf`
- `all`
- comma-separated values such as `claude,cursor`

`init-mcp` writes or merges config into these files:

- `.mcp.json`
- `.cursor/mcp.json`
- `.vscode/mcp.json`
- `.codeium/windsurf/mcp_config.json`

Default transport is **stdio** — `npx annotask mcp` resolves the dev-server
URL from `.annotask/server.json` per request, so `.mcp.json` does not go
stale when the dev-server port changes:

```json
{
  "mcpServers": {
    "annotask": {
      "command": "npx",
      "args": ["annotask", "mcp"]
    }
  }
}
```

Pass `--transport=http` to pin a specific URL instead — useful for editors
without stdio support, or to point at a remote dev server:

```bash
npx annotask init-mcp --transport=http
```

```json
{
  "mcpServers": {
    "annotask": {
      "type": "http",
      "url": "http://localhost:5173/__annotask/mcp"
    }
  }
}
```

With HTTP transport, the URL is resolved once at `init-mcp` time. If the
dev-server port changes, re-run `annotask init-mcp --transport=http --force`.

### Skills

Install the bundled skills:

```bash
npx annotask init-skills
```

Default targets:

- `.claude/skills/`
- `.agents/skills/`

Optional built-in target:

- `.copilot/skills/`

Examples:

```bash
npx annotask init-skills --target=claude
npx annotask init-skills --target=claude,agents,copilot
npx annotask init-skills --force
```

The first target gets real files. Additional targets get symlinks back to that primary copy.

## Generate The Design Spec

Run `/annotask-init` after installing skills, or ask your agent to initialize Annotask.

This writes `.annotask/design-spec.json`. The current design spec is variant-aware and includes:

- `themes[]`
- `defaultTheme`
- `colors[]`
- `typography.families[]`
- `typography.scale[]`
- `spacing[]`
- `borders.radius[]`
- `breakpoints`
- `icons`
- `components`

Each token stores `values` keyed by theme id, so multi-theme apps can edit light and dark variants independently.

## Workspace And MFE Behavior

Annotask is workspace-aware. In monorepos it can detect sibling packages from:

- `pnpm-workspace.yaml`
- `package.json` `workspaces`
- `lerna.json`

This affects:

- component catalog aggregation
- data-source scanning
- API schema discovery
- the shell's MFE filter dropdown
- `GET /__annotask/api/workspace`

## Generated State

Annotask writes local state under `.annotask/`:

- `tasks.json`
- `design-spec.json`
- `server.json`
- `performance.json`
- `screenshots/`

Usually this should stay out of git:

```gitignore
.annotask/
```

## Verify The Setup

1. Open `http://localhost:5173/__annotask/`.
2. Click an element in the iframe and confirm file and line data appear.
3. Create an annotation or style edit and confirm it lands in the Tasks panel.
4. Run `annotask status`.
5. If you configured MCP, confirm your editor can reach `POST /__annotask/mcp`.

## What You Should See

The shell currently exposes three top-level surfaces:

- **Annotate** - annotations, screenshots, viewport tools, route-aware tasks
- **Design** - tokens, inspector, layout overlay, component browser
- **Audit** - a11y, data, libraries, performance, errors

Internally the Audit tab still uses the `develop` view id for localStorage compatibility.

## Troubleshooting

**No source mapping on elements**

Annotask must come after the framework plugin in Vite.

**Shell opens but the iframe is blank**

Confirm the dev server is still running and the app works outside Annotask.

**CLI or MCP cannot find the server**

Run `annotask status --server=http://localhost:PORT` or inspect `.annotask/server.json`.

**WebSocket updates are missing**

Make sure `/__annotask/ws` is reachable and not blocked by a proxy.

**Cross-origin or MFE setup**

Annotask uses a `postMessage` bridge rather than direct iframe DOM access, so local cross-origin setups can still work.
