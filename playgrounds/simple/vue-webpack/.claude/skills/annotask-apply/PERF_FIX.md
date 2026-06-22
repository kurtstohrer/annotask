# Performance fix tasks

`perf_fix` tasks come from the Perf tab. Each task points at one finding:
a Web Vital that regressed, a heavy resource group, a heavy bundle
package, or long main-thread tasks captured during a recording.

## Read order

1. **`task.context.category`** — what kind of finding this is:
   `'vital' | 'resource' | 'long-task' | 'bundle'`. The fix surface
   varies dramatically by category; don't apply a vitals recipe to a
   bundle task.
2. **`task.context.metric`** — present **only on `vital` findings**: the
   uppercase Web Vital name (`'LCP'`, `'CLS'`, `'INP'`, `'TTFB'`,
   `'FCP'`). Non-vital findings have no `metric`; key off `category`
   and `findingId` instead.
3. **`task.context.findingId`** — stable id that also encodes the
   offender: `vital:LCP`, `resource:heavy-script`,
   `bundle:lodash`, `blocking:long-tasks`.
4. **`task.context.value`** + **`unit`** — the observed value (`'ms'`
   for vitals and long tasks, `'bytes'` for resource/bundle findings,
   empty unit for CLS which is unitless). Use this to verify your fix
   in the Perf tab post-edit.
5. **`task.context.severity`** — the Web Vitals rating scale:
   `'good' | 'needs-improvement' | 'poor'`. `poor` CLS (>0.25) usually
   means a single layout shift you can squash; `needs-improvement` may
   be unfixable without redesign.
6. **`task.context.detail`** / **`resources`** — human-readable summary,
   and (on `resource` findings) the offending URLs with sizes and
   durations. `context.metrics` carries the full snapshot when one was
   captured.

## Fix patterns

- **LCP** — defer or preload the largest contentful element. Drop hero
  images to the right format/size; preconnect to the right origins.
- **CLS** — explicit dimensions on images, reserved space for async
  content (banners, ads, late-loaded fonts).
- **INP** — break long tasks, debounce input handlers, move work off the
  main thread. `blocking:long-tasks` findings give you Total Blocking
  Time and pair naturally with INP work.
- **Resource / bundle size** — confirm the offender lives in user code,
  not a vendor chunk. Tree-shake or lazy-load instead of swapping
  libraries; the `bundle:<package>` finding's detail may already
  suggest a lighter alternative.

## Don't

- Don't suppress the metric by changing what gets counted (e.g. excluding
  a route from RUM).
- Don't ship a "fix" that improves the metric in dev but regresses in
  prod (e.g. removing `import.meta.hot` blocks).
- Don't refactor unrelated code in a perf task.

Set `status: 'review'` with a resolution that names the finding and the
post-fix expected value (`'CLS dropped from 0.31 to ~0.05 — reserved space
for hero image'`). The user re-runs the Perf scan to confirm.
