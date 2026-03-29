# Improvement Plan

Synthesized from:
- `feedback/claude-opus-4-6.md`
- `feedback/copilot-grok-code-fast-1.md`
- `feedback/copilot-gemini-3-1-pro.md`
- `feedback/copilot-gpt-5-4.md`
- `feedback/openai-gpt-5-3-codex.md`

## Core Direction

Do a stabilization pass before adding more surface area. The repeated theme across every review is the same: Annotask already proves the product idea, but the trust boundary is still weak. The next cycle should make reports correct, validate the runtime contract, harden the dev-only boundary, and add regression coverage.

## Repeated Gaps

### 1. Correctness and report fidelity

- `src/shell/composables/useStyleEditor.ts` captures style `before` values after mutating the DOM.
- `src/plugin/transform.ts` emits template-relative line numbers instead of file-relative ones.
- The transform path still relies on brittle string scanning for template parsing.
- Class edits in `src/shell/App.vue` do not emit `class_update` records.
- Report metadata is hardcoded instead of reflecting the actual project.
- Change collapsing is keyed too loosely and can merge edits from different elements.
- `src/schema.ts` is ahead of runtime emission, which makes the external contract unreliable.

### 2. Safety and runtime hardening

- The transform/injection path appears to run outside dev-server-only mode.
- API and WebSocket payloads have little or no validation.
- Some browser-side HTML insertion paths should be sanitized before catalog data becomes dynamic.
- The CLI and WebSocket clients need more resilient reconnect behavior.
- The local-dev security model is implicit rather than clearly documented and enforced.

### 3. Maintainability and state architecture

- `src/shell/App.vue` is too monolithic for the number of concerns it owns.
- `src/shell/components/ThemePage.vue` and `src/shell/composables/useStyleEditor.ts` each mix too many responsibilities.
- WebSocket connection logic is duplicated across composables.
- Module-level singleton state and side-effectful initialization make lifecycle behavior harder to reason about.
- Route tracking and annotation cleanup rely on fragile heuristics.

### 4. Quality gates and operational maturity

- There is no meaningful automated test coverage for the transform, report generation, API layer, or task pipeline.
- There is no visible CI gate protecting the core data contract.
- Root docs are too thin for new users and contributors.
- Packaging and metadata are still prototype-level (`0.0.1`, sparse package metadata, Vue-only implementation despite broader schema claims).

## Plan

### Phase 1 - Fix the trust boundary first

1. Fix style baseline capture in `src/shell/composables/useStyleEditor.ts` so `before` is read before `setProperty`.
2. Fix file line mapping in `src/plugin/transform.ts` so emitted lines include the template offset.
3. Replace or harden the tag scanner in `src/plugin/transform.ts` with compiler-backed parsing, or at minimum cover backticks and known edge cases with fixtures.
4. Emit `class_update` records from the class editor path in `src/shell/App.vue`.
5. Populate report `project` metadata from detected project/design-spec state instead of hardcoded values.
6. Include stable element identity in change-collapse keys so sibling edits on the same source line do not overwrite each other.
7. Add a report-shaping pass that guarantees runtime output conforms to `src/schema.ts`.

### Phase 2 - Harden the dev-only and API boundaries

1. Ensure all Annotask transforms, globals, and toggle-button injection are gated to dev/serve mode.
2. Add structured validation for API request bodies and WebSocket messages, with clear 4xx errors for invalid payloads.
3. Sanitize any HTML insertion path that interpolates catalog or user-derived values.
4. Make the CLI reconnect on transient socket loss instead of exiting immediately.
5. Document the local-only security model, supported threat assumptions, and project-root write constraints.

### Phase 3 - Add regression coverage before more features

1. Add unit tests for `src/plugin/transform.ts` covering attribute injection, file-relative lines, and parser edge cases.
2. Add unit tests for `src/shell/composables/useStyleEditor.ts` covering style baselines, report generation, class updates, and collapse behavior.
3. Add integration tests for `src/server/api.ts`, task lifecycle flows, and WebSocket event handling.
4. Add one browser smoke test for the end-to-end loop: open shell, select element, apply edit, verify report.
5. Add CI to run build + automated tests on every change.

### Phase 4 - Refactor for maintainability

1. Split `src/shell/App.vue` into focused modules for selection, overlays, tasks, route/iframe sync, and shell chrome.
2. Break `src/shell/components/ThemePage.vue` and `src/shell/composables/useStyleEditor.ts` into smaller services with clearer ownership.
3. Consolidate WebSocket transport into one shared connection/service used by tasks, report updates, and design spec state.
4. Replace heuristic cleanup logic with stable IDs for annotations and task links.
5. Replace polling-based route detection with event-driven navigation tracking where possible.

### Phase 5 - Align product messaging with current reality

1. Update `README.md` with a real quickstart, development workflow, limitations, and troubleshooting.
2. Add contributor docs covering architecture, build/test commands, and the report contract.
3. Clearly position the project as Vue-first until React/Svelte support actually exists.
4. Audit half-wired features/options and either finish them, mark them experimental, or remove them from the surface area.
5. Avoid adding new major features until Phases 1-3 are complete.

## Suggested Sequence

1. Correctness fixes (`useStyleEditor`, `transform`, class report emission, metadata).
2. Schema/runtime validation.
3. Dev-only gating and API validation.
4. Tests and CI.
5. Refactors and documentation cleanup.

## Exit Criteria

The stabilization pass is done when all of the following are true:

- A style or class edit always produces a correct `before`/`after` report.
- Source anchors point to the correct file and line even in larger SFCs.
- Runtime reports are validated against the documented schema.
- Annotask instrumentation does not leak into production builds.
- The core flow is covered by automated tests and enforced in CI.
- The README explains what works today, what is experimental, and how to verify the tool locally.
