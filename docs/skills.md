# Claude Code Skills

Annotask ships two Claude Code skills that let AI agents interact with the design tool.

## Overview

| Skill | Trigger | Purpose |
|-------|---------|---------|
| `/annotask-init` | "initialize Annotask", "set up Annotask" | Scan project, generate `.annotask/design-spec.json` |
| `/annotask-apply` | "apply the changes", "sync Annotask" | Fetch pending tasks, apply to source code, mark for review |

## /annotask-init

Scans the project to detect:
- Framework (Vue, React, Svelte, SolidJS)
- Styling methods (Tailwind, scoped CSS, CSS modules)
- Color tokens (CSS variables, Tailwind config, `@theme` blocks)
- Typography (families, scale, weights)
- Spacing and border radius tokens
- Icon library (Lucide, Heroicons, FontAwesome, etc.)
- Component library (PrimeVue, Vuetify, shadcn, etc.)

Output: `.annotask/design-spec.json` — populates the Theme page in Annotask.

Idempotent. Re-running overwrites with fresh data.

## /annotask-apply

The main automation skill. Processes tasks **one at a time** for incremental feedback:

1. Fetch pending and denied tasks from `GET /__annotask/api/tasks`
2. For each task, sequentially:
   - **Lock**: `PATCH /api/tasks/:id` with `status: "in_progress"` — user sees it's being worked on
   - **Apply**: Read the task type and apply the change to source code:
     - **annotation**: Read `description` and `action`, apply the described edit
     - **style_update**: Set the CSS property to the `after` value
     - **section_request**: Create new content matching the `prompt`
     - **theme_update**: Update CSS variable or Tailwind config token
     - **a11y_fix**: Fix the accessibility violation using context details
   - **Review**: `PATCH /api/tasks/:id` with `status: "review"` — immediately, before starting the next task
3. Report what was applied and which files changed
4. Denied tasks (with `feedback` field) are re-processed with corrections

The user can accept or deny early tasks while later ones are still being applied.

### Task lifecycle

```
pending → in_progress (agent working) → review (user checks in Annotask)
  → accepted (task removed)
  → denied + feedback (agent re-applies with corrections)
```

## Skill file locations

Skills are defined in `.claude/skills/`:

```
.claude/skills/
├── annotask-apply/SKILL.md
└── annotask-init/SKILL.md
```

These are project-scoped — they work when Claude Code is running from the Annotask project directory or any project that has these files checked in.
