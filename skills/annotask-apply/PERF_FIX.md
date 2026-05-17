# Performance fix tasks

`perf_fix` tasks come from the Perf tab. Each task points at one Web Vital
or scanner finding (LCP, CLS, INP, oversized bundles, expensive renders,
forced layout in handlers).

## Read order

1. **`task.context.metric`** — which signal regressed (`'lcp'`, `'cls'`,
   `'inp'`, `'bundle_size'`, …). The fix surface varies dramatically by
   metric; don't apply an LCP fix recipe to a CLS task.
2. **`task.context.value`** + **`unit`** — the observed value. Use this
   to verify your fix in the Perf tab post-edit.
3. **`task.context.severity`** — `'critical' | 'serious' | 'moderate' |
   'minor'`. Critical CLS (>0.25) usually means a single layout shift you
   can squash; minor CLS may be unfixable without redesign.
4. **`task.context.category`** — `'rendering' | 'network' | 'bundle' |
   'interaction'`. The diagnosis lives in a different toolset for each.

## Fix patterns

- **LCP** — defer or preload the largest contentful element. Drop hero
  images to the right format/size; preconnect to the right origins.
- **CLS** — explicit dimensions on images, reserved space for async
  content (banners, ads, late-loaded fonts).
- **INP** — break long tasks, debounce input handlers, move work off the
  main thread.
- **Bundle size** — confirm the offender lives in user code, not a
  vendor chunk. Tree-shake or lazy-load instead of swapping libraries.

## Don't

- Don't suppress the metric by changing what gets counted (e.g. excluding
  a route from RUM).
- Don't ship a "fix" that improves the metric in dev but regresses in
  prod (e.g. removing `import.meta.hot` blocks).
- Don't refactor unrelated code in a perf task.

Set `status: 'review'` with a resolution that names the metric and the
post-fix expected value (`'CLS dropped from 0.31 to ~0.05 — reserved space
for hero image'`). The user re-runs the Perf scan to confirm.
