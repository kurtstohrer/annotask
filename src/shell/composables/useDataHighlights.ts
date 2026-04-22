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
import { useWorkspace } from './useWorkspace'

export type HighlightConfidence = 'precise' | 'fallback' | 'runtime-only'

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
  /** Optional library/source-module filter. Paired with `tag`, the bridge
   *  also requires `data-annotask-source-module` to equal this value (or
   *  start with `<module>/`) — disambiguates two libraries that both expose
   *  the same component name. */
  module?: string
  /** Per-site match confidence. A binding graph can be mostly precise with
   *  one file falling back to line:0 wildcard, so granularity lives here
   *  rather than only on the parent source. Defaults to `'precise'` when
   *  unset. */
  confidence?: HighlightConfidence
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
  /** Source-level confidence — `'fallback'` when the binding graph contains
   *  at least one file-level wildcard, `'runtime-only'` for network sources
   *  with no static binding, else `'precise'`. UI shows a badge when this is
   *  not precise. Defaults to `'precise'`. */
  confidence?: HighlightConfidence
  /** Short diagnostic string shown in row tooltips — "Astro analyzer
   *  missing", etc. Only surfaced when `confidence !== 'precise'`. */
  partialNote?: string
}

export interface DataHighlightRect {
  sourceName: string
  file: string
  line: number
  eid: string
  rect: BridgeRect
  color: string
  label: string
  /** Originating site's source tag, when one was provided. Lets the shell
   *  match a `data:hover` event to the exact rect by tag + module without
   *  parsing the library prefix out of `sourceName`. */
  tag?: string
  /** Library package name the source belonged to (empty for non-library
   *  sources like data hooks). Matches against the hovered element's
   *  `data-annotask-source-module` via prefix so `@kobalte/core` also
   *  covers `@kobalte/core/button`. */
  module?: string
  /** Per-rect confidence derived from the originating site (or the parent
   *  source when the site didn't set one). Drives fallback/precise overlay
   *  styling in `_highlights.css`. Defaults to `'precise'`. */
  confidence?: HighlightConfidence
  /** Every source that resolved to this DOM element. `sourceName` is the
   *  primary (first) owner for back-compat with existing callers; multi-
   *  source elements list every contributor here so the overlay can show a
   *  count badge and a multi-line hover label. Length ≥ 1. */
  ownerSources: string[]
  /** Per-owner labels, aligned with `ownerSources` by index. Lets the hover
   *  tooltip render "useFoo\nuseBar" without re-joining names through the
   *  source list. */
  ownerLabels: string[]
}

/**
 * Theme-token palette used for positional color assignment in the Data view.
 * First six are the annotation tokens (guaranteed visually distinct per theme,
 * per the shell-theme contract). Six more semantic/utility tokens extend the
 * palette for pages with many data sources; beyond 12, `buildPositionalPalette`
 * falls back to golden-angle HCL hues so N sources always get N distinct colors.
 */
const DATA_PALETTE = [
  'var(--annotation-red)',
  'var(--annotation-orange)',
  'var(--annotation-yellow)',
  'var(--annotation-green)',
  'var(--annotation-blue)',
  'var(--annotation-purple)',
  'var(--cyan)',
  'var(--indigo)',
  'var(--success)',
  'var(--warning)',
  'var(--info)',
  'var(--danger)',
]

/**
 * Build a color array where `result[i]` is the color for the i-th source in a
 * visible list. Guarantees distinct adjacent colors up to the palette size,
 * with golden-angle HCL overflow when count exceeds the palette.
 */
export function buildPositionalPalette(count: number): string[] {
  const out: string[] = []
  for (let i = 0; i < count; i++) {
    if (i < DATA_PALETTE.length) {
      out.push(DATA_PALETTE[i])
    } else {
      // Golden-angle hue rotation — every N, the added hue stays far from its
      // neighbors so overflow entries never visually collide with each other.
      const hue = ((i - DATA_PALETTE.length) * 137.508) % 360
      out.push(`hsl(${hue.toFixed(1)}, 68%, 55%)`)
    }
  }
  return out
}

/**
 * Deterministic name → color mapping via FNV-1a hash. Used as a fallback for
 * callers that don't have a positional index (library swatches, per-operation
 * legend chips). For Data-view sources, prefer `buildPositionalPalette` +
 * index so N adjacent sources always get N distinct colors.
 */
