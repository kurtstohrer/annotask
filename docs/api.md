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
- `origin_port_mismatch` (agent spawn routes only — origin must match the server's own port)
- `not_found`
- `missing_field`
- `invalid_id`
- `invalid_body`

## Task Model

Canonical task types:

- `annotation`
- `section_request`
- `style_update`
- `theme_update`
- `a11y_fix`
- `error_fix`
- `perf_fix`
- `wireframe_apply` — created by the wireframe palette's "Build this route" or by the design-session apply path ("Apply now" / "Implement this wireframe"). `context.wireframe` carries `{ route, instances[] }`; each instance has an `anchor` (`file`, `line`, `position`, `component`, `targetTag`) and an `inserted` payload (`tag`, `componentName`, `library`, `module`, `props`, `classes`, `text_content`). `context.session` (when present) carries `{ session_id, entries[] }` — the design-session edits and/or wireframe directions. Applied via the `WIREFRAME_APPLY.md` companion playbook.

There is no dedicated task type for backend-contract work; it surfaces as `annotation` tasks grounded with `data_context` and runtime-endpoint evidence.

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
| `GET` | `/__annotask/api/system-prompt` | composed embedded-agent system prompt (`?task_type=` adds the matching companion playbook) |
| `GET` | `/__annotask/api/style-guide` | contents of `.annotask/STYLE_GUIDE.md` (init wizard review step) |
| `GET` | `/__annotask/api/read-file` | read one project file by relative `?path=` (traversal-guarded to the project root) |
| `DELETE` | `/__annotask/api/session-reset` | clear the `.annotask/.session-reset` sentinel after the shell wipes localStorage |

Notes:

- `report` supports `?mfe=NAME`
- `report` can include `performance` when a snapshot exists
- `status` reports `sessionReset: true` while the `.session-reset` sentinel exists on disk

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
| `GET` | `/__annotask/api/data-sources` | project data-source catalog (`?include_runtime=true` to append the runtime-observed catalog) |
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
- `include_runtime=true|1` (`data-sources`)

### Runtime Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/__annotask/api/runtime-endpoints` | aggregated runtime-observed endpoints (iframe fetch/XHR/beacon calls) |
| `POST` | `/__annotask/api/runtime-endpoints` | ingest iframe network-call observations |
| `DELETE` | `/__annotask/api/runtime-endpoints` | clear the runtime catalog |

Useful query params:

- `merge_static=true|1` — enrich rows with matching static sources and OpenAPI operations
- `route=PATH` — filter to endpoints observed on a specific iframe route
- `orphans_only=true|1` — only rows with no matching static source (surfaces gaps the static scanner missed)

### Task Sidecars

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/__annotask/api/tasks/:id/interaction-history` | per-task pre-task user-trace sidecar (route + ~20 recent actions) |
| `POST` | `/__annotask/api/tasks/:id/interaction-history` | write the sidecar for a task |
| `GET` | `/__annotask/api/tasks/:id/rendered-html` | per-task `outerHTML` snapshot of the selected element (200 KB cap) |
| `POST` | `/__annotask/api/tasks/:id/rendered-html` | write the sidecar for a task |

Both sidecars are written server-side on task create whenever the shell has them. The in-shell "Embed" toggles only decide whether the payload rides inside the task JSON; when unembedded, agents retrieve from the sidecar endpoint. Rendered-HTML reads include a `source` field (`embedded` vs `sidecar`) and fall back to `{ rendered: null, not_captured: true }` when the task has no selection.

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

### Wireframe

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/__annotask/api/wireframe` | full multi-route wireframe document, or one route's slice with `?route=PATH` |
| `PUT` | `/__annotask/api/wireframe` | replace the whole document (the shell owns the in-memory merge) |
| `POST` | `/__annotask/api/wireframe-snapshots` | upload a canvas block PNG (`{id, data}`; id-addressed, 4MB cap) |
| `GET` | `/__annotask/wireframe-snapshots/:filename` | serve a canvas snapshot PNG (containment-guarded) |
| `DELETE` | `/__annotask/api/wireframe-snapshots/:filename` | drop a canvas snapshot PNG |
| `GET` `PUT` `DELETE` | `/__annotask/api/design-session` | design-session journal (CAS on `rev`, 409 on stale writes); DELETE discards the journal, session-created placements, and every route's canvas sketch |
| `POST` | `/__annotask/api/design-session/apply` | snapshot the touched files and mint one `wireframe_apply` task (placements + design-session edits/directions); the embedded agent then writes source |
| `POST` | `/__annotask/api/design-session/undo-batch` | restore the newest apply batch's pre-apply bytes (hash-guarded) |
| `POST` | `/__annotask/api/design-session/detach-file` | diverged-file resolution: keep the disk bytes, drop the file from the session |
| `GET` | `/__annotask/api/design-session/snapshots` | snapshot-engine state (touched files, divergence, apply batches) |

The document persists to `.annotask/wireframe.json` and is shape-validated (`{ version: "1.0", updatedAt, routes[] }`) on PUT. Snapshot PNGs live in `.annotask/wireframe-snapshots/` (orphans GC'd at boot). The design-session journal persists to `.annotask/design-session.json`; "Apply now" / "Implement this wireframe" snapshots the touched files first so undo/discard stays byte-exact — the agent writes source, the tool only snapshots and restores.

### Agent Configs

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/__annotask/api/agent-configs` | per-persona project directions and provider preferences from `.annotask/agents.json` |
| `PATCH` | `/__annotask/api/agent-configs/:id` | update one persona's `projectDirections`, `providerId`, `model`, or `effort` |

### Embedded Agent

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/__annotask/api/agent/spawn` | spawn an allow-listed local CLI (claude / codex / opencode / copilot) and stream stdout/stderr back as SSE |
| `DELETE` | `/__annotask/api/agent/spawn/:runId` | abort a running spawn by run id |
| `GET` | `/__annotask/api/agent/detect` | detect which local CLIs are installed and logged in |
| `GET` | `/__annotask/api/agent/models` | per-provider model catalog for `?cli=ID` (`?refresh=1` bypasses the 5-min cache) |

The spawn routes enforce a stricter same-port origin check on top of the general localhost gate — a page on a different localhost port cannot spawn CLIs that have credential access (`origin_port_mismatch`). When `ANNOTASK_MAX_PERMISSION` is set to `plan` or `default`, the server refuses any spawn that exceeds it. The default is no ceiling (`bypass`).

### Task Conversations

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/__annotask/api/tasks/:id/messages` | full per-task conversation snapshot (optional `?after=<id>`) |
| `POST` | `/__annotask/api/tasks/:id/messages` | append a message; broadcasts to subscribers |
| `GET` | `/__annotask/api/tasks/:id/messages/stream` | SSE stream; honours `Last-Event-ID` for resume |
| `PATCH` | `/__annotask/api/tasks/:id/messages/:msgId` | update a message in place (used to flush a partial assistant turn while it streams) |

Threads persist as append-only JSONL at `.annotask/conversations/<taskId>.jsonl`.

### Usage

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/__annotask/api/usage` | aggregate token-usage totals, per-scope and per-provider, from `.annotask/usage.jsonl` |
| `GET` | `/__annotask/api/usage/recent` | most recent usage entries, newest first (`?limit=N`, default 50, max 500) |

### Init Wizard

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/__annotask/api/init/state` | current init-runner state |
| `GET` | `/__annotask/api/init/scan-targets` | existence + mtime of the durable scan artifacts (`design-spec.json`, `agents.json`) |
| `POST` | `/__annotask/api/init/start` | start an init scan (body can skip individual scanners and pin provider/model/effort) |
| `POST` | `/__annotask/api/init/cancel` | cancel a running scan |
| `POST` | `/__annotask/api/init/skip` | mark the project initialized without committing token data |
| `POST` | `/__annotask/api/init/commit` | commit the reviewed spec (and optionally a style guide) to `.annotask/` |

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
| `components:updated` | `{ scannedAt }` — a background component scan landed a fresh catalog |
| `init:progress` | init-runner step state for the wizard |
| `runtime-endpoints:updated` | current runtime endpoint catalog |
| `wireframe:updated` | saved wireframe document (`null` when invalidated from disk) |
| `session:updated` | `null` — broadcast when `.annotask/design-session.json` changes |

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
- `annotask_get_interaction_history`
- `annotask_get_rendered_html`
- `annotask_get_data_sources`
- `annotask_get_runtime_endpoints`
- `annotask_get_api_schemas`
- `annotask_get_api_operation`
- `annotask_resolve_endpoint`
- `annotask_get_data_source_examples`
- `annotask_get_data_source_details`
- `annotask_get_source_excerpt`
- `annotask_get_binding_classification`
- `annotask_get_playbook`
- `annotask_get_agent_directions`
- `annotask_conversation_read`
- `annotask_conversation_post`
- `annotask_conversation_subscribe`

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
- `component_prop_update` experimental
- `component_insert`
- `component_move` legacy — no longer emitted (the Reposition tool was removed); agents still apply it from older reports
- `component_delete` experimental
- `annotation`
- `section_request` legacy — no longer emitted (sections are wireframe sketch material riding `wireframe_apply` add directions)

The canonical definitions live in `src/schema.ts`.
