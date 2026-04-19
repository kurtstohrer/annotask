# Setup Guide

## Requirements

- Node.js 18+
- A Vite 4+ or Webpack 5+ project
- Vue 3, React, Svelte, SolidJS, Astro, plain HTML, or htmx

## Install

```bash
npm install -D annotask
# or
pnpm add -D annotask
```

## Configure Vite

Annotask should be added after your framework plugin.

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

### Plain HTML / htmx

```ts
import { defineConfig } from 'vite'
import { annotask } from 'annotask'

export default defineConfig({
  plugins: [annotask()],
})
```

### Astro

```js
import { defineConfig } from 'astro/config'
import { annotask } from 'annotask'

export default defineConfig({
  vite: {
    plugins: [annotask()],
  },
})
```

Annotask only runs in dev mode. Production builds stay clean: no transforms, no injected scripts, no API routes.

## Configure Webpack

```ts
import { AnnotaskWebpackPlugin } from 'annotask/webpack'

export default {
  plugins: [
    new AnnotaskWebpackPlugin(),
  ],
}
```

The Webpack plugin starts a standalone Annotask server on port `24678` by default. Pass `{ port: N }` to customize it.

## Start the Dev Server

```bash
npm run dev
```

Then open:

| URL | What |
|-----|------|
| `http://localhost:5173/` | Your app, with the Annotask bridge and toggle button injected |
| `http://localhost:5173/__annotask/` | The Annotask shell |
| `http://localhost:5173/__annotask/api/status` | Health check |
| `http://localhost:5173/__annotask/mcp` | MCP endpoint for AI agents |

## Connect an AI Agent

Annotask supports two integration styles.

### MCP

Recommended for Claude Code, Cursor, VS Code, Windsurf, and any client that can speak MCP.

```bash
npx annotask init-mcp --editor=claude
```

Other supported editor targets: `cursor`, `vscode`, `windsurf`, `all`, or a comma-separated list such as `claude,cursor`.

### Skills

Install the bundled `/annotask-init` and `/annotask-apply` skills:

```bash
npx annotask init-skills
```

Default targets are `.claude/skills/` and `.agents/skills/`. Other built-in targets include `copilot`.

Examples:

```bash
npx annotask init-skills --target=claude
npx annotask init-skills --target=claude,agents,copilot
npx annotask init-skills --force
```

## Generate the Design Spec

Run `/annotask-init` after installing skills, or ask your agent to initialize Annotask. This scans the project and writes `.annotask/design-spec.json`.

The generated design spec powers:

- Design token editing in the shell
- Breakpoint detection
- Detected icon and component-library metadata
- Higher-signal context for agents working on `theme_update` tasks

## Generated State

Annotask writes local state under `.annotask/`, including tasks, screenshots, server discovery, and the design spec.

Add it to `.gitignore` unless you explicitly want to commit that state:

```gitignore
# Annotask generated state
.annotask/
```

## Verify It Works

1. Open `http://localhost:5173/__annotask/`.
2. Click an element in the iframe and confirm you see source file, line, and component info.
3. Create a quick annotation or style edit and confirm it appears in the Tasks panel.
4. Run `annotask status` or open `http://localhost:5173/__annotask/api/status`.
5. If you configured MCP, confirm your editor can reach `POST /__annotask/mcp`.

## What You Should See

The current shell has three major surfaces:

- **Editor**: annotations, screenshots, viewport preview, route-aware tasks
- **Design**: tokens, inspector, layout overlay, component browser
- **Develop**: a11y, data sources, libraries, performance, errors

## Troubleshooting

**No source mapping on elements**

Put Annotask after the framework plugin in Vite. For Vue, Annotask needs the raw SFC template before Vue compiles it.

**Shell opens but the app iframe is blank**

Check that the dev server is still running at the expected URL and that your app works outside Annotask.

**CLI or MCP cannot find the server**

Run `annotask status --server=http://localhost:PORT` or `annotask status --port=PORT`. The CLI also auto-discovers `.annotask/server.json` when available.

**WebSocket updates are missing**

Make sure `/__annotask/ws` is reachable and that your dev server is not behind a proxy blocking local WebSocket connections.

**Changes are not showing up in the live report**

Annotask filters out no-op edits. If the before and after values match, no change is emitted.

**Cross-origin or MFE setup**

Annotask uses a `postMessage` bridge rather than direct iframe DOM access, so separate dev-server origins can work. Keep all origins local.
