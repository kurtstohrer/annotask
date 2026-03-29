# Annotask Critical Analysis

## Executive take

This codebase has a strong product idea and an unusually practical architecture for local-first visual editing (single Vite plugin + same-origin iframe + structured change reports). The current implementation already proves the core interaction loop. However, it is still at an early prototype stage: several correctness bugs undermine report reliability, core modules are tightly coupled, and production-readiness foundations (tests, docs, validation, hardening) are largely missing.

My overall assessment: **high potential, medium implementation maturity, high technical risk if scaled without a stabilization pass**.

## What is working well

### 1) Solid architectural direction

- The decision to keep everything on one dev server (plugin + shell + API + WS) is coherent with the product goal and avoids cross-origin complexity.
- The source instrumentation model (`data-annotask-*`) is simple and easy to reason about.
- The report-centric contract in `src/schema.ts` is a good boundary for AI-agent integration.

### 2) Good developer ergonomics for local use

- Setup in the playground is straightforward (`annotask()` in Vite plugins).
- Live loop exists end-to-end: select in iframe -> edit -> report -> WS/API consumption.
- The shell UI offers substantial interaction modes already (select, pin, arrow, draw, highlight, theme).

### 3) Clear momentum and feature ambition

- The roadmap in `plan/claude.md` is detailed and strategically thoughtful.
- The code already reflects forward-looking features (task system, design spec ingestion, theme task generation).

## Critical gaps and risks

## A) Correctness and data integrity risks (highest priority)

1. **Style-change baseline appears incorrect in `useStyleEditor.applyStyle`**
   - The code applies the new inline style before reading `before` from computed styles.
   - This likely records an incorrect baseline, can break meaningful change filtering, and weakens undo/report fidelity.

2. **Change collapse key does not include element identity**
   - Collapse logic matches by `file + line + property`, not by actual element.
   - Multi-element edits sharing source metadata can overwrite each other in the report.

3. **Line mapping from transform is template-relative, not file-relative**
   - `transform.ts` calculates line numbers relative to template content.
   - Consumers expecting true file line anchors may patch the wrong location.

4. **Schema vs emitted payload drift**
   - `schema.ts` defines richer/typed change variants, but runtime report generation emits a narrower subset and custom shapes.
   - This contract drift raises integration risk for AI tools relying on stable schema semantics.

## B) Reliability and maintainability concerns

1. **Monolithic shell composition**
   - `src/shell/App.vue` combines very large state/event/UI/CSS concerns.
   - This slows iteration, increases regression probability, and makes behavior hard to reason about.

2. **State consistency issues in task composable**
   - `useTasks` keeps filtered task lists with manual refresh mechanics that can desynchronize from WS updates.
   - Module-level singleton state with side-effectful initialization complicates lifecycle predictability.

3. **Ad-hoc runtime heuristics in transform and component registration**
   - String/regex-based import detection and script injection are brittle across coding styles.
   - Unused imports and `any` usage indicate type-safety erosion in critical paths.

4. **Synchronous filesystem operations in hot server path**
   - Task/config reads and writes in plugin server are synchronous.
   - For larger projects or frequent updates, this can block the event loop and impact dev responsiveness.

## C) Product hardening gaps

1. **No automated tests found**
   - No unit/integration/e2e test files were detected.
   - High-risk modules (transform, report shaping, task lifecycle, WS events) are unguarded.

2. **Documentation is minimal where users start**
   - Root `README.md` is effectively empty.
   - The detailed plan exists, but operational and API docs for users/contributors are not discoverable from the root.

3. **Error handling and validation are thin**
   - API body parsing assumes valid JSON without robust error responses.
   - Input schemas, request validation, and explicit fault surfaces are limited.

4. **Security posture is dev-centric but under-specified**
   - CORS is permissive for API routes.
   - Given local-dev intent this may be acceptable, but constraints and threat assumptions are not formally documented.

## D) Delivery/strategy drift

- The codebase currently looks closer to a broad prototype than a tightly scoped MVP.
- Many advanced UI capabilities are partially implemented while foundational reliability (tests/contracts/docs) lags.
- This creates a scaling risk: adding features faster than trustworthiness improves.

## Observed strengths vs weaknesses summary

| Area | Strength | Weakness |
|---|---|---|
| Core architecture | Pragmatic single-plugin same-origin model | Tight coupling across runtime concerns |
| UX prototype | Rich interaction surface already | Large monolith and interaction complexity |
| AI integration model | Report-first approach is correct | Runtime payload/schema mismatch risk |
| Runtime robustness | Build currently succeeds (`pnpm build`) | No regression safety net (tests absent) |
| Documentation | Deep product plan exists | Entry-point docs and contribution guidance are weak |

## Priority recommendations

### Phase 1 - Stabilize correctness (immediate)

1. Fix style baseline capture and change-collapsing identity in `useStyleEditor`.
2. Normalize line mapping semantics (true file lines) and document transform guarantees.
3. Enforce report-schema conformance with runtime validators and fixture tests.
4. Add defensive API parsing with structured 4xx responses.

### Phase 2 - Introduce quality gates

1. Add unit tests for:
   - SFC transform attribute injection and line mapping.
   - Report generation and collapse behavior.
   - Task state transitions and WS event handling.
2. Add integration tests for plugin middleware endpoints.
3. Add one Playwright smoke e2e: open shell, select element, apply style, verify report.

### Phase 3 - Refactor for maintainability

1. Split `App.vue` into feature-focused modules/stores (selection, overlays, tasks, theme, keyboard).
2. Consolidate WS connection management into one shared service.
3. Replace fragile regex heuristics with structured parsing where practical.

### Phase 4 - Improve project usability

1. Replace root README with real quickstart + architecture + troubleshooting.
2. Document API and report schema examples in user-facing docs.
3. Publish contributor workflow (build/test/lint expectations).

## Final judgment

Annotask has an excellent conceptual foundation and clear product value. The project is already beyond a toy demo, but it is not yet dependable enough for broad agent-driven code modification workflows. If the team shifts focus from feature expansion to correctness + contract rigor + tests for one dedicated stabilization cycle, this could become a very strong developer tool.
