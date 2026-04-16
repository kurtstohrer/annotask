import { ref, type Ref } from 'vue'
import * as bridge from '../services/iframeBridge'
import type {
  ResolvedElement, TemplateGroupResult, BridgeRect,
  StyleGetComputedResult, StyleApplyResult,
  ClassSetResult, ElementClassificationData,
  LayoutContainerData, LayoutAddTrackResult, LayoutAddChildResult,
  CheckSourceMappingResult, ColorSwatch, ColorSchemeResult,
  InsertPlaceholderResult, InsertVueComponentResult,
  InteractionMode, PerfScanResult, PerfRecording,
} from '../../shared/bridge-types'

export function useIframeManager(iframeRef: Ref<HTMLIFrameElement | null>) {
  const currentRoute = ref('/')
  const bridgeReady = ref(false)

  /** Best-effort: derive the iframe's origin so the bridge doesn't have to post to '*'.
   *  For same-origin iframes (the common case) we can read contentWindow.location; if
   *  the iframe navigates cross-origin we fall back to the src URL origin. */
  function iframeOrigin(): string {
    const iframe = iframeRef.value
    if (!iframe) return ''
    try {
      const loc = iframe.contentWindow?.location
      if (loc && typeof loc.origin === 'string' && loc.origin && loc.origin !== 'null') return loc.origin
    } catch { /* cross-origin */ }
    try {
      const src = iframe.src
      if (src) return new URL(src, window.location.href).origin
    } catch { /* invalid URL */ }
    return ''
  }

  /** Initialize the bridge when the iframe loads */
  function initBridgeForIframe() {
    const win = iframeRef.value?.contentWindow
    if (!win) return
    bridge.resetBridge(win, iframeOrigin())
    bridgeReady.value = false

    bridge.onBridgeReady(() => {
      bridgeReady.value = true
    })

    // Route tracking via bridge events
    bridge.on('route:changed', (payload: { path: string }) => {
      currentRoute.value = payload.path
    })

    // bridge:ready may already be queued from bridge-client script execution
    // (before iframe load event). Probe on next tick to catch it.
    setTimeout(() => bridge.probeBridge(), 0)
  }

  /** Start the bridge listener (call once on shell mount) */
  function mountBridge() {
    const win = iframeRef.value?.contentWindow
    if (win) bridge.initBridge(win, iframeOrigin())
  }

  /** Clean up the bridge (call on shell unmount) */
  function unmountBridge() {
    bridge.destroyBridge()
  }

  // ── Coordinate Helpers ──────────────────────────────────

  /** Convert iframe-local rect to shell coordinates */
  function toShellRect(iframeLocalRect: BridgeRect): BridgeRect | null {
    const iframe = iframeRef.value
    if (!iframe) return null
    const f = iframe.getBoundingClientRect()
    return {
      x: f.left + iframeLocalRect.x,
      y: f.top + iframeLocalRect.y,
      width: iframeLocalRect.width,
      height: iframeLocalRect.height,
    }
  }

  /** Convert shell coordinates to iframe-local coordinates */
  function toIframeCoords(shellX: number, shellY: number): { x: number; y: number } | null {
    const iframe = iframeRef.value
    if (!iframe) return null
    const f = iframe.getBoundingClientRect()
    return { x: shellX - f.left, y: shellY - f.top }
  }

  // ── Bridge-based operations (async) ────────────────────

  async function resolveElementAt(shellX: number, shellY: number): Promise<ResolvedElement | null> {
    const coords = toIframeCoords(shellX, shellY)
    if (!coords) return null
    if (coords.x < 0 || coords.y < 0) return null
    const iframe = iframeRef.value
    if (!iframe) return null
    const f = iframe.getBoundingClientRect()
    if (coords.x > f.width || coords.y > f.height) return null
    try {
      const result = await bridge.request<ResolvedElement | null>('resolve:at-point', coords, 500)
      if (!result) return null
      // Convert rect to shell coordinates
      result.rect = toShellRect(result.rect) || result.rect
      return result
    } catch { return null }
  }

  async function findTemplateGroup(file: string, line: string, tagName: string): Promise<TemplateGroupResult> {
    try {
      const result = await bridge.request<TemplateGroupResult>('resolve:template-group', { file, line, tagName })
      // Convert rects to shell coordinates
      result.rects = result.rects.map(r => toShellRect(r) || r)
      return result
    } catch { return { eids: [], rects: [] } }
  }

  async function getElementRect(eid: string): Promise<BridgeRect | null> {
    try {
      const result = await bridge.request<{ rect: BridgeRect } | null>('resolve:rect', { eid })
      if (!result) return null
      return toShellRect(result.rect) || result.rect
    } catch { return null }
  }

  async function getElementRects(eids: string[]): Promise<(BridgeRect | null)[]> {
    if (eids.length === 0) return []
    try {
      const result = await bridge.request<{ rects: (BridgeRect | null)[] }>('resolve:rects', { eids: [...eids] })
      return result.rects.map(r => r ? (toShellRect(r) || r) : null)
    } catch { return eids.map(() => null) }
  }

  async function getComputedStyles(eid: string, properties: string[]): Promise<Record<string, string>> {
    try {
      const result = await bridge.request<StyleGetComputedResult>('style:get-computed', { eid, properties })
      return result.styles
    } catch { return {} }
  }

  async function applyStyleVia(eid: string, property: string, value: string): Promise<string> {
    try {
      const result = await bridge.request<StyleApplyResult>('style:apply', { eid, property, value })
      return result.before
    } catch { return '' }
  }

  async function applyStyleBatch(eids: string[], property: string, value: string): Promise<string[]> {
    try {
      const result = await bridge.request<{ befores: string[] }>('style:apply-batch', { eids: [...eids], property, value })
      return result.befores
    } catch { return eids.map(() => '') }
  }

  async function setClass(eid: string, classes: string): Promise<string> {
    try {
      const result = await bridge.request<ClassSetResult>('class:set', { eid, classes })
      return result.before
    } catch { return '' }
  }

  async function setClassBatch(eids: string[], classes: string): Promise<string[]> {
    try {
      const result = await bridge.request<{ befores: string[] }>('class:set-batch', { eids: [...eids], classes })
      return result.befores
    } catch { return eids.map(() => '') }
  }

  async function undoStyle(eid: string, property: string, value: string): Promise<void> {
    try { await bridge.request('style:undo', { eid, property, value }) } catch {}
  }

  async function undoClass(eid: string, classes: string): Promise<void> {
    try { await bridge.request('class:undo', { eid, classes }) } catch {}
  }

  async function classifyElement(eid: string): Promise<ElementClassificationData | null> {
    try {
      return await bridge.request<ElementClassificationData | null>('classify:element', { eid })
    } catch { return null }
  }

  async function scanLayout(): Promise<LayoutContainerData[]> {
    try {
      const result = await bridge.request<{ containers: LayoutContainerData[] }>('layout:scan')
      // Convert rects to shell coordinates
      for (const c of result.containers) {
        c.rect = toShellRect(c.rect) || c.rect
      }
      return result.containers
    } catch { return [] }
  }

  async function layoutAddTrack(eid: string, axis: 'col' | 'row'): Promise<LayoutAddTrackResult | null> {
    try {
      return await bridge.request<LayoutAddTrackResult>('layout:add-track', { eid, axis })
    } catch { return null }
  }

  async function layoutAddChild(eid: string): Promise<LayoutAddChildResult | null> {
    try {
      return await bridge.request<LayoutAddChildResult>('layout:add-child', { eid })
    } catch { return null }
  }

  async function checkSourceMapping(): Promise<boolean> {
    try {
      const result = await bridge.request<CheckSourceMappingResult>('check:source-mapping')
      return result.hasMapping
    } catch { return false }
  }

  async function injectThemeCss(css: string, styleId: string): Promise<void> {
    try { await bridge.request('theme:inject-css', { css, styleId }) } catch {}
  }

  async function removeThemeCss(styleId: string): Promise<void> {
    try { await bridge.request('theme:remove-css', { styleId }) } catch {}
  }

  async function scanColorVars(): Promise<ColorSwatch[]> {
    try {
      const result = await bridge.request<{ swatches: ColorSwatch[] }>('palette:scan-vars')
      return result.swatches
    } catch { return [] }
  }

  async function getCurrentRoute(): Promise<string> {
    try {
      const result = await bridge.request<{ path: string }>('route:current')
      currentRoute.value = result.path
      return result.path
    } catch { return '/' }
  }

  async function getColorScheme(): Promise<ColorSchemeResult | null> {
    try {
      return await bridge.request<ColorSchemeResult>('color-scheme:get')
    } catch { return null }
  }

  async function insertPlaceholder(
    targetEid: string, position: string, tag: string,
    opts?: { classes?: string; textContent?: string; category?: string; library?: string; defaultProps?: Record<string, unknown> }
  ): Promise<string> {
    try {
      const result = await bridge.request<InsertPlaceholderResult>('insert:placeholder', {
        targetEid, position, tag, ...(opts || {})
      })
      return result.placeholderEid
    } catch { return '' }
  }

  async function removePlaceholder(eid: string): Promise<void> {
    try { await bridge.request('insert:remove', { eid }) } catch {}
  }

  async function moveElement(eid: string, targetEid: string, position: string): Promise<void> {
    try { await bridge.request('move:element', { eid, targetEid, position }) } catch {}
  }

  async function insertComponent(
    targetEid: string, position: string, componentName: string, props?: Record<string, unknown>
  ): Promise<InsertVueComponentResult> {
    try {
      return await bridge.request<InsertVueComponentResult>('insert:component', {
        targetEid, position, componentName, props
      })
    } catch { return { eid: '', mounted: false } }
  }

  /** @deprecated Use insertComponent */
  const insertVueComponent = insertComponent

  async function getElementContext(eid: string): Promise<{ ancestors: any[]; subtree: any } | null> {
    try {
      return await bridge.request('resolve:element-context', { eid })
    } catch { return null }
  }

  async function captureScreenshot(clipRect: { x: number; y: number; width: number; height: number } | null): Promise<{ dataUrl?: string; error?: string }> {
    try {
      return await bridge.request('screenshot:capture', { rect: clipRect }, 15000)
    } catch { return { error: 'timeout' } }
  }

  async function scanA11y(eid?: string): Promise<{ violations: any[]; error?: string }> {
    try {
      return await bridge.request('a11y:scan', { eid }, 30000) // longer timeout for axe load
    } catch { return { violations: [], error: 'timeout' } }
  }

  async function scanPerf(): Promise<PerfScanResult> {
    try {
      return await bridge.request('perf:scan', {}, 15000)
    } catch { return { timestamp: 0, url: '', route: '', vitals: [], resources: [], error: 'timeout' } }
  }

  function startPerfRecording() {
    bridge.send('perf:start-recording', {})
  }

  async function stopPerfRecording(): Promise<PerfRecording> {
    try {
      return await bridge.request('perf:stop-recording', {}, 15000)
    } catch { return { startTime: 0, endTime: 0, duration: 0, url: '', route: '', events: [], vitals: [], resources: [], error: 'timeout' } }
  }

  function setMode(mode: InteractionMode) {
    bridge.send('mode:set', { mode })
  }

  return {
    currentRoute,
    bridgeReady,
    // Lifecycle
    mountBridge,
    unmountBridge,
    initBridgeForIframe,
    // Coordinates
    toShellRect,
    toIframeCoords,
    // Element resolution
    resolveElementAt,
    findTemplateGroup,
    getElementRect,
    getElementRects,
    // Style operations
    getComputedStyles,
    applyStyleVia,
    applyStyleBatch,
    setClass,
    setClassBatch,
    undoStyle,
    undoClass,
    // Classification
    classifyElement,
    getElementContext,
    captureScreenshot,
    scanA11y,
    scanPerf,
    startPerfRecording,
    stopPerfRecording,
    // Layout
    scanLayout,
    layoutAddTrack,
    layoutAddChild,
    // Source check
    checkSourceMapping,
    // Theme
    injectThemeCss,
    removeThemeCss,
    // Palette
    scanColorVars,
    // Route
    getCurrentRoute,
    // Color scheme
    getColorScheme,
    // Insert/Move
    insertPlaceholder,
    removePlaceholder,
    moveElement,
    insertComponent,
    insertVueComponent,
    // Mode
    setMode,
    // Bridge events
    onBridgeEvent: bridge.on,
    onBridgeReady: bridge.onBridgeReady,
  }
}
