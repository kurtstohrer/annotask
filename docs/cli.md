# CLI Reference

The `annotask` CLI talks to a running Annotask dev server over HTTP and WebSocket.

## Install

The CLI ships with the `annotask` package:

```bash
npm install -D annotask
npx annotask help
```

## Output Modes

- Default: human-oriented output
- `--pretty`: pretty-printed JSON
- `--mcp`: compact JSON shaped to match the equivalent MCP tool output

`--mcp` is the best fallback mode for agent skills when MCP is unavailable.

## Common Connection Flags

| Flag | Description |
|------|-------------|
| `--port=N` | Dev-server port. Defaults to `5173` unless discovered from `.annotask/server.json` |
| `--host=H` | Dev-server host. Default `localhost` |
| `--server=URL` | Full Annotask server URL. Overrides discovery |
| `--mfe=NAME` | Filter task/report queries by MFE identity |

## Commands

### watch

Stream live report updates over WebSocket.

```bash
annotask watch
```

Reconnects automatically with exponential backoff.

### report

Fetch the current change report.

```bash
annotask report
```

### status

Check if the server is reachable.

```bash
annotask status
```

### tasks

Fetch task summaries or full task objects.

```bash
annotask tasks [--status=STATUS] [--detail]
```

Notes:

- default output is compact task summaries
- `--detail` returns full tasks
- `--status=STATUS` filters client-side after fetch

### task

Fetch one task by ID.

```bash
annotask task <task-id>
```

Returns the full task object with `visual` removed and `agent_feedback` trimmed to the latest relevant exchanges.

### update-task

Update status, reviewer feedback, agent questions, blocked state, or resolution.

```bash
annotask update-task <task-id> --status=in_progress
annotask update-task <task-id> --status=review --resolution="Adjusted spacing and typography"
annotask update-task <task-id> --status=denied --feedback="The padding is still too large"
annotask update-task <task-id> --ask='{"message":"Need clarification","questions":[{"id":"q1","text":"Which variant?","type":"choice","options":["primary","secondary"]}]}'
annotask update-task <task-id> --blocked-reason="Cannot fix inside third-party library"
```

Valid statuses: `pending`, `in_progress`, `applied`, `review`, `accepted`, `denied`, `needs_info`, `blocked`.

### screenshot

Download a task screenshot.

```bash
annotask screenshot <task-id> [--output=PATH]
```

Default output path is under `.annotask/screenshots/`.

### design-spec

Fetch a design-spec summary or one full category.

```bash
annotask design-spec
annotask design-spec --category=colors
```

Valid categories: `colors`, `typography`, `spacing`, `borders`, `breakpoints`, `icons`, `components`, `framework`.

### components

List detected library components.

```bash
annotask components [search] [--library=NAME] [--limit=N] [--offset=N]
```

### component

Fetch full detail for one component.

```bash
annotask component <name> [--library=NAME]
```

### component-examples

Show real in-repo usages of a component.

```bash
annotask component-examples Button [--limit=5]
```

### code-context

Ground a task to its current source excerpt.

```bash
annotask code-context <task-id> [--context-lines=25]
```

Returns excerpt, enclosing symbol, import block, and excerpt hash.

### data-context

Resolve or re-resolve a task's `data_context`.

```bash
annotask data-context <task-id> [--refresh]
```

### data-sources

List discovered project data sources and detected data libraries.

```bash
annotask data-sources [--kind=K] [--library=NAME] [--search=Q] [--used-only]
```

Kinds: `composable`, `signal`, `store`, `fetch`, `graphql`, `loader`, `rpc`.

### data-source-examples

Show real in-repo usages of a data source.

```bash
annotask data-source-examples useUserQuery [--kind=composable] [--limit=5]
```

### data-source-details

Fetch definition-level detail for a project data source.

```bash
annotask data-source-details useUserQuery [--kind=composable] [--file=src/hooks/useUserQuery.ts] [--context-lines=20]
```

### api-schemas

List discovered API schemas.

```bash
annotask api-schemas [--kind=openapi] [--detail]
```

Kinds: `openapi`, `graphql`, `trpc`, `jsonschema`.

### api-operation

Fetch one API operation by path.

```bash
annotask api-operation /users --method=GET [--schema-location=PATH]
```

### resolve-endpoint

Resolve a concrete URL against the discovered schema catalog.

```bash
annotask resolve-endpoint /api/users/42 [--method=GET]
```

### init-mcp

Write MCP configuration for one or more editors.

```bash
annotask init-mcp [--editor=claude] [--force]
annotask init-mcp --editor=claude,cursor
annotask init-mcp --editor=all
```

Built-in editor targets: `claude`, `cursor`, `vscode`, `windsurf`, `all`.

### init-skills

Install the bundled skills into one or more target directories.

```bash
annotask init-skills [--target=claude,agents] [--force]
annotask init-skills --target=copilot
```

Built-in targets: `claude`, `agents`, `copilot`.

### mcp

Run a stdio MCP proxy that forwards to the HTTP MCP endpoint.

```bash
annotask mcp
```

This is useful for MCP clients that only support stdio transport.

### help

Show the built-in CLI help.

```bash
annotask help
```

## Examples

```bash
annotask tasks --mcp --status=pending
annotask task TASK_ID --mcp
annotask design-spec --category=colors --mcp
annotask components Button --mcp
annotask data-context TASK_ID --refresh --mcp
annotask api-schemas --detail --mcp
annotask resolve-endpoint /api/users/42 --method=GET --mcp
```
