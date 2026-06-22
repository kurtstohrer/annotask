import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { useCanvasHistory } from '../useCanvasHistory'

/** Minimal document the history snapshots: a value + a selection list. */
interface Doc { value: number; sel: string[] }

function harness(initial: Doc = { value: 0, sel: [] }) {
  let state: Doc = JSON.parse(JSON.stringify(initial))
  const history = useCanvasHistory<Doc>(
    () => state,
    (s) => { state = s },
  )
  return {
    history,
    get: () => state,
    set: (d: Doc) => { state = d },
  }
}

describe('useCanvasHistory', () => {
  it('record() captures the pre-mutation state; undo restores it, redo re-applies', () => {
    const h = harness({ value: 1, sel: ['a'] })
    h.history.record()
    h.set({ value: 2, sel: ['b'] })

    expect(h.history.canUndo.value).toBe(true)
    expect(h.history.canRedo.value).toBe(false)

    h.history.undo()
    expect(h.get()).toEqual({ value: 1, sel: ['a'] })
    expect(h.history.canRedo.value).toBe(true)

    h.history.redo()
    expect(h.get()).toEqual({ value: 2, sel: ['b'] })
  })

  it('restores the selection alongside the value (one snapshot covers both)', () => {
    const h = harness({ value: 0, sel: ['x', 'y'] })
    h.history.record()
    h.set({ value: 5, sel: ['z'] })
    h.history.undo()
    expect(h.get().sel).toEqual(['x', 'y'])
  })

  it('a new record() after undo clears the redo stack (no branching)', () => {
    const h = harness({ value: 0, sel: [] })
    h.history.record(); h.set({ value: 1, sel: [] })
    h.history.undo()
    expect(h.history.canRedo.value).toBe(true)
    h.history.record(); h.set({ value: 9, sel: [] })
    expect(h.history.canRedo.value).toBe(false)
  })

  it('begin()/end() collapse a multi-step gesture into ONE undo entry', () => {
    const h = harness({ value: 0, sel: [] })
    h.history.begin()
    // Several mutations inside the gesture; inner record() calls no-op.
    h.set({ value: 1, sel: [] }); h.history.record('rect')
    h.set({ value: 2, sel: [] }); h.history.record('rect')
    h.set({ value: 3, sel: [] })
    h.history.end()

    h.history.undo()
    expect(h.get().value).toBe(0)        // one step back to the pre-gesture state
    expect(h.history.canUndo.value).toBe(false)
  })

  it('end() drops a no-op gesture (a click that never moved)', () => {
    const h = harness({ value: 7, sel: ['a'] })
    h.history.begin()
    h.history.end()                       // nothing changed
    expect(h.history.canUndo.value).toBe(false)
  })

  describe('coalescing (rapid same-key records merge into one entry)', () => {
    beforeEach(() => vi.useFakeTimers())
    afterEach(() => vi.useRealTimers())

    it('merges same-key records within the time window, splits after it', () => {
      const h = harness({ value: 0, sel: [] })
      h.history.record('nudge'); h.set({ value: 1, sel: [] })
      vi.advanceTimersByTime(100)
      h.history.record('nudge'); h.set({ value: 2, sel: [] }) // coalesced — no new entry
      vi.advanceTimersByTime(100)
      h.history.record('nudge'); h.set({ value: 3, sel: [] }) // still coalesced

      h.history.undo()
      expect(h.get().value).toBe(0)        // single entry back to the start
      expect(h.history.canUndo.value).toBe(false)

      // After the window elapses, a fresh entry is cut.
      h.set({ value: 3, sel: [] })
      h.history.record('nudge'); h.set({ value: 4, sel: [] })
      vi.advanceTimersByTime(1000)
      h.history.record('nudge'); h.set({ value: 5, sel: [] })
      h.history.undo()
      expect(h.get().value).toBe(4)        // only the last burst undone
    })

    it('different keys never coalesce', () => {
      const h = harness({ value: 0, sel: [] })
      h.history.record('a'); h.set({ value: 1, sel: [] })
      h.history.record('b'); h.set({ value: 2, sel: [] })
      h.history.undo(); expect(h.get().value).toBe(1)
      h.history.undo(); expect(h.get().value).toBe(0)
    })
  })

  it('caps the undo stack at the configured limit (drops the oldest)', () => {
    let state = { value: 0, sel: [] as string[] }
    const history = useCanvasHistory<typeof state>(() => state, (s) => { state = s }, { limit: 3 })
    for (let i = 1; i <= 5; i++) { history.record(); state = { value: i, sel: [] } }
    // 5 records, limit 3 → only the 3 newest pasts remain.
    let undos = 0
    while (history.canUndo.value) { history.undo(); undos++ }
    expect(undos).toBe(3)
    expect(state.value).toBe(2)            // oldest reachable state (0 and 1 dropped)
  })

  it('clear() empties both stacks', () => {
    const h = harness()
    h.history.record(); h.set({ value: 1, sel: [] })
    h.history.clear()
    expect(h.history.canUndo.value).toBe(false)
    expect(h.history.canRedo.value).toBe(false)
  })
})
