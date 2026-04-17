import { ref, watch } from 'vue'
import type { BridgeRect } from '../../shared/bridge-types'
import type { useAnnotations } from './useAnnotations'
import type { useIframeManager } from './useIframeManager'
import type { useTasks } from './useTasks'

/**
 * rAF loop that keeps annotation overlays (arrows, highlights, sections, task elements)
 * positioned correctly as the user scrolls or the viewport changes.
 */
export function useAnnotationRects(deps: {
  iframe: ReturnType<typeof useIframeManager>
  annotations: ReturnType<typeof useAnnotations>
  taskSystem: ReturnType<typeof useTasks>
  normalizeRoute: (path: string) => string
}) {
  const { iframe, annotations, taskSystem, normalizeRoute } = deps

  let loopRunning = false
  let refreshInFlight = false
  const taskElementRects = ref<{ taskId: string; rect: BridgeRect }[]>([])

  async function refreshAnnotationRects() {
    if (refreshInFlight) return
    refreshInFlight = true
    try {
      type EidEntry = { type: string; id: string; field: string }
      const eidEntries = new Map<string, EidEntry[]>()
      function addEid(eid: string, entry: EidEntry) {
        const arr = eidEntries.get(eid)
        if (arr) arr.push(entry); else eidEntries.set(eid, [entry])
      }

      for (const a of annotations.arrows.value) {
        if (a.fromEid) addEid(a.fromEid, { type: 'arrow', id: a.id, field: 'from' })
        if (a.toEid) addEid(a.toEid, { type: 'arrow', id: a.id, field: 'to' })
      }
      for (const h of annotations.highlights.value) {
        if (h.eid) addEid(h.eid, { type: 'highlight', id: h.id, field: 'rect' })
      }
      for (const s of annotations.drawnSections.value) {
        if (s.nearEid) addEid(s.nearEid, { type: 'section', id: s.id, field: 'near' })
      }
      const currentRoute = annotations.activeRoute.value
      for (const t of taskSystem.tasks.value) {
        const v = t.visual as any
        if (v?.kind === 'select' && t.status !== 'accepted' && (!t.route || normalizeRoute(t.route) === currentRoute)) {
          const taskEids: string[] = v.eids || (v.eid ? [v.eid] : [])
          for (const eid of taskEids) addEid(eid, { type: 'task', id: t.id, field: 'rect' })
        }
      }

      if (eidEntries.size === 0) {
        if (taskElementRects.value.length) taskElementRects.value = []
        return
      }

      const eids = [...eidEntries.keys()]
      const rects = await iframe.getElementRects(eids)

      const newTaskRects: { taskId: string; rect: BridgeRect }[] = []

      for (let i = 0; i < eids.length; i++) {
        const rect = rects[i]
        if (!rect) continue
        for (const entry of eidEntries.get(eids[i])!) {
          if (entry.type === 'arrow') {
            const arrow = annotations.arrows.value.find(a => a.id === entry.id)
            if (!arrow) continue
            if (entry.field === 'from') {
              if (arrow.fromRect) {
                const dx = (rect.x + rect.width / 2) - (arrow.fromRect.x + arrow.fromRect.width / 2)
                const dy = (rect.y + rect.height / 2) - (arrow.fromRect.y + arrow.fromRect.height / 2)
                if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) {
                  arrow.fromX += dx; arrow.fromY += dy; arrow.fromRect = rect
                }
              } else { arrow.fromRect = rect }
            } else {
              if (arrow.toRect) {
                const dx = (rect.x + rect.width / 2) - (arrow.toRect.x + arrow.toRect.width / 2)
                const dy = (rect.y + rect.height / 2) - (arrow.toRect.y + arrow.toRect.height / 2)
                if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) {
                  arrow.toX += dx; arrow.toY += dy; arrow.toRect = rect
                }
              } else { arrow.toRect = rect }
            }
          } else if (entry.type === 'highlight') {
            const hl = annotations.highlights.value.find(h => h.id === entry.id)
            if (!hl) continue
            // Reject stale matches: the highlight we found may have been replaced
            // mid-await with a new one that happens to share the same id (ids are
            // derived from a counter that gets reclaimed when pending annotations
            // are discarded, so a rapid swap produces id collisions).
            if (hl.eid !== eids[i]) continue
            if (hl.rects && hl.rects.length) {
              // Range-based highlight: track the element's movement and shift the
              // per-line rects (which describe text runs, not the element box) by
              // the same delta. Don't overwrite hl.rect with the element rect.
              const prev = (hl as any)._anchorRect as typeof rect | undefined
              if (prev) {
                const dx = rect.x - prev.x
                const dy = rect.y - prev.y
                if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) {
                  hl.rects = hl.rects.map(r => ({ x: r.x + dx, y: r.y + dy, width: r.width, height: r.height }))
                  if (hl.rect) hl.rect = { x: hl.rect.x + dx, y: hl.rect.y + dy, width: hl.rect.width, height: hl.rect.height }
                  ;(hl as any)._anchorRect = rect
                }
              } else {
                ;(hl as any)._anchorRect = rect
              }
            } else {
              hl.rect = rect
            }
          } else if (entry.type === 'section') {
            const section = annotations.drawnSections.value.find(s => s.id === entry.id)
            if (!section) continue
            const prevRect = (section as any)._nearRect as typeof rect | undefined
            if (prevRect) {
              const dx = rect.x - prevRect.x, dy = rect.y - prevRect.y
              if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) {
                section.x += dx; section.y += dy; (section as any)._nearRect = rect
              }
            } else { (section as any)._nearRect = rect }
          } else if (entry.type === 'task') {
            newTaskRects.push({ taskId: entry.id, rect })
          }
        }
      }
      taskElementRects.value = newTaskRects
    } finally {
      refreshInFlight = false
    }
  }

  function startAnnotationLoop() {
    if (loopRunning) return
    loopRunning = true
    function tick() {
      const hasWork = annotations.arrows.value.some(a => a.fromEid || a.toEid)
        || annotations.highlights.value.some(h => h.eid)
        || annotations.drawnSections.value.some(s => s.nearEid)
        || taskSystem.tasks.value.some(t => { const v = t.visual as any; return v?.kind === 'select' && (v.eids?.length || v.eid) && t.status !== 'accepted' })
      if (!hasWork) { loopRunning = false; return }
      // Skip work while the tab is hidden — the browser still fires rAF at reduced rate,
      // but there's nothing for the user to see and no reason to thrash the iframe bridge.
      if (typeof document !== 'undefined' && document.hidden) {
        requestAnimationFrame(tick)
        return
      }
      refreshAnnotationRects()
      requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  }

  // Start annotation loop when annotations or tasks exist
  watch([annotations.arrows, annotations.highlights, annotations.drawnSections, taskSystem.tasks], () => {
    startAnnotationLoop()
  }, { deep: true })

  return { taskElementRects, startAnnotationLoop, refreshAnnotationRects }
}
