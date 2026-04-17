# API Reference

All endpoints are served by the dev server (Vite or Webpack) at `/__annotask/`. They are only available in dev mode.

CORS is restricted to localhost origins (`localhost`, `127.0.0.1`, `::1`). Mutating requests (POST, PATCH, DELETE) from non-local origins are rejected with `403 Forbidden`.

## HTTP Endpoints

### GET /api/report

Returns the current change report. Supports `?mfe=NAME` to filter changes by MFE identity.

**Response:**
```json
{
  "version": "1.0",
  "project": {
    "framework": "vue",
    "styling": ["scoped-css"],
    "root": "/absolute/path/to/project"
  },
  "changes": [
    {
      "id": "change-1",
      "type": "style_update",
      "description": "Changed background-color on div",
      "file": "src/components/Header.vue",
      "section": "template",
      "line": 5,
      "component": "Header",
      "element": "div",
      "property": "background-color",
      "before": "rgb(255, 255, 255)",
      "after": "#1a1a2e"
    }
  ]
}
```

### GET /api/tasks

Returns all tasks in the pipeline.

**Response:**
```json
{
  "version": "1.0",
  "tasks": [
    {
      "id": "task-abc",
      "type": "annotation",
      "status": "pending",
      "description": "Make header text larger",
      "file": "src/components/Header.vue",
      "line": 3,
      "component": "Header",
      "intent": "Increase the heading font size to 2rem",
      "action": "text_edit",
      "context": { "element_tag": "h1" },
      "createdAt": 1711612800000,
      "updatedAt": 1711612800000
    }
  ]
}
```

### GET /api/tasks/:id

Returns the full task object for a single task by ID, including `context`, `element_context`, `interaction_history`, `agent_feedback`, and any other stored fields.

**Response:** the task object, or `404` if not found.

### POST /api/tasks

Create a new task.

**Request body:**
```json
{
  "type": "annotation",
  "description": "Add padding to card",
  "file": "src/components/Card.vue",
  "line": 2,
  "intent": "Add 16px padding to the card container"
}
```

**Response:** `201` with the created task object.

### PATCH /api/tasks/:id

Update a task's status, description, or other fields.

Only whitelisted fields are accepted: `status`, `description`, `notes`, `screenshot`, `feedback`, `intent`, `action`, `context`, `viewport`, `interaction_history`, `element_context`, `mfe`. Unknown fields are silently dropped.

**Request body (lock for agent work):**
```json
{ "status": "in_progress" }
```

**Request body (mark for review):**
```json
{ "status": "review" }
```

**Request body (deny with feedback and screenshot):**
```json
{
  "status": "denied",
  "feedback": "The color should be darker, closer to #0a0a1e",
  "screenshot": "screenshot-1711800000-ab3kf.png"
}
```

**Request body (edit description):**
```json
{ "description": "Updated task description with **markdown** support" }
```

**Valid statuses:** `pending`, `in_progress`, `applied`, `review`, `accepted`, `denied`, `needs_info`, `blocked`

**Typical lifecycle:**
```
pending → in_progress (agent locks) → review (agent done) → accepted (removed) or denied (with feedback)
```

`needs_info` is auto-set when an agent sends `questions` on a PATCH. `blocked` is auto-set when an agent sends `blocked_reason`.

Screenshots: max 4MB, uploaded via POST /api/screenshots.

### DELETE /api/tasks/:id

Delete a task and clean up its associated screenshot.

**Response:** `200` with `{ "deleted": true }`.

### POST /api/screenshots

Upload a screenshot (base64-encoded PNG, max 4MB).

**Request body:**
```json
{ "data": "data:image/png;base64,..." }
```

**Response:** `201` with `{ "filename": "screenshot-1711800000-ab3kf.png" }`.

### GET /screenshots/:filename

Serve a previously uploaded screenshot file.

### GET /api/design-spec

Returns the current design spec (from `.annotask/design-spec.json`).

### GET /api/config

Deprecated. Backward-compatible wrapper — use `/api/design-spec` instead.

### GET /api/components

Returns the component library catalog detected for the project, including props, types, defaults, slots, events, and descriptions. See [component-discovery.md](component-discovery.md) for the extraction details.

### GET /api/performance

Returns the latest performance snapshot captured by the shell (Web Vitals, DOM stats, resource timings, bundle analysis).

### POST /api/performance

Store a new performance snapshot. Called by the shell's perf monitor; not intended for external callers.

### GET /api/status

Health check. Returns `{ "status": "ok", "version": "<package-version>" }` when the server is running. Used by `annotask status` and by stdio MCP proxies to verify the dev server is up.

## WebSocket

Connect to `ws://localhost:5173/__annotask/ws`.

### Events (server → client)

| Event | Payload | When |
|-------|---------|------|
| `report:updated` | Full `AnnotaskReport` | A change was made in the shell (broadcast to other clients) |
| `report:current` | Full `AnnotaskReport` | On connection (if data exists) or in response to `get:report` |
| `changes:cleared` | `null` | All changes were cleared |

### Events (client → server)

| Event | Payload | Purpose |
|-------|---------|---------|
| `report:updated` | Full `AnnotaskReport` | Client reports new changes |
| `changes:cleared` | `{}` | Client cleared all changes |
| `get:report` | `{}` | Request the current report |

### Message format

All messages are JSON with `event`, `data`, and `timestamp` fields:
```json
{
  "event": "report:updated",
  "data": { ... },
  "timestamp": 1711612800000
}
```

## Change types

The `changes` array in a report can contain these types:

| Type | Description | Key fields |
|------|-------------|------------|
| `style_update` | Inline style change | `property`, `before`, `after` |
| `class_update` | CSS class change | `before.classes`, `after.classes` |
| `annotation` | Design intent note | `intent`, `action?`, `context?` |
| `section_request` | Drawn area for new content | `prompt`, `position`, `dimensions` |
| `component_insert` | New element added | `component.tag`, `insert_position` |
| `component_move` | Element reordered | `element`, `move_to` |
| `scoped_style_update` | Scoped CSS change (experimental) | `selector`, `before`, `after` |
| `prop_update` | Component prop change (experimental) | `before`, `after` |
| `component_delete` | Element removed (experimental) | `element` |

See `src/schema.ts` for full TypeScript definitions.

## MCP Server

`POST /__annotask/mcp` — [Streamable HTTP transport](https://modelcontextprotocol.io/specification/2025-03-26/basic/transports#streamable-http). Accepts JSON-RPC 2.0 requests, returns tool results. This is the recommended way for AI agents to interact with Annotask.

Available tools:

| Tool | Description |
|------|-------------|
| `annotask_get_tasks` | List task summaries (supports `status` and `mfe` filters; `detail=true` for full objects) |
| `annotask_get_task` | Get full detail for a single task by ID (context, element_context, agent_feedback) |
| `annotask_create_task` | Create a new pending task |
| `annotask_update_task` | Transition status, set resolution, ask questions, mark blocked |
| `annotask_delete_task` | Delete a task and clean up its screenshot |
| `annotask_get_design_spec` | Design spec summary, or full tokens for a `category` (colors, typography, etc.) |
| `annotask_get_components` | Search component libraries by name (up to 20 results per library) |
| `annotask_get_component` | Full detail for one component by name (disambiguates across libraries) |
| `annotask_get_screenshot` | Task screenshot as base64 PNG |
