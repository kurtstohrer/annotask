# Annotask Setup Guide

## 1. Install

```bash
npm install -D annotask
```

## 2. Add the plugin

### Vite (Vue, React, Svelte, SolidJS, or plain HTML)

```ts
import { annotask } from 'annotask'

export default defineConfig({
  plugins: [
    vue(),    // or react() or svelte() or solid() — omit for plain HTML/htmx
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

Astro source mapping uses Astro's native `data-astro-source-*` attributes — no extra configuration needed.

### Webpack

```ts
import { AnnotaskWebpackPlugin } from 'annotask/webpack'

// Add to your webpack config plugins (dev only):
plugins: [new AnnotaskWebpackPlugin()]
```

## 3. Start your dev server

```bash
npm run dev
```

Open your app and navigate to `/__annotask/` to open the Annotask shell (e.g. `http://localhost:5173/__annotask/`).

## 4. Connect your AI coding agent

Annotask provides two ways for agents to interact with it: **MCP** (recommended) and **skills**.

### Option A: MCP Server (recommended)

Annotask includes a built-in [MCP](https://modelcontextprotocol.io) server that starts automatically with your dev server — no extra process, no extra dependency. Your AI coding tool connects directly to it and gets structured tools for reading tasks, applying changes, and managing the full task lifecycle.

#### Claude Code

Add to `.mcp.json` in your project root:

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

Replace `5173` with your dev server port if different.

#### Cursor / Windsurf / VS Code

Add to your MCP settings (`.cursor/mcp.json`, `.windsurf/mcp.json`, or VS Code's MCP config):

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

#### Stdio transport

For MCP clients that only support stdio (subprocess) transport:

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

The stdio transport reads `.annotask/server.json` (written on dev server startup) to discover the port automatically. The dev server must be running.

#### MCP Tools

Once connected, your agent gets these tools:

| Tool | Description |
|------|-------------|
| `annotask_get_tasks` | List tasks with optional status and MFE filters |
| `annotask_get_task` | Get full detail for a single task by ID (context, element_context, agent_feedback) |
| `annotask_update_task` | Transition task status, set resolution, ask questions, mark blocked |
| `annotask_create_task` | Create a new pending task |
| `annotask_delete_task` | Delete a task and its screenshot |
| `annotask_get_design_spec` | Design tokens — colors, typography, spacing, borders, breakpoints |
| `annotask_get_components` | Search component libraries by name (up to 20 results per library) |
| `annotask_get_component` | Full detail for one component by name (library optional) |
| `annotask_get_screenshot` | Task screenshot as base64 PNG image |

#### Agent workflow with MCP

A typical agent session:

1. `annotask_get_tasks` with `status: "pending"` — find work to do
2. `annotask_update_task` with `status: "in_progress"` — lock the task
3. Read the task's `file`, `line`, `description`, and `context` — understand what to change
4. `annotask_get_screenshot` — see what the user sees (if screenshot attached)
5. Edit the source file
6. `annotask_update_task` with `status: "review"` and `resolution: "..."` — mark done
7. If stuck: `annotask_update_task` with `questions: [...]` — ask the user
8. If impossible: `annotask_update_task` with `blocked_reason: "..."` — explain why

### Option B: Skills

Annotask ships markdown-based skill files for agents that support them. Skills provide step-by-step workflow instructions that reference CLI commands.

```bash
npx annotask init-skills
```

This copies skill files to `.claude/skills/` and `.agents/skills/` so your agent can discover them.

| Agent | Skill directory | Notes |
|-------|----------------|-------|
| Claude Code | `.claude/skills/` | Invoke with `/annotask-apply`, `/annotask-init` |
| GitHub Copilot | `.agents/skills/` | Auto-discovered by Copilot agents |
| OpenAI Codex | `.agents/skills/` | Uses the same `.agents/` convention |
| Other agents | `.agents/skills/` | Any agent that reads `.agents/skills/` |

| Skill | What it does |
|-------|-------------|
| `/annotask-init` | Scans your project and generates `.annotask/design-spec.json` with detected tokens, fonts, colors, and component library. Run once per project. |
| `/annotask-apply` | Fetches pending tasks from the Annotask API, applies changes to source files, and marks them for review. |

### MCP vs Skills

| | MCP | Skills |
|-|-----|--------|
| Setup | Add MCP config once | Run `init-skills`, commit skill files |
| Agent interaction | Structured tool calls with typed inputs/outputs | Shell commands that output JSON |
| Screenshots | Returned as inline images | Downloaded to disk, then read |
| Works with | Any MCP-compatible editor | Agents that read skill markdown |
| Requires dev server | Yes | Yes (for the API) |

## 5. Initialize the design spec (optional)

Scan your project to detect design tokens (colors, typography, spacing, borders, breakpoints) and component/icon libraries:

- **With MCP**: Your agent can call `annotask_get_design_spec` directly. To generate the spec file, ask your agent to run `/annotask-init`.
- **With skills**: Run `/annotask-init` in your agent.

This writes `.annotask/design-spec.json`, which populates the Theme page in the Annotask shell. Add `.annotask/` to your `.gitignore`.

## Micro-frontends

For MFE architectures where multiple apps load into a single root shell:

**MFE child** (Vite) — adds `data-annotask-mfe` attribute to all elements:

```ts
annotask({
  mfe: '@myorg/my-mfe',                    // MFE identity tag
  server: 'http://localhost:24678',         // Root's annotask server URL
})
```

**Root shell** (Webpack) — runs the annotask server, bridge, and shell UI:

```ts
plugins: [new AnnotaskWebpackPlugin({ port: 24678 })]
```

When `server` is set, the MFE's local annotask server is skipped — the root handles it. When only `mfe` is set (no `server`), annotask runs normally for standalone development.

Tasks created from MFE elements carry the `mfe` field. Filter them with `annotask_get_tasks` (MCP) or `GET /__annotask/api/tasks?mfe=@myorg/my-mfe` (HTTP).

## Troubleshooting

**Elements don't show source info**: Make sure your framework plugin (Vue, React, Svelte, or SolidJS) is installed and the Annotask plugin is listed after it in your Vite config. For Astro, source mapping is automatic. For plain HTML/htmx, source mapping is injected via `transformIndexHtml`.

**MCP not connecting**: The dev server must be running. The MCP endpoint is at `/__annotask/mcp` on the same port as your dev server. Check `annotask status` to verify.

**WebSocket not connecting**: The CLI and shell connect to `/__annotask/ws` on the same port as your dev server.

**Changes not appearing in report**: Only style and class changes that differ from computed values are included. If before and after are identical, the change is filtered out.
