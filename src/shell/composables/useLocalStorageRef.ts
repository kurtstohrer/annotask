import { ref, watch, type Ref } from 'vue'

/**
 * Reactive ref backed by localStorage.
 *
 * - Reads initial value on construction (falls back to `fallback`).
 * - `serialize`/`parse` default to identity for strings — pass JSON helpers
 *   for other types.
 * - Writes on every change via a Vue `watch`. Fire-and-forget is fine here:
 *   localStorage is synchronous and there's nothing to await.
 *
 * This composable replaces the scattered `ref(localStorage.getItem(...))` +
 * `watch(x, v => localStorage.setItem(...))` pairs previously inlined in App.vue.
 */
export function useLocalStorageRef(key: string, fallback: string): Ref<string> {
  const initial = localStorage.getItem(key) ?? fallback
  const r = ref(initial)
  watch(r, (v) => localStorage.setItem(key, v))
  return r
}

/**
 * Reactive boolean ref backed by localStorage.
 * Stores as "true" / "false" strings.
 */
export function useLocalStorageBool(key: string, fallback: boolean): Ref<boolean> {
  const stored = localStorage.getItem(key)
  const initial = stored === null ? fallback : stored === 'true'
  const r = ref(initial)
  watch(r, (v) => localStorage.setItem(key, String(v)))
  return r
}

/**
 * Like `useLocalStorageRef` but restricted to a fixed set of allowed string values.
 * Unknown stored values fall back to `fallback` (e.g. if an old build wrote
 * a value that no longer exists in the enum).
 */
export function useLocalStorageEnum<T extends string>(key: string, values: readonly T[], fallback: T): Ref<T> {
  const stored = localStorage.getItem(key)
  const initial = stored && values.includes(stored as T) ? (stored as T) : fallback
  const r = ref(initial) as Ref<T>
  watch(r, (v) => localStorage.setItem(key, v))
  return r
}
