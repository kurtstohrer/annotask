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
  ResolveComponentChainResult,
  ResolveBySelectorsResult, ResolveBySelectorsMatch,
  ComputeAccessibilityInfoResult, AccessibilityInfo,
  ComputeTabOrderResult, TabOrderEntry,
} from '../../shared/bridge-types'
import type { DesignSpecThemeSelector } from '../../schema'

export function useIframeManager(iframeRef: Ref<HTMLIFrameElement | null>) {
  const currentRoute = ref('/')
  const bridgeReady = ref(false)
  /**
   * Live color scheme of the iframe. Seeded on bridge ready via an on-demand
   * request, then kept in sync by unsolicited 'color-scheme:changed' pushes
   * from the plugin (MutationObserver on html/body + prefers-color-scheme).
   * Drives the Theme page's auto-selected variant.
   */
  const colorScheme = ref<ColorSchemeResult | null>(null)

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

  // Observers / listeners that keep the bridge's cached frame offset fresh.
  // window.frameElement is null for cross-origin iframes (different ports
  // count), so the plugin can't self-measure — we push on every layout event
  // that might move the iframe inside the shell viewport.
  let frameOffsetResizeObserver: ResizeObserver | null = null
  let frameOffsetWindowHandler: (() => void) | null = null
  let frameOffsetLastX = NaN
  let frameOffsetLastY = NaN

  function pushFrameOffset() {
    const iframe = iframeRef.value
    if (!iframe) return
    const f = iframe.getBoundingClientRect()
    if (f.left === frameOffsetLastX && f.top === frameOffsetLastY) return
    frameOffsetLastX = f.left
    frameOffsetLastY = f.top
    bridge.send('frame:offset', { x: f.left, y: f.top })
  }

  function teardownFrameOffsetWatchers() {
    if (frameOffsetResizeObserver) {
      frameOffsetResizeObserver.disconnect()
      frameOffsetResizeObserver = null
    }
    if (frameOffsetWindowHandler) {
      window.removeEventListener('resize', frameOffsetWindowHandler)
      window.removeEventListener('scroll', frameOffsetWindowHandler, true)
      frameOffsetWindowHandler = null
    }
    frameOffsetLastX = NaN
    frameOffsetLastY = NaN
  }

  function setupFrameOffsetWatchers() {
    teardownFrameOffsetWatchers()
    const iframe = iframeRef.value
    if (!iframe) return
    if (typeof ResizeObserver !== 'undefined') {
      frameOffsetResizeObserver = new ResizeObserver(() => pushFrameOffset())
      frameOffsetResizeObserver.observe(iframe)
      // Also observe the body so panel open/close (which can shift the iframe
      // without resizing it directly) still triggers a push.
      if (document.body) frameOffsetResizeObserver.observe(document.body)
    }
    frameOffsetWindowHandler = () => pushFrameOffset()
    window.addEventListener('resize', frameOffsetWindowHandler)
    // Scroll in capture phase catches scrolling inside any shell container that
    // holds the iframe — keeps the offset accurate if the iframe isn't at the
    // top of the viewport.
    window.addEventListener('scroll', frameOffsetWindowHandler, true)
  }

  /** Initialize the bridge when the iframe loads */
  function initBridgeForIframe() {
    const win = iframeRef.value?.contentWindow
    if (!win) return
    bridge.resetBridge(win, iframeOrigin())
    bridgeReady.value = false

    bridge.onBridgeReady(() => {
      bridgeReady.value = true
      // Seed the color scheme once the bridge is ready. Subsequent changes
      // arrive via the 'color-scheme:changed' push handler below.
      getColorScheme().then(result => { if (result) colorScheme.value = result })
      // Seed the bridge's frame-offset cache and start watching for layout
      // changes so cross-origin setups (e.g. webpack direct URL) get the
      // correct offset for text-selection rects.
      pushFrameOffset()
      setupFrameOffsetWatchers()
    })

    // Route tracking via bridge events
    bridge.on('route:changed', (payload: { path: string }) => {
      currentRoute.value = payload.path
    })

    // Live color-scheme tracking — plugin pushes this whenever the iframe
    // flips light/dark or swaps a named theme.
    bridge.on('color-scheme:changed', (payload: ColorSchemeResult) => {
      colorScheme.value = payload
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
    teardownFrameOffsetWatchers()
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

  /** Visible iframe viewport size in iframe-local coordinates. */
  function getIframeViewport(): { w: number; h: number } | null {
    const iframe = iframeRef.value
    if (!iframe) return null
    const f = iframe.getBoundingClientRect()
    return { w: Math.round(f.width), h: Math.round(f.height) }
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

  /**
   * Ask the iframe for every element whose `data-annotask-file` matches one of
   * the supplied files. Drives the Data view's "where does this render" overlay.
   */
  async function getFileElementRects(files: string[]): Promise<{ matches: Array<{ file: string; eid: string; line: string; rect: BridgeRect }>; truncated: boolean }> {
    if (files.length === 0) return { matches: [], truncated: false }
    try {
      const result = await bridge.request<{ matches: Array<{ file: string; eid: string; line: string; rect: BridgeRect }>; truncated?: boolean }>(
        'resolve:by-files',
        { files: [...files] },
      )
      const matches = (result.matches || []).map(m => ({
        file: m.file,
        eid: m.eid,
        line: m.line,
        rect: toShellRect(m.rect) || m.rect,
      }))
      return { matches, truncated: !!result.truncated }
    } catch { return { matches: [], truncated: false } }
  }

  /**
   * Ask the iframe for the distinct set of `data-annotask-file` values
   * currently rendered — the source files contributing to this route.
   */
  async function listRenderedFiles(): Promise<{ files: Array<{ file: string; mfe?: string }> }> {
    try {
      // Bridge now emits `[{ file, mfe? }]`. Older bridges may still return
      // bare strings; normalize to the object shape either way.
      const result = await bridge.request<{ files: Array<{ file: string; mfe?: string } | string> }>(
        'list:rendered-files', {},
      )
      const list = Array.isArray(result.files) ? result.files : []
      const norm: Array<{ file: string; mfe?: string }> = []
      for (const item of list) {
        if (typeof item === 'string') norm.push({ file: item })
        else if (item && typeof item.file === 'string') norm.push({ file: item.file, ...(item.mfe ? { mfe: item.mfe } : {}) })
      }
      return { files: norm }
    } catch { return { files: [] } }
  }

  /**
   * Ask the iframe for every project component currently rendered. Returns
   * each component's representative file/line plus per-instance eid/rect.
   * Drives the Components view.
   */
  async function listProjectComponents(): Promise<{ components: Array<{ name: string; file: string; line: string; count: number; instances: Array<{ file: string; line: string; eid: string; rect: BridgeRect; mfe?: string }> }> }> {
    try {
      const result = await bridge.request<{ components: Array<{ name: string; file: string; line: string; count: number; instances: Array<{ file: string; line: string; eid: string; rect: BridgeRect; mfe?: string }> }> }>(
        'list:project-components',
        {},
      )
      const components = (result.components || []).map(c => ({
        ...c,
        instances: c.instances.map(i => ({ ...i, rect: toShellRect(i.rect) || i.rect })),
      }))
      return { components }
    } catch { return { components: [] } }
  }

  /**
   * Ask the iframe for precise per-location matches. Each input location is
   * `(file, line)`; line=0 means "every element in this file" (file-level
   * fallback). Drives the Data view overlay once binding analysis lands.
   */
  async function getLocationElementRects(locations: Array<{ file: string; line: number; ref?: string; tag?: string; mfe?: string; module?: string }>): Promise<{ matches: Array<{ ref?: string; file: string; line: number; eid: string; rect: BridgeRect }>; truncated: boolean }> {
    if (locations.length === 0) return { matches: [], truncated: false }
    try {
      const result = await bridge.request<{ matches: Array<{ ref?: string; file: string; line: number; eid: string; rect: BridgeRect }>; truncated?: boolean }>(
        'resolve:by-locations',
        { locations: locations.map(l => ({ file: l.file, line: l.line, ref: l.ref, tag: l.tag, mfe: l.mfe, module: l.module })) },
      )
      const matches = (result.matches || []).map(m => ({
        ref: m.ref,
        file: m.file,
        line: m.line,
        eid: m.eid,
        rect: toShellRect(m.rect) || m.rect,
      }))
      return { matches, truncated: !!result.truncated }
    } catch { return { matches: [], truncated: false } }
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

  /**
   * Drive the iframe into a specific theme variant by applying its selector
   * (data-attribute or class) and clearing markers for sibling variants. Used
   * by the Design Tokens page so clicking a variant tab actually switches the
   * app to that theme instead of only pinning the edit target.
   *
   * Implementation: the iframe is same-origin in the normal dev-server setup,
   * so we poke its DOM directly rather than routing through the bridge. This
   * also lets the feature work against apps that haven't yet reloaded the
   * plugin bridge. The plugin's own MutationObserver will emit a
   * 'color-scheme:changed' push which seeds `colorScheme` — but we also set it
   * optimistically so the UI updates without a round-trip.
   */
  async function activateColorScheme(
    selector: DesignSpecThemeSelector | null | undefined,
    all: DesignSpecThemeSelector[] = []
  ): Promise<void> {
    const iframe = iframeRef.value
    const doc = iframe?.contentDocument
    if (!doc) return
    const hostEl = (h?: 'html' | 'body') => (h === 'body' ? doc.body : doc.documentElement)
    for (const s of all) {
      if (!s || s === selector) continue
      const el = hostEl(s.host)
      if (!el) continue
      if (s.kind === 'attribute' && s.name) el.removeAttribute(s.name)
      else if (s.kind === 'class' && s.name) el.classList.remove(s.name)
    }
    if (selector) {
      const tel = hostEl(selector.host)
      if (tel) {
        if (selector.kind === 'attribute' && selector.name) tel.setAttribute(selector.name, selector.value ?? '')
        else if (selector.kind === 'class' && selector.name) tel.classList.add(selector.name)
      }
    }
    try {
      const fresh = await bridge.request<ColorSchemeResult>('color-scheme:get')
      if (fresh) colorScheme.value = fresh
    } catch { /* fall back to MutationObserver push */ }
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

  async function getComponentChain(eid: string): Promise<ResolveComponentChainResult | null> {
    try {
      return await bridge.request<ResolveComponentChainResult | null>('resolve:component-chain', { eid })
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

  async function scrollIntoView(eid: string): Promise<void> {
    if (!eid) return
    try { await bridge.request('scroll:into-view', { eid }, 2000) } catch {}
  }

  /**
   * Resolve a list of CSS selectors against the iframe DOM. For each input
   * selector, returns the first matching element's eid + rect (in shell
   * coordinates) — or null on no match. Used by useA11yHighlights to convert
   * axe's `node.target` selectors into renderable overlays.
   */
  async function resolveBySelectors(selectors: string[]): Promise<ResolveBySelectorsMatch[]> {
    if (selectors.length === 0) return []
    try {
      const result = await bridge.request<ResolveBySelectorsResult>('resolve:by-selectors', { selectors: [...selectors] })
      return (result.matches || []).map(m => ({
        selector: m.selector,
        eid: m.eid,
        rect: m.rect ? (toShellRect(m.rect) || m.rect) : null,
      }))
    } catch { return selectors.map(s => ({ selector: s, eid: null, rect: null })) }
  }

  /**
   * Compute per-element accessibility metadata (computed name, role,
   * tabindex, focus indicator, contrast, ARIA attrs) for a list of eids.
   * Drives the inspector "Accessibility" section and the per-element a11y
   * payload attached to a11y_fix tasks.
   */
  async function computeAccessibilityInfo(eids: string[]): Promise<(AccessibilityInfo | null)[]> {
    if (eids.length === 0) return []
    try {
      const result = await bridge.request<ComputeAccessibilityInfoResult>('compute:accessibility-info', { eids: [...eids] })
      return result.items || eids.map(() => null)
    } catch { return eids.map(() => null) }
  }

  /**
   * Walk the iframe DOM in tab order. Returns every focusable element with
   * its sequence index, tabindex value, accessible name, and any DOM-vs-tab
   * order disagreements that signal a keyboard/visual reordering bug.
   */
  async function computeTabOrder(): Promise<{ entries: TabOrderEntry[]; reorderings: ComputeTabOrderResult['reorderings'] }> {
    try {
      const result = await bridge.request<ComputeTabOrderResult>('compute:tab-order', {}, 5000)
      const entries = (result.entries || []).map(e => ({ ...e, rect: toShellRect(e.rect) || e.rect }))
      return { entries, reorderings: result.reorderings || [] }
    } catch { return { entries: [], reorderings: [] } }
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
    getIframeViewport,
    // Element resolution
    resolveElementAt,
    findTemplateGroup,
    getElementRect,
    getElementRects,
    getFileElementRects,
    getLocationElementRects,
    listProjectComponents,
    listRenderedFiles,
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
    getComponentChain,
    captureScreenshot,
    scanA11y,
    scrollIntoView,
    resolveBySelectors,
    computeAccessibilityInfo,
    computeTabOrder,
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
    activateColorScheme,
    colorScheme,
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
    offBridgeEvent: bridge.off,
    sendBridgeMessage: bridge.send,
    onBridgeReady: bridge.onBridgeReady,
  }
}
