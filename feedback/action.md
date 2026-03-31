# Annotask Action Plan

Synthesized from three independent reviews (Codex GPT-5, Copilot Gemini, Copilot Grok). Items are included only where reviewers agree or the issue is clearly valid on inspection. Organized by priority.

---

## Phase 1: Hardening & Correctness

These are the highest-leverage changes. All three reviewers agree the system works but can't be fully trusted yet. Fixing these makes every future feature more credible.

### 1.1 Async I/O + atomic writes in state.ts

**Problem:** `state.ts` uses `readFileSync`/`writeFileSync` in request handlers. Two concurrent writes (agent + browser) can lose data via read-modify-write races.

**Plan:**
- Replace all sync fs calls with `fs.promises.*`
- Hold tasks in memory after first load, flush to disk on mutation
- Use atomic write pattern (write to `.tmp`, rename over original)
- Add a simple in-process write queue (no need for SQLite — this is a single-user localhost tool, native deps would complicate install)

### 1.2 CORS and origin restrictions

**Problem:** API sets `Access-Control-Allow-Origin: *` on all endpoints including POST/PATCH. Any website the developer visits could mutate tasks.

**Plan:**
- Restrict CORS to `localhost` / `127.0.0.1` origins only
- Validate `Origin` header on mutating requests, reject if not local
- Validate `postMessage` sender in `iframeBridge.ts` against the actual iframe `contentWindow`

### 1.3 Whitelist patchable task fields

**Problem:** `PATCH /tasks/:id` validates `status` then blindly `Object.assign`s everything else. Arbitrary fields can be injected into persisted tasks.

**Plan:**
- Define an explicit allowlist of patchable fields (e.g. `status`, `description`, `notes`, `screenshot`)
- Strip unknown fields before applying updates
- Return 400 for unknown fields (or silently drop — TBD)

### 1.4 Expand framework enum in schema.ts

**Problem:** `AnnotaskReport.project.framework` only allows `'vue' | 'react' | 'svelte'` but the tool supports Astro, HTML, and htmx. AI consumers get wrong metadata.

**Plan:**
- Add `'astro' | 'html' | 'htmx'` to the framework union type
- Update `useStyleEditor` to stop defaulting to `'vue'` for unknown frameworks
- Audit anywhere the framework string is used to ensure all values are handled

---

## Phase 2: Quality & Structure

### 2.1 Break up App.vue

**Problem:** App.vue is 1806 lines mixing selection state, task creation, screenshots, a11y, viewport, keyboard shortcuts, and review logic. All three reviewers flag this.

**Plan:**
- Extract into focused components/composables:
  - Task creation + review workflow
  - Screenshot capture + management
  - Keyboard shortcut handling
  - Selection / inspector state (may already be partially in composables)
- Remove unused `A11yTab.vue` import if confirmed dead
- Clean up `any` casts where reasonable

### 2.2 Add typecheck script and CI step

**Problem:** No `tsc --noEmit` in scripts or CI despite heavy TypeScript usage.

**Plan:**
- Add `"typecheck": "tsc --noEmit"` to package.json scripts
- Add typecheck step to `.github/workflows/ci.yml`

### 2.3 Run Playwright in CI (slim matrix)

**Problem:** CI only runs build + unit tests. E2e tests exist but never run in CI. Framework coverage gaps.

**Plan:**
- Add a Playwright step to CI with a small matrix (vue-vite, react-vite at minimum)
- Fix any currently-failing e2e tests
- Add Astro/HTML/htmx to the Playwright config to match advertised support (can be marked `@slow` or run only on push to main)

### 2.4 Bundle axe-core and html2canvas locally

**Problem:** These are loaded from cdnjs at runtime. Breaks under CSP, fails offline, awkward for enterprise.

**Plan:**
- Include both as devDependencies
- Inject from local assets served by the Annotask plugin instead of CDN URLs
- Keep CDN as optional fallback if local load fails

### 2.5 MFE end-to-end filtering

**Problem:** MFE filtering only works on task GET. Live report changes and `useStyleEditor` don't carry `mfe` context.

**Plan:**
- Thread `mfe` identifier through report change events
- Add server-side report filtering for `GET /report?mfe=...`
- Ensure `annotask report --mfe=...` returns correctly scoped data

---

## Phase 3: New Features

Selected from reviewer suggestions where at least two reviewers agree or the feature clearly fills a gap.

### 3.1 `annotask doctor`

Diagnostic command that checks:
- Whether `.annotask/server.json` is stale
- Shell assets are present and correct version
- Source mapping coverage (how many visible elements have file/line metadata)
- CDN reachability / CSP compatibility
- Framework detection accuracy

### 3.2 Before/after visual diffing on task completion

When an agent marks a task `applied` or `review`:
- Auto-capture a new screenshot
- Store both before (original task screenshot) and after
- Show a comparison view in the shell for accept/reject workflow

### 3.3 Git context on tasks

- Auto-tag tasks with current branch and commit hash at creation time
- Add optional branch filter to task listing (`GET /tasks?branch=...`)
- Show branch context in the shell task list

### 3.4 Task quality scoring

Surface warnings when a task is missing context that would help an agent:
- No file/line metadata
- No element context
- No screenshot
- No viewport info
- Missing interaction history

Display as a completeness indicator in the shell and include in API responses.

### 3.5 Source mapping diagnostics panel

Shell UI panel showing:
- How many visible elements have resolvable file/line/component metadata
- Which framework transform path is active
- Where mapping falls back or fails
- Useful for both debugging and building confidence in the tool

---

## Explicitly Deferred

These were suggested but don't make sense right now:

| Idea | Why deferred |
|---|---|
| SQLite storage | Adds native dep complexity for a localhost single-user tool. Async I/O + atomic writes solves the actual problem. |
| AST-based transforms | Architecture doc explicitly chose string scanning for speed/simplicity. Current approach works — invest in better test coverage for edge cases instead of a rewrite. |
| Figma/Penpot sync | Large scope, different product direction. Revisit after core is hardened. |
| Angular/SolidJS/Qwik support | No demand signal. Framework list is already broad. |
| Multi-user collaboration | Annotask is a local dev tool, not a design platform. |
| VS Code extension | Good idea but significant standalone effort. Consider after API is stable. |
| IDE CodeLens integration | Same as above. |
| Role-based access / enterprise auth | Premature for current stage. |
| Real `annotask init` replacing skill | The skill-based approach is intentional — it lets the LLM use judgment for framework detection. A deterministic scanner would be less flexible. Revisit if users report poor init quality. |
| `annotask export` / `apply --dry-run` | Useful but lower priority than hardening. |
| Task dedup/merge | Nice to have, not blocking. |
| In-shell diff review | Depends on agent integration patterns stabilizing first. |

---

## Decisions (resolved)

1. **PATCH field policy:** Silently drop unknown fields (don't error). Agents evolve and send extra context — breaking them with strict 400s creates friction nobody wants to debug. Log a warning server-side for dev visibility.

2. **Screenshot size limit:** Bump capture limit to 4MB so retina screenshots don't fail. Add automatic downscaling (cap at 1280px wide) before serving via the API, so stored screenshots stay useful for visual diffing while API-served versions stay token-efficient. (Yes — larger images cost more LLM tokens since they get tiled internally.)

3. **CDN fallback:** Local-first, no silent fallback. Bundle axe-core and html2canvas with the package. If local assets are missing, fail explicitly with a clear error. Silent CDN fallbacks mask failures and break under CSP — tools like Storybook and Playwright take the same approach.