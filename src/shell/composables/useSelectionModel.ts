import { ref, computed, watch } from 'vue'
import type { Ref } from 'vue'
import type { BridgeRect } from '../../shared/bridge-types'
import type { ElementRole } from './useElementClassification'
import type { useIframeManager } from './useIframeManager'
import type { useStyleEditor } from './useStyleEditor'

export interface SelectionData {
  file: string; line: string; component: string; mfe: string
  tagName: string; classes: string; eid: string
  /** Visible label text, used for agent disambiguation in task context. */
  text?: string
}

/**
 * Manages element selection state, rect tracking, hover highlights,
 * live computed styles, and style/class change handlers.
 */
export function useSelectionModel(
  iframe: ReturnType<typeof useIframeManager>,
  styleEditor: ReturnType<typeof useStyleEditor>,
) {
  const { applyStyle, recordClassChange } = styleEditor

  // ── Core selection state ──
  const primarySelection = ref<SelectionData | null>(null)
  const selectedEids = ref<string[]>([])
  const templateGroupEids = ref<string[]>([])
  const applyToGroup = ref(true)

  const editTargetEids = computed<string[]>(() => {
    if (selectedEids.value.length > 1) return selectedEids.value
    if (applyToGroup.value && templateGroupEids.value.length > 1) return templateGroupEids.value
    return primarySelection.value ? [primarySelection.value.eid] : []
  })

  // ── Rect tracking (rAF loop for selection/group outlines) ──
  const selectionRects = ref<BridgeRect[]>([])
  const groupRects = ref<BridgeRect[]>([])
  let rectsGeneration = 0
  let rectLoopRunning = false
  let rectRefreshInFlight = false

  async function refreshRects() {
    if (rectRefreshInFlight) return
    rectRefreshInFlight = true
    const gen = ++rectsGeneration

    if (selectedEids.value.length > 0) {
      const rects = await iframe.getElementRects(selectedEids.value)
      if (gen !== rectsGeneration) { rectRefreshInFlight = false; return }
      selectionRects.value = rects.filter((r): r is BridgeRect => r !== null)
    } else {
      selectionRects.value = []
    }

    if (applyToGroup.value && selectedEids.value.length <= 1 && templateGroupEids.value.length > 0) {
      const otherEids = templateGroupEids.value.filter(eid => !selectedEids.value.includes(eid))
      const rects = await iframe.getElementRects(otherEids)
      if (gen !== rectsGeneration) { rectRefreshInFlight = false; return }
      groupRects.value = rects.filter((r): r is BridgeRect => r !== null)
    } else {
      groupRects.value = []
    }
    rectRefreshInFlight = false
  }

  function startRectLoop() {
    if (rectLoopRunning) return
    rectLoopRunning = true
    function tick() {
      if (!selectedEids.value.length) { rectLoopRunning = false; return }
      if (typeof document !== 'undefined' && document.hidden) {
        requestAnimationFrame(tick)
        return
      }
      refreshRects()
      requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  }

  watch([selectedEids, templateGroupEids, applyToGroup], () => {
    if (selectedEids.value.length) startRectLoop()
    else refreshRects()
  }, { deep: true })

  // ── Selection summary ──
  const selectionSummary = computed(() => {
    const explicit = selectedEids.value.length
    const group = templateGroupEids.value.length
    if (explicit > 1) return `${explicit} elements selected`
    if (group > 1) return `1 selected · ${group} instances in template`
    return null
  })

  // ── Element role classification ──
  const selectedElementRole = ref<ElementRole | null>(null)

  async function refreshElementRole() {
    if (!primarySelection.value) { selectedElementRole.value = null; return }
    const classification = await iframe.classifyElement(primarySelection.value.eid)
    selectedElementRole.value = classification?.role || null
  }

  // ── Live computed styles ──
  const liveStyles = ref<Record<string, string>>({})
  const editingClasses = ref('')
  const hoverRect = ref<BridgeRect | null>(null)
  const hoverInfo = ref<{ tag: string; file: string; component: string } | null>(null)

  const allStyleProps = [
    'display', 'position', 'width', 'height', 'min-width', 'max-width', 'min-height', 'max-height',
    'padding', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
    'margin', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
    'gap', 'flex-direction', 'align-items', 'justify-content', 'flex-wrap',
    'background-color', 'color', 'font-size', 'font-weight', 'font-family',
    'text-align', 'line-height', 'letter-spacing',
    'border', 'border-radius', 'border-color', 'border-width',
    'opacity', 'overflow', 'box-shadow',
  ]

  async function readLiveStyles() {
    if (!primarySelection.value?.eid) return
    liveStyles.value = await iframe.getComputedStyles(primarySelection.value.eid, allStyleProps)
  }

  // ── Style / class change handlers ──
  async function onStyleChange(property: string, value: string, tokenRole?: string) {
    if (!primarySelection.value) return
    const meta = {
      file: primarySelection.value.file,
      line: primarySelection.value.line,
      component: primarySelection.value.component,
      mfe: primarySelection.value.mfe || undefined,
      tokenRole,
    }
    const eids = editTargetEids.value
    for (const eid of eids) {
      const before = await iframe.applyStyleVia(eid, property, value)
      applyStyle(eid, property, value, before, meta)
    }
    await readLiveStyles()
  }

  async function applyClassChange() {
    if (!primarySelection.value) return
    const before = primarySelection.value.classes
    const after = editingClasses.value
    if (before === after) return
    const meta = {
      file: primarySelection.value.file,
      line: primarySelection.value.line,
      component: primarySelection.value.component,
      mfe: primarySelection.value.mfe || undefined,
    }
    const eids = editTargetEids.value
    for (const eid of eids) {
      await iframe.setClass(eid, after)
      recordClassChange(eid, before, after, meta)
    }
    primarySelection.value.classes = after
    await readLiveStyles()
  }

  function clearSelection() {
    primarySelection.value = null
    selectedEids.value = []
    selectionRects.value = []
    templateGroupEids.value = []
    groupRects.value = []
  }

  return {
    primarySelection, selectedEids, templateGroupEids, applyToGroup,
    editTargetEids, selectionRects, groupRects,
    selectionSummary, selectedElementRole,
    liveStyles, editingClasses,
    hoverRect, hoverInfo,
    readLiveStyles, refreshRects, refreshElementRole,
    onStyleChange, applyClassChange,
    clearSelection,
  }
}
