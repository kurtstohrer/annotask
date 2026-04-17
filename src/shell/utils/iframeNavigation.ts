import { computed, type Ref } from 'vue'
import type { useViewportPreview } from '../composables/useViewportPreview'

/** Navigate the app iframe to a new route. */
export function navigateIframe(iframeRef: Ref<HTMLIFrameElement | null>, currentRoute: Ref<string>, route: string): void {
  const r = route.trim()
  if (!r || r === currentRoute.value) return
  const path = r.startsWith('/') ? r : '/' + r
  const iframeEl = iframeRef.value
  if (iframeEl?.contentWindow) {
    iframeEl.contentWindow.location.href = window.location.origin + path
  }
}

/** Compute the initial app URL from query params + saved route. */
export function useAppUrl() {
  return computed(() => {
    const params = new URLSearchParams(window.location.search)
    const base = params.get('appUrl') || window.location.origin
    const savedRoute = localStorage.getItem('annotask:lastRoute')
    return savedRoute ? base + savedRoute : base + '/'
  })
}

/** Compute an inline `style` object that sizes the iframe to the active viewport preview. */
export function useIframeStyle(viewport: ReturnType<typeof useViewportPreview>) {
  return computed(() => {
    const vp = viewport.effectiveViewport.value
    if (!vp.width && !vp.height) return {}
    return {
      width: vp.width ? `${vp.width}px` : '100%',
      height: vp.height ? `${vp.height}px` : '100%',
    }
  })
}
