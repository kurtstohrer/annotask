# Annotask Critical Analysis

## Executive take

Annotask has a genuinely strong product idea: a same-origin visual editing shell living on top of a local Vite app, emitting structured changes that an AI agent can turn into source edits. The repo already proves that this idea is viable. But the implementation is still much closer to an ambitious prototype than a dependable developer tool.

My assessment is: **strong concept, promising prototype surface area, weak correctness guarantees, and low operational maturity**.

The biggest concern is not missing polish. It is trust. The core promise of this project is that a visual change can be traced back to the right source location and exported in a form an agent can apply safely. Right now, the repository does not fully earn that trust.

## What the project gets right

### 1) The core architecture is smart

- The same-origin shell model is the best decision in the repo. Serving the editor at `/__annotask/` and embedding the real app in an iframe avoids a lot of cross-origin, extension, and message-passing complexity. `src/plugin/index.ts`, `src/plugin/serve-shell.ts`, and `vite.config.shell.ts` show a coherent architectural direction.
- The project keeps the mental model simple: one Vite plugin, one shell, one local server, one report format. That is a much better starting point than a distributed toolchain.
- The playground is a meaningful demo instead of a toy. The Vue Router app plus FastAPI backend gives the project a believable development context. See `playground/src/router.ts`, `playground/src/pages/PlanetsPage.vue`, `playground/src/pages/MoonsPage.vue`, and `playground/api/main.py`.

### 2) The repository already covers a lot of the interaction loop

- There is already a shell UI, source instrumentation, a task model, a WebSocket channel, an HTTP API, a CLI, and a design-token workflow. That is a lot of surface area for an early codebase.
- `src/schema.ts` is especially important: it shows the team is thinking in terms of contracts, not just UI behavior.
- The shell includes more than simple style tweaking. Selection, notes, arrows, sections, highlights, and theme token workflows all exist in some form. That demonstrates product ambition clearly.

### 3) The long-term vision is unusually well articulated

- `plan/claude.md` is thoughtful, concrete, and product-driven. It explains the why behind the architecture, not just the mechanics.
- This matters because the repo is not directionless. The problem is not lack of vision. The problem is that implementation quality has not yet caught up to the vision.

## Where the project is weakest

### 1) The dev-only boundary looks unsafe

This is the most serious architectural issue.

- `src/plugin/index.ts` applies the `.vue` transform and `transformIndexHtml()` unconditionally.
- Only the server middleware plugin uses `apply: 'serve'`.
- That means the code appears to inject `data-annotask-*` attributes, expose Vue globals, and add the floating toggle script even outside the dev-server path.

That is a direct mismatch with the stated design in `plan/claude.md`, which says the tool should be dev-only and stripped from production behavior. If this understanding is correct, the project risks contaminating production builds with development instrumentation.

## 2) Source mapping and change fidelity are not reliable enough yet

This is the core trust problem.

- `src/plugin/transform.ts` claims a compiler-based approach in its header comments, but the real implementation is a regex plus character scanner over raw template text. That is much more brittle than the comment suggests.
- `transformSFC()` computes line numbers relative to the template fragment, not the full `.vue` file. The `templateOpenTagEnd` argument is passed into `injectAttributes()` and then never used.
- `src/shell/composables/useStyleEditor.ts` records style changes incorrectly: `applyStyle()` sets the new inline style before reading the `before` value from computed styles.

These are not minor bookkeeping issues. They threaten the central contract of the tool:

1. identify the correct source location,
2. capture the original state accurately,
3. emit a trustworthy change report.

If any of those fail, downstream AI application becomes guesswork.

### 3) The runtime behavior does not match the schema's ambition

`src/schema.ts` is more mature than the actual product behavior.

- The schema supports `class_update`, `prop_update`, `scoped_style_update`, `component_delete`, and `section_request`.
- The main shell and report pipeline mostly emit style updates, annotations, inserts, and moves.
- `src/shell/App.vue` lets users edit classes in `applyClassChange()`, but that path mutates `className` directly and does not record a `class_update` in the exported report.
- `src/shell/composables/useStyleEditor.ts` hardcodes project metadata as `framework: 'vue'`, `styling: ['tailwind', 'scoped-css']`, and `root: ''`, regardless of the actual app.

This is a classic prototype smell: the type system describes the intended product, but the runtime only implements a narrower and less reliable subset.

### 4) The shell is already too monolithic

The frontend architecture is carrying too much inside a few oversized files.

- `src/shell/App.vue` is the clearest example. It owns selection state, route tracking, iframe bridging, overlays, task creation, keyboard handling, report copying, context menus, annotation restoration, and a very large amount of styling.
- `src/shell/components/ThemePage.vue` is also very large and mixes UI rendering, token editing state, preview logic, and task generation.
- `src/shell/composables/useStyleEditor.ts` mixes DOM mutation, undo logic, WebSocket transport, report shaping, placeholder rendering, and component mounting.

