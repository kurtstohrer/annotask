export type ElementRole = 'container' | 'content' | 'component'

export interface ElementClassification {
  role: ElementRole
  display: string
  isFlexContainer: boolean
  isGridContainer: boolean
  flexDirection?: string
  childCount: number
  isComponentUnit: boolean
}

const SEMANTIC_CONTAINERS = new Set([
  'section', 'main', 'aside', 'nav', 'header', 'footer', 'article',
])

/**
 * Classify an element as container, content, or component.
 */
export function classifyElement(el: Element, win: Window): ElementClassification {
  const tag = el.tagName.toLowerCase()
  const cs = win.getComputedStyle(el as HTMLElement)
  const display = cs.display
  const childCount = el.children.length

  // Component: has data-annotask-component (framework component)
  if (el.hasAttribute('data-annotask-component')) {
    const comp = el.getAttribute('data-annotask-component') || ''
    // Known UI library components are opaque
    if (comp && comp !== comp.toLowerCase()) {
      // PascalCase = component (not plain HTML)
      return {
        role: 'component',
        display,
        isFlexContainer: false,
        isGridContainer: false,
        childCount,
        isComponentUnit: true,
      }
    }
  }

  // Container: flex or grid display with children
  const isFlex = display.includes('flex')
  const isGrid = display.includes('grid')
  if ((isFlex || isGrid) && childCount > 0) {
    return {
      role: 'container',
      display,
      isFlexContainer: isFlex,
      isGridContainer: isGrid,
      flexDirection: isFlex ? cs.flexDirection : undefined,
      childCount,
      isComponentUnit: false,
    }
  }

  // Semantic containers with children
  if (SEMANTIC_CONTAINERS.has(tag) && childCount > 0) {
    return {
      role: 'container',
      display,
      isFlexContainer: false,
      isGridContainer: false,
      childCount,
      isComponentUnit: false,
    }
  }

  // Content: everything else
  return {
    role: 'content',
    display,
    isFlexContainer: false,
    isGridContainer: false,
    childCount,
    isComponentUnit: false,
  }
}

/** Classify using iframe element (handles cross-frame window access) */
export function classifyIframeElement(el: Element): ElementClassification | null {
  const win = el.ownerDocument?.defaultView
  if (!win) return null
  return classifyElement(el, win)
}
