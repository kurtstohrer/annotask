# Agent-loop evaluation harness

The agent-loop e2e suite measures the Annotask round-trip — user
annotates → task lands in MCP → coding agent applies the change →
re-render verifies the fix — for the three highest-leverage task types
on the stress-test playground.

It is the credibility artifact behind the public demo and the
design-partner pitch deck. The numbers it emits are how we'll know
whether shipping the next task type is helping or regressing the loop.

> **v1 scope.** The simulator that stands in for the coding agent is
> deterministic and rule-based — not LLM-driven. The harness is here
> to measure *plumbing reliability* (does the task land, do the MCP
> tools work, does HMR pick the fix up, do metrics persist) so we can
> ship the public demo without a paid-LLM dependency. The follow-up
> ticket on **agent-apply quality** (tracked under
> [ANN-1](/ANN/issues/ANN-1) child issues) is where the real LLM gets
> wired into this same harness.

## What each test proves

| Task type     | Test surface                                                            | Round-trip assertion                                                          |
| ------------- | ----------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `style_update`| Tracer stylesheet on a known `data-agent-loop-target` element.          | Iframe `getComputedStyle().color` flips after Vite HMR.                       |
| `a11y_fix`    | `<img>` in the test-only target component with `alt` attribute removed. | `axe-core` rescan reports zero `image-alt` violations after the fix.           |
| `error_fix`   | `console.error(<tracer>)` injected into the target component.           | Console listener sees zero tracer errors after the fix lands.                  |

All three tests run on both **React+Vite** (`react-workflows`, port
4210) and **Vue+Vite** (`vue-data-lab`, port 4220) MFEs. Adding a new
framework target is a single entry in
`playgrounds/stress-test/e2e/annotask/helpers/agent-loop/targets.ts`.

## How the simulator stands in for an agent

The agent simulator
(`playgrounds/stress-test/e2e/annotask/helpers/agent-loop/simulator.ts`)
calls the same `annotask` CLI flags a real coding agent would (`--mcp`,
`--server=…`) so we exercise the MCP-shaped tool surface end-to-end:

1. `annotask task <id> --mcp` — hydrate full task detail
2. `annotask update-task <id> --status=in_progress --mcp` — lock it
3. **Apply step (rule-based for v1):**
   - `style_update` — replace the `before` rgb literal with `after` in
     `agent-loop-target.css`
   - `a11y_fix` — for `rule: image-alt`, regex-inject `alt=""` on any
     `<img>` missing the attribute
   - `error_fix` — strip every line containing the test's tracer
     comment marker
4. `annotask update-task <id> --status=review --resolution="…" --mcp`

The apply step is what an LLM coding agent will replace in the v2
ticket. The rest of the loop — lock, fetch context, mark review,
re-fetch denied tasks — is the production path.

## Running the suite

```bash
pnpm build                       # CLI must be built first; simulator uses dist/cli.js
pnpm test:e2e:stress:annotask    # runs everything under playgrounds/stress-test/e2e/annotask/
```

The Playwright config under `playgrounds/stress-test/e2e/` boots the
host shell, the seven stress MFEs, and the four fast native API
services with `reuseExistingServer: true`. First boot takes about a
minute while Vite optimizes deps.

The agent-loop specs run in `serial` mode per (framework × task type)
because each test mutates the AgentLoopTarget component file and
restores it in `afterEach`. Two concurrent style_update tests on the
same MFE would race on the file.

## Reading the metrics output

Each test writes one JSON file under
`playgrounds/stress-test/e2e/annotask/reports/agent-loop/`:

```json
{
  "task_type": "style_update",
  "app_id": "react-workflows",
  "framework": "react+vite",
  "outcome": "success",
  "time_to_apply_ms": 412,
  "retries": 0,
  "denied_on_first_try": false,
  "task_id": "task-abc123",
  "resolution": "Swapped color from rgb(255, 0, 0) to rgb(0, 128, 0) in agent-loop-target.css",
  "error_message": null,
  "recorded_at": "2026-05-12T20:21:14.882Z"
}
```

Field meanings — useful when this seeds the eval dashboard:

- **outcome** — `success` if the round-trip assertion passes; otherwise
  `failure` with `error_message` set.
- **time_to_apply_ms** — wall-clock from simulator start to task
  transitioning to `review`. Not the full round-trip — HMR and re-scan
  time are reported in the Playwright test duration, not here.
- **retries** — always `0` in v1 (simulator does not loop). When the
  LLM agent lands, the simulator will increment this on `denied` →
  `in_progress` cycles.
- **denied_on_first_try** — placeholder for the v2 LLM apply harness.
  The deterministic simulator never gets denied today.
- **task_id** / **resolution** — copied from the MCP-CLI response to
  make it easy to grep back to the originating task without re-running
  the suite.

## v1 caveats (what's *not* tested yet)

- The shell's inspector tool is not driven for `style_update` — tasks
  are seeded via the per-MFE API. Driving the inspector tool is its own
  test; the agent-loop suite focuses on what the agent does *after*
  the task lands.
- The "Create Fix Task" button on `a11y_fix` is exercised in
  `annotate.spec.ts`. The agent-loop suite seeds a deterministic task
  shape directly so the simulator can run against a known anchor.
- The simulator's deterministic apply rules cover **one** failure mode
  per task type. The v2 ticket on agent-apply quality expands rules
  (or, more likely, replaces them with an LLM call) so the harness can
  measure performance on the full task-type matrix.
- `retries` and `denied_on_first_try` are wired into the metric shape
  but always zero/false in v1. The schema is locked so the dashboard
  doesn't churn when the LLM agent ships.

## How to add a new task type

1. Add a deterministic apply function to `helpers/agent-loop/simulator.ts`.
2. Add a fixture to `AgentLoopTarget.{tsx,vue}` (or a sibling target
   file) that the test can mutate to seed the failure mode.
3. Add a spec under `playgrounds/stress-test/e2e/annotask/agent-loop/`
   following the same `capture → seed → drive shell → simulate →
   verify → restore` pattern.
4. Extend `TaskTypeKey` in `helpers/agent-loop/metrics.ts` so the JSON
   output stays type-checked.
5. Document the new task type in the table at the top of this file.