This is still manageable for a solo prototype. It is not a good foundation for a product that still plans to add component catalogs, source patching, OpenAPI awareness, responsive editing, and more framework support.

### 5) Several features are only half-wired

The repo gives the impression of breadth first, completion second.

- `src/shell/App.vue` includes `onContextMenuAction()`, but it is just a stub.
- `src/plugin/index.ts` exposes an `openapi` option, but it is not actually used.
- Theme editing in `src/shell/components/ThemePage.vue` uses a "Commit" button, but commit here really means "create tasks," not "apply source changes," which is an important semantic gap.
- The task/review flow exists, but much of the system still behaves like a note-taking layer wrapped around style edits rather than a full source-editing pipeline.

None of this is fatal on its own. Together, it creates uncertainty about what is truly production intent versus what is exploratory scaffolding.

### 6) State management is convenient, but brittle

- `src/shell/composables/useTasks.ts` uses module-level singleton refs, side-effectful initialization, manual refetches, and hand-maintained filtered lists instead of a cleaner reactive store design.
- WebSocket handling is duplicated across `useTasks.ts`, `useDesignSpec.ts`, and `useStyleEditor.ts`.
- This makes lifecycle behavior harder to reason about and increases the chance of stale UI or divergent client state.

For a tool that depends on live synchronization and confidence in current state, this is a meaningful maintainability risk.

### 7) The server/API layer is thin and optimistic

- `src/plugin/api.ts` reads request bodies and immediately `JSON.parse`s them with no structured validation and no error handling for malformed input.
- `src/plugin/index.ts` uses synchronous filesystem reads and writes for design spec and task persistence.
- Server-side data shapes are largely unvalidated `unknown`, `Record<string, unknown>`, or `any`.

That is acceptable for a throwaway prototype. It is weak for a tool that intends to be a trusted intermediary between browser edits and source code changes.

### 8) Documentation, testing, and release hygiene are far behind the concept

This is the most obvious maturity gap.

- `README.md` is effectively empty.
- No test files were found.
- No CI workflows were found under `.github/`.
- `package.json` has no test script, no lint script, and lacks basic package metadata like description, repository, and license.

The strongest documentation in the repo is `CLAUDE.md` and `plan/claude.md`, which are useful for an AI collaborator, but they do not replace user-facing or contributor-facing docs.

## Product and strategy gap

The repository's stated ambition is significantly ahead of the code.

- `plan/claude.md` describes a future with source patching, MCP tooling, OpenAPI parsing, worker-thread scanning, component catalogs, report validation, and formal schema guarantees.
- The actual workspace is much smaller: one core package plus a playground, as shown by `pnpm-workspace.yaml` and `package.json`.
- The repo does not yet include the most important downstream step: a robust, tested apply-to-source pipeline.

That does not mean the plan is bad. It means the team should be careful about continuing feature expansion before stabilizing the trust boundary.

## Developer experience issues worth fixing early

- The shell is served from prebuilt assets in `dist/shell` via `src/plugin/serve-shell.ts`, which means shell development is less direct than the rest of the system and can easily drift into rebuild friction.
- The playground setup is under-documented. `playground/vite.config.ts` proxies `/api` to port `8888`, while the user-facing error text in `playground/src/pages/PlanetsPage.vue` and `playground/src/pages/MoonsPage.vue` still says `:8000`.
- `playground/src/components/Header.vue` links to API docs on `http://localhost:8888/docs`, but the root docs do not clearly explain how to run the backend alongside the frontend.

These are small issues individually, but they signal that the repo has not yet gone through a full polishing pass from a new contributor's perspective.

## What is missing most

If I reduce the whole repo to the most important absences, they are these:

1. **A dependable source-application pipeline**: not just recording intent, but safely converting intent into code changes.
2. **Automated tests around the fragile core**: especially SFC transformation, source mapping, report generation, and task transport.
3. **Runtime validation**: the project needs stricter guarantees between schema, UI actions, API payloads, and emitted reports.
4. **A documentation pass for humans**: install, architecture, limitations, workflow, and troubleshooting should start in `README.md`, not in planning documents.

## Recommended next move

The repo should resist the urge to add more surface area right now.

The best next phase is a stabilization cycle with four goals:

1. Make the plugin unambiguously dev-only.
2. Fix source-line fidelity and style baseline capture.
3. Align emitted runtime changes with `src/schema.ts` and validate them.
4. Add tests before adding more capabilities.

If those four things are done well, the rest of the roadmap becomes much more believable.

## Final judgment

Annotask is not a weak project. It is an overextended one.

The idea is strong, the architecture has real merit, and the demo is compelling enough to show that the product could matter. But the repository is still in the phase where the most important guarantees are only partially true. Until source mapping, report fidelity, and dev-only safety are made reliable, this project is better understood as a convincing prototype than a trustworthy toolchain.

That is actually a good place to be. The concept is worth hardening. The next win is not more features. It is making the current promise dependable.
