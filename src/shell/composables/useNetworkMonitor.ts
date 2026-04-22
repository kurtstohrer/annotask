/**
 * Shell-side bridge receiver for iframe network events.
 *
 * The iframe's bridge client patches fetch / XHR / sendBeacon and POSTS each
 * batch directly to `/__annotask/api/runtime-endpoints`. It also broadcasts
 * `network:calls` via postMessage for anything in the shell that wants a
 * live feed — but forwarding the batch a second time from here would cause
 * the server aggregator to double-count every call when the shell is open.
 *
 * This composable is now a no-op seam: the bridge is wired so future features
 * (a live-tail panel, etc.) can subscribe without reintroducing the duplicate
 * ingest path. Capture itself happens entirely iframe-side.
 */
import type { useIframeManager } from './useIframeManager'

type IframeManager = ReturnType<typeof useIframeManager>

export function useNetworkMonitor(_iframe: IframeManager) {
  function init(): void {
    // Intentionally empty — iframe posts directly. See file header.
  }
  return { init }
}
