# CLI Reference

The `annotask` CLI talks to a running Annotask server over HTTP and WebSocket.

## Install

The CLI ships with the `annotask` package:

```bash
npm install -D annotask
npx annotask help
```

## Output Modes

- default output is human-oriented
- `--pretty` prints formatted JSON
- `--mcp` prints compact JSON shaped to match the equivalent `annotask_*` MCP tool output

`--mcp` is the recommended fallback mode for agent skills.

## Connection Flags

| Flag | Meaning |
|------|---------|
| `--port=N` | dev-server port — last-resort fallback, only applied when no `.annotask/server.json` is found and no `--server=URL` is given |
| `--host=H` | host (default `localhost`) — same caveat as `--port` |
| `--server=URL` | full server URL, overrides discovery |
| `--mfe=NAME` | filter task and report queries by MFE id |

The CLI's normal discovery path is `.annotask/server.json`, written by the
dev server at startup. If you hit a connection error that mentions
`http://localhost:5173` and you aren't actually running on 5173, you're
running the CLI from a directory without a `server.json` — cd into the MFE
root that owns the dev server, or pass `--server=URL`.

## Commands

### `watch`

Stream report updates over WebSocket.

```bash
annotask watch
```

This is also the default command when no command is given.

### `report`

Fetch the current change report.

```bash
annotask report
```

### `status`

Check whether the server is reachable.

```bash
annotask status
annotask status --mcp
```

### `tasks`

Fetch task summaries or full task objects.

```bash
annotask tasks
annotask tasks --status=pending
annotask tasks --detail
annotask tasks --mcp --detail
```

Notes:

- default output is compact task summaries
- `--detail` returns full task objects
- `--status=STATUS` filters client-side after fetch

### `task`

Fetch one task by id.

```bash
annotask task <task-id>
```

The result strips the shell-only `visual` field and trims older `agent_feedback` entries.

### `update-task`

Update status, reviewer feedback, agent questions, blocked reason, or resolution.

```bash
annotask update-task <task-id> --status=in_progress
annotask update-task <task-id> --status=review --resolution="Adjusted spacing and typography"
annotask update-task <task-id> --status=denied --feedback="Still too much padding"
annotask update-task <task-id> --ask='{"message":"Need clarification","questions":[{"id":"q1","text":"Which variant?","type":"choice","options":["primary","secondary"]}]}'
annotask update-task <task-id> --blocked-reason="Cannot patch third-party library"
```

Valid statuses:

- `pending`
- `in_progress`
- `applied`
- `review`
- `accepted`
- `denied`
- `needs_info`
- `blocked`

### `screenshot`

Download a task screenshot.

```bash
annotask screenshot <task-id>
annotask screenshot <task-id> --output=.tmp/task.png
```

Default output is under `.annotask/screenshots/`.

### `design-spec`

Fetch a design-spec summary or a single category.

```bash
annotask design-spec
annotask design-spec --category=colors
```

Supported categories:

- `colors`
- `typography`
- `spacing`
- `borders`
- `breakpoints`
- `icons`
- `components`
- `framework`

### `components`

List detected component libraries and their components.

```bash
annotask components
annotask components Button
annotask components Button --library=primevue --limit=20 --offset=20
```

### `component`

Fetch full detail for one component.

```bash
annotask component Button
annotask component Button --library=primevue
annotask component Button --json
```

`--json` is supported for this command in addition to `--mcp`.

### `component-examples`

Show real in-repo usages of a component.

```bash
annotask component-examples Button
annotask component-examples Button --limit=10
```

### `code-context`

Resolve a task to grounded source context.

```bash
annotask code-context <task-id>
annotask code-context <task-id> --context-lines=25
```

Returns excerpt, enclosing symbol, import block, and excerpt hash.

### `data-context`

Resolve or re-resolve a task's `data_context`.

```bash
annotask data-context <task-id>
annotask data-context <task-id> --refresh
```

### `data-sources`

List detected data/state libraries and project data sources.

```bash
annotask data-sources
annotask data-sources --used-only
annotask data-sources --kind=composable --search=user
```

Kinds:

- `composable`
- `signal`
- `store`
- `fetch`
- `graphql`
- `loader`
- `rpc`

### `data-source-examples`

Show real in-repo usages of a data source.

```bash
annotask data-source-examples useUserQuery --kind=composable
annotask data-source-examples useUserQuery --kind=composable --limit=10
```

### `data-source-details`

Fetch definition-level detail for a project data source.

```bash
annotask data-source-details useUserQuery --kind=composable
annotask data-source-details useUserQuery --file=src/hooks/useUserQuery.ts --context-lines=20
```

### `api-schemas`

List discovered API schemas.

```bash
annotask api-schemas
annotask api-schemas --kind=openapi --detail
```

Kinds:

- `openapi`
- `graphql`
- `trpc`
- `jsonschema`

### `api-operation`

Fetch one API operation by path.

```bash
annotask api-operation /users --method=GET
annotask api-operation /users --method=GET --schema-location=openapi.yaml
```

### `resolve-endpoint`

Match a concrete URL to the discovered schema catalog.

```bash
annotask resolve-endpoint /api/users/42 --method=GET
```

### `init-mcp`

Write editor MCP config.

```bash
annotask init-mcp                        # default: stdio transport
annotask init-mcp --editor=claude,cursor
annotask init-mcp --editor=all --force
annotask init-mcp --transport=http       # pin a static URL
```

Built-in editors:

- `claude`
- `cursor`
- `vscode`
- `windsurf`
- `all`

`--transport=stdio` (default) writes `{ command: "npx", args: ["annotask", "mcp"] }` —
the proxy resolves the dev-server URL from `.annotask/server.json` per request,
so the config survives port changes. `--transport=http` writes the discovered
URL at init time; re-run with `--force` if the port later changes.

### `init-skills`

Install the bundled skills into one or more target directories.

```bash
annotask init-skills
annotask init-skills --target=claude,agents
annotask init-skills --target=copilot --force
```

Built-in targets:

- `claude`
- `agents`
- `copilot`

Custom paths are also accepted.

### `mcp`

Run a stdio MCP proxy that forwards to the HTTP MCP endpoint.

```bash
annotask mcp
```

### `help`

Show built-in CLI help.

```bash
annotask help
```

## Common Flags

| Flag | Used By |
|------|---------|
| `--detail` | `tasks`, `api-schemas` |
| `--status=STATUS` | `tasks`, `update-task` |
| `--category=NAME` | `design-spec` |
| `--library=NAME` | `components`, `component`, `data-sources` |
| `--limit=N` | `components`, `component-examples`, `data-source-examples` |
| `--offset=N` | `components` |
| `--context-lines=N` | `code-context`, `data-source-details` |
| `--file=PATH` | `data-source-details` |
| `--refresh` | `data-context` |
| `--used-only` | `data-sources` |
| `--kind=K` | `data-sources`, `data-source-examples`, `data-source-details`, `api-schemas` |
| `--method=M` | `api-operation`, `resolve-endpoint` |
| `--schema-location=L` | `api-operation` |
| `--search=Q` | `data-sources` |
| `--force` | `init-mcp`, `init-skills` |

## Examples

```bash
annotask tasks --mcp --status=pending
annotask task TASK_ID --mcp
annotask design-spec --category=colors --mcp
annotask components Button --mcp
annotask component Button --library=primevue --mcp
annotask data-context TASK_ID --refresh --mcp
annotask data-sources --used-only --mcp
annotask api-schemas --detail --mcp
annotask resolve-endpoint /api/users/42 --method=GET --mcp
```
