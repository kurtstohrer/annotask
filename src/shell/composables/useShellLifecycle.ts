import { onMounted, onUnmounted, type Ref } from 'vue'
import type { useIframeManager } from './useIframeManager'
import type { useAnnotations } from './useAnnotations'
import type { useLayoutOverlay } from './useLayoutOverlay'
import type { InteractionMode } from './useInteractionMode'

interface UseShellLifecycleOptions {
  iframe: ReturnType<typeof useIframeManager>
  iframeRef: Ref<HTMLIFrameElement | null>
  annotations: ReturnType<typeof useAnnotations>
  layoutOverlay: ReturnType<typeof useLayoutOverlay>
  interactionMode: Ref<InteractionMode>
  showWarning: Ref<boolean>

  setupBridgeEvents: () => void
  restoreAnnotationsFromTasks: () => Promise<void>
  resolveSelectTaskEids: () => void
  scheduleAutoScan: () => void
}

/**
 * Wires the iframe bridge + load listeners to the Vue lifecycle.
 * Handles initial annotation seeding, bridge-ready setup (source mapping
 * check, initial route sync), and cleanup on unmount.
 */
export function useShellLifecycle(opts: UseShellLifecycleOptions) {
  const {
    iframe, iframeRef, annotations, layoutOverlay, interactionMode, showWarning,
    setupBridgeEvents, restoreAnnotationsFromTasks, resolveSelectTaskEids, scheduleAutoScan,
  } = opts

  async function onIframeLoad() {
    iframe.initBridgeForIframe()

    iframe.onBridgeReady(async () => {
      iframe.setMode(interactionMode.value)
      // Check source mapping — defer to allow frameworks (React, Svelte) to render first
      const hasMapping = await iframe.checkSourceMapping()
      if (!hasMapping) {
        // Retry after a delay: frameworks may not have rendered yet on bridge ready
        await new Promise((r) => setTimeout(r, 2000))
        showWarning.value = !(await iframe.checkSourceMapping())
      }
      // Get actual route from bridge and persist it
      const route = await iframe.getCurrentRoute()
      annotations.setRoute(route)
      localStorage.setItem('annotask:lastRoute', route)
      await resolveSelectTaskEids()
      if (layoutOverlay.showOverlay.value) layoutOverlay.scan()
      scheduleAutoScan()
    })
  }

  onMounted(async () => {
    // Seed route before bridge sync so restored annotations are filtered predictably.
    const savedRoute = localStorage.getItem('annotask:lastRoute') || '/'
    annotations.setRoute(savedRoute)
    // Restore annotations from persisted tasks first (bridge-independent).
    await restoreAnnotationsFromTasks()

    iframe.mountBridge()
    setupBridgeEvents()
    iframeRef.value?.addEventListener('load', onIframeLoad)
    // If iframe already loaded, trigger manually
    if (iframeRef.value?.contentWindow) onIframeLoad()
  })

  onUnmounted(() => {
    iframeRef.value?.removeEventListener('load', onIframeLoad)
    iframe.unmountBridge()
  })
}
