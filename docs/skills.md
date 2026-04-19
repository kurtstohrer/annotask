# Agent Skills

Annotask ships two bundled skills that teach an agent how to scan the project and how to apply queued tasks.

## Overview

| Skill | Purpose | Output |
|-------|---------|--------|
| `/annotask-init` | Scan the project and build the design spec | `.annotask/design-spec.json` |
| `/annotask-apply` | Triage actionable tasks and apply them to source code | Task status updates plus code changes |

Install both with:

```bash
annotask init-skills
```

Default targets are `.claude/skills/` and `.agents/skills/`. Built-in alternate target: `copilot`.

## /annotask-init

Scans the project to detect:

- framework and version
- styling approaches
- colors, typography, spacing, borders, and breakpoints
- icon libraries
- component libraries and used components

The generated design spec is what powers the shell's Tokens page and gives agents grounded token metadata for `theme_update` tasks.

The run is idempotent. Re-running overwrites the spec with a fresh scan.

## /annotask-apply

Processes the current task queue. The actionable set is:

- `pending`
- `denied` tasks with reviewer feedback
- `needs_info` tasks whose questions have been answered

The skill skips unresolved `needs_info` tasks and `blocked` tasks.

### What it does

1. Fetch task summaries.
2. Group tasks by touched files and shared resources so unsafe parallel edits do not collide.
3. Lock each task with `status: "in_progress"`.
4. Pull deeper context only when needed: design spec, screenshots, code context, component examples, data context, API schemas, and so on.
5. Apply the code change.
6. Mark each completed task `review` with a short `resolution` note.
7. Re-scan for newly created or denied tasks before finishing.

### Task types it is expected to handle

- `annotation`
- `section_request`
- `style_update`
- `theme_update`
- `a11y_fix`
- `error_fix`
- `perf_fix`
- `api_update`

### Agent surfaces it can use

The skill prefers MCP when available. The equivalent CLI surface exists for fallback.

Common MCP helpers used by the skill:

- `annotask_get_tasks`, `annotask_get_task`, `annotask_update_task`
- `annotask_get_design_spec`
- `annotask_get_screenshot`, `annotask_get_code_context`
- `annotask_get_components`, `annotask_get_component_examples`
- `annotask_get_data_context`, `annotask_get_data_sources`, `annotask_get_data_source_examples`, `annotask_get_data_source_details`
- `annotask_get_api_schemas`, `annotask_get_api_operation`, `annotask_resolve_endpoint`

## Lifecycle

```text
pending -> in_progress -> review -> accepted | denied
                           \-> needs_info
                           \-> blocked
```

- `accepted` removes the task and cleans up its screenshot when present.
- `denied` preserves reviewer feedback for the next retry.
- `needs_info` stores an agent question thread on the task.
- `blocked` records why the task could not be completed.

## Skill Locations

Depending on target selection, `annotask init-skills` writes or links the bundled skill files into one or more of:

- `.claude/skills/`
- `.agents/skills/`
- `.copilot/skills/`

The first target gets real files. Additional targets get symlinks back to that first copy so the skills stay in sync.
