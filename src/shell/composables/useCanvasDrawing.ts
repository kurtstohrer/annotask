import { ref } from 'vue'
import type { useAnnotations } from './useAnnotations'
import type { ElementRect } from './useAnnotations'

type Annotations = ReturnType<typeof useAnnotations>
type ResolvedCtx = {
  eid: string; file: string; line: string; component: string; tag: string; classes?: string
  rect: { x: number; y: number; width: number; height: number }
} | null
type ResolveElementAt = (x: number, y: number) => Promise<ResolvedCtx>

export type HoverElement = {
  rect: ElementRect; tag: string; component: string
} | null

export function useCanvasDrawing(
  annotations: Annotations,
  resolveElementAt: ResolveElementAt,
  getInteractionMode: () => string,
  onArrowCreated?: (arrowId: string, fromCtx: ResolvedCtx, toCtx: ResolvedCtx) => void,
  getArrowColor?: () => string,
  onBeforeAnnotation?: () => void,
) {
  const drawingArrow = ref<{
    fromX: number; fromY: number; toX: number; toY: number
    fromRect?: ElementRect; toRect?: ElementRect
    fromTag?: string; fromComponent?: string
    toTag?: string; toComponent?: string
  } | null>(null)
  const drawingRect = ref<{ x: number; y: number; width: number; height: number } | null>(null)
  const hoverElement = ref<HoverElement>(null)
  let drawStart: { x: number; y: number } | null = null

  async function onCanvasPointerDown(e: PointerEvent) {
    const mode = getInteractionMode()
    if (mode === 'arrow') {
      drawStart = { x: e.clientX, y: e.clientY }
      // Seed from hover if available
      const fromRect = hoverElement.value?.rect
      const fromTag = hoverElement.value?.tag
      const fromComponent = hoverElement.value?.component
      hoverElement.value = null
      drawingArrow.value = {
        fromX: e.clientX, fromY: e.clientY, toX: e.clientX, toY: e.clientY,
        fromRect, fromTag, fromComponent,
      }
      // Resolve from-element asynchronously (confirms/updates seed)
      const fromCtx = await resolveElementAt(e.clientX, e.clientY)
      if (drawingArrow.value && fromCtx) {
        drawingArrow.value = {
          ...drawingArrow.value,
          fromRect: fromCtx.rect, fromTag: fromCtx.tag, fromComponent: fromCtx.component,
        }
      }
    } else if (mode === 'draw') {
      drawStart = { x: e.clientX, y: e.clientY }
      drawingRect.value = { x: e.clientX, y: e.clientY, width: 0, height: 0 }
    }
  }

  // Throttle async resolve during move
  let moveResolveTimer: ReturnType<typeof setTimeout> | null = null

  function onCanvasPointerMove(e: PointerEvent) {
    const mode = getInteractionMode()
    // Hover preview when not drawing
    if (!drawStart && mode === 'arrow') {
      if (moveResolveTimer) clearTimeout(moveResolveTimer)
      const cx = e.clientX, cy = e.clientY
      moveResolveTimer = setTimeout(async () => {
        const ctx = await resolveElementAt(cx, cy)
        // Only update if still hovering (not drawing)
        if (!drawStart && getInteractionMode() === 'arrow') {
          hoverElement.value = ctx ? { rect: ctx.rect, tag: ctx.tag, component: ctx.component } : null
        }
      }, 50)
      return
    }
    if (!drawStart) return
    if (mode === 'arrow' && drawingArrow.value) {
      drawingArrow.value = { ...drawingArrow.value, toX: e.clientX, toY: e.clientY }
      // Debounced target element resolve
      if (moveResolveTimer) clearTimeout(moveResolveTimer)
      const cx = e.clientX, cy = e.clientY
      moveResolveTimer = setTimeout(async () => {
        const toCtx = await resolveElementAt(cx, cy)
        if (drawingArrow.value) {
          drawingArrow.value = {
            ...drawingArrow.value,
            toRect: toCtx?.rect, toTag: toCtx?.tag, toComponent: toCtx?.component,
          }
        }
      }, 50)
    } else if (mode === 'draw' && drawingRect.value) {
      const x = Math.min(drawStart.x, e.clientX)
      const y = Math.min(drawStart.y, e.clientY)
      const w = Math.abs(e.clientX - drawStart.x)
      const h = Math.abs(e.clientY - drawStart.y)
      drawingRect.value = { x, y, width: w, height: h }
    }
  }

  async function onCanvasPointerUp(e: PointerEvent) {
    if (!drawStart) return
    if (moveResolveTimer) { clearTimeout(moveResolveTimer); moveResolveTimer = null }
    const mode = getInteractionMode()
    if (mode === 'arrow' && drawingArrow.value) {
      const a = drawingArrow.value
      if (Math.abs(a.toX - a.fromX) > 20 || Math.abs(a.toY - a.fromY) > 20) {
        onBeforeAnnotation?.()
        const fromCtx = await resolveElementAt(a.fromX, a.fromY)
        const toCtx = await resolveElementAt(a.toX, a.toY)
        const color = getArrowColor?.() || '#ef4444'
        const arrow = annotations.addArrow(a.fromX, a.fromY, a.toX, a.toY, undefined, color)
        if (fromCtx) {
          annotations.updateArrow(arrow.id, {
            fromFile: fromCtx.file, fromLine: parseInt(fromCtx.line) || 0,
            fromComponent: fromCtx.component, fromRect: fromCtx.rect, fromEid: fromCtx.eid,
          })
        }
        if (toCtx) {
          annotations.updateArrow(arrow.id, {
            toFile: toCtx.file, toLine: parseInt(toCtx.line) || 0, toRect: toCtx.rect, toEid: toCtx.eid,
          })
        }
        annotations.updateArrow(arrow.id, { label: '' })
        onArrowCreated?.(arrow.id, fromCtx, toCtx)
      }
      drawingArrow.value = null
    } else if (mode === 'draw' && drawingRect.value) {
      const r = drawingRect.value
      if (r.width > 30 && r.height > 30) {
        onBeforeAnnotation?.()
        const nearCtx = await resolveElementAt(r.x + r.width / 2, r.y)
        const section = annotations.addDrawnSection(r.x, r.y, r.width, r.height)
        if (nearCtx) {
          const placement = r.y > (drawStart?.y || 0) ? 'below' : 'above'
          annotations.updateDrawnSection(section.id, {
            nearEid: nearCtx.eid,
            nearFile: nearCtx.file,
            nearLine: parseInt(nearCtx.line) || 0,
            nearComponent: nearCtx.component,
            placement: placement as 'above' | 'below',
          })
        }
      }
      drawingRect.value = null
    }
    drawStart = null
  }

  return {
    drawingArrow,
    drawingRect,
    hoverElement,
    onCanvasPointerDown,
    onCanvasPointerMove,
    onCanvasPointerUp,
  }
}
