/**
 * Tab/focus order overlay — paints a numbered badge over every focusable
 * element in the iframe and flags positive tabindex values, unreachable
 * native interactives, and DOM/visual reorderings. Synthesizes `tab-order`
 * a11y_fix tasks for any flagged item.
 *
 * Lifecycle: refresh runs once per `enable()` and on each rAF tick while
 * active — no auto-poll between renders, since the user explicitly opted in.
 * Disabling clears the overlay and stops the loop.
 */
import { ref, watch, type Ref } from 'vue'
import type { TabOrderEntry, ComputeTabOrderResult } from '../../shared/bridge-types'
import type { useIframeManager } from './useIframeManager'

export type TabOrderFlag = 'positive' | 'unreachable' | 'reorder' | null

export interface TabOrderBadge extends TabOrderEntry {
  flag: TabOrderFlag
  reason: string
}

export function useTabOrderOverlay(deps: {
  iframe: ReturnType<typeof useIframeManager>
  /** True when the user is on Audit > A11y. We auto-disable when leaving. */
  active: Ref<boolean>
}) {
  const { iframe, active } = deps

  const enabled = ref(false)
  const badges = ref<TabOrderBadge[]>([])
  const reorderings = ref<ComputeTabOrderResult['reorderings']>([])
  const loading = ref(false)

  let loopRunning = false
  let inflight = false

  async function refresh(): Promise<void> {
    if (inflight) return
    inflight = true
    try {
      const result = await iframe.computeTabOrder()
      const flagsByEid = new Map<string, { flag: TabOrderFlag; reason: string }>()
      for (const r of result.reorderings) {
        flagsByEid.set(r.aEid, { flag: 'reorder', reason: r.reason })
        flagsByEid.set(r.bEid, { flag: 'reorder', reason: r.reason })
      }
      const next: TabOrderBadge[] = []
      for (const e of result.entries) {
        let flag: TabOrderFlag = null
        let reason = ''
        if (e.is_positive_tabindex) {
          flag = 'positive'
          reason = 'Positive tabindex breaks expected DOM tab order — use 0 or remove.'
        } else if (e.is_disabled_focusable) {
          flag = 'unreachable'
          reason = 'Native interactive element is unreachable by keyboard (tabindex="-1").'
        } else {
          const reorder = flagsByEid.get(e.eid)
          if (reorder) {
            flag = 'reorder'
            reason = reorder.reason
          }
        }
        next.push({ ...e, flag, reason })
      }
      badges.value = next
      reorderings.value = result.reorderings
    } finally {
      inflight = false
    }
  }

  function startLoop(): void {
    if (loopRunning) return
    loopRunning = true
    const tick = () => {
      if (!enabled.value || !active.value) {
        loopRunning = false
        return
      }
      if (typeof document !== 'undefined' && document.hidden) {
        requestAnimationFrame(tick)
        return
      }
      refresh()
      requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  }

  async function enable(): Promise<void> {
    if (enabled.value) return
    enabled.value = true
    loading.value = true
    await refresh()
    loading.value = false
    startLoop()
  }

  function disable(): void {
    enabled.value = false
    badges.value = []
    reorderings.value = []
  }

  function toggle(): void {
    if (enabled.value) disable()
    else enable()
  }

  // Auto-disable when leaving the a11y panel — overlay is panel-scoped.
  watch(active, (v) => { if (!v) disable() })

  return {
    enabled,
    loading,
    badges,
    reorderings,
    enable,
    disable,
    toggle,
    refresh,
  }
}
