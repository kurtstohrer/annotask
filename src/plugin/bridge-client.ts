/**
 * Client bridge script injected into the user's app.
 * Communicates with the Annotask shell via postMessage.
 * Handles all DOM interactions: hover, click, style reads/writes,
 * element resolution, layout scanning, etc.
 *
 * Assembled from focused modules under bridge/ — each returns a
 * fragment of vanilla JS that runs inside a single IIFE.
 */
import { bridgeRegistry } from './bridge/registry.js'
import { bridgeEvents } from './bridge/events.js'
import { bridgeHelpers } from './bridge/helpers.js'
import { bridgeMessages } from './bridge/messages.js'
import { bridgePerfObservers } from './bridge/perf-observers.js'
import { bridgeNetworkMonitor } from './bridge/network-monitor.js'

export function bridgeClientScript(): string {
  return `
(function() {
  // Don't run inside the Annotask shell
  if (window.location.pathname.startsWith('/__annotask')) return;
  // Don't run if already initialized
  if (window.__ANNOTASK_BRIDGE__) return;
  window.__ANNOTASK_BRIDGE__ = true;
${bridgeRegistry()}${bridgeEvents()}${bridgeHelpers()}${bridgeMessages()}${bridgePerfObservers()}${bridgeNetworkMonitor()}
})();
`.trim()
}
