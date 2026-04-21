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

For **in-repo usage examples** (real prop combinations + import path this project actually uses), call `annotask_get_component_examples(name: "Button")` — or `npx annotask component-examples Button --mcp`. Prefer the example's import path and prop shape over reinventing: the examples show how *this* codebase uses the component, not just what the library exposes.

#### c-ter. Find the data source (required for any task that adds or modifies data-driven UI)

Before writing UI that renders data, check what's already wired. If the task's summary contains `data_context_summary` (e.g. `"hook:useUserQuery"` or `"store:useCounterStore"`), that's the primary data source powering the selected element. For the full picture:

**MCP:** `annotask_get_data_context(task_id: "TASK_ID")` — returns the complete `DataContext`: every data reference in the enclosing file (`sources`, sorted with the primary source at index 0 — closest to `task.line`, tie-broken by kind precedence), `rendered_identifiers` from the template/JSX (CSV), and `route_bindings` (CSV).

```bash
npx annotask data-context TASK_ID --mcp
```

To browse the project's catalog of hooks, stores, and fetch wrappers (sorted by `used_count` — most load-bearing first):

**MCP:** `annotask_get_data_sources(used_only: true)` — filter to entries actually used elsewhere in the codebase.

```bash
npx annotask data-sources --used-only --mcp
```

To see **real in-repo usages** of a specific data source (destructuring patterns, parameter shape, common wrappers — parallel to `annotask_get_component_examples`):

**MCP:** `annotask_get_data_source_examples(name: "useUserQuery", kind: "composable")`

```bash
npx annotask data-source-examples useUserQuery --kind=composable --mcp
```

To see **what shape comes back** from an API — cross-reference declared schemas (OpenAPI, GraphQL, tRPC) so you don't guess field names:

**MCP:** `annotask_resolve_endpoint(url: "/api/cats")` → returns the best-match operation with a confidence score.

```bash
npx annotask resolve-endpoint /api/cats --mcp
```

**MCP:** `annotask_get_api_operation(path: "/api/cats", method: "GET")` — full request / response schema for a known path pattern.

```bash
npx annotask api-operation /api/cats --method=GET --mcp
```

**MCP:** `annotask_get_api_schemas(detail: true)` — browse every discovered schema source up front.

```bash
npx annotask api-schemas --detail --mcp
```

If a task summary shows `response_schema_ref: "Cat[]"`, the agent already knows a declared shape exists — `annotask_get_api_operation` or `annotask_resolve_endpoint` will surface the full JSON schema.

**When to use:**
- Any task where the user's description mentions adding, replacing, or rewiring data — "show the current user", "list orders", "filter by status", "fetch from the API".
- Denied tasks where feedback mentions wrong or fake data.
- Section requests that need to render real information.

**How to apply:**
- Prefer reusing a hook/store from `data_context.sources` or `data-sources` catalog over writing new fetch code.
- Copy the import path and call-site shape from `data-source-examples`, not from library docs.
- If `sources[0]` doesn't match the user's description (e.g. task says "user name" but `sources[0]` is `useOrdersQuery`), check the rest of the `sources` list — the right hook is usually there.

**When to use:**
- **Section requests** — Instead of creating HTML from scratch, search for relevant components and compose them
- **UI additions** — Check if a table, button, card, modal, input, form, list, or nav component already exists before writing custom HTML
- **Styling consistency** — Using library components ensures your changes match the design system

**How to apply:**
- Search for components matching the intent (e.g., "table" if adding tabular data, "dropdown" if adding a select menu)
- Read the props to understand customization options (variant, size, disabled, etc.)
- Call `annotask_get_component_examples` to see how the component is already used in this codebase; copy the import path and prop patterns from there
- Use the component in your JSX/Vue/Svelte code with appropriate props
- Document the component reference in your resolution note

#### c-bis. Re-anchor older or retried tasks

