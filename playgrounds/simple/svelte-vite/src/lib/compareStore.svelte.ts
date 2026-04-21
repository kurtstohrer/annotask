/**
 * Compare store — selected country codes (max 4), persisted to localStorage.
 */

const STORAGE_KEY = 'atlas-compare'
const MAX = 4

function load(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.slice(0, MAX) : []
  } catch {
    return []
  }
}

function persist(codes: string[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(codes))
  } catch {
    /* noop */
  }
}

export function createCompareStore() {
  let codes = $state<string[]>(load())

  return {
    get codes() {
      return codes
    },
    get count() {
      return codes.length
    },
    has(code: string) {
      return codes.includes(code.toUpperCase())
    },
    add(code: string) {
      const upper = code.toUpperCase()
      if (codes.includes(upper) || codes.length >= MAX) return false
      codes = [...codes, upper]
      persist(codes)
      return true
    },
    remove(code: string) {
      codes = codes.filter((c) => c !== code.toUpperCase())
      persist(codes)
    },
    toggle(code: string) {
      return this.has(code) ? (this.remove(code), false) : this.add(code)
    },
    clear() {
      codes = []
      persist(codes)
    },
  }
}
