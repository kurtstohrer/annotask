# API Reference

All endpoints are served by the dev server (Vite or Webpack) at `/__annotask/`. They are only available in dev mode.

## HTTP Endpoints

### GET /api/report

Returns the current change report.

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

Update a task's status or add feedback.

**Request body (mark for review):**
```json
{ "status": "review" }
```

**Request body (deny with feedback):**
```json
{
  "status": "denied",
  "feedback": "The color should be darker, closer to #0a0a1e"
}
```

**Valid status transitions:**
- `pending` → `applied` → `review` → `accepted` or `denied`
- `denied` tasks return to `pending` for re-processing

### GET /api/design-spec

Returns the current design spec (from `.annotask/design-spec.json`).

### GET /api/config

Deprecated. Backward-compatible wrapper — use `/api/design-spec` instead.

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
