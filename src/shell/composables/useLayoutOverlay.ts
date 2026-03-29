import { ref, type Ref } from 'vue'

export interface LayoutContainer {
  el: HTMLElement
  display: 'flex' | 'grid'
  direction: string // flex-direction or 'grid'
  rect: DOMRect
  // Grid-specific
  columns?: number[]  // column widths in px
  rows?: number[]     // row heights in px
  columnGap: number
  rowGap: number
  templateColumns?: string
  templateRows?: string
}

export interface LayoutOverlayRect {
  x: number
  y: number
  width: number
  height: number
  display: 'flex' | 'grid'
  direction: string
  columns?: number[]
  rows?: number[]
  columnGap: number
  rowGap: number
  el: HTMLElement // reference to the actual element
  templateColumns?: string
  templateRows?: string
}

export function useLayoutOverlay(
  iframeRef: Ref<HTMLIFrameElement | null>,
) {
  const showOverlay = ref(false)
  const containers = ref<LayoutOverlayRect[]>([])

  function getIframeDoc(): Document | null {
    try { return iframeRef.value?.contentDocument ?? null } catch { return null }
  }

  function iframeRelativeRect(el: Element): DOMRect | null {
    if (!iframeRef.value) return null
    const r = el.getBoundingClientRect()
    const f = iframeRef.value.getBoundingClientRect()
    return new DOMRect(f.left + r.left, f.top + r.top, r.width, r.height)
  }

  function scan() {
    const doc = getIframeDoc()
    if (!doc) { containers.value = []; return }

    const results: LayoutOverlayRect[] = []
    const all = doc.querySelectorAll('*')
    const win = doc.defaultView
    if (!win) return

    for (const el of all) {
      if (el.nodeType !== 1) continue
      const cs = win.getComputedStyle(el as HTMLElement)
      const d = cs.display

      if (!d.includes('flex') && !d.includes('grid')) continue
      // Skip tiny elements
      const rect = iframeRelativeRect(el)
      if (!rect || rect.width < 20 || rect.height < 20) continue

      const isGrid = d.includes('grid')
      const display = isGrid ? 'grid' as const : 'flex' as const
      const direction = isGrid ? 'grid' : cs.flexDirection

      const entry: LayoutOverlayRect = {
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
        display,
        direction,
        columnGap: parseFloat(cs.columnGap) || 0,
        rowGap: parseFloat(cs.rowGap) || 0,
        el: el as HTMLElement,
      }

      // For grid containers, extract column/row track sizes
      if (isGrid) {
        const cols = cs.gridTemplateColumns
        const rows = cs.gridTemplateRows
        entry.templateColumns = cols
        entry.templateRows = rows
        if (cols && cols !== 'none') {
          entry.columns = cols.split(/\s+/).map(s => parseFloat(s) || 0).filter(v => v > 0)
        }
        if (rows && rows !== 'none') {
          entry.rows = rows.split(/\s+/).map(s => parseFloat(s) || 0).filter(v => v > 0)
        }
      }

      results.push(entry)
    }

    containers.value = results
  }

  function toggle() {
    showOverlay.value = !showOverlay.value
    if (showOverlay.value) scan()
    else containers.value = []
  }

  /** Add a column or row track to a grid container */
  function addTrack(container: LayoutOverlayRect, axis: 'col' | 'row') {
    const el = container.el
    if (!el) return null
    const win = el.ownerDocument.defaultView
    if (!win) return null

    const cs = win.getComputedStyle(el)
    const prop = axis === 'col' ? 'gridTemplateColumns' : 'gridTemplateRows'
    const cssProp = axis === 'col' ? 'grid-template-columns' : 'grid-template-rows'
    const current = cs.getPropertyValue(cssProp) || ''
    const before = current

    // Append a 1fr track
    const newValue = current && current !== 'none' ? current + ' 1fr' : '1fr'
    el.style.setProperty(cssProp, newValue)

    // Rescan to update overlay
    scan()

    return { el, property: cssProp, before, after: newValue }
  }

  /** Add a child element to a flex container */
  function addChild(container: LayoutOverlayRect) {
    const el = container.el
    if (!el) return null
    const doc = el.ownerDocument

    const child = doc.createElement('div')
    child.style.minWidth = '60px'
    child.style.minHeight = '40px'
    child.style.border = '2px dashed #a855f7'
    child.style.borderRadius = '4px'
    child.style.background = 'rgba(168,85,247,0.05)'
    child.setAttribute('data-annotask-placeholder', 'true')
    el.appendChild(child)

    scan()

    return {
      parentEl: el,
      childEl: child,
    }
  }

  return { showOverlay, containers, toggle, scan, addTrack, addChild }
}
