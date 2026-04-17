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

**Always pass `--mcp` to CLI commands.** The flag emits compact JSON that matches the MCP tool response shapes exactly (no ANSI colors, no human prefixes, `visual` stripped, `agent_feedback` trimmed). That way the same parsing logic works whether you're calling the MCP tool or the CLI fallback.

## Steps

### 0. Check server status

**MCP:** If you have MCP tools, the server is already running — skip this step.

```bash
npx annotask status --mcp
```

If this fails, the Annotask dev server isn't running. Ask the user to start it.

### 1. Fetch pending tasks

**MCP:** `annotask_get_tasks(status: "pending")` — returns compact summaries. Use `detail: true` for full objects.

```bash
npx annotask tasks --mcp --status=pending
```

Response (compact task summaries):
```json
{"version":"1.0","count":1,"tasks":[{"id":"task-123","type":"annotation","status":"pending","description":"Change the header background to match the new brand colors","file":"src/components/Header.vue","line":5,"action":"text_edit","screenshot":"screenshot-1711800000-ab3kf.png"}]}
```

Each task summary has: `id`, `type`, `status`, `description`, `file`, `line`, and optionally `component`, `action`, `screenshot`, `feedback` (on denied tasks), `blocked_reason`, `resolution`.

For full task details (context, element_context, viewport, interaction_history, agent_feedback), use `annotask_get_task` MCP tool or `npx annotask task <id> --mcp` for a single task (`npx annotask tasks --mcp --detail` for the full list). Only fetch full details when the summary doesn't provide enough context to apply the change.

### Screenshot reference

Some tasks include a `screenshot` field. The screenshot shows exactly what the user sees in the browser. To view it:

**MCP:** `annotask_get_screenshot(task_id: "TASK_ID")` — returns base64-encoded PNG directly.

```bash
npx annotask screenshot TASK_ID
```

