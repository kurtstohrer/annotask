import { ref } from 'vue'
import type { useIframeManager } from './useIframeManager'

type IframeManager = ReturnType<typeof useIframeManager>

export function useScreenshots(iframe: IframeManager) {
  const snipActive = ref(false)
  const snipRect = ref<{ x: number; y: number; width: number; height: number } | null>(null)
  const snipStart = ref<{ x: number; y: number } | null>(null)
  const pendingScreenshot = ref<string | null>(null)

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
  }

  /** Consume the pending screenshot (returns filename and clears it) */
  function consumeScreenshot(): string | null {
    const s = pendingScreenshot.value
    pendingScreenshot.value = null
    return s
  }

  return {
    snipActive,
    snipRect,
    snipStart,
    pendingScreenshot,
    startSnip,
    onSnipDown,
    onSnipMove,
    onSnipUp,
    cancelSnip,
    removeScreenshot,
    consumeScreenshot,
  }
}
