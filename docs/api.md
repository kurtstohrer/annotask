# API Reference

Annotask serves its local API under `/__annotask/` in development.

## Transport Rules

- CORS is limited to local origins such as `localhost`, `127.0.0.1`, and `::1`
- mutating requests from non-local origins are rejected
- request bodies are capped at 4 MiB
- screenshots are served from `/__annotask/screenshots/*` outside the `/api` namespace

## Error Shape

HTTP errors use:

```json
{
  "error": {
    "code": "validation_failed",
    "message": "status: Invalid status. Must be one of: pending, in_progress, applied, review, accepted, denied, needs_info, blocked"
  }
}
```

Current error codes:

- `invalid_json`
- `body_too_large`
- `body_not_object`
- `validation_failed`
- `invalid_transition`
- `forbidden_origin`
- `not_found`
- `missing_field`

## Task Model

Canonical task types:

- `annotation`
- `section_request`
- `style_update`
- `theme_update`
- `a11y_fix`
- `error_fix`
- `perf_fix`
- `api_update`

Statuses:

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

`applied` is also a valid intermediate status.

## HTTP Endpoints

### Core

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/__annotask/api/status` | health check |
| `GET` | `/__annotask/api/report` | current live change report |
| `GET` | `/__annotask/api/config` | current design-spec-backed config payload |
| `GET` | `/__annotask/api/design-spec` | current design spec |
| `GET` | `/__annotask/api/performance` | latest stored performance snapshot |
| `POST` | `/__annotask/api/performance` | store a performance snapshot |

Notes:

- `report` supports `?mfe=NAME`
- `report` can include `performance` when a snapshot exists

### Tasks

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/__annotask/api/tasks` | list tasks |
| `POST` | `/__annotask/api/tasks` | create a task |
| `GET` | `/__annotask/api/tasks/:id` | fetch one task |
| `PATCH` | `/__annotask/api/tasks/:id` | update a task |
| `DELETE` | `/__annotask/api/tasks/:id` | delete a task |

`GET /tasks` supports `?mfe=NAME`.

`POST /tasks` accepts these user-settable fields:

- `type`
- `description`
- `file`
- `line`
- `component`
- `mfe`
- `route`
- `intent`
- `action`
- `context`
- `viewport`
- `color_scheme`
- `interaction_history`
- `data_context`
- `screenshot`
- `screenshot_meta`
- `visual`

Server-controlled fields such as `id`, `status`, `createdAt`, and `updatedAt` are generated automatically.

`PATCH /tasks/:id` currently accepts:

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
- `data_context`
- `screenshot_meta`
- `mfe`
- `agent_feedback`
- `blocked_reason`
- `resolution`

Transitions are validated server-side.

### Screenshots

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/__annotask/api/screenshots` | upload a base64 PNG |
| `GET` | `/__annotask/screenshots/:filename` | fetch a stored screenshot |

Screenshot uploads must be PNG data URLs and are limited to 4 MiB.

### Components And Workspace

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/__annotask/api/components` | detected component libraries |
| `GET` | `/__annotask/api/component-usage` | project usage index for detected components |
| `GET` | `/__annotask/api/component-examples/:name` | real in-repo usage examples |
| `GET` | `/__annotask/api/workspace` | workspace packages and discovered MFE ids |

`workspace` omits internal absolute paths and returns workspace-relative package dirs.

### Code Context

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/__annotask/api/code-context/:taskId` | source excerpt for a task |
| `GET` | `/__annotask/api/source-excerpt` | direct file-and-line excerpt |

Query params:

- `context_lines` defaults to `15`, max `200`
- `source-excerpt` also accepts `file` and `line`

### Data And Bindings

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/__annotask/api/data-context/:taskId` | stored or freshly resolved task data context |
| `GET` | `/__annotask/api/data-context/probe` | quick probe for whether data context is worth offering |
| `GET` | `/__annotask/api/data-context/resolve` | resolve file-and-line data context |
| `GET` | `/__annotask/api/data-context/element` | resolve element-focused data context |
| `GET` | `/__annotask/api/data-sources` | project data-source catalog |
| `GET` | `/__annotask/api/data-source-examples/:name` | in-repo usages for a data source |
| `GET` | `/__annotask/api/data-source-details/:name` | definition-level detail for a data source |
| `GET` | `/__annotask/api/data-source-bindings/:name` | binding graph used for page highlights |

Useful query params:

- `kind`
- `library`
- `search`
- `used_only=true|1`
- `limit`
- `file`
- `context_lines`

### API Schemas

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/__annotask/api/api-schemas` | discovered schema catalog |
| `GET` | `/__annotask/api/api-operation` | one operation by path |
| `GET` | `/__annotask/api/resolve-endpoint` | best-match operation for a concrete URL |

Schema sources can include:

- OpenAPI
- GraphQL
- tRPC
- JSON Schema

Useful query params:

- `kind`
- `detail=true|1`
- `path`
- `method`
- `schema_location`
- `url`

## WebSocket

Connect to `ws://localhost:<port>/__annotask/ws`.

Messages are JSON objects with `event`, `data`, and `timestamp`.

Server-to-client events:

| Event | Payload |
|-------|---------|
| `report:updated` | full `AnnotaskReport` |
| `report:current` | full `AnnotaskReport` |
| `changes:cleared` | `null` |
| `tasks:updated` | task list payload |
| `designspec:updated` | `null` |

Client-to-server events:

| Event | Payload |
|-------|---------|
| `report:updated` | full `AnnotaskReport` |
| `changes:cleared` | `{}` |
| `get:report` | `{}` |

## MCP

`POST /__annotask/mcp` implements Streamable HTTP MCP over JSON-RPC 2.0.

Current tool surface:

- `annotask_get_tasks`
- `annotask_get_task`
- `annotask_update_task`
- `annotask_create_task`
- `annotask_delete_task`
- `annotask_get_design_spec`
- `annotask_get_components`
- `annotask_get_component`
- `annotask_get_screenshot`
- `annotask_get_code_context`
- `annotask_get_component_examples`
- `annotask_get_data_context`
- `annotask_get_data_sources`
- `annotask_get_api_schemas`
- `annotask_get_api_operation`
- `annotask_resolve_endpoint`
- `annotask_get_data_source_examples`
- `annotask_get_data_source_details`

Behavior differences from raw HTTP:

- task lists return summaries by default
- the shell-only `visual` field is stripped
- older `agent_feedback` entries are trimmed from single-task reads
- arguments are validated at the tool boundary

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

The canonical definitions live in `src/schema.ts`.
