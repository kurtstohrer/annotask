/**
 * Per-violation overlay state for the Audit > Accessibility view. Mirrors
 * the current scan: when `setViolations([])` is called (e.g. on rescan or
 * route change) the overlays clear automatically. An rAF loop keeps rects
 * synced against the iframe DOM.
 *
 * Color comes from the violation's impact (`--severity-*` CSS vars), so the
 * overlays inherit the active shell theme. When `focusedRule` is set, that
 * rule's overlays are visually emphasized and the rest are dimmed.
 *
 * Shares the rAF lifecycle + re-entrancy/visibility guards with the Data view
 * via `useOverlayLoop` (useOverlayEngine.ts); this file only owns the
 * selector/eid resolve and the per-violation rect shape.
 */
import { ref, type Ref } from 'vue'
import type { BridgeRect } from '../../shared/bridge-types'
import type { useIframeManager } from './useIframeManager'
import type { A11yViolation } from './useA11yScanner'
import { useOverlayLoop, OVERLAY_RECT_CAP } from './useOverlayEngine'

export interface A11yHighlightRect {
  ruleId: string
  impact: string
  selector: string
  eid: string
  rect: BridgeRect
}

export function useA11yHighlights(deps: {
  iframe: ReturnType<typeof useIframeManager>
  violations: Ref<A11yViolation[]>
  /** True when the shell is on the Audit > Accessibility view — caller owns
   *  the routing check so this composable stays oblivious to view ids. */
  active: Ref<boolean>
  /** Currently emphasized rule (hover/click in the panel). When set, that
   *  rule's overlays use `.focused`, others use `.dimmed`. */
  focusedRule: Ref<string | null>
}) {
  const { iframe, violations, active, focusedRule } = deps

  const rects = ref<A11yHighlightRect[]>([])

  async function refreshRects(): Promise<void> {
    {
      if (!active.value || violations.value.length === 0) {
        if (rects.value.length) rects.value = []
        return
      }

      // Build a flat list of (ruleId, impact, selector, eid) requests. Cap at
      // the shared overlay budget so a 1000-violation scan can't blow up the
      // loop. Elements with a pre-resolved `eid` (e.g. synthetic tab-order
      // findings) skip the selector resolve entirely — we still call
      // computeLayoutRects on them via a dedicated bridge below.
      const items: Array<{ ruleId: string; impact: string; selector: string; eid?: string }> = []
      for (const v of violations.value) {
        if (!v.elements) continue
        for (const el of v.elements) {
          if (!el.target && !el.eid) continue
          if (items.length >= OVERLAY_RECT_CAP) break
          items.push({ ruleId: v.id, impact: v.impact || 'minor', selector: el.target, eid: el.eid })
        }
        if (items.length >= OVERLAY_RECT_CAP) break
      }

      if (items.length === 0) {
        if (rects.value.length) rects.value = []
        return
      }

      // Resolve the selector-based items in one batch; eid-based items are
      // returned as-is and their rects are filled by computeLayoutRects.
      const selectorItems = items.filter(i => !i.eid && i.selector)
      const matches = selectorItems.length
        ? await iframe.resolveBySelectors(selectorItems.map(i => i.selector))
        : []
      const matchBySelector = new Map<string, { eid: string | null; rect: BridgeRect | null }>()
      for (let i = 0; i < selectorItems.length; i++) {
        const m = matches[i]
        if (!m) continue
        matchBySelector.set(selectorItems[i].selector, { eid: m.eid, rect: m.rect })
      }

      const eidOnlyEids = items.filter(i => i.eid).map(i => i.eid!) as string[]
      const eidRects = eidOnlyEids.length
        ? await iframe.getElementRects(eidOnlyEids)
        : []
      const rectByEid = new Map<string, BridgeRect | null>()
      for (let i = 0; i < eidOnlyEids.length; i++) rectByEid.set(eidOnlyEids[i], eidRects[i] ?? null)

      const out: A11yHighlightRect[] = []
      for (const item of items) {
        if (item.eid) {
          const rect = rectByEid.get(item.eid)
          if (!rect) continue
          out.push({ ruleId: item.ruleId, impact: item.impact, selector: '', eid: item.eid, rect })
        } else {
          const m = matchBySelector.get(item.selector)
          if (!m || !m.eid || !m.rect) continue
          out.push({ ruleId: item.ruleId, impact: item.impact, selector: item.selector, eid: m.eid, rect: m.rect })
        }
      }
      rects.value = out
    }
  }

  // Shared overlay loop owns the rAF lifecycle + re-entrancy/visibility guards;
  // this composable supplies the refresh body and what "idle" means.
  useOverlayLoop({
    active,
    refresh: refreshRects,
    inputs: () => violations.value,
    isIdle: () => violations.value.length === 0,
    onDeactivate: () => { rects.value = [] },
  })

  function classFor(rect: A11yHighlightRect): string {
    if (focusedRule.value) {
      return rect.ruleId === focusedRule.value ? 'focused' : 'dimmed'
    }
    return ''
  }

  return {
    rects,
    classFor,
  }
}
