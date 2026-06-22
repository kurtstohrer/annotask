import { ref, computed, type Ref, type ComputedRef } from 'vue'
import type { WireframeBlock, WireframeCanvasState } from '../../shared/wireframe-types'

/**
 * Canvas block selection (multi via shift-click / marquee), lifted out of
 * WireframeCanvas.vue so undo/redo can snapshot and restore it alongside the
 * blocks: an undone move re-selects whatever was selected when it was made.
 *
 * `selectedIds` is ordered by selection recency — the LAST id is primary (it
 * drives the per-block detail/edit affordances).
 */
export interface CanvasSelection {
  selectedIds: Ref<string[]>
  primaryId: ComputedRef<string | null>
  primaryBlock: ComputedRef<WireframeBlock | null>
  isSelected: (id: string) => boolean
  select: (id: string | null, additive?: boolean) => void
  setSelection: (ids: string[]) => void
  clear: () => void
  selectedBlocks: () => WireframeBlock[]
}

export function useCanvasSelection(canvas: Ref<WireframeCanvasState | null>): CanvasSelection {
  const selectedIds = ref<string[]>([])

  const primaryId = computed(() => selectedIds.value[selectedIds.value.length - 1] ?? null)
  const primaryBlock = computed(() =>
    canvas.value?.blocks.find((b) => b.id === primaryId.value && !b.deleted) ?? null)

  const isSelected = (id: string) => selectedIds.value.includes(id)

  function select(id: string | null, additive = false): void {
    if (id === null) {
      selectedIds.value = []
      return
    }
    if (additive) {
      selectedIds.value = isSelected(id)
        ? selectedIds.value.filter((x) => x !== id)
        : [...selectedIds.value, id]
    } else if (!isSelected(id)) {
      selectedIds.value = [id]
    } else {
      // Re-click inside a multi-selection keeps the group; promote to primary.
      selectedIds.value = [...selectedIds.value.filter((x) => x !== id), id]
    }
  }

  /** Replace the selection wholesale (marquee, undo/redo restore). Prunes ids
   *  that no longer resolve to a live block so a restored selection can't point
   *  at a deleted/removed block. */
  function setSelection(ids: string[]): void {
    const valid = new Set((canvas.value?.blocks ?? []).filter((b) => !b.deleted).map((b) => b.id))
    selectedIds.value = ids.filter((id) => valid.has(id))
  }

  function clear(): void {
    selectedIds.value = []
  }

  function selectedBlocks(): WireframeBlock[] {
    return (canvas.value?.blocks ?? []).filter((b) => isSelected(b.id) && !b.deleted)
  }

  return { selectedIds, primaryId, primaryBlock, isSelected, select, setSelection, clear, selectedBlocks }
}
