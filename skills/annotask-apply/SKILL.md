# annotask-apply

Apply pending Annotask design tasks to the source code.

## When to use

Use this skill when the user says:
- "apply the Annotask changes"
- "apply my design changes"
- "sync Annotask"
- `/annotask-apply`

## How it works

Annotask is a visual markup tool that integrates with Vite and Webpack. The user annotates the page with pins, sticky notes, arrows, text highlights, and drawn sections. These become **tasks** stored in `.annotask/tasks.json` and served via API. This skill fetches pending tasks, applies them, and marks them for review.

## Steps

### 0. Check server status

```bash
annotask status
```

If this fails, the Annotask dev server isn't running. Ask the user to start it.

### 1. Fetch pending tasks

```bash
annotask tasks
```

Response:
```json
{
  "version": "1.0",
  "tasks": [
    {
      "id": "task-123",
      "type": "annotation",
      "status": "pending",
      "description": "Change the header background to match the new brand colors",
      "file": "src/components/Header.vue",
      "line": 5,
      "action": "text_edit",
      "context": { "element_tag": "header" },
      "screenshot": "screenshot-1711800000-ab3kf.png"
    }
  ]
}
```

Each task has: `id`, `type`, `status`, `description` (what to do), `file`, `line`, `component`, and optionally `action`, `context` with element details, and `screenshot` with a filename.

### Screenshot reference

Some tasks include a `screenshot` field. The screenshot shows exactly what the user sees in the browser. To view it:

```bash
annotask screenshot TASK_ID
```

This downloads the PNG to `.annotask/screenshots/`. Use it as visual context alongside the task description and source code.

### 2. Process each pending task — one at a time

Filter for `status: "pending"` (and `status: "denied"` with `feedback`) tasks. Process them **sequentially** — do not batch. For each task, follow this cycle:

#### a. Lock the task

Mark it `in_progress` so the user sees you're working on it:

```bash
annotask update-task TASK_ID --status=in_progress
```

#### b. Apply the change

Read the task type and apply accordingly:

- **`annotation` with `action: "text_edit"`**: The `description` field says what text to change. Find the text in the source file and apply the edit.

- **`annotation` with other actions** (`add_column`, `add_row`, `wrap_container`, `delete`, `duplicate`, `move_up`, `move_down`): Apply the structural change described in `description`.

- **`annotation` with no action**: This is a free-text note. Read `description` and apply your best judgment to the source code. If `context.to_element` is present, this is an arrow annotation referencing two elements.

- **`style_update`**: Apply CSS property changes. The `context.changes` array contains each change with `property`, `before`, and `after` values. Use scoped styles, inline styles, or Tailwind classes based on project patterns.

- **`section_request`**: Create a new section in the template near the referenced element. The `description` field describes what content to create. `placement` gives spatial hints.

- **`a11y_fix`**: Fix an accessibility violation. The `context` contains `rule` (axe rule ID), `impact`, `help` (what to fix), `helpUrl` (WCAG reference), and `elements` array with `html` snippets, `selector`, `fix` suggestions, and source `file`/`line`/`component`.

- **`theme_update`**: A design token value change from the Theme page. The `context` object contains:
  - `category`: which token category (`colors`, `typography.families`, `typography.scale`, `spacing`, `borders.radius`)
  - `role`: semantic role name (e.g., `primary`, `background`, `heading`)
  - `before`: old value (`null` if this is a new token)
  - `after`: new value
  - `cssVar`: CSS variable name if backed by one (e.g., `--color-primary`)
  - `sourceFile` / `sourceLine`: where the current value is defined
  - `styling`: array of project styling methods (e.g., `["tailwind", "scoped-css"]`)
  - `isNew`: `true` if this is a brand-new token being added

  **How to apply:**
  - If `cssVar` is set and `sourceFile` is provided: find the CSS variable declaration in the source file and update its value.
  - If the source references a Tailwind config: update the corresponding key in `tailwind.config.*`.
  - If `isNew` is true: add the new variable/config entry in the most appropriate location (`:root` block in the main CSS file, or Tailwind config `theme.extend`).
  - After applying, update `.annotask/design-spec.json` to reflect the new value so the Theme page stays in sync.

#### c. Mark for review immediately

As soon as you finish applying **this** task, mark it for review before moving to the next:

```bash
annotask update-task TASK_ID --status=review
```

The user sees the status change live in the Annotask shell and can start reviewing while you work on the next task.

#### d. Move to the next task

Repeat steps a–c for each remaining pending task. This way the user gets incremental feedback — they can accept or deny early tasks while later ones are still being applied.

### 3. Report to the user

Tell the user:
- Which tasks were applied
- Which files were modified
- Any tasks that couldn't be applied (and why)

The user will review changes in Annotask and either **accept** (task removed) or **deny with feedback** (task stays denied for next apply).

### Denied tasks

Tasks with `status: "denied"` and a `feedback` field were rejected by the user. They are processed alongside pending tasks in step 2. Read the `feedback` carefully to understand what went wrong and re-apply with corrections.

## Also check the live report

```bash
annotask report
```

This returns both the live report (current session markup) and tasks. Use it as additional context — it shows what's on the user's screen right now. But tasks are the source of truth for what to apply.

## Task lifecycle

```
pending → in_progress (agent working) → review (user checks) → accepted (removed)
                                                              → denied (with feedback → agent re-applies)
```

## Important notes

- Always fetch tasks, not just the report — tasks persist across sessions
- The `feedback` field on denied tasks is critical — it tells you what the user didn't like
- Tasks with `status: "review"` are waiting for user review — don't re-apply them
- After applying, the user's page will hot-reload via Vite HMR showing the changes immediately
