# API Reference

All endpoints are served under `/__annotask/` by the dev server in development mode.

CORS is restricted to local origins such as `localhost`, `127.0.0.1`, and `::1`. Mutating requests from non-local origins are rejected.

## HTTP Endpoints

### GET /api/report

Returns the current live change report.

Supports `?mfe=NAME`.

### GET /api/tasks

Returns all tasks.

Supports `?mfe=NAME`.

### GET /api/tasks/:id

Returns the full task object.

Useful fields include:

- `context`
- `viewport`
- `color_scheme`
- `interaction_history`
- `element_context`
- `data_context`
- `agent_feedback`
- `blocked_reason`
- `resolution`
- `screenshot` and `screenshot_meta`

### POST /api/tasks

Create a new task.

Accepted task types are defined by `TASK_TYPES` in `src/schema.ts`:

- `annotation`
- `section_request`
- `style_update`
- `theme_update`
- `a11y_fix`
- `error_fix`
- `perf_fix`
- `api_update`

Server-controlled fields such as `id`, `status`, `createdAt`, and `updatedAt` are generated automatically.

### PATCH /api/tasks/:id

Update an existing task.

Accepted fields currently include:

- `status`
- `description`
- `notes`
- `screenshot`
- `feedback`
- `intent`
- `action`
- `context`
- `viewport`
- `color_scheme`
- `interaction_history`
- `element_context`
- `data_context`
- `screenshot_meta`
- `mfe`
- `agent_feedback`
- `blocked_reason`
- `resolution`

Valid statuses:

- `pending`
- `in_progress`
- `applied`
- `review`
- `accepted`
- `denied`
- `needs_info`
- `blocked`

Typical lifecycle:

```text
pending -> in_progress -> review -> accepted | denied
                           \-> needs_info
                           \-> blocked
```

Notes:

- `questions` are represented on the stored task as `agent_feedback`
- `blocked_reason` records why a task could not be completed
- `resolution` records a short completion note when an agent moves a task to `review`
- transitions are validated server-side

### DELETE /api/tasks/:id

Deletes a task and its screenshot, if present.

### GET /api/design-spec

Returns the current design spec from `.annotask/design-spec.json`.

### GET /api/components

Returns the detected component-library catalog including libraries, components, props, slots, events, tags, and descriptions.

### GET /api/component-usage

Returns the project usage index for detected components.

### GET /api/component-examples/:name

Returns real in-repo usage examples for a component name.

Query params:

- `limit` default `3`, max `10`

### GET /api/code-context/:taskId

Resolves a task's current source excerpt, enclosing symbol, import block, and excerpt hash.

Query params:

- `context_lines` default `15`, max `200`

### GET /api/source-excerpt

Direct file-and-line source excerpt helper used by the shell.

Query params:

- `file` required
- `line` default `1`
- `context_lines` default `15`, max `200`

### GET /api/data-context/:taskId

Returns stored `data_context` for a task or resolves it on demand.

### GET /api/data-context/probe

Lightweight capability probe used by the shell to decide whether data context is worth offering.

Query params:

- `file` required

### GET /api/data-context/resolve

Resolve file-and-line data context.

Query params:

- `file` required
- `line` optional

### GET /api/data-context/element

Resolve element-focused data context for a file and line.

Query params:

- `file` required
- `line` optional

### GET /api/data-sources

Returns the project data-source catalog plus detected libraries.

Query params:

- `kind`
- `library`
- `search`
- `used_only=true|1`

### GET /api/data-source-examples/:name

Returns real in-repo usage examples for a data source.

Query params:

- `kind`
- `limit` default `3`, max `10`

### GET /api/data-source-details/:name

Returns definition-level detail for a project data source.

Query params:

- `kind`
- `file`
- `context_lines` default `15`, max `40`

### GET /api/data-source-bindings/:name

Returns the binding graph used by the shell's page-highlighting overlays.

### GET /api/api-schemas

Returns the discovered API schema catalog.

Sources can include OpenAPI, GraphQL, tRPC, and JSON Schema.

Query params:

- `kind`
- `detail=true|1`

### GET /api/api-operation

Returns one API operation by path, optionally narrowed by method and schema location.

Query params:

- `path` required
- `method`
- `schema_location`

### GET /api/resolve-endpoint

Matches a concrete URL to the discovered schema catalog.

Query params:

- `url` required
- `method`

### GET /api/performance

Returns the latest performance snapshot stored by the shell.

### POST /api/performance

Stores a performance snapshot. Used by the shell.

### POST /api/screenshots

Upload a base64-encoded PNG screenshot.

Current limit: 4 MB.

### GET /screenshots/:filename

Serves a stored screenshot.

### GET /api/status

Health check endpoint.

## WebSocket

Connect to `/__annotask/ws`.

### Server -> client events

| Event | Payload |
|-------|---------|
| `report:updated` | Full `AnnotaskReport` |
| `report:current` | Full `AnnotaskReport` |
| `changes:cleared` | `null` |

### Client -> server events

| Event | Payload |
|-------|---------|
| `report:updated` | Full `AnnotaskReport` |
| `changes:cleared` | `{}` |
| `get:report` | `{}` |

Messages are JSON objects with `event`, `data`, and `timestamp`.

## MCP Server

`POST /__annotask/mcp` implements Streamable HTTP MCP with JSON-RPC 2.0.

Current tool surface:

| Tool | Purpose |
|------|---------|
| `annotask_get_tasks` | List task summaries or full tasks |
| `annotask_get_task` | Fetch one full task |
| `annotask_update_task` | Transition status, set resolution, ask questions, or mark blocked |
| `annotask_create_task` | Create a pending task |
| `annotask_delete_task` | Delete a task and screenshot |
| `annotask_get_design_spec` | Design-spec summary or category slice |
| `annotask_get_components` | Search detected component libraries |
| `annotask_get_component` | Full detail for one component |
| `annotask_get_component_examples` | Real in-repo component usages |
| `annotask_get_screenshot` | Fetch a screenshot as base64 PNG |
| `annotask_get_code_context` | Ground a task to current source |
| `annotask_get_data_context` | Resolve task data context |
| `annotask_get_data_sources` | Project data-source catalog |
| `annotask_get_data_source_examples` | Real in-repo data-source usages |
| `annotask_get_data_source_details` | Definition-level data-source detail |
| `annotask_get_api_schemas` | Discovered schema catalog |
| `annotask_get_api_operation` | One API operation by path |
| `annotask_resolve_endpoint` | Resolve a concrete URL to a known operation |

## Change Types

The live report's `changes[]` union currently includes:

- `style_update`
- `class_update`
- `scoped_style_update` experimental
- `prop_update` experimental
- `component_insert`
- `component_move`
- `component_delete` experimental
- `annotation`
- `section_request`

See `src/schema.ts` for the canonical TypeScript definitions.
