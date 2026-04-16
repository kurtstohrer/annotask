# Reviewing Annotask PRs

A short checklist. Reviewers should skim this and block PRs that violate it without a clear justification in the description.

## Always-on rules

- [ ] **One canonical definition per rule.** Screenshot filename regex, status transitions, PATCH field whitelists, rect-to-shell coordinate transforms, wire schemas — each has exactly one home (`src/server/validation.ts`, `src/server/schemas.ts`, or `src/shell/utils/`). New duplicates are rejected.
- [ ] **No business logic in `App.vue`.** Orchestration only: wire composables, pass props, forward events. New logic goes into a composable under `src/shell/composables/`.
- [ ] **Shared-state composables are singletons with refcount**, not module-level globals. Use VueUse's `createSharedComposable` or the local idiom — never attach listeners at module scope without a matching teardown.
- [ ] **Every boundary validates.** HTTP bodies, MCP tool args, WS messages, `postMessage` payloads all parse through a schema (`zod` for server/MCP; a hand-rolled validator for the bridge).
- [ ] **Every rAF loop has a `document.hidden` guard** and an explicit teardown. Reviewers verify both.
- [ ] **No `any` in `src/schema.ts` or `src/shared/bridge-types.ts`.** These are the shared contracts; drift here causes silent cross-process breakage.
- [ ] **Tests required for:** every new MCP tool, every new HTTP endpoint, every task state transition rule.
- [ ] **Pin what you vendor.** Anything copied into `dist/vendor/` has an exact-version pin in `package.json` and a guard in `scripts/copy-vendor.mjs`.
- [ ] **Bump + changelog in the same commit** as the user-visible change. CI (or reviewer) verifies the top `CHANGELOG.md` heading matches the new `package.json` version.

## Size budgets (soft caps)

Files over budget either ship with an extraction plan in the PR description or get split in the same PR.

| File / type | Budget |
|---|---|
| `src/shell/App.vue` | ≤ 800 lines (currently over — trending down) |
| Any Vue component | ≤ 500 lines |
| Any composable | ≤ 200 lines |

## Security-sensitive changes

Extra scrutiny for PRs that touch:

- `src/server/origin.ts` — CORS / origin checks
- `src/server/validation.ts` + `src/server/schemas.ts` — wire contract
- `src/server/state.ts` — task store serialization
- `src/shell/services/iframeBridge.ts` — postMessage origin handling
- `scripts/copy-vendor.mjs` + vendored package pins

## How to check

```bash
pnpm typecheck
pnpm test                  # unit
pnpm test:e2e              # end-to-end (Playwright)
pnpm build                 # runs the vendor-guard script
wc -l src/shell/App.vue    # size budget
```