This downloads the PNG to `.annotask/screenshots/`. Use it as visual context alongside the task description and source code. (The screenshot command writes the file on disk — `--mcp` doesn't apply.)

### 2. Triage, group, then apply

Filter actionable tasks: `status: "pending"`, `status: "denied"` (with `feedback`), and `status: "in_progress"` tasks whose `agent_feedback` now contains answers to earlier questions. Skip `needs_info` (waiting for user) and `blocked` (marked not actionable).

Before locking anything, **triage** — read all actionable task summaries and group them by touched resources:

- **By file**: tasks whose `file` is the same go in one group (Edits batched on one Read).
- **By shared state**: any task that writes `.annotask/design-spec.json`, `:root` CSS variables, `tailwind.config.*`, or a global stylesheet goes in the *shared-state* group regardless of which source file triggered it.
- **By dependency**: if a `theme_update` adds or changes a token that a `style_update` in the same batch consumes, the `theme_update` goes in an earlier phase. If a `section_request` introduces the UI that an `a11y_fix` targets, the `section_request` goes first.

Within each group: process serially, reading the file once and batching Edits. Across groups that are fully disjoint (no shared file, no shared state, no dependency edge), you may launch parallel subagents — one per group — to apply them concurrently. If in doubt, run serially.

#### Parallelism rules

- **Same file → same group, serial.** Never have two tasks editing the same file concurrently.
- **Shared global state → one group, serial.** `.annotask/design-spec.json`, `:root` blocks in shared CSS, `tailwind.config.*`, shared layout files, i18n catalogs, route tables, barrel exports.
- **Dependency order**: `theme_update` before any `style_update` that references the new/changed token; structural task (`section_request`, `annotation` with `wrap_container`/`add_row`/`add_column`) before an `a11y_fix` or `style_update` on the same new UI.
- **Stale locators**: after edits land, the `file`/`line` on remaining tasks may drift. Prefer searching by surrounding text/element context over trusting `line` from the original triage.
- **Non-idempotent inserts**: `add_row`, `add_column`, `section_request`, and free-text "add this" notes can duplicate on retry. Before inserting, confirm the target isn't already present.
- **If using parallel subagents**: each subagent receives only its group's task IDs plus project context. After all subagents finish, run a quick typecheck/build sanity pass before returning control to the user. If any subagent failed, surface it clearly — do not silently accept partial success.

For each task in a group, follow this cycle:

#### a. Lock the task

Mark it `in_progress` so the user sees you're working on it:

**MCP:** `annotask_update_task(task_id: "TASK_ID", status: "in_progress")`

```bash
npx annotask update-task TASK_ID --status=in_progress --mcp
```

#### b. Reference the design spec for consistency

Before making any design or styling decisions, fetch the project's design spec to ensure consistency with existing tokens (colors, typography, spacing, borders, etc.):

**MCP:** `annotask_get_design_spec()` — returns design tokens summary, framework detection (Tailwind, CSS-in-JS, etc.), and responsive breakpoints.

```bash
npx annotask design-spec --mcp
```

Response example:
```json
{"version":"1.0","framework":"tailwind","tokens":{"colors":{"primary":"#3b82f6","secondary":"#8b5cf6"},"typography":{"scale":["xs","sm","base","lg","xl"],"families":["Inter","Roboto"]}},"breakpoints":{"sm":"640px","md":"768px","lg":"1024px"}}
```

For detailed tokens in a specific category:

```bash
npx annotask design-spec --category=colors --mcp
```

**When to use:**
- **Style updates** — Use design tokens instead of arbitrary colors or spacing values
- **Typography changes** — Reference the font scale and families from the spec
- **Responsive design** — Use detected breakpoints when adding media queries
- **New components** — Match the design system when creating new UI

**How to apply:**
- For color changes, use token names (e.g., `--color-primary`) instead of hardcoded hex values
- For spacing/sizing, use the project's scale (e.g., Tailwind scale: xs, sm, base, lg, xl)
- For responsive design, use the detected breakpoints
- Document the token reference in your resolution note (e.g., "Applied primary color token")

#### c. Find relevant components (required when adding any UI element)

If the task asks you to add, insert, or create a UI element of any kind — a table, button, card, modal, input, dropdown, form, list, nav, etc. — you **must** search the component library first before writing HTML from scratch. This applies to all task types: `section_request`, `annotation` with actions like `add_column`/`add_row`/`wrap_container`, and free-text `annotation` notes whose `description` implies new UI.

**MCP:** `annotask_get_components(search: "button")` — returns matching components from registered libraries with names, descriptions, and prop signatures. Limit results with `limit`, offset with `offset`, filter by `library`.

```bash
npx annotask components "button" --mcp
```

Response example:
```json
{"version":"1.0","libraries":[{"name":"antenna","components":[{"name":"Button","description":"Primary button component","props":{"variant":{"type":"string","default":"primary","options":["primary","secondary","tertiary"]},"size":{"type":"string","default":"md"},"disabled":{"type":"boolean"}}}]}]}
```

For a specific component, get its full prop signature:

```bash
npx annotask component Button --mcp
```

**When to use:**
- **Section requests** — Instead of creating HTML from scratch, search for relevant components and compose them
- **UI additions** — Check if a table, button, card, modal, input, form, list, or nav component already exists before writing custom HTML
- **Styling consistency** — Using library components ensures your changes match the design system

**How to apply:**
- Search for components matching the intent (e.g., "table" if adding tabular data, "dropdown" if adding a select menu)
- Read the props to understand customization options (variant, size, disabled, etc.)
- Use the component in your JSX/Vue/Svelte code with appropriate props
- Document the component reference in your resolution note

#### d. Apply the change

Read the task type and apply accordingly:

- **`annotation` with `action: "text_edit"`**: The `description` field says what text to change. Find the text in the source file and apply the edit.

- **`annotation` with other actions** (`add_column`, `add_row`, `wrap_container`, `delete`, `duplicate`, `move_up`, `move_down`): Apply the structural change described in `description`. If the action adds new UI (e.g. `add_row` into a table that doesn't exist yet, or `wrap_container` that introduces a new component), run step c first.

- **`annotation` with no action**: This is a free-text note. Read `description` and apply your best judgment to the source code. If `context.to_element` is present, this is an arrow annotation referencing two elements. **If the description asks you to add, insert, or create any UI element (e.g. "add a table", "put a form here", "insert a card"), you must run step c (component library search) before writing HTML.**

- **`style_update`**: Apply CSS property changes. The `context.changes` array contains each change with `property`, `before`, and `after` values. Use scoped styles, inline styles, or Tailwind classes based on project patterns.

- **`section_request`**: Create a new section in the template near the referenced element. The `description` field describes what content to create. `placement` gives spatial hints. Use the design spec (step b) and component library search (step c) to find relevant components and tokens before writing custom HTML.

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

#### e. Ask for clarification (only when stuck)

If you are **genuinely stuck** — missing API context, unclear library usage, ambiguous intent that could lead to a wrong implementation — ask the user for clarification instead of guessing:

**MCP:** `annotask_update_task(task_id: "TASK_ID", questions: [{"id":"q1","text":"Which auth library should I use?","type":"choice","options":["NextAuth","Clerk","Custom"]},{"id":"q2","text":"Where is the session config located?","type":"text"}])`

```bash
npx annotask update-task TASK_ID --mcp --ask='{"message":"Optional markdown context","questions":[{"id":"q1","text":"Which auth library should I use?","type":"choice","options":["NextAuth","Clerk","Custom"]},{"id":"q2","text":"Where is the session config located?","type":"text"}]}'
```

This sets the task to `needs_info` status. The user sees your questions in the Annotask UI and responds there. When answered, the task returns to `in_progress` with answers in `agent_feedback`.

**Question types:**
- `text` — free-text answer from user
- `choice` — user picks from your provided `options` array

**Guidelines:**
- Only ask when you truly cannot proceed — do not ask for confirmation on straightforward tasks
- Be specific: "Which CSS framework should I use for the grid?" is better than "How should I do this?"
- Combine related questions into a single ask rather than multiple rounds
- After asking, move on to the next task. Come back to check answers later via `annotask_get_tasks` MCP tool or `npx annotask tasks --mcp`

#### f. Mark as blocked (when the task can't be done)

If the task is **fundamentally outside your control** — a performance issue in a third-party library, an accessibility bug in a dependency, a config change that requires infrastructure access, etc. — mark it as blocked with an explanation:

**MCP:** `annotask_update_task(task_id: "TASK_ID", blocked_reason: "This layout shift is caused by vue-router v4's async route loading. Needs upstream fix or a loading skeleton wrapper — cannot be resolved by editing component code alone.")`

```bash
npx annotask update-task TASK_ID --mcp --blocked-reason="This layout shift is caused by vue-router v4's async route loading. Needs upstream fix or a loading skeleton wrapper — cannot be resolved by editing component code alone."
```

This sets the task to `blocked` status automatically. The user sees your explanation and can either **dismiss** the task or **push back** (deny it with feedback asking you to try a different approach).

**When to use blocked vs needs_info:**
- `needs_info` = "I can do this, but I need more information from you"
- `blocked` = "This can't be done through source code changes — here's why"

#### g. Mark for review immediately

As soon as you finish applying **this** task, mark it for review with a brief resolution note:

**MCP:** `annotask_update_task(task_id: "TASK_ID", status: "review", resolution: "Swapped grid to flexbox, added gap-4 for spacing")`

```bash
npx annotask update-task TASK_ID --status=review --resolution="Swapped grid to flexbox, added gap-4 for spacing" --mcp
```

Keep resolutions short — one sentence describing what you changed, not why. The user sees it in the Annotask shell alongside the diff.

#### h. Move to the next task in the group

Repeat steps a–g for each remaining task in the current group, then move to the next group (or confirm parallel subagents have finished). Per-task review flipping is what powers incremental feedback — each task moves to `review` as soon as *its own* edit lands, even inside a batched group, so the user can accept or deny early while later tasks are still in flight.

### 3. Second sweep — catch denies and new tasks that arrived mid-run

Because tasks flip to `review` as soon as their edit lands, the user may have been reviewing (and denying) early tasks while you were still applying later ones. They may also have created brand-new tasks. Before reporting, re-fetch once:

**MCP:** `annotask_get_tasks(status: "denied")` and `annotask_get_tasks(status: "pending")`

```bash
npx annotask tasks --mcp --status=denied
npx annotask tasks --mcp --status=pending
```

If either query returns tasks you did not handle in step 2, loop back to step 2 and process them — re-triage, re-group, apply. Repeat step 3 after each sweep until both queries come back empty.

**If a task keeps returning denied across multiple sweeps**, stop guessing and ask. Use step 2e (`annotask_update_task` with `questions`) to flip it to `needs_info` and let the user clarify what they actually want, rather than burning more sweeps on a misread requirement.

### 4. Report to the user

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
