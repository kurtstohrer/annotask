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

## MCP preference

If you have `annotask_*` MCP tools available, prefer them over CLI commands — they return structured data directly, are faster, and avoid shell/npx issues. If MCP tools are not available, use the CLI commands shown below.

## Steps

### 0. Check server status

**MCP:** If you have MCP tools, the server is already running — skip this step.

```bash
npx annotask status
```

If this fails, the Annotask dev server isn't running. Ask the user to start it.

### 1. Fetch pending tasks

**MCP:** `annotask_get_tasks(status: "pending")` — returns compact summaries. Use `detail: true` for full objects.

```bash
npx annotask tasks
```

Response (compact task summaries):
```json
{"version":"1.0","count":1,"tasks":[{"id":"task-123","type":"annotation","status":"pending","description":"Change the header background to match the new brand colors","file":"src/components/Header.vue","line":5,"action":"text_edit","screenshot":"screenshot-1711800000-ab3kf.png"}]}
```

Each task summary has: `id`, `type`, `status`, `description`, `file`, `line`, and optionally `component`, `action`, `screenshot`, `feedback` (on denied tasks), `blocked_reason`, `resolution`.

For full task details (context, element_context, viewport, interaction_history, agent_feedback), use `annotask_get_task` MCP tool or `npx annotask tasks --pretty`. Only fetch full details when the summary doesn't provide enough context to apply the change.

### Screenshot reference

Some tasks include a `screenshot` field. The screenshot shows exactly what the user sees in the browser. To view it:

**MCP:** `annotask_get_screenshot(task_id: "TASK_ID")` — returns base64-encoded PNG directly.

```bash
npx annotask screenshot TASK_ID
```

This downloads the PNG to `.annotask/screenshots/`. Use it as visual context alongside the task description and source code.

### 2. Process each pending task — one at a time

Filter for `status: "pending"` and `status: "denied"` (with `feedback`) tasks. Also check for `status: "in_progress"` tasks that have answers in `agent_feedback` (previously asked questions now answered). Skip `needs_info` tasks — they're waiting for user input. Process them **sequentially** — do not batch. For each task, follow this cycle:

#### a. Lock the task

Mark it `in_progress` so the user sees you're working on it:

**MCP:** `annotask_update_task(task_id: "TASK_ID", status: "in_progress")`

```bash
npx annotask update-task TASK_ID --status=in_progress
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

#### c. Ask for clarification (only when stuck)

If you are **genuinely stuck** — missing API context, unclear library usage, ambiguous intent that could lead to a wrong implementation — ask the user for clarification instead of guessing:

**MCP:** `annotask_update_task(task_id: "TASK_ID", questions: [{"id":"q1","text":"Which auth library should I use?","type":"choice","options":["NextAuth","Clerk","Custom"]},{"id":"q2","text":"Where is the session config located?","type":"text"}])`

```bash
npx annotask update-task TASK_ID --ask='{"message":"Optional markdown context","questions":[{"id":"q1","text":"Which auth library should I use?","type":"choice","options":["NextAuth","Clerk","Custom"]},{"id":"q2","text":"Where is the session config located?","type":"text"}]}'
```

This sets the task to `needs_info` status. The user sees your questions in the Annotask UI and responds there. When answered, the task returns to `in_progress` with answers in `agent_feedback`.

**Question types:**
- `text` — free-text answer from user
- `choice` — user picks from your provided `options` array

**Guidelines:**
- Only ask when you truly cannot proceed — do not ask for confirmation on straightforward tasks
- Be specific: "Which CSS framework should I use for the grid?" is better than "How should I do this?"
- Combine related questions into a single ask rather than multiple rounds
- After asking, move on to the next task. Come back to check answers later via `annotask_get_tasks` MCP tool or `npx annotask tasks`

#### d. Mark as blocked (when the task can't be done)

If the task is **fundamentally outside your control** — a performance issue in a third-party library, an accessibility bug in a dependency, a config change that requires infrastructure access, etc. — mark it as blocked with an explanation:

**MCP:** `annotask_update_task(task_id: "TASK_ID", blocked_reason: "This layout shift is caused by vue-router v4's async route loading. Needs upstream fix or a loading skeleton wrapper — cannot be resolved by editing component code alone.")`

```bash
npx annotask update-task TASK_ID --blocked-reason="This layout shift is caused by vue-router v4's async route loading. Needs upstream fix or a loading skeleton wrapper — cannot be resolved by editing component code alone."
```

This sets the task to `blocked` status automatically. The user sees your explanation and can either **dismiss** the task or **push back** (deny it with feedback asking you to try a different approach).

**When to use blocked vs needs_info:**
- `needs_info` = "I can do this, but I need more information from you"
- `blocked` = "This can't be done through source code changes — here's why"

#### e. Mark for review immediately

As soon as you finish applying **this** task, mark it for review with a brief resolution note:

**MCP:** `annotask_update_task(task_id: "TASK_ID", status: "review", resolution: "Swapped grid to flexbox, added gap-4 for spacing")`

```bash
npx annotask update-task TASK_ID --status=review --resolution="Swapped grid to flexbox, added gap-4 for spacing"
```

Keep resolutions short — one sentence describing what you changed, not why. The user sees it in the Annotask shell alongside the diff.

#### f. Move to the next task

Repeat steps a–c for each remaining pending task. This way the user gets incremental feedback — they can accept or deny early tasks while later ones are still being applied.

### 3. Report to the user

Tell the user:
- Which tasks were applied
- Which files were modified
- Any tasks that couldn't be applied (and why)

The user will review changes in Annotask and either **accept** (task removed) or **deny with feedback** (task stays denied for next apply).

### Denied tasks

Tasks with `status: "denied"` and a `feedback` field were rejected by the user. They are processed alongside pending tasks in step 2. Read the `feedback` carefully to understand what went wrong and re-apply with corrections.

## Task lifecycle

```
pending → in_progress (agent working) → review (user checks) → accepted (removed)
                  ↓                          ↓                → denied (with feedback → agent re-applies)
             needs_info (waiting)        blocked (can't do)   → dismissed (user deletes)
                  ↓                          ↓                → pushed back (denied → agent retries)
             in_progress (resume)        user decides
```

## Important notes

- Tasks are the source of truth — fetch tasks, not the report
- The `feedback` field on denied tasks is critical — it tells you what the user didn't like
- Tasks with `status: "review"` are waiting for user review — don't re-apply them
- Tasks with `status: "needs_info"` are waiting for the user to answer your questions — skip them and check back later
- Tasks with `status: "blocked"` have been flagged as not actionable — skip them unless the user pushes back with feedback
- When a `needs_info` task returns to `in_progress`, check `agent_feedback` for the user's answers before resuming work
- After applying, the user's page will hot-reload via Vite HMR showing the changes immediately
