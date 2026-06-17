import { describe, it, expect } from 'vitest'
import { ref } from 'vue'
import { useCanvasSelection } from '../useCanvasSelection'
import type { WireframeBlock, WireframeCanvasState } from '../../../shared/wireframe-types'

/** Minimal block — selection only cares about id + deleted. */
function blk(id: string, deleted = false): WireframeBlock {
  return { id, kind: 'placeholder', rect: { x: 0, y: 0, width: 10, height: 10 }, z: 0, createdAt: 1, ...(deleted ? { deleted: true } : {}) }
}

function canvasOf(...blocks: WireframeBlock[]) {
  return ref<WireframeCanvasState | null>({
    capturedAt: 1,
    viewport: { width: 1280, height: 800, docWidth: 1280, docHeight: 2400, scale: 1 },
    blocks,
  })
}

describe('useCanvasSelection', () => {
  it('single select replaces; primary is the (only) selected id', () => {
    const sel = useCanvasSelection(canvasOf(blk('a'), blk('b')))
    sel.select('a')
    expect(sel.selectedIds.value).toEqual(['a'])
    expect(sel.primaryId.value).toBe('a')
    expect(sel.primaryBlock.value?.id).toBe('a')

    sel.select('b')
    expect(sel.selectedIds.value).toEqual(['b'])
    expect(sel.isSelected('a')).toBe(false)
  })

  it('additive select toggles membership and keeps primary = last-selected', () => {
    const sel = useCanvasSelection(canvasOf(blk('a'), blk('b'), blk('c')))
    sel.select('a')
    sel.select('b', true)
    sel.select('c', true)
    expect(sel.selectedIds.value).toEqual(['a', 'b', 'c'])
    expect(sel.primaryId.value).toBe('c')

    // Additive re-click REMOVES (toggle off).
    sel.select('b', true)
    expect(sel.selectedIds.value).toEqual(['a', 'c'])
    expect(sel.isSelected('b')).toBe(false)
  })

  it('re-clicking inside a multi-selection keeps the group and promotes to primary (no collapse)', () => {
    const sel = useCanvasSelection(canvasOf(blk('a'), blk('b'), blk('c')))
    sel.setSelection(['a', 'b', 'c'])
    expect(sel.primaryId.value).toBe('c')

    // Plain (non-additive) click on an already-selected member must NOT collapse
    // to a single selection — it promotes that member to primary.
    sel.select('a')
    expect(sel.selectedIds.value).toEqual(['b', 'c', 'a'])
    expect(sel.primaryId.value).toBe('a')
  })

  it('select(null) and clear() empty the selection', () => {
    const sel = useCanvasSelection(canvasOf(blk('a')))
    sel.select('a')
    sel.select(null)
    expect(sel.selectedIds.value).toEqual([])
    sel.setSelection(['a'])
    sel.clear()
    expect(sel.selectedIds.value).toEqual([])
    expect(sel.primaryId.value).toBeNull()
    expect(sel.primaryBlock.value).toBeNull()
  })

  it('setSelection prunes ids that no longer resolve to a live block', () => {
    const sel = useCanvasSelection(canvasOf(blk('a'), blk('b'), blk('gone-deleted', true)))
    // 'ghost' was removed entirely; 'gone-deleted' is soft-deleted — both pruned.
    sel.setSelection(['a', 'ghost', 'gone-deleted', 'b'])
    expect(sel.selectedIds.value).toEqual(['a', 'b'])
  })

  it('primaryBlock and selectedBlocks exclude soft-deleted blocks', () => {
    const canvas = canvasOf(blk('a'), blk('b'))
    const sel = useCanvasSelection(canvas)
    sel.setSelection(['a', 'b'])
    expect(sel.selectedBlocks().map((b) => b.id)).toEqual(['a', 'b'])

    // 'b' gets soft-deleted after selection — it drops out of selectedBlocks,
    // and a primary pointing at it resolves to null (the live-block lookup skips it).
    canvas.value!.blocks = [blk('a'), blk('b', true)]
    expect(sel.selectedBlocks().map((b) => b.id)).toEqual(['a'])
    expect(sel.primaryId.value).toBe('b')      // id is still tracked…
    expect(sel.primaryBlock.value).toBeNull()  // …but it no longer resolves to a live block
  })
})
