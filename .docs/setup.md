# Setup Guide

## Requirements

- Node.js >= 18
- A Vite (v4+) or Webpack (v5+) project
- Vue 3, React, or Svelte

## Install

```bash
npm install -D annotask
# or
pnpm add -D annotask
```

## Configure Vite

Add Annotask to your `vite.config.ts`. It must come **after** the Vue plugin:

```ts
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { annotask } from 'annotask'

export default defineConfig({
  plugins: [vue(), annotask()],
})
```

Annotask only runs in dev mode (`vite dev`). Production builds (`vite build`) are completely clean — no transforms, no injected scripts, no API endpoints.

## Configure Webpack

Add the Webpack plugin to your `webpack.config.js`:

```ts
import { AnnotaskWebpackPlugin } from 'annotask/webpack'

export default {
  // ... your config
  plugins: [
    // ... other plugins
    new AnnotaskWebpackPlugin()  // Only activates in development mode
  ]
}
```

The Webpack plugin starts a standalone server on port 24678 by default. Pass `{ port: N }` to customize.

## Configure React (Vite)

```ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { annotask } from 'annotask'

export default defineConfig({
  plugins: [react(), annotask()],
})
```

## Configure Svelte (Vite)

```ts
import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { annotask } from 'annotask'

export default defineConfig({
  plugins: [svelte(), annotask()],
})
```

## Start

```bash
npm run dev
```

Then open:

| URL | What |
|-----|------|
| `http://localhost:5173/` | Your app (with a small toggle button injected) |
| `http://localhost:5173/__annotask/` | Annotask design shell |

The design shell loads your app inside an iframe. Click elements to inspect them, edit styles visually, and annotate with pins, arrows, and notes.

## Install AI agent skills (optional)

Annotask includes skills for Claude Code, Codex, Copilot, and other AI agents. Install them with:

```bash
npx annotask init-skills
```

This copies skills to `.claude/skills/` and symlinks them into `.agents/skills/` by default. To target specific agents:

```bash
npx annotask init-skills --target=claude          # Claude Code only
npx annotask init-skills --target=copilot          # Copilot only
npx annotask init-skills --target=claude,agents,copilot  # All three
```

## Initialize design tokens (optional)

If you use Claude Code, run the `/init-annotask` skill to scan your project and generate a design spec:

```
/init-annotask
```

This creates `.annotask/design-spec.json` with detected colors, typography, spacing, and borders. The Theme page in Annotask reads this file.

Add `.annotask/` to your `.gitignore` — it contains generated state:

```
# Annotask (generated)
.annotask/
```

## Verify it works

1. Open `http://localhost:5173/__annotask/`
2. Click an element in the iframe — you should see its source file, line number, and component name in the inspector panel
3. Change a style (e.g., background color) — the change should appear instantly
4. Open `http://localhost:5173/__annotask/api/report` — you should see a JSON report of your changes

## Troubleshooting

**Elements don't show source info:**
Make sure `@vitejs/plugin-vue` is listed before `annotask()` in your plugins array. Annotask's transform runs with `enforce: 'pre'` so it needs the raw SFC before Vue compiles it.

**WebSocket not connecting:**
The CLI and shell connect to `/__annotask/ws` on the same port as your dev server. Make sure the dev server is running.

**Changes not appearing in report:**
Only changes where before and after values differ are included. If the computed value already matches what you set, the change is filtered out.

**Port conflicts:**
If your dev server runs on a port other than 5173, pass `--port` to the CLI:
```bash
annotask watch --port=3000
```