export function colorForSource(name: string): string {
  let h = 2166136261
  for (let i = 0; i < name.length; i++) {
    h ^= name.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  const idx = Math.abs(h) % DATA_PALETTE.length
  return DATA_PALETTE[idx]
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
    if (active.value) {
      // Kick a refresh now so switching tools (Data → Components etc.) paints
      // within the same frame instead of waiting for the next rAF tick. The
      // rAF loop handles ongoing sync; this call just removes the startup gap.
      refreshRects()
      startLoop()
    }
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

      // Build the location list (one entry per unique (file, line, tag)).
      // When two sources share a location we accumulate both owners in
      // `siteOwners` rather than dropping the second — the overlay then
      // renders a count badge and a multi-owner tooltip. refToken is now the
      // location key itself so the bridge's match deduplicates across owners
      // before we even round-trip.
      const locations: Array<{ ref: string; file: string; line: number; tag?: string; mfe?: string; module?: string }> = []
      interface OwnerMeta { sourceName: string; color: string; label: string; tag?: string; module?: string; confidence: HighlightConfidence }
      const siteOwners = new Map<string, OwnerMeta[]>()

      // Workspace-aware path translation: catalogs store workspace-relative
      // paths, but the iframe DOM carries MFE-local `data-annotask-file`
      // values tagged with `data-annotask-mfe`. Convert each workspace path
      // back to `(mfe-local, mfe)` so the bridge selector lines up.
      const ws = useWorkspace()
      const mfePkgs = (ws.info.value?.packages ?? []).filter(p => !!p.mfe && !!p.dir)

      function toBridgeLoc(file: string): { file: string; mfe?: string } {
        // Longest-matching dir wins so nested packages beat their parent.
        let bestDir = ''
        let bestMfe: string | undefined
        for (const pkg of mfePkgs) {
          if (file === pkg.dir || file.startsWith(pkg.dir + '/')) {
            if (pkg.dir.length > bestDir.length) {
              bestDir = pkg.dir
              bestMfe = pkg.mfe
            }
          }
        }
        if (bestMfe) {
          return { file: file === bestDir ? '' : file.slice(bestDir.length + 1), mfe: bestMfe }
        }
        return { file }
      }

      for (const src of sources.value) {
        const sourceColor = src.color ?? colorForSource(src.name)
        for (const site of src.sites) {
          // Include tag in the dedup key so two sites at the same file:line
          // but different tags (e.g. Card outer + Checkbox inner) stay distinct.
          const key = `${site.file}::${site.line}::${site.tag ?? ''}`
          const label = site.label ?? src.defaultLabel ?? src.name
          const color = site.color ?? sourceColor
          // Per-site confidence falls back to the parent source's, then to
          // `'precise'`. File-level wildcard sites (line === 0) default to
          // `'fallback'` when neither the site nor the source sets one —
          // useDataSources emits that pattern for partial binding graphs.
          const confidence: HighlightConfidence =
            site.confidence
            ?? src.confidence
            ?? (site.line === 0 ? 'fallback' : 'precise')
          const entry: OwnerMeta = { sourceName: src.name, color, label, tag: site.tag, module: site.module, confidence }
          const existing = siteOwners.get(key)
          if (existing) {
            // Same (file, line, tag) already has an owner — stack this source
            // instead of silently dropping it. The bridge still only gets one
            // `locations` entry for this key, so we don't inflate the query.
            existing.push(entry)
            continue
          }
          siteOwners.set(key, [entry])
          const bridgeLoc = toBridgeLoc(site.file)
          locations.push({ ref: key, file: bridgeLoc.file, line: site.line, tag: site.tag, mfe: bridgeLoc.mfe, module: site.module })
        }
      }

      if (locations.length === 0) {
        if (rects.value.length) rects.value = []
        if (truncated.value) truncated.value = false
        return
      }

      const { matches, truncated: wasTruncated } = await iframe.getLocationElementRects(locations)

      // Two layers of merging: (1) the bridge returns one match per (ref,
      // eid) so the same refToken with different DOM matches produces
      // multiple rects, fine; (2) two different refTokens can resolve to
      // the same eid when separate sources both point at one element —
      // merge those into a single rect with an `ownerSources` list so the
      // UI can show both owners instead of drawing two stacked overlays.
      const byEid = new Map<string, DataHighlightRect>()
      const confidenceRank: Record<HighlightConfidence, number> = {
        precise: 2,
        fallback: 1,
        'runtime-only': 0,
      }
      for (const m of matches) {
        const owners = m.ref ? siteOwners.get(m.ref) : undefined
        if (!owners || owners.length === 0) continue
        const primary = owners[0]
        const existing = byEid.get(m.eid)
        if (existing) {
          // Another ref already mapped to this element — merge owner lists
          // and promote confidence to the strongest match so the overlay
          // doesn't misrepresent a precise+fallback combo as fallback.
          for (const o of owners) {
            if (existing.ownerSources.includes(o.sourceName)) continue
            existing.ownerSources.push(o.sourceName)
            existing.ownerLabels.push(o.label)
          }
          const currentRank = confidenceRank[existing.confidence ?? 'precise']
          for (const o of owners) {
            if (confidenceRank[o.confidence] > currentRank) {
              existing.confidence = o.confidence
            }
          }
          continue
        }
        if (byEid.size >= RECT_CAP) continue
        byEid.set(m.eid, {
          sourceName: primary.sourceName,
          file: m.file,
          line: m.line,
          eid: m.eid,
          rect: m.rect,
          color: primary.color,
          label: primary.label,
          tag: primary.tag,
          module: primary.module,
          confidence: primary.confidence,
          ownerSources: owners.map(o => o.sourceName),
          ownerLabels: owners.map(o => o.label),
        })
      }
      rects.value = [...byEid.values()]
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
    if (v && !old) {
      // Entering a highlight-showing view (Data / Components / etc.) — push a
      // refresh immediately so already-set sources paint without waiting for
      // the next setSources call. Fixes the case where a user switches to
      // Components on an unchanged iframe route and expects the overlays to
      // appear without them having to navigate the iframe first.
      refreshRects()
      startLoop()
    } else if (!v && old) {
      // Leaving a highlight view — clear both rects and sources so the next
      // entry starts from a clean slate. Without this, switching
      // Data → Annotate → Components would briefly paint the stale Data
      // sources until Components' own load() pushed its list.
      sources.value = []
      focusedName.value = null
      focusedEid.value = null
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
