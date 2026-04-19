import { ref } from 'vue'
import type { useIframeManager } from './useIframeManager'
import type { ScreenshotMeta } from '../../schema'

type IframeManager = ReturnType<typeof useIframeManager>

export function useScreenshots(iframe: IframeManager) {
  const snipActive = ref(false)
  const snipRect = ref<{ x: number; y: number; width: number; height: number } | null>(null)
  const snipStart = ref<{ x: number; y: number } | null>(null)
  const pendingScreenshot = ref<string | null>(null)
  const pendingScreenshotMeta = ref<ScreenshotMeta | null>(null)

  function startSnip() {
    snipActive.value = true
  }

  function onSnipDown(e: PointerEvent) {
    snipStart.value = { x: e.clientX, y: e.clientY }
    snipRect.value = { x: e.clientX, y: e.clientY, width: 0, height: 0 }
  }

  function onSnipMove(e: PointerEvent) {
    if (!snipStart.value) return
    const x = Math.min(snipStart.value.x, e.clientX)
    const y = Math.min(snipStart.value.y, e.clientY)
    snipRect.value = { x, y, width: Math.abs(e.clientX - snipStart.value.x), height: Math.abs(e.clientY - snipStart.value.y) }
  }

  async function onSnipUp() {
    let clipRect: { x: number; y: number; width: number; height: number } | null = null
    if (snipRect.value && snipRect.value.width > 30 && snipRect.value.height > 30) {
      const iCoords = iframe.toIframeCoords(snipRect.value.x, snipRect.value.y)
      const iCoordsEnd = iframe.toIframeCoords(snipRect.value.x + snipRect.value.width, snipRect.value.y + snipRect.value.height)
      if (iCoords && iCoordsEnd) {
        clipRect = { x: iCoords.x, y: iCoords.y, width: iCoordsEnd.x - iCoords.x, height: iCoordsEnd.y - iCoords.y }
      }
    }

    snipActive.value = false
    snipRect.value = null
    snipStart.value = null

    const result = await iframe.captureScreenshot(clipRect)
    if (result.error || !result.dataUrl) {
      console.warn('Screenshot failed:', result.error)
      return
    }

    try {
      const resp = await fetch('/__annotask/api/screenshots', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: result.dataUrl }),
      })
      const { filename } = await resp.json()
      pendingScreenshot.value = filename
      const viewport = iframe.getIframeViewport()
      if (viewport) {
        const meta: ScreenshotMeta = {
          viewport_rect: viewport,
          device_pixel_ratio: window.devicePixelRatio || 1,
        }
        if (clipRect) {
          meta.crop_rect = {
            x: Math.round(clipRect.x),
            y: Math.round(clipRect.y),
            w: Math.round(clipRect.width),
            h: Math.round(clipRect.height),
          }
        }
        pendingScreenshotMeta.value = meta
      }
    } catch {
      console.warn('Screenshot upload failed')
    }
  }

  function cancelSnip() {
    snipActive.value = false
    snipRect.value = null
    snipStart.value = null
  }

  function removeScreenshot() {
    pendingScreenshot.value = null
    pendingScreenshotMeta.value = null
  }

  /**
   * Consume the pending screenshot. Returns the filename and the spatial meta
   * captured at snip time (viewport, devicePixelRatio, crop rect), both
   * cleared. Callers can merge task-specific fields (element_rect,
   * arrow_endpoints, section_bounds) onto the returned meta.
   */
  function consumeScreenshot(): { filename: string; meta: ScreenshotMeta | null } | null {
    const filename = pendingScreenshot.value
    const meta = pendingScreenshotMeta.value
    pendingScreenshot.value = null
    pendingScreenshotMeta.value = null
    if (!filename) return null
    return { filename, meta }
  }

  return {
    snipActive,
    snipRect,
    snipStart,
    pendingScreenshot,
    pendingScreenshotMeta,
    startSnip,
    onSnipDown,
    onSnipMove,
    onSnipUp,
    cancelSnip,
    removeScreenshot,
    consumeScreenshot,
  }
}
