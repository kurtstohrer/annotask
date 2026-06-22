/**
 * Shared overlay loop runtime for every surface that paints rects over the
 * iframe DOM and must keep them aligned as the app scrolls / resizes:
 * data-source highlights, a11y highlights, and (soon) the wireframe canvas's
 * drop-targets and placement outlines.
 *
 * Before this, `useDataHighlights` and `useA11yHighlights` each carried their
 * own copy of the same boilerplate — an rAF tick, a re-entrancy guard, a
 * page-visibility guard, and the active/inputs watchers — which drifted out of
 * sync and gave the wireframe nowhere to plug in. This is the single home for
 * that lifecycle (and the natural seat for the activity-throttled, delta-aware
 * refresh in overlay step O5).
 *
 * The engine owns *when* a refresh runs; the producer owns *what* a refresh
 * does (its bridge calls + rect merge). A producer stays a plain
 * `async refresh()` that resolves + sets its own `rects` ref; the engine
 * guarantees it is never run re-entrantly, never while the tab is hidden, and
 * never while the surface is inactive or idle.
 */
import { watch, type Ref } from 'vue'

/** Shared upper bound on rects drawn in one overlay pass. Centralized here so
 *  every surface (and the density/clustering work in O4) shares one budget
 *  instead of each composable hard-coding its own 400. */
export const OVERLAY_RECT_CAP = 400

/**
 * Minimum gap between rect re-resolves while the loop runs (~30fps). The loop
 * still ALWAYS refreshes — it's only rate-capped — so overlays can never go
 * stale beyond this bound (imperceptible during scroll), but the per-frame
 * bridge round-trip cost is roughly halved versus refreshing every animation
 * frame. `kick()` bypasses the cap so focus/source changes paint instantly.
 *
 * A fuller "only refresh when the iframe actually moved" gate would need the
 * iframe to emit scroll/resize/mutation signals (it doesn't today, and the
 * annotation-rect loop polls every frame the same way) — a coordinated
 * cross-overlay change left as follow-up. This cap is the safe, no-staleness win.
 */
const MIN_REFRESH_INTERVAL_MS = 33

function nowMs(): number {
  return typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now()
}

export interface OverlayLoopDeps {
  /** True while the overlay surface is visible. The loop only runs while
   *  active; flipping it false stops the rAF loop and triggers `onDeactivate`. */
  active: Ref<boolean>
  /** One refresh pass against the iframe DOM — resolve locations/selectors to
   *  rects and assign the producer's own `rects` ref. The engine guards
   *  re-entrancy and page-visibility, so this can stay a plain async resolve. */
  refresh: () => Promise<void>
  /** Reactive inputs whose change should (re)drive the loop — typically the
   *  producer's source / violation list. Watched deeply; a change kicks an
   *  immediate refresh and ensures the loop is running. */
  inputs: () => unknown
  /** Optional idle predicate. When it returns true the loop stops itself (and
   *  `startLoop` won't start) so an empty surface costs zero rAF time — mirrors
   *  the old "stop the loop when there are no sources" behavior. */
  isIdle?: () => boolean
  /** Clear producer state (rects, focus, …) when the surface deactivates. */
  onDeactivate?: () => void
}

export interface OverlayLoop {
  /** Ensure the rAF loop is running (no-op if already running, inactive, or
   *  idle). */
  startLoop: () => void
  /** Refresh immediately and ensure the loop is running — call after pushing
   *  new inputs so the surface paints within the same frame instead of waiting
   *  for the next tick. */
  kick: () => void
  /** Run exactly one refresh pass now, guarded against re-entrancy. */
  runOnce: () => Promise<void>
}

export function useOverlayLoop(deps: OverlayLoopDeps): OverlayLoop {
  const { active, refresh, inputs, isIdle, onDeactivate } = deps

  let loopRunning = false
  let rafHandle: number | null = null
  let refreshInFlight = false
  let lastRunAt = 0

  function idle(): boolean {
    return isIdle ? isIdle() : false
  }

  async function runOnce(): Promise<void> {
    if (refreshInFlight) return
    refreshInFlight = true
    lastRunAt = nowMs()
    try {
      await refresh()
    } finally {
      refreshInFlight = false
    }
  }

  function stopLoop(): void {
    loopRunning = false
    if (rafHandle !== null) {
      cancelAnimationFrame(rafHandle)
      rafHandle = null
    }
  }

  function startLoop(): void {
    if (loopRunning || !active.value || idle()) return
    loopRunning = true
    const tick = () => {
      if (!active.value || idle()) {
        stopLoop()
        return
      }
      // Skip work while the tab is backgrounded, but keep the rAF alive so the
      // loop resumes the instant the tab is visible again.
      if (typeof document !== 'undefined' && document.hidden) {
        rafHandle = requestAnimationFrame(tick)
        return
      }
      // Rate-cap the bridge round-trip to ~30fps. Always refreshes (no
      // staleness) — just not on every single animation frame.
      if (nowMs() - lastRunAt >= MIN_REFRESH_INTERVAL_MS) runOnce()
      rafHandle = requestAnimationFrame(tick)
    }
    rafHandle = requestAnimationFrame(tick)
  }

  function kick(): void {
    if (!active.value) return
    runOnce() // immediate — bypasses the rate cap (runOnce stamps lastRunAt)
    startLoop()
  }

  watch(active, (v, old) => {
    if (v && !old) {
      kick()
    } else if (!v && old) {
      // Cancel the queued tick too — a bare `loopRunning = false` leaves one
      // frame in flight, and a reactivate before it fires would stack a second
      // loop on top of it.
      stopLoop()
      onDeactivate?.()
    }
  })

  // Deep-watch the producer's inputs so a new source/violation list repaints
  // immediately (and restarts the loop if it had idled out).
  watch(inputs, () => {
    if (active.value) kick()
  }, { deep: true })

  return { startLoop, kick, runOnce }
}
