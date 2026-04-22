/**
 * Workspace catalog for the shell. Loads once from /api/workspace and
 * exposes the list of packages (with optional MFE ids) plus a helper for
 * mapping a workspace-relative file path back to its MFE. Powers the MFE
 * filter dropdown on Components / Data tabs.
 *
 * Module-level state so every page sees the same catalog without re-fetching.
 */
import { ref, computed } from 'vue'

export interface WorkspacePackage {
  name: string
  dir: string        // workspace-relative, forward-slash normalized
  mfe?: string
}

export interface WorkspaceInfo {
  root: string
  isWorkspace: boolean
  packages: WorkspacePackage[]
  /** Workspace-relative dir of the running package. Shell prefixes bridge-
   *  reported files with this so they align with workspace-rooted scanners.
   *  Empty string when the running package is the workspace root. */
  currentDir?: string
}

const info = ref<WorkspaceInfo | null>(null)
const isLoading = ref(false)
const loadError = ref<string | null>(null)
let loadPromise: Promise<void> | null = null

/** Active MFE ids selected via the filter UI. Empty set = show every MFE. */
const selectedMfes = ref<Set<string>>(new Set())

function toggleMfe(id: string): void {
  const next = new Set(selectedMfes.value)
  if (next.has(id)) next.delete(id); else next.add(id)
  selectedMfes.value = next
}

function clearMfes(): void {
  if (selectedMfes.value.size > 0) selectedMfes.value = new Set()
}

async function load(): Promise<void> {
  if (loadPromise) return loadPromise
  isLoading.value = true
  loadError.value = null
  loadPromise = (async () => {
    try {
      const res = await fetch('/__annotask/api/workspace')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      info.value = await res.json() as WorkspaceInfo
    } catch (err) {
      loadError.value = (err as Error).message ?? 'Failed to load workspace'
      info.value = null
    } finally {
      isLoading.value = false
    }
  })()
  return loadPromise
}

/** Packages that the plugin configured as MFEs — used to populate the filter. */
const mfePackages = computed<WorkspacePackage[]>(() =>
  (info.value?.packages ?? []).filter(p => !!p.mfe),
)

/** True when >1 MFE is present. Retained for call sites that still want the
 *  stricter check; new UI should prefer `hasAnyMfes` so the filter renders
 *  even in single-MFE projects (it still disambiguates "this MFE" vs
 *  "shared packages"). */
const hasMultipleMfes = computed<boolean>(() => mfePackages.value.length > 1)

/** True when at least one MFE was discovered. */
const hasAnyMfes = computed<boolean>(() => mfePackages.value.length > 0)

/**
 * Map a workspace-relative file path to the MFE id whose directory prefixes
 * it, or null when the file isn't under any MFE's package (shared libs etc.).
 */
function mfeForFile(file: string | undefined | null): string | null {
  if (!file) return null
  const norm = file.replace(/\\/g, '/')
  let best: WorkspacePackage | null = null
  for (const pkg of info.value?.packages ?? []) {
    if (!pkg.mfe) continue
    if (norm === pkg.dir || norm.startsWith(pkg.dir + '/')) {
      // Prefer the longest-matching dir so nested MFEs win over their parent.
      if (!best || pkg.dir.length > best.dir.length) best = pkg
    }
  }
  return best?.mfe ?? null
}

/** True when `files` has at least one entry under any selected MFE's dir. */
function filesMatchSelectedMfes(files: Iterable<string>): boolean {
  const ids = selectedMfes.value
  if (ids.size === 0) return true
  for (const f of files) {
    const id = mfeForFile(f)
    if (id && ids.has(id)) return true
  }
  return false
}

/** Shorthand for callers that have a single file path. */
function matchesSelectedMfes(mfeId: string | null): boolean {
  const ids = selectedMfes.value
  if (ids.size === 0) return true
  return !!mfeId && ids.has(mfeId)
}

export function useWorkspace() {
  return {
    info,
    isLoading,
    loadError,
    load,
    mfePackages,
    hasMultipleMfes,
    hasAnyMfes,
    selectedMfes,
    toggleMfe,
    clearMfes,
    mfeForFile,
    filesMatchSelectedMfes,
    matchesSelectedMfes,
  }
}
