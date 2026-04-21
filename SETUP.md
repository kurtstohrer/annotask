# Annotask Setup Guide

`docs/setup.md` is the full reference. This file is the short version for getting a project running quickly.

## Requirements

- Node.js 18+
- Vite 4+ or Webpack 5+
- A supported frontend stack: Vue, React, Svelte, Solid, Astro, HTML, or htmx

Astro, HTML, and htmx are Vite-first paths.

## Install

```bash
npm install -D annotask
```

## Add The Plugin

Vite example:

```ts
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { annotask } from 'annotask'

export default defineConfig({
  plugins: [vue(), annotask()],
})
```

Solid example:

```ts
import { defineConfig } from 'vite'
import solid from 'vite-plugin-solid'
import { annotask } from 'annotask'

export default defineConfig({
  plugins: [solid(), annotask()],
})
```

Webpack example:

```ts
import { AnnotaskWebpackPlugin } from 'annotask/webpack'

export default {
  plugins: [new AnnotaskWebpackPlugin()],
}
```

Annotask should come after the framework plugin in Vite.

## Start The Dev Server

```bash
npm run dev
```

Then open:

- app: `http://localhost:5173/`
- shell: `http://localhost:5173/__annotask/`
- status: `http://localhost:5173/__annotask/api/status`
- MCP: `http://localhost:5173/__annotask/mcp`

## Connect Your Agent

Recommended: MCP.

```bash
npx annotask init-mcp --editor=claude
```

Supported editor targets:

- `claude`
- `cursor`
- `vscode`
- `windsurf`
- `all`

Or install the bundled skills:

```bash
npx annotask init-skills
```

Default skill targets:

- `.claude/skills/`
- `.agents/skills/`

Optional built-in target:

- `.copilot/skills/`

## Generate The Design Spec

Run `/annotask-init` after installing skills, or ask your agent to initialize Annotask.

This writes `.annotask/design-spec.json`, which powers:

- Design > Tokens
- theme-aware token editing
- component and icon metadata
- better grounding for `theme_update` tasks

## Monorepos And MFEs

Annotask is workspace-aware. It can scan sibling packages in pnpm, npm, Yarn, Bun, and Lerna workspaces.

For MFE children pointing at a root shell:

```ts
annotask({
  mfe: '@myorg/catalog',
  server: 'http://localhost:24678',
})
```

Webpack root shell:

```ts
plugins: [new AnnotaskWebpackPlugin({ port: 24678 })]
```

Tasks created from MFE elements keep the `mfe` field and can be filtered in the shell, CLI, HTTP API, and MCP tools.

## Generated State

Annotask writes state under `.annotask/`:

- `tasks.json`
- `design-spec.json`
- `server.json`
- `performance.json`
- `screenshots/`

Usually this should be ignored in git:

```gitignore
.annotask/
```

## Troubleshooting

**No source mapping on elements**

Put Annotask after the framework plugin in Vite.

**Shell loads but the iframe is blank**

Make sure the app itself still works at the dev-server URL.

**CLI or MCP cannot find the server**

Use `annotask status --server=http://localhost:PORT` or check `.annotask/server.json`.

**Cross-origin or MFE setup**

Annotask uses a `postMessage` bridge, so local cross-origin iframe setups can work without direct DOM access.

## Full Docs

- detailed setup: [`docs/setup.md`](docs/setup.md)
- CLI reference: [`docs/cli.md`](docs/cli.md)
- API reference: [`docs/api.md`](docs/api.md)
