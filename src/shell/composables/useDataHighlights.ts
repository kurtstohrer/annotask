/**
 * Data-source preview highlight state for the Data view. Driven by
 * `useDataSources`: setSources populates the list, setFocus emphasizes one.
 * An rAF loop keeps rects synced against the iframe DOM.
 *
 * The per-source payload is a list of precise `{file, line}` sites (produced
 * by the server's binding-analysis pass). A line of `0` is a wildcard
 * meaning "every element in this file" — the file-level fallback that the
 * server emits when no AST analyzer is available.
 *
 * Colors come from the annotation palette so they follow the active theme.
 */
import { ref, watch, type Ref } from 'vue'
import type { BridgeRect } from '../../shared/bridge-types'
import type { DataSource } from '../../schema'
import type { useIframeManager } from './useIframeManager'

export interface DataHighlightSite {
  file: string
  line: number
  /** Optional per-site display label override (e.g. `/api/solar/planets`). */
  label?: string
  /** Optional per-site color override. Lets the APIs tab color each element
   *  by the specific operation path rather than the enclosing schema. */
  color?: string
  /** Optional source tag filter (e.g. `Card`). When present, the iframe
   *  handler only matches elements whose `data-annotask-source-tag` equals
   *  this value — critical for library components where multiple tags on
   *  the same line would otherwise confuse the leaf-only filter. */
  tag?: string
}

export interface DataHighlightSource {
  name: string
  kind: DataSource['kind']
  sites: DataHighlightSite[]
  /** Default display label for sites that don't carry their own. */
  defaultLabel?: string
  /** Optional source-level color override. When present, overrides the
   *  default `colorForSource(name)` hash so multiple sources can share one
   *  color (e.g. every component from the same library). */
  color?: string
}

export interface DataHighlightRect {
  sourceName: string
  file: string
  line: number
  eid: string
  rect: BridgeRect
  color: string
  label: string
}

const ANNOTATION_PALETTE = [
  'var(--annotation-red)',
  'var(--annotation-orange)',
  'var(--annotation-yellow)',
  'var(--annotation-green)',
  'var(--annotation-blue)',
  'var(--annotation-purple)',
]

/**
 * Deterministic name → color mapping over the 6-color annotation palette.
 */
export function colorForSource(name: string): string {
  let h = 2166136261
  for (let i = 0; i < name.length; i++) {
    h ^= name.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  const idx = Math.abs(h) % ANNOTATION_PALETTE.length
  return ANNOTATION_PALETTE[idx]
}

const RECT_CAP = 400

export function useDataHighlights(deps: {
  iframe: ReturnType<typeof useIframeManager>
  /** True when the shell is on a view that should show data-source highlights
   *  (Develop > Data or Design > Components). The caller computes this from
   *  its own routing state so the composable stays oblivious to view ids. */
  active: Ref<boolean>
}) {
  const { iframe, active } = deps

  const sources = ref<DataHighlightSource[]>([])
  const focusedName = ref<string | null>(null)
  /** When set, scopes focus to one specific element (by eid) — used for
   *  iframe-hover to highlight a single instance rather than every rect
   *  sharing the same sourceName. Cleared when focus is set from a list
   *  row (no eid) or when focus clears entirely. */
  const focusedEid = ref<string | null>(null)
  const rects = ref<DataHighlightRect[]>([])
  const truncated = ref(false)

  let loopRunning = false
  let refreshInFlight = false

  function setSources(list: DataHighlightSource[]): void {
    sources.value = list
    if (list.length === 0) {
      rects.value = []
      truncated.value = false
    }
    if (focusedName.value && !list.find(s => s.name === focusedName.value)) {
      focusedName.value = null
    }
    if (active.value) startLoop()
  }

  function setFocus(name: string | null, eid: string | null = null): void {
    focusedName.value = name
    focusedEid.value = eid
  }

  function clear(): void {
    sources.value = []
    focusedName.value = null
    focusedEid.value = null
    rects.value = []
    truncated.value = false
  }

  async function refreshRects(): Promise<void> {
    if (refreshInFlight) return
    refreshInFlight = true
    try {
      if (!active.value || sources.value.length === 0) {
        if (rects.value.length) rects.value = []
        if (truncated.value) truncated.value = false
        return
      }

      // Build the location list (one entry per (source, site)). First-source
      // wins on collision — if two sources share a file:line, only the first
      // one's location is sent, so the match is attributed to it.
      const seen = new Set<string>()
      const locations: Array<{ ref: string; file: string; line: number; tag?: string }> = []
      const siteMeta = new Map<string, { sourceName: string; color: string; label: string }>()

      for (const src of sources.value) {
        const sourceColor = src.color ?? colorForSource(src.name)
        for (const site of src.sites) {
          // Include tag in the dedup key so two sites at the same file:line
          // but different tags (e.g. Card outer + Checkbox inner) stay distinct.
          const key = `${site.file}::${site.line}::${site.tag ?? ''}`
          if (seen.has(key)) continue
          seen.add(key)
          const refToken = `${src.name}\u0001${key}`
          const label = site.label ?? src.defaultLabel ?? src.name
          const color = site.color ?? sourceColor
          siteMeta.set(refToken, { sourceName: src.name, color, label })
          locations.push({ ref: refToken, file: site.file, line: site.line, tag: site.tag })
        }
      }

      if (locations.length === 0) {
        if (rects.value.length) rects.value = []
        if (truncated.value) truncated.value = false
        return
      }

      const { matches, truncated: wasTruncated } = await iframe.getLocationElementRects(locations)

      const out: DataHighlightRect[] = []
      for (const m of matches) {
        if (out.length >= RECT_CAP) break
        const meta = m.ref ? siteMeta.get(m.ref) : undefined
        if (!meta) continue
        out.push({
          sourceName: meta.sourceName,
          file: m.file,
          line: m.line,
          eid: m.eid,
          rect: m.rect,
          color: meta.color,
          label: meta.label,
        })
      }
      rects.value = out
      truncated.value = wasTruncated || matches.length > RECT_CAP
    } finally {
      refreshInFlight = false
    }
  }

  function startLoop(): void {
    if (loopRunning) return
    if (!active.value) return
    loopRunning = true
    const tick = () => {
      if (!active.value || sources.value.length === 0) {
        loopRunning = false
        return
      }
      if (typeof document !== 'undefined' && document.hidden) {
        requestAnimationFrame(tick)
        return
      }
      refreshRects()
      requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  }

  watch(active, (v, old) => {
    if (v && !old) startLoop()
    else if (!v && old) {
      rects.value = []
      truncated.value = false
    }
  })

  watch(sources, () => { if (active.value) startLoop() }, { deep: true })

  return {
    sources,
    focusedName,
    focusedEid,
    rects,
    truncated,
    setSources,
    setFocus,
    clear,
  }
}
