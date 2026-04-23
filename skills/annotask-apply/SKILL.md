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

For full task details (context, viewport, interaction_history, agent_feedback), use `annotask_get_task` MCP tool or `npx annotask task <id> --mcp` for a single task (`npx annotask tasks --mcp --detail` for the full list). Only fetch full details when the summary doesn't provide enough context to apply the change.

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
- **Stale locators**: after edits land, the `file`/`line` on remaining tasks may drift. When in doubt, call `annotask_get_code_context(task_id)` before editing — it returns the current symbol, a ±15 line excerpt, and an `excerpt_hash` you can compare across retries. Otherwise, search by surrounding text/element context over trusting `line` from the original triage.
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

Use the design spec when the task changes visual design, layout tokens, typography, spacing, or introduces new UI that should match the existing system.

**MCP:** `annotask_get_design_spec()`

```bash
npx annotask design-spec --mcp
```

For one category only:

```bash
npx annotask design-spec --category=colors --mcp
```

Apply it narrowly:
- Prefer existing tokens over hardcoded values
- Use the project's spacing and breakpoint scale
- Reuse the detected styling conventions instead of introducing a new pattern

#### c. Gather only the extra context this task needs

Start with the task summary. Pull more context only when it changes the implementation.

**Re-anchor stale tasks**

For **denied** tasks, old `in_progress` tasks, or any task whose `file`/`line` may have drifted, call `annotask_get_code_context(task_id)` before editing.

```bash
npx annotask code-context TASK_ID --mcp
```

Use `symbol` + `excerpt` to locate the edit target. Treat `excerpt_hash` as a cheap drift check across retries.

**If the task adds UI, find components first**

If the task asks you to add, insert, or create UI of any kind — table, button, card, modal, input, dropdown, form, list, nav, layout wrapper — search the component library before writing custom HTML. This applies to `section_request`, structural `annotation` actions like `add_row` or `wrap_container`, and free-text notes that clearly imply new UI.

**MCP:** `annotask_get_components(search: "button")`

```bash
npx annotask components "button" --mcp
```

If a candidate looks right, inspect the exact API and project usage:

```bash
npx annotask component Button --mcp
npx annotask component-examples Button --mcp
```

Prefer the import path and prop shape from `annotask_get_component_examples` over inventing a fresh usage.

**If the task binds or changes data, inspect the existing data path**

Do this only for data-driven work: showing real data, rewiring an existing hook/store, changing filters or queries, or fixing a denied task that used fake or wrong data.

Start with what the task already tells you:
- If the summary has `data_context_summary`, use that as the first candidate source
- If that is not enough, call `annotask_get_data_context(task_id)` to inspect nearby sources in the current file

```bash
npx annotask data-context TASK_ID --mcp
```

Only expand further when needed:
- `annotask_get_data_sources(used_only: true)` / `npx annotask data-sources --used-only --mcp` when you need to find a reused project-level source
- `annotask_get_data_source_examples(name)` / `npx annotask data-source-examples NAME --kind=composable --mcp` when you need the real import path or call-site shape
- `annotask_resolve_endpoint(url)` or `annotask_get_api_operation(path, method)` when you need response field names or schema details
- `annotask_get_api_schemas(detail: true)` only as a last resort when you still do not know which schema owns the endpoint

Prefer reusing an existing hook/store/fetch wrapper over writing new data plumbing.

**If the task references a flow or rendered structure, pull it on demand**

Use interaction history when the task depends on the user's path through the app:

```bash
npx annotask interaction-history TASK_ID --mcp
```

Use rendered HTML when the task refers to post-render structure that is easier to inspect from the DOM than from source:

```bash
npx annotask rendered-html TASK_ID --mcp
```

Both tools prefer embedded task payloads when present and otherwise fall back to the per-task sidecar under `.annotask/`.

#### d. Apply the change

Read the task type and apply accordingly:

- **`annotation` with `action: "text_edit"`**: The `description` field says what text to change. Find the text in the source file and apply the edit.

- **`annotation` with other actions** (`add_column`, `add_row`, `wrap_container`, `delete`, `duplicate`, `move_up`, `move_down`): Apply the structural change described in `description`. If the action adds new UI (e.g. `add_row` into a table that doesn't exist yet, or `wrap_container` that introduces a new component), run the component lookup in step c first.

- **`annotation` with no action**: This is a free-text note. Read `description` and apply your best judgment to the source code. If `context.to_element` is present, this is an arrow annotation referencing two elements. **If the description asks you to add, insert, or create any UI element (e.g. "add a table", "put a form here", "insert a card"), you must run the component lookup in step c before writing HTML.**

- **`style_update`**: Apply CSS property changes. The `context.changes` array contains each change with `property`, `before`, and `after` values. Use scoped styles, inline styles, or Tailwind classes based on project patterns.

- **`section_request`**: Create a new section in the template near the referenced element. The `description` field describes what content to create. `placement` gives spatial hints. Use the design spec (step b) and the relevant step-c lookups before writing custom HTML.

- **`a11y_fix`**: Fix an accessibility violation. Read `A11Y_RULES.md` in this skill directory before applying the change. If you are working through multiple a11y tasks in one run, read it once for the batch, not once per task. Keep three defaults in mind even before you open the playbook: prefer pattern fixes over instance fixes, expect layout/head rules to live in root or layout files, and fetch the screenshot first when the issue is visual (contrast, focus ring, hidden text, similar).

- **`theme_update`**: Apply batched design-token edits from the Theme page. Read `THEME_UPDATE.md` in this skill directory before applying the change. If you are working through multiple theme tasks in one run, read it once for the batch, not once per task. Keep three defaults in mind even before you open the playbook: one task may include many edits, update source files before `.annotask/design-spec.json`, and land `theme_update` before dependent `style_update` tasks.

- **`api_update`**: Do **not** edit the API in this skill. Instead, inspect the task context and tell the user exactly what would need to change for the request to work. Open `context.schema_location`, inspect the referenced operation (`context.operation.method` + `context.operation.path`, or find it by `endpoint`), and identify:
  - the schema change required
  - the backend handler or router that would need updating
  - any frontend data source or caller that would need follow-up changes if the contract changed

  Then mark the task `blocked` with a concise explanation naming the schema location, operation, and required contract change. If the API is external, block it immediately and say Annotask cannot change APIs outside the repo.

- **`annotation` with cross-boundary API edits**: Some frontend requests turn out to depend on backend work (for example, a field is not returned by the current response schema). Do **not** edit the backend and do **not** ask for permission to do so. If there is a meaningful frontend-only fallback, apply it and explain the missing backend support in the resolution note. Otherwise, mark the task `blocked` and tell the user which API/schema change would be required.

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
