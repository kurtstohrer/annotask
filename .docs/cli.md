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
