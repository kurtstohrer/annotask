# Claude Code Skills

Annotask ships three Claude Code skills that let AI agents interact with the design tool.

## Overview

| Skill | Trigger | Purpose |
|-------|---------|---------|
| `/init-annotask` | "initialize Annotask", "set up Annotask" | Scan project, generate `.annotask/design-spec.json` |
| `/watch-annotask` | "watch my changes", "monitor Annotask" | Stream changes in real-time, describe what the user is doing |
| `/apply-annotask` | "apply the changes", "sync Annotask" | Fetch pending tasks, apply to source code, mark for review |

## /init-annotask

Scans the project to detect:
- Framework (Vue, React, Svelte)
- Styling methods (Tailwind, scoped CSS, CSS modules)
- Color tokens (CSS variables, Tailwind config, `@theme` blocks)
- Typography (families, scale, weights)
- Spacing and border radius tokens
- Icon library (Lucide, Heroicons, FontAwesome, etc.)
- Component library (PrimeVue, Vuetify, shadcn, etc.)

Output: `.annotask/design-spec.json` — populates the Theme page in Annotask.

Idempotent. Re-running overwrites with fresh data.

## /watch-annotask

Passive monitoring mode. Connects to the WebSocket and describes changes as the user makes them:

- "You changed the background color of table cells in PlanetTable.vue to #2a1a1a"
- "You increased the header font size to 28px"

Does not modify any files. Suggests `/apply-annotask` when the user seems done.

## /apply-annotask

The main automation skill. Workflow:

1. Fetch pending tasks from `GET /__annotask/api/tasks`
2. For each `status: "pending"` task, apply the change to source code based on type:
   - **annotation**: Read `intent` and `action`, apply the described edit
   - **style_update**: Set the CSS property to the `after` value
   - **section_request**: Create new content matching the `prompt`
   - **theme_update**: Update CSS variable or Tailwind config token
3. Mark each task as `status: "review"` via `PATCH /api/tasks/:id`
4. Report what was applied and which files changed
5. Handle denied tasks (re-apply with corrections from `feedback` field)

### Task lifecycle

```
pending → applied (agent writes code) → review (user checks in Annotask)
  → accepted (task removed)
  → denied + feedback (task goes back to pending for next apply)
```

## Skill file locations

Skills are defined in `.claude/skills/`:

```
.claude/skills/
├── apply-annotask/SKILL.md
├── init-annotask/SKILL.md
└── watch-annotask/SKILL.md
```

These are project-scoped — they work when Claude Code is running from the Annotask project directory or any project that has these files checked in.
