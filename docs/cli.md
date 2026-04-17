# CLI Reference

The `annotask` CLI connects to a running dev server (Vite or Webpack) with the Annotask plugin.

## Install

The CLI is included in the `annotask` package:

```bash
npm install -D annotask
npx annotask help
```

Or run directly:
```bash
npx annotask help
```

## Commands

### watch

Stream changes in real-time via WebSocket.

```bash
annotask watch [--port=PORT] [--host=HOST]
```

| Flag | Default | Description |
|------|---------|-------------|
| `--port` | auto-detected | Dev server port (5173 for Vite, 24678 for Webpack) |
| `--host` | `localhost` | Dev server host |

Output is color-coded by change type. The watcher automatically reconnects with exponential backoff (up to 20 attempts).

### report

Fetch the current change report as JSON (one-shot HTTP GET).

```bash
annotask report [--port=PORT] [--host=HOST]
```

Prints the full `AnnotaskReport` JSON to stdout. Pipe to `jq` for formatting:

```bash
annotask report | jq .
annotask report | jq '.changes[] | select(.type == "style_update")'
```

### status

Check if the Annotask server is running.

```bash
annotask status [--port=PORT] [--host=HOST]
```

Exits with code 0 if the server responds, non-zero otherwise.

### tasks

Fetch the task list.

```bash
annotask tasks [--pretty] [--mfe=NAME]
```

Returns compact task summaries (one line per task) by default. Use `--pretty` for full, formatted task objects. `--mfe=NAME` filters by MFE identity.

### update-task

Transition a task's status, attach feedback, ask the user a question, or mark it blocked.

```bash
annotask update-task <task-id> --status=<status> [--feedback=<text>] [--resolution=<text>]
annotask update-task <task-id> --ask='{"message":"...","questions":["..."]}'
annotask update-task <task-id> --blocked-reason="Cannot fix: issue is in third-party library"
```

| Flag | Description |
|------|-------------|
| `--status` | One of: `pending`, `in_progress`, `applied`, `review`, `accepted`, `denied`, `needs_info`, `blocked` |
| `--feedback` | User-facing feedback (typically paired with `denied`) |
| `--resolution` | Short note describing what the agent did (typically paired with `review`) |
| `--ask` | JSON-encoded `{ message, questions[] }` appended to `agent_feedback`. Auto-sets status to `needs_info` unless `--status` is given. |
| `--blocked-reason` | Why the task can't be applied. Auto-sets status to `blocked`. |

### screenshot

Download a task's screenshot to a file.

```bash
annotask screenshot <task-id> [--output=PATH]
```

Writes the PNG to `<task-id>.png` by default, or to `--output=PATH`.

### components

List components from every detected component library.

```bash
annotask components [NAME]
```

Supply an optional name fragment to filter. Without an argument, prints every component grouped by library.

### component

Show full detail for one component — props, slots, events, types, defaults, description.

```bash
annotask component <name> [--library=NAME] [--json]
```

`--library` disambiguates when the same name exists in multiple libraries. `--json` outputs machine-readable JSON (suitable for LLM consumption).

### init-mcp

Write an MCP configuration file so your editor can connect to the Annotask MCP server.

```bash
annotask init-mcp [--editor=NAME] [--force]
```

| Flag | Default | Description |
|------|---------|-------------|
| `--editor` | `claude` | `claude` (`.mcp.json`), `cursor` (`.cursor/mcp.json`), `vscode` (`.vscode/mcp.json`), `windsurf` (`.windsurf/mcp.json`), or `all` |
| `--force` | off | Overwrite an existing MCP config file |

Multiple editors: `--editor=claude,cursor`.

### mcp

Start an MCP stdio server that proxies requests to the running Annotask dev server. Used by MCP clients that only support stdio transport.

```bash
annotask mcp
```

The stdio server reads `.annotask/server.json` (written on dev server startup) to auto-discover the port. The dev server must be running.

### init-skills

Install Annotask's AI agent skills into your project.

```bash
annotask init-skills [--target=TARGETS] [--force]
```

| Flag | Default | Description |
|------|---------|-------------|
| `--target` | `claude,agents` | Comma-separated list of targets |
| `--force` | off | Overwrite existing skills |

**Built-in targets:**

| Name | Directory |
|------|-----------|
| `claude` | `.claude/skills/` |
| `agents` | `.agents/skills/` |
| `copilot` | `.copilot/skills/` |

Custom paths work too: `--target=.my-tool/skills`.

**How it works:** The first target gets real files. Additional targets get symlinks pointing back to the first, so there's only one copy of each skill file.

```bash
annotask init-skills                          # .claude + .agents (default)
annotask init-skills --target=claude          # Only .claude/skills/
annotask init-skills --target=copilot         # Only .copilot/skills/
annotask init-skills --target=claude,agents,copilot  # All three
annotask init-skills --force                  # Overwrite existing
```

### help

Show usage information.

```bash
annotask help
```