For **denied** tasks, tasks that have been sitting in the queue while you edited other files, or any task whose `file`/`line` you suspect has drifted: call `annotask_get_code_context(task_id)` before editing.

```bash
npx annotask code-context TASK_ID --mcp
```

Response:
```json
{"file":"src/components/Header.vue","line":42,"symbol":"Header","excerpt_start_line":27,"excerpt_end_line":57,"excerpt":"...","imports":["import ..."],"excerpt_hash":"ab12cd34ef56..."}
```

Use `symbol` + `excerpt` to locate the edit target; the `excerpt_hash` is a cheap drift check on subsequent retries (if the hash changes between attempts, the surrounding code moved). Skip this step for fresh pending tasks where `file`/`line` are known good.

#### c-quater. Retrieve interaction history or rendered HTML on demand

Annotask always captures two richer context streams per task — but keeps them out of the default task payload so lists stay lean:
- **Interaction history** — the user's recent navigation + click trace (up to ~20 events around task creation)
- **Rendered HTML** — the post-render `outerHTML` of the selected element (bindings resolved, capped at 200 KB)

The "Embed …" toggles in the Annotask UI only decide whether each rides in the task payload. When the payload doesn't contain them, pull on demand:

**MCP:** `annotask_get_interaction_history(task_id: "TASK_ID")` — useful when the task description references a flow or sequence ("after I click submit…", "on the orders page…").

```bash
npx annotask interaction-history TASK_ID --mcp
```

**MCP:** `annotask_get_rendered_html(task_id: "TASK_ID")` — useful when the task references visual structure that's hard to reconstruct from source alone ("the three spans in the header", "this button's icon wrapper").

```bash
npx annotask rendered-html TASK_ID --mcp
```

Both tools prefer the embedded copy on the task when present (`source: "embedded"`), fall back to the per-task sidecar under `.annotask/` (`source: "sidecar"`), and return `not_captured: true` when neither exists (rare — only when no selection was attached at task creation).

#### d. Apply the change

Read the task type and apply accordingly:

- **`annotation` with `action: "text_edit"`**: The `description` field says what text to change. Find the text in the source file and apply the edit.

