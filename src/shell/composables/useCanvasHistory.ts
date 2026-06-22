import { ref, computed, type Ref } from 'vue'

/**
 * Snapshot-stack undo/redo for a single plain-data document.
 *
 * The wireframe canvas is small, JSON-serializable state (a few dozen blocks
 * plus the current selection), so a structural-clone snapshot stack is the
 * simplest thing that covers EVERY mutation uniformly — move, resize, delete,
 * duplicate, note, binding, z-order, palette-drop, explode. No per-op inverse
 * commands to keep in sync.
 *
 * Recording model:
 *  - `record(key?)` — a discrete op snapshots the CURRENT (pre-mutation) state.
 *    Call it BEFORE mutating. `key` + a short time window coalesces rapid
 *    repeats (e.g. a burst of arrow-key nudges) into one entry.
 *  - `begin()` / `end()` — bracket a multi-step gesture (a drag, or a loop over
 *    several selected blocks). `begin()` captures one baseline; `record()` calls
 *    in between no-op; `end()` commits a single entry (or drops it if nothing
 *    actually changed). Gestures collapse what would otherwise be N entries.
 */
export interface CanvasHistory {
  canUndo: Ref<boolean>
  canRedo: Ref<boolean>
  begin(): void
  end(): void
  record(coalesceKey?: string): void
  undo(): boolean
  redo(): boolean
  clear(): void
}

const COALESCE_MS = 600

export function useCanvasHistory<S>(
  getState: () => S,
  setState: (s: S) => void,
  opts: { limit?: number; clone?: (s: S) => S } = {},
): CanvasHistory {
  const limit = opts.limit ?? 50
  const clone = opts.clone ?? ((s: S) => JSON.parse(JSON.stringify(s)) as S)

  const past = ref<S[]>([]) as Ref<S[]>
  const future = ref<S[]>([]) as Ref<S[]>
  const canUndo = computed(() => past.value.length > 0)
  const canRedo = computed(() => future.value.length > 0)

  let gestureActive = false
  let gestureBaseline: S | null = null
  let lastCoalesceKey: string | null = null
  let lastRecordAt = 0
  // Module-local clock so coalescing never depends on a passed-in timestamp.
  const now = () => Date.now()

  function pushPast(snapshot: S): void {
    past.value.push(snapshot)
    if (past.value.length > limit) past.value.shift()
  }

  function commit(snapshot: S): void {
    pushPast(snapshot)
    future.value = []
  }

  function begin(): void {
    if (gestureActive) return
    gestureActive = true
    gestureBaseline = clone(getState())
  }

  function end(): void {
    if (!gestureActive) return
    gestureActive = false
    const baseline = gestureBaseline
    gestureBaseline = null
    if (baseline == null) return
    // Drop no-op gestures (a click that never moved, a drag back to origin).
    if (JSON.stringify(baseline) === JSON.stringify(getState())) return
    commit(baseline)
    lastCoalesceKey = null
  }

  function record(coalesceKey?: string): void {
    if (gestureActive) return
    const ts = now()
    if (coalesceKey && coalesceKey === lastCoalesceKey && ts - lastRecordAt < COALESCE_MS) {
      // Same gesture continuing — fold into the entry already on the stack.
      lastRecordAt = ts
      return
    }
    commit(clone(getState()))
    lastCoalesceKey = coalesceKey ?? null
    lastRecordAt = ts
  }

  function undo(): boolean {
    if (!past.value.length) return false
    const prev = past.value.pop() as S
    future.value.push(clone(getState()))
    setState(clone(prev))
    lastCoalesceKey = null
    return true
  }

  function redo(): boolean {
    if (!future.value.length) return false
    const next = future.value.pop() as S
    pushPast(clone(getState()))
    setState(clone(next))
    lastCoalesceKey = null
    return true
  }

  function clear(): void {
    past.value = []
    future.value = []
    gestureActive = false
    gestureBaseline = null
    lastCoalesceKey = null
    lastRecordAt = 0
  }

  return { canUndo, canRedo, begin, end, record, undo, redo, clear }
}
