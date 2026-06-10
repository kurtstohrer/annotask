# Agent Skills

Annotask ships two bundled skills:

- `/annotask-init`
- `/annotask-apply`

Install them with:

```bash
annotask init-skills
```

The first target gets real files. Additional targets get symlinks back to that primary copy.

## Install Targets

Built-in targets:

- `claude` -> `.claude/skills/`
- `agents` -> `.agents/skills/`
- `copilot` -> `.copilot/skills/`

Examples:

```bash
annotask init-skills
annotask init-skills --target=claude,agents,copilot
annotask init-skills --force
```

## `/annotask-init`

Purpose: scan the project and generate `.annotask/design-spec.json`.

Current design-spec shape includes:

- `framework`
- `themes[]`
- `defaultTheme`
- `colors[]`
- `typography.families[]`
- `typography.scale[]`
- `typography.weights[]`
- `spacing[]`
- `borders.radius[]`
- `breakpoints`
- `icons`
- `components`

Important current behavior:

- token values are variant-aware through `values: Record<themeId, string>`
- single-theme apps use a synthesized `default` theme id
- multi-theme apps can express class-, attribute-, media-, or default-driven variants
- the output powers Design > Tokens and gives agents grounded token metadata for `theme_update` tasks

## `/annotask-apply`

Purpose: process actionable Annotask tasks and apply them to source code. Cross-boundary API edits are the exception: the skill never edits the backend — it applies a frontend-only fallback when one exists, or marks the task `blocked` with the required backend change.

The skill prefers MCP when available and falls back to CLI commands with `--mcp` for parity.

Actionable work usually includes:

- `pending`
- `denied` tasks with reviewer feedback
- `in_progress` tasks whose `agent_feedback` now contains answers to earlier questions

The skill skips `needs_info` (still waiting on the user — answered tasks return to `in_progress`) and `blocked` tasks.

### Current Apply Flow

1. fetch task summaries
2. triage tasks by touched files and shared state
3. lock a task with `status: "in_progress"`
4. fetch deeper context only when needed
5. apply the source change, or mark cross-boundary backend work `blocked`
6. mark the task `review` with a short `resolution`
7. re-check the queue before finishing

The current workflow is aware of:

- batched `theme_update` tasks with `context.edits[]` (handled via `THEME_UPDATE.md`)
- batched `wireframe_apply` tasks with `context.wireframe.instances[]` (handled via `WIREFRAME_APPLY.md`)
- code-context re-anchoring for retried or drifted tasks
- component examples and data-source examples as grounding aids

### Task Types The Skill Is Expected To Handle

- `annotation`
- `section_request`
- `style_update`
- `theme_update`
- `a11y_fix`
- `error_fix`
- `perf_fix`
- `wireframe_apply`

## MCP And CLI Parity

The skill is designed so MCP and CLI fallback return equivalent machine-readable shapes.

Common MCP helpers:

- `annotask_get_tasks`
- `annotask_get_task`
- `annotask_update_task`
- `annotask_get_design_spec`
- `annotask_get_screenshot`
- `annotask_get_code_context`
- `annotask_get_components`
- `annotask_get_component_examples`
- `annotask_get_data_context`
- `annotask_get_interaction_history`
- `annotask_get_rendered_html`
- `annotask_get_data_sources`
- `annotask_get_data_source_examples`
- `annotask_get_data_source_details`
- `annotask_get_runtime_endpoints`
- `annotask_get_api_schemas`
- `annotask_get_api_operation`
- `annotask_resolve_endpoint`

Equivalent CLI commands exist under `annotask ... --mcp`.

## Lifecycle

Statuses understood by the skills and supported by the server:

- `pending`
- `in_progress`
- `applied`
- `review`
- `accepted`
- `denied`
- `needs_info`
- `blocked`

Typical reviewer-facing path:

```text
pending -> in_progress -> review -> accepted | denied
                     \-> needs_info
                     \-> blocked
```

`applied` is allowed as an intermediate automation state.

## Where The Skill Files Live

Published skill files live in the package root under:

- `skills/annotask-init/SKILL.md`
- `skills/annotask-apply/SKILL.md`
- `skills/annotask-apply/A11Y_RULES.md` (companion playbook read on demand for `a11y_fix` tasks)
- `skills/annotask-apply/THEME_UPDATE.md` (companion playbook read on demand for `theme_update` tasks)
- `skills/annotask-apply/ERROR_FIX.md` (companion playbook read on demand for `error_fix` tasks)
- `skills/annotask-apply/PERF_FIX.md` (companion playbook read on demand for `perf_fix` tasks)
- `skills/annotask-apply/WIREFRAME_APPLY.md` (companion playbook read on demand for `wireframe_apply` tasks)

They are copied or symlinked into the consumer project's chosen skill directories by `annotask init-skills`.

`skills/` is the canonical copy. The in-repo `.claude/skills/`, `.agents/skills/`, and `playgrounds/simple/vue-webpack/.claude/skills/` directories are generated mirrors — run `pnpm sync:skills` after editing the canonical files (CI fails if the mirrors drift).