- **`annotation` with other actions** (`add_column`, `add_row`, `wrap_container`, `delete`, `duplicate`, `move_up`, `move_down`): Apply the structural change described in `description`. If the action adds new UI (e.g. `add_row` into a table that doesn't exist yet, or `wrap_container` that introduces a new component), run step c first.

- **`annotation` with no action**: This is a free-text note. Read `description` and apply your best judgment to the source code. If `context.to_element` is present, this is an arrow annotation referencing two elements. **If the description asks you to add, insert, or create any UI element (e.g. "add a table", "put a form here", "insert a card"), you must run step c (component library search) before writing HTML.**

- **`style_update`**: Apply CSS property changes. The `context.changes` array contains each change with `property`, `before`, and `after` values. Use scoped styles, inline styles, or Tailwind classes based on project patterns.

- **`section_request`**: Create a new section in the template near the referenced element. The `description` field describes what content to create. `placement` gives spatial hints. Use the design spec (step b) and component library search (step c) to find relevant components and tokens before writing custom HTML.

- **`a11y_fix`**: Fix an accessibility violation. The `context` contains `rule` (axe rule ID, or the synthetic `tab-order` rule from Annotask's tab-order overlay), `impact`, `help`, `helpUrl`, and `elements` array with `html`, `selector`, `fix`, source `file`/`line`/`component`, and a per-element `a11y` block with computed accessibility metadata:

  ```
  elements[i].a11y = {
    accessible_name, name_source,   // "Sign in", source: aria-label | labelledby | label | alt | text | placeholder | none
    role, role_source,              // "button", source: explicit | implicit | none
    tabindex, focusable,            // null | number, true/false
    focus_indicator,                // "visible" | "none" | "unknown"
    contrast,                       // { foreground, background, ratio, aa_normal, aa_large, ... } only when element has text
    aria_attrs,                     // [{ name: "aria-expanded", value: "false" }, ...]
  }
  ```

  If `screenshot_meta` is present (the user manually attached one with the snip tool), retrieve it via `annotask_get_screenshot` before proposing visual changes (color-contrast, focus rings).

  **Per-rule playbook.** Most rules fall into one of these patterns — match by `context.rule`:

  | Rule(s) | Fix layer | What to do |
  |---|---|---|
  | `color-contrast`, `color-contrast-enhanced` | Design tokens first | Read `elements[i].a11y.contrast` for the actual fg/bg hex + ratio. If the colors come from theme tokens (check `cssVar` lookups in the source), adjust the token. If the contrast comes from a one-off inline style or hardcoded class, fix the component, not the token (you'd regress every other consumer). |
  | `label`, `form-field-multiple-labels` | Markup | Wrap input in `<label>` or add `aria-labelledby` referencing visible text. `a11y.accessible_name` shows what (if anything) the input currently exposes — when `name_source === 'placeholder'`, the input has no real label. |
  | `button-name`, `link-name`, `input-button-name` | Markup | Add visible text content or `aria-label`. For icon-only buttons add a visually hidden `<span class="sr-only">` (or your project's equivalent). Don't add `title` — it's not reliable for SR users. |
  | `image-alt`, `role-img-alt`, `svg-img-alt` | Markup | `alt=""` for decorative imagery, descriptive `alt` for informational. For `<img>` that conveys text, use the text. For SVG icons that pair with visible text, use `aria-hidden="true"`. |
  | `landmark-one-main`, `region`, `landmark-no-duplicate-banner`, `landmark-no-duplicate-contentinfo` | Layout component | Wrap the page's primary content in `<main>`. Add `role="region"` + `aria-label` to top-level layout containers. These almost always live in a layout component (e.g. `App.vue`, `_layout.tsx`, `RootLayout`), not in leaf components. |
  | `heading-order`, `page-has-heading-one`, `empty-heading` | Content/layout | Insert/promote `<h1>`; renumber subsequent levels so the outline is contiguous. Usually a layout/section component change, not a leaf change. |
  | `aria-allowed-attr`, `aria-required-attr`, `aria-valid-attr-value`, `aria-roles`, `aria-required-children`, `aria-required-parent` | Markup | Read `elements[i].a11y.role` and `aria_attrs` to see exactly what's set. Reference the WAI-ARIA roles spec (`helpUrl`) for the role's allowed attributes. Remove disallowed attrs; add required ones. |
  | `aria-hidden-focus`, `aria-hidden-body` | Markup | An element with `aria-hidden="true"` cannot contain focusable descendants. Either remove `aria-hidden`, or move the focusable elements outside (or set `tabindex="-1"` and ensure they're never the focus target). |
  | `tabindex`, **synthetic** `tab-order` | Markup | Remove positive `tabindex`; use 0 (focusable in DOM order) or -1 (programmatically focusable, not in tab order). For the synthetic `tab-order` rule, `context.tab_order.flag` is one of `positive` / `unreachable` / `reorder` — fix the source markup so DOM order matches visual order. |
  | `meta-viewport`, `html-has-lang`, `html-lang-valid`, `document-title`, `meta-refresh` | Document head | Single source of truth — usually `index.html` (Vite/CRA), `app/layout.tsx` (Next), `src/routes/+layout.svelte` (SvelteKit), or the framework's root document. |
  | `focus-order-semantics`, `nested-interactive` | Markup | Use semantic interactive elements (`<button>`, `<a href>`, `<input>`) instead of clickable `<div>`/`<span>`. Don't nest interactive elements (e.g. `<button>` inside `<a>`). |
  | `bypass`, `skip-link` | Layout component | Add a "Skip to main content" link as the first focusable element of the layout. Style it with the visually-hidden pattern that becomes visible on `:focus`. |
  | `duplicate-id`, `duplicate-id-active`, `duplicate-id-aria` | Markup | Search the codebase for hardcoded `id="…"` and rename one. If the id is dynamic, ensure the generation key is unique per instance. |
  | `frame-title`, `iframe-title` | Markup | Add `title="…"` describing the iframe's purpose. |

  **General rules:**
  - Prefer **pattern fixes** over instance fixes. When `elements` contains many entries that share the same `file`/`component`, change the source component once — don't paste the same fix N times.
  - For the synthetic `tab-order` rule, the offending element is in `elements[0].a11y.eid` and the failure type is in `context.tab_order.flag`. There is no `helpUrl` from axe — use the linked WCAG focus-order page in `context.helpUrl`.
  - When `a11y.accessible_name` is empty and `a11y.focusable` is true, the element is unreachable for screen readers — naming is the highest-priority fix.

- **`theme_update`**: One or more design token value changes committed together from the Theme page. A single task now covers every edit the user made in one Commit click — do not expect one task per token. The `context` object contains:
  - `edits`: array of token edits. Each entry has:
    - `category`: `colors` | `typography.families` | `typography.scale` | `spacing` | `borders.radius`
    - `role`: semantic role name (e.g. `primary`, `background`, `heading`)
    - `cssVar`: CSS variable name if backed by one (e.g. `--color-primary`), or `null`
    - `theme_variant`: the theme id this edit targets (e.g. `light`, `dark`)
    - `theme_selector`: how that variant is activated in the DOM — `{kind:'default'}`, `{kind:'attribute',host,name,value}`, `{kind:'class',host,name}`, or `{kind:'media',media}` — tells you which CSS block owns this variable (`:root`, `:root[data-theme="dark"]`, `.dark`, `@media (prefers-color-scheme: dark)`)
    - `before`: old value (`null` for new tokens)
    - `after`: new value
    - `sourceFile` / `sourceLine`: where the current declaration lives (both `null` for new tokens — you pick the location)
    - `isNew`: `true` if this token didn't exist before
  - `styling`: array of project styling methods (e.g. `["tailwind", "scoped-css"]`)
  - `specFile`: relative path to the design spec (typically `.annotask/design-spec.json`)

  **How to apply:**
  1. **Group `context.edits` by `sourceFile`.** For each file (skipping `null`/`isNew` for now), open it once, apply every edit against its file in a single Edit-batch, save. Use `theme_selector` + `cssVar` to locate the right declaration block — e.g. an edit with `theme_selector: {kind:'attribute',host:'html',name:'data-theme',value:'dark'}` belongs inside `:root[data-theme="dark"] { … }`, a `{kind:'default'}` edit belongs in the base `:root { … }` block.
  2. **Tailwind config edits:** if `cssVar` is `null` and `sourceFile` references `tailwind.config.*`, update the corresponding key. If edits span both Tailwind and raw CSS, handle each file independently.
  3. **New tokens (`isNew: true`):** add the CSS variable to the declaration block matching `theme_selector`. If no block exists for that variant yet, create one (e.g. add `:root[data-theme="dark"] { --new-var: …; }` at the end of the main tokens file). After writing, remember the final file path and line for step 4.
  4. **Patch `.annotask/design-spec.json` once at the end.** Resolve `context.specFile` against the MFE root (the directory containing `.annotask/`). For each edit:
     - Existing token: find `spec.<category>` — note dotted categories like `typography.families` map to nested paths — locate the entry by `role`, then set `values[theme_variant] = after`.
     - New token: append a token object with `role`, `values: { [theme_variant]: after }`, `cssVar`, and fresh `sourceFile` / `sourceLine` pointing at where you added the declaration in step 3.
     - When writing, keep the existing JSON formatting (same indentation, trailing newline) so the file watcher's next broadcast is clean.
  5. The server watches `design-spec.json`; saving it fires a `designspec:updated` push and the Theme page refetches automatically.

  **Worked example:** `context.edits = [{ category:'colors', role:'background', cssVar:'--stress-bg', theme_variant:'light', theme_selector:{kind:'default'}, before:'#f4f7fb', after:'#ff00ff', sourceFile:'../../packages/shared-ui-tokens/tokens.css', sourceLine:12, isNew:false }, { category:'colors', role:'text', cssVar:'--stress-text', theme_variant:'dark', theme_selector:{kind:'attribute',host:'html',name:'data-theme',value:'dark'}, before:'#e7eefb', after:'#ffeb3b', sourceFile:'../../packages/shared-ui-tokens/tokens.css', sourceLine:65, isNew:false }]` → open `tokens.css` once, update `--stress-bg` in the `:root` block and `--stress-text` in the `:root[data-theme="dark"]` block, save. Then open `.annotask/design-spec.json`, set `colors[?role=='background'].values.light = '#ff00ff'` and `colors[?role=='text'].values.dark = '#ffeb3b'`, save. Mark the task `review` with resolution `"Updated 2 color tokens in tokens.css and design-spec.json"`.

- **`api_update`**: In-repo backend-contract edit. Created from the shell's Data view when the user selects an internal data source (`schema_in_repo === true`) and fills in a desired change. Only valid for in-repo schemas — external APIs cannot be edited from Annotask and should be marked `blocked` with an explanation if a request implies one.

  The `context` object carries:
  - `data_source_name`: hook/store/query identifier (e.g. `useCatsQuery`)
  - `data_source_kind`: one of `composable | signal | store | fetch | graphql | loader | rpc`
  - `schema_location`: path to the schema file (e.g. `openapi.yaml`, `src/trpc/router.ts`)
  - `schema_kind`: `openapi | graphql | trpc | jsonschema`
  - `endpoint`: literal endpoint / query key when the source used one
  - `operation`: `{ method, path }` from the matched schema operation, when a match exists
  - `desired_change`: user's description of the needed contract change
  - `rationale`: optional "why"

  **How to apply:**
  - Open the schema file at `context.schema_location`. Read the referenced operation (`context.operation.method` + `context.operation.path`, or find it by `endpoint`) and make the change described in `desired_change`.
  - Update the handler / backend implementation that serves that operation (typical pairs: OpenAPI routes ↔ the framework-specific handler file, tRPC router ↔ its procedure body).
  - Update the frontend data source at `file:line` if the shape change affects the consumer (e.g. return type, destructured fields).
  - If the change is additive (new optional field), you usually don't need to change existing callers. If it's breaking (required field, renamed field), search for all usages with `annotask_get_data_source_examples` and update them.
  - Record what you changed in the resolution note — mention which schema location, which operation, and any frontend call sites touched.

- **`annotation` with cross-boundary API edits**: An annotation task may turn out to require an in-repo API change (e.g. "show expiration date on the tier badge" when the `Cat` schema does not currently return `expires_at`).

  **Rule**: do **not** silently edit the backend. Ask the user first via a `needs_info` question:
  > This change requires updating the internal API route `GET /api/cats` to add an `expires_at` field on the `Cat` response. Proceed with both frontend and backend edits? (yes / no)

  If the user approves, continue the same task (do **not** spawn a separate `api_update` task). Record each API edit structurally in `task.context.api_edits[]`:
  ```json
  {
    "api_edits": [
      {
        "schema_location": "openapi.yaml",
        "schema_kind": "openapi",
        "operation": { "method": "GET", "path": "/api/cats" },
        "change_summary": "Added nullable expires_at: string (ISO date) to the Cat response schema and handler."
      }
    ]
  }
  ```
  Annotask's summary lifting will surface `api_edits_count` on the triage view so the user sees this task crossed the frontend/backend line.

  If the user denies, do the frontend-only thing you can, or mark the task `blocked` with an explanation pointing at the missing backend support.

  If the data source is external (`schema_in_repo === false`) and the task requires a contract change, mark the task `blocked` immediately — Annotask cannot edit APIs outside the repo.

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
