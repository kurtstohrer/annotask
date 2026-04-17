import { watch, type Ref } from 'vue'
import type { useIframeManager } from './useIframeManager'
import type { InteractionMode } from './useInteractionMode'

interface Rect {
  x: number
  y: number
  width: number
  height: number
}

interface PendingTaskLike {
  kind: string
}

interface UseInteractionModeSyncOptions {
  interactionMode: Ref<InteractionMode>
  iframe: ReturnType<typeof useIframeManager>
  pendingTaskCreation: Ref<PendingTaskLike | null>
  pendingTaskText: Ref<string>
  arrowHoverElement: Ref<unknown>
  hoverRect: Ref<Rect | null>
  hoverInfo: Ref<unknown>
  clearSelection: () => void
  discardUncommittedAnnotations: () => void
}

/**
 * Syncs interaction mode changes to the iframe bridge and resets related
 * state when switching modes (clears selection on interact, cleans orphan
 * annotations, drops arrow-mode hover state, etc.).
 */
export function useInteractionModeSync(opts: UseInteractionModeSyncOptions) {
  const {
    interactionMode, iframe,
    pendingTaskCreation, pendingTaskText,
    arrowHoverElement, hoverRect, hoverInfo,
    clearSelection, discardUncommittedAnnotations,
  } = opts

  watch(interactionMode, (mode) => {
    iframe.setMode(mode)
    discardUncommittedAnnotations()
    if (mode !== 'select' && pendingTaskCreation.value?.kind === 'select') {
      pendingTaskCreation.value = null
      pendingTaskText.value = ''
    }
    if (mode !== 'arrow') {
      arrowHoverElement.value = null
    }
    if (mode === 'interact' || mode === 'highlight') {
      clearSelection()
      hoverRect.value = null
      hoverInfo.value = null
    }
  })
}
