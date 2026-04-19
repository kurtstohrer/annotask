# Annotask Setup Guide

## 1. Install

```bash
npm install -D annotask
```

## 2. Add the Plugin

Annotask should come after your framework plugin.

### Vite

```ts
import { annotask } from 'annotask'

export default defineConfig({
  plugins: [
    vue(),    // or react(), svelte(), solid() - omit for plain HTML/htmx
    annotask(),
  ],
})
```

### SolidJS

```ts
import { defineConfig } from 'vite'
import solid from 'vite-plugin-solid'
import { annotask } from 'annotask'

export default defineConfig({
  plugins: [solid(), annotask()],
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

Astro source mapping uses Astro's native `data-astro-source-*` attributes automatically.

### Webpack

```ts
import { AnnotaskWebpackPlugin } from 'annotask/webpack'

plugins: [new AnnotaskWebpackPlugin()]
```

## 3. Start Your Dev Server

```bash
npm run dev
```

Then open `http://localhost:5173/__annotask/`.

## 4. Connect Your AI Agent

Annotask supports two integration styles: **MCP** and **skills**.

### Option A: MCP

Recommended for Claude Code, Cursor, VS Code, Windsurf, and other MCP clients.

Quick setup:

```bash
npx annotask init-mcp --editor=claude
```

Manual config example:

```json
{
  "mcpServers": {
    "annotask": {
      "type": "url",
      "url": "http://localhost:5173/__annotask/mcp"
    }
  }
}
```

For stdio-only MCP clients:

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

### MCP Tools

Current tool surface:

- `annotask_get_tasks`, `annotask_get_task`, `annotask_update_task`, `annotask_create_task`, `annotask_delete_task`
- `annotask_get_design_spec`
- `annotask_get_components`, `annotask_get_component`, `annotask_get_component_examples`
- `annotask_get_screenshot`, `annotask_get_code_context`
- `annotask_get_data_context`, `annotask_get_data_sources`, `annotask_get_data_source_examples`, `annotask_get_data_source_details`
- `annotask_get_api_schemas`, `annotask_get_api_operation`, `annotask_resolve_endpoint`

### Typical MCP Workflow

1. `annotask_get_tasks` to find actionable work.
2. `annotask_update_task` with `status: "in_progress"` to lock a task.
3. Pull deeper context only when needed: screenshot, code context, components, data context, API schemas.
4. Edit source files.
5. `annotask_update_task` with `status: "review"` and a `resolution` note.
6. Use `questions` or `blocked_reason` when the task cannot be completed directly.

### Option B: Skills

Install the bundled skills:

```bash
npx annotask init-skills
```

Default targets are `.claude/skills/` and `.agents/skills/`. Built-in alternate target: `copilot`.

Available skills:

| Skill | What it does |
|-------|--------------|
| `/annotask-init` | Scans the project and generates `.annotask/design-spec.json` |
| `/annotask-apply` | Pulls pending and denied tasks, applies changes, and marks them for review |

## 5. Generate the Design Spec

Run `/annotask-init` after installing skills, or ask your agent to initialize Annotask.

This writes `.annotask/design-spec.json`, which powers:

- Design token editing
- breakpoint metadata
- component and icon library discovery
- better grounding for `theme_update` work

## 6. What the Current Shell Includes

Annotask is organized into three main surfaces:

- **Editor**: annotations, screenshots, viewport controls, route-aware tasks
- **Design**: tokens, inspector, layout overlay, component browser
- **Develop**: a11y, data sources, libraries, performance, errors

## 7. Generated State

Annotask writes local state under `.annotask/`.

Typical contents:

- `tasks.json`
- `design-spec.json`
- `server.json`
- `screenshots/`

Add it to `.gitignore` unless you intentionally want to commit it.

## Micro-frontends

For MFE setups where multiple apps render into one root shell:

### MFE child

```ts
annotask({
  mfe: '@myorg/my-mfe',
  server: 'http://localhost:24678',
})
```

### Root shell

```ts
plugins: [new AnnotaskWebpackPlugin({ port: 24678 })]
```

When `server` is set, the child skips starting its own Annotask server and forwards to the root shell's server instead.

Tasks created from MFE elements carry the `mfe` field and can be filtered through MCP, CLI, or HTTP.

## Troubleshooting

**Elements do not show source info**

Make sure Annotask is listed after the framework plugin in Vite. For Astro and plain HTML/htmx, source mapping is handled through their dedicated integration paths.

**MCP is not connecting**

The dev server must be running. Check `annotask status` and confirm the MCP endpoint is reachable at `/__annotask/mcp`.

**WebSocket updates are missing**

The shell and CLI connect to `/__annotask/ws` on the same port as the Annotask server.

**Changes are not appearing in the report**

No-op edits are filtered out. If the computed before and after values are identical, no change is emitted.

**Cross-origin or MFE iframe**

Annotask uses a `postMessage` bridge rather than direct iframe DOM access, so separate local dev-server origins can still work.
