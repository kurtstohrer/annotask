import type { WireframeDirectionChange, WireframeRect } from '../../schema'
import type { WireframeBlock, WireframeCanvasState } from '../../shared/wireframe-types'
import { WIREFRAME_DATA_BINDING_ENABLED } from '../wireframeFeatures'

/**
 * Diff the original capture against the current canvas into anchored,
 * structured directions — ONE direction per changed block. Pixel geometry is
 * a hint; the relational facts computed here are the contract the agent
 * implements ("now above the filters toolbar"), so they must be derivable
 * from box geometry alone — never invented, never blended with user notes.
 */

/** Canvas jitter below these thresholds is not a direction. */
const MOVE_THRESHOLD_PX = 8
const RESIZE_THRESHOLD_PX = 4
const RESIZE_THRESHOLD_PCT = 2

function label(b: WireframeBlock): string {
  if (b.kind === 'placeholder') return b.label ?? 'placeholder'
  if (b.kind === 'palette') return b.component?.componentName ?? b.component?.tag ?? 'component'
  // cssClass first: a page's blocks all share the owning component name, and
  // 'div' says nothing — '.toolbar'/'.layout' is the human-distinct identity.
  return b.anchor?.cssClass || b.anchor?.sourceTag || b.anchor?.tag || b.anchor?.component || 'block'
}

function overlap1D(a0: number, a1: number, b0: number, b1: number): number {
  return Math.max(0, Math.min(a1, b1) - Math.max(a0, b0))
}

function centerY(r: WireframeRect): number { return r.y + r.height / 2 }
function centerX(r: WireframeRect): number { return r.x + r.width / 2 }

/** Edge distance between two rects (0 when they touch/overlap). */
function edgeDistance(a: WireframeRect, b: WireframeRect): number {
  const dx = Math.max(0, Math.max(b.x - (a.x + a.width), a.x - (b.x + b.width)))
  const dy = Math.max(0, Math.max(b.y - (a.y + a.height), a.y - (b.y + b.height)))
  return Math.hypot(dx, dy)
}

/** Surviving captured blocks with a real source anchor — the only honest
 *  anchor donors for added material. */
function anchorDonors(blocks: WireframeBlock[]): WireframeBlock[] {
  return blocks.filter((b) => b.kind === 'captured' && !b.deleted && !b.duplicateOf && !!b.anchor?.file)
}

/**
 * Anchor an added block at its nearest anchored neighbor. Position describes
 * where the new markup goes relative to the NEIGHBOR in source order:
 * neighbor visually above → insert 'after' it; below → 'before' it;
 * containing → 'append' into it. `runnerUp` names the second-nearest donor
 * when it was a close call (edge distance ≤ 1.5x the winner's) — an honest
 * alternative for the agent to sanity-check the anchor choice against.
 */
export function directionAnchor(
  block: WireframeBlock,
  blocks: WireframeBlock[],
): { neighbor: WireframeBlock | null; position: 'before' | 'after' | 'append' | 'prepend'; runnerUp?: WireframeBlock } {
  const donors = anchorDonors(blocks).filter((d) => d.id !== block.id)
  if (donors.length === 0) return { neighbor: null, position: 'append' }
  let best: WireframeBlock | null = null
  let bestDist = Infinity
  let second: WireframeBlock | null = null
  let secondDist = Infinity
  for (const d of donors) {
    const dist = edgeDistance(block.rect, d.rect)
    if (dist < bestDist) { second = best; secondDist = bestDist; best = d; bestDist = dist }
    else if (dist < secondDist) { second = d; secondDist = dist }
  }
  const runnerUp = second && secondDist <= 1.5 * bestDist ? { runnerUp: second } : {}
  const r = best!.rect
  const contains = block.rect.x >= r.x && block.rect.y >= r.y
    && block.rect.x + block.rect.width <= r.x + r.width
    && block.rect.y + block.rect.height <= r.y + r.height
  if (contains) return { neighbor: best, position: 'append', ...runnerUp }
  return { neighbor: best, position: centerY(block.rect) >= centerY(r) ? 'after' : 'before', ...runnerUp }
}

/** Relational facts for a moved block vs every other surviving block.
 *  Priority: order flips → full content width → fresh alignment. Max 3. */
function computeRelations(
  moved: WireframeBlock,
  others: WireframeBlock[],
  contentWidth: number,
): string[] {
  const relations: string[] = []
  const before = moved.originalRect!
  const after = moved.rect

  for (const o of others) {
    if (relations.length >= 3) break
    const oBefore = o.originalRect ?? o.rect
    const oAfter = o.rect
    const oLabel = label(o)
    // Vertical order flip — only meaningful when the pair shares a column
    // (≥30% horizontal overlap).
    const hOverlap = overlap1D(after.x, after.x + after.width, oAfter.x, oAfter.x + oAfter.width)
    if (hOverlap >= 0.3 * Math.min(after.width, oAfter.width)) {
      const wasBelow = centerY(before) > centerY(oBefore)
      const isAbove = centerY(after) < centerY(oAfter)
      if (wasBelow && isAbove) { relations.push(`now above the ${oLabel} (was below)`); continue }
      const wasAbove = centerY(before) < centerY(oBefore)
      const isBelow = centerY(after) > centerY(oAfter)
      if (wasAbove && isBelow) { relations.push(`now below the ${oLabel} (was above)`); continue }
    }
    // Horizontal order flip — only when the pair shares a row (≥50% vertical
    // overlap).
    const vOverlap = overlap1D(after.y, after.y + after.height, oAfter.y, oAfter.y + oAfter.height)
    if (vOverlap >= 0.5 * Math.min(after.height, oAfter.height)) {
      const wasRight = centerX(before) > centerX(oBefore)
      const isLeft = centerX(after) < centerX(oAfter)
      if (wasRight && isLeft) { relations.push(`now left of the ${oLabel} (was right)`); continue }
      const wasLeft = centerX(before) < centerX(oBefore)
      const isRight = centerX(after) > centerX(oAfter)
      if (wasLeft && isRight) { relations.push(`now right of the ${oLabel} (was left)`); continue }
    }
  }

  if (relations.length < 3
    && after.width >= 0.95 * contentWidth && before.width < 0.9 * contentWidth) {
    relations.push('now spans the full content width')
  }

  if (relations.length < 3) {
    for (const o of others) {
      if (relations.length >= 3) break
      const oBefore = o.originalRect ?? o.rect
      if (Math.abs(after.x - o.rect.x) <= 4 && Math.abs(before.x - oBefore.x) > 4) {
        relations.push(`left-aligned with the ${label(o)}`)
        break
      }
    }
  }

  return relations
}

function fileLine(b: WireframeBlock): string {
  return b.anchor?.file ? ` (${b.anchor.file}:${b.anchor.line})` : ''
}

function rectStr(r: WireframeRect): string {
  return `${Math.round(r.width)}x${Math.round(r.height)}`
}

/** Fallback relation when the overlap-gated rules produce nothing (diagonal
 *  move into empty space): a pixels-only direction is one the agent is told
 *  to distrust, so always name the nearest surviving block and the rough
 *  side the block landed on (dominant center-delta axis). */
function nearestRelation(after: WireframeRect, others: WireframeBlock[]): string | null {
  let nearest: WireframeBlock | null = null
  let nearestDist = Infinity
  for (const o of others) {
    const dist = edgeDistance(after, o.rect)
    if (dist < nearestDist) { nearest = o; nearestDist = dist }
  }
  if (!nearest) return null
  const dxc = centerX(after) - centerX(nearest.rect)
  const dyc = centerY(after) - centerY(nearest.rect)
  const side = Math.abs(dyc) >= Math.abs(dxc)
    ? (dyc < 0 ? 'above' : 'below')
    : (dxc < 0 ? 'left of' : 'right of')
  return `nearest the ${label(nearest)}${fileLine(nearest)}, roughly ${side} it`
}

/** Blocks minted by one v-for/map render all share a single (file, line)
 *  anchor — a source-level edit there hits EVERY instance, so directions on
 *  a sharer must say so. Deleted sharers still count (they share the anchor
 *  too). Ordinal is document order, proxied by capture rect (y, then x). */
function computeAnchorSharers(blocks: WireframeBlock[]): Map<string, { ordinal: number; of: number }> {
  const groups = new Map<string, WireframeBlock[]>()
  for (const b of blocks) {
    if (b.kind !== 'captured' || b.duplicateOf || !b.anchor?.file) continue
    const key = `${b.anchor.file}:${b.anchor.line}`
    const g = groups.get(key)
    if (g) g.push(b)
    else groups.set(key, [b])
  }
  const shared = new Map<string, { ordinal: number; of: number }>()
  for (const g of groups.values()) {
    if (g.length < 2) continue
    g.sort((a, c) => {
      const ar = a.originalRect ?? a.rect
      const cr = c.originalRect ?? c.rect
      return ar.y - cr.y || ar.x - cr.x
    })
    g.forEach((b, i) => shared.set(b.id, { ordinal: i + 1, of: g.length }))
  }
  return shared
}

export function computeWireframeDirections(canvas: WireframeCanvasState): WireframeDirectionChange[] {
  const blocks = canvas.blocks
  const survivors = blocks.filter((b) => !b.deleted)
  const capturedOriginals = blocks.filter((b) => b.kind === 'captured' && !b.duplicateOf && b.originalRect)
  const unionWidth = capturedOriginals.length
    ? Math.max(...capturedOriginals.map((b) => b.originalRect!.x + b.originalRect!.width))
      - Math.min(...capturedOriginals.map((b) => b.originalRect!.x))
    : canvas.viewport.width
  const contentWidth = Math.max(canvas.viewport.width, unionWidth)
  const sharedAnchors = computeAnchorSharers(blocks)

  // Exploded children ride a parent drag, so a group move diffs as N+1
  // identical deltas — suppress the children's moves and let the parent's
  // single direction carry the relocation, or the agent double-applies it.
  const delta = (x: WireframeBlock) => {
    const o = x.originalRect ?? x.rect
    return { dx: x.rect.x - o.x, dy: x.rect.y - o.y }
  }
  const movedPastThreshold = (x: WireframeBlock) => {
    const d = delta(x)
    return Math.abs(d.dx) + Math.abs(d.dy) > MOVE_THRESHOLD_PX
  }
  const suppressedChildMoves = new Set<string>()
  const parentsOfSuppressed = new Set<string>()
  for (const b of blocks) {
    if (b.kind !== 'captured' || b.duplicateOf || b.deleted || !b.parentId || !movedPastThreshold(b)) continue
    const parent = blocks.find((p) => p.id === b.parentId)
    if (!parent || parent.kind !== 'captured' || parent.deleted || !movedPastThreshold(parent)) continue
    const d = delta(b)
    const pd = delta(parent)
    if (Math.abs(d.dx - pd.dx) <= 2 && Math.abs(d.dy - pd.dy) <= 2) {
      suppressedChildMoves.add(b.id)
      parentsOfSuppressed.add(parent.id)
    }
  }

  const directions: WireframeDirectionChange[] = []

  for (const b of blocks) {
    const isAddition = b.kind !== 'captured' || !!b.duplicateOf

    // Added sketch material (palette drops, placeholders, duplicates).
    if (isAddition) {
      if (b.deleted) continue // added then deleted — never existed
      const ownLabel = label(b)
      // Data binding is gated for this release: a block may still carry a
      // PERSISTED binding (older docs render it read-only), but a NEW apply
      // task must not inherit it — strip it here so "new tasks won't carry
      // bindings" (WIREFRAME_APPLY.md) is literally true. When the gate flips
      // on, the persisted/picker binding flows through unchanged.
      const data = WIREFRAME_DATA_BINDING_ENABLED ? b.data : undefined
      const original = b.duplicateOf ? blocks.find((x) => x.id === b.duplicateOf) : undefined
      const isCapturedDup = !!original && original.kind === 'captured'
      const kind: 'component' | 'placeholder' | 'duplicate' =
        b.kind === 'palette' ? 'component' : isCapturedDup ? 'duplicate' : 'placeholder'

      // A duplicate of a captured block anchors AT its original — the agent
      // duplicates that exact markup. Everything else anchors at the nearest
      // surviving captured neighbor.
      let neighbor: WireframeBlock | null
      let position: 'before' | 'after' | 'append' | 'prepend'
      let runnerUp: WireframeBlock | undefined
      if (isCapturedDup && !original.deleted && original.anchor?.file) {
        neighbor = original
        position = centerY(b.rect) >= centerY(original.rect) ? 'after' : 'before'
      } else {
        ({ neighbor, position, runnerUp } = directionAnchor(b, blocks))
      }

      const componentName = b.component?.componentName
      const where = neighbor
        ? `${position === 'append' ? 'inside' : position} the ${label(neighbor)}${fileLine(neighbor)}`
        : 'on the page'
      // A near-tie donor is worth naming: the agent can sanity-check the
      // anchor choice instead of trusting one edge-distance winner blindly.
      const altNote = runnerUp ? `; alternative anchor: the ${label(runnerUp)}${fileLine(runnerUp)}` : ''
      // A duplicate whose original LEFT the sketch (deleted/exploded) has no
      // anchor to copy from — say so honestly instead of claiming the user
      // sketched a box. A placeholder WITH md is a drawn section: the spec in
      // added.md is the contract, not "keep it visibly a placeholder".
      const danglingDup = b.kind === 'captured' && !!b.duplicateOf && !original
      const what = kind === 'component'
        ? `component <${componentName ?? ownLabel}>`
        : kind === 'duplicate'
          ? `a duplicate of the ${label(original!)} block's markup`
          : danglingDup
            ? `a copy of the removed "${ownLabel}" block (its original left the sketch — the AFTER pane shows its content; re-anchor from the screenshot, never invent)`
            : b.md
              ? `drawn section "${ownLabel}" (user-sketched box ${rectStr(b.rect)})`
              : `placeholder "${ownLabel}" (user-sketched box ${rectStr(b.rect)}; keep it visibly a placeholder)`
      // Honest summaries only: the FULL md body rides added.md verbatim (the
      // description quotes its first line); the binding summary names the
      // real source + the shape_source honesty tag.
      const mdFirstLine = b.md ? b.md.split('\n')[0].replace(/^#+\s*/, '').slice(0, 120) : ''
      const mdNote = b.md ? `; user wrote a markdown spec (rides added.md verbatim) — first line: "${mdFirstLine}"` : ''
      const mapNote = data?.propMap && Object.keys(data.propMap).length
        ? `; map ${Object.entries(data.propMap).map(([prop, field]) => `${field}→${prop}`).join(', ')}`
        : ''
      const loopNote = data?.path && data.path.includes('[]')
        ? `; render a v-for over ${data.path} — render ALL items (the ×${data.repeat ?? 'N'} on the canvas is a sketch hint)`
        : ''
      // Honest tags: the path provenance (schema-picked vs user-typed) tells the
      // agent whether to trust `path` or re-ground it before wiring.
      const dataNote = data
        ? `; bind to the ${data.kind} ${data.name}${data.path ? ` → ${data.path}` : ''}${data.fields?.length ? ` (show ${data.fields.join(', ')})` : ''}${mapNote}${loopNote} [shape: ${data.shape_source}${data.path_source ? `, path: ${data.path_source}` : ''}]`
        : ''
      // Multi-MFE: import the dropped component FROM its own package when it has
      // one; otherwise inherit the anchored DONOR's MFE — a placeholder/dup
      // dropped into (or duplicated from) MFE-A's region is authored in MFE-A's
      // package. Names the owning package so the agent imports from it and
      // scopes example search there (see WIREFRAME_APPLY.md).
      const addMfe = b.component?.mfe || neighbor?.anchor?.mfe || ''
      const mfeNote = addMfe ? `; import from MFE "${addMfe}"` : ''
      directions.push({
        id: `wd-${b.id}-add`,
        type: 'wireframe_direction',
        op: 'add',
        description: `ADD ${what} ${where}${altNote}${mdNote}${dataNote}${mfeNote}${b.note ? ` — user said: "${b.note}"` : ''}`,
        file: neighbor?.anchor?.file ?? '',
        section: 'template',
        line: neighbor?.anchor?.line ?? 0,
        ...(neighbor?.anchor?.component ? { component: neighbor.anchor.component } : {}),
        block: { label: ownLabel, ...(componentName ? { component: componentName } : {}), ...(b.component?.tag || b.anchor?.tag ? { tag: b.component?.tag ?? b.anchor?.tag } : {}) },
        measured: { after: { ...b.rect } },
        added: {
          kind,
          ...(componentName ? { componentName } : {}),
          ...(b.component?.library ? { library: b.component.library } : {}),
          ...(b.component?.module ? { module: b.component.module } : {}),
          ...(addMfe ? { mfe: addMfe } : {}),
          ...(b.component?.props ? { props: b.component.props } : {}),
          ...(b.component?.previewProps ? { previewProps: b.component.previewProps } : {}),
          ...(kind === 'placeholder' ? { label: ownLabel } : {}),
          ...(b.md ? { md: b.md } : {}),
          ...(data ? { data: JSON.parse(JSON.stringify(data)) as typeof data } : {}),
          position,
        },
        ...(b.note ? { note: b.note } : {}),
      })
      continue
    }

    // Captured blocks: delete / move / resize / note against the original.
    const ownLabel = label(b)
    // Multi-MFE: the existing element LIVES in this package — the agent edits
    // THAT source, and a shared MFE-local path (src/App.tsx) disambiguates by it
    // (LOCATION semantics, distinct from an add's import-from). See
    // WIREFRAME_APPLY.md.
    const mfeLoc = b.anchor?.mfe ? ` in MFE "${b.anchor.mfe}"` : ''
    const shared = sharedAnchors.get(b.id)
    // Anchorless block (file '') carrying a capture-time DOM fingerprint: ride
    // it on the direction and tell the agent to resolve it FIRST — a bare
    // class label + measured rects is honest but not actionable. A GREP-
    // resolved anchor (the shell's capture-time auto-resolve stamped file/line
    // from that fingerprint) is usable but not gospel: keep the fingerprint
    // riding and tell the agent to verify the anchor before editing.
    const grepResolved = b.anchor?.resolvedBy === 'grep'
    const fingerprint = (!b.anchor?.file || grepResolved) && b.anchor?.fingerprint ? b.anchor.fingerprint : undefined
    const fingerprintNote = !b.anchor?.file && fingerprint
      ? ' — unanchored: DOM fingerprint attached; resolve it to source with annotask_resolve_fingerprint before editing'
      : grepResolved
        ? ' — anchor grep-resolved from a DOM fingerprint; verify with annotask_get_source_excerpt before editing'
        : ''
    // Anchorless markup that a server produced (htmx/Turbo swap): there is no
    // client file — point the agent at the endpoint's template instead.
    const fragmentNote = !b.anchor?.file && b.anchor?.fragmentUrl
      ? ` — markup produced by ${b.anchor.fragmentUrl}; edit the server template behind that endpoint`
      : ''
    const anchorNotes = fingerprintNote + fragmentNote
    const base = {
      type: 'wireframe_direction' as const,
      file: b.anchor?.file ?? '',
      section: 'template' as const,
      line: b.anchor?.line ?? 0,
      ...(b.anchor?.component ? { component: b.anchor.component } : {}),
      ...(b.anchor?.mfe ? { mfe: b.anchor.mfe } : {}),
      block: { label: ownLabel, ...(b.anchor?.component ? { component: b.anchor.component } : {}), ...(b.anchor?.tag ? { tag: b.anchor.tag } : {}) },
      ...(shared ? { sharedAnchor: shared } : {}),
      ...(fingerprint ? { fingerprint } : {}),
    }
    // One anchor, many blocks = loop-rendered: a source edit hits every
    // instance, so the description must warn — deletes loudest of all.
    const sharedDeleteNote = shared
      ? ` — CAUTION: ${shared.of} blocks share this anchor (likely loop-rendered); removing the source element removes ALL of them. Verify with annotask_get_binding_classification; if the user meant one item, ask via needs_info.`
      : ''
    const sharedEditNote = shared
      ? ` — note: ${shared.of} blocks share this anchor (loop-rendered); the source-level change applies to every instance.`
      : ''

    if (b.deleted) {
      directions.push({
        ...base,
        id: `wd-${b.id}-delete`,
        op: 'delete',
        description: `DELETE the ${ownLabel}${fileLine(b)}${mfeLoc}${b.note ? ` — user said: "${b.note}"` : ''}${sharedDeleteNote}${anchorNotes}`,
        measured: { before: { ...(b.originalRect ?? b.rect) } },
        ...(b.note ? { note: b.note } : {}),
      })
      continue
    }

    const before = b.originalRect ?? b.rect
    const after = b.rect
    const dx = after.x - before.x
    const dy = after.y - before.y
    const dw = after.width - before.width
    const dh = after.height - before.height
    const movedFar = Math.abs(dx) + Math.abs(dy) > MOVE_THRESHOLD_PX
    const resized = (Math.abs(dw) > RESIZE_THRESHOLD_PX && Math.abs(dw) / Math.max(before.width, 1) * 100 > RESIZE_THRESHOLD_PCT)
      || (Math.abs(dh) > RESIZE_THRESHOLD_PX && Math.abs(dh) / Math.max(before.height, 1) * 100 > RESIZE_THRESHOLD_PCT)
    const wPct = Math.round((after.width / Math.max(before.width, 1)) * 100)
    const hPct = Math.round((after.height / Math.max(before.height, 1)) * 100)

    if (movedFar && !suppressedChildMoves.has(b.id)) {
      // Moved (and possibly resized) — ONE direction so the agent never
      // double-applies; resize facts ride the move.
      const others = survivors.filter((o) => o.id !== b.id)
      let relations = computeRelations(b, others, contentWidth)
      if (!relations.length) {
        const fallback = nearestRelation(after, others)
        if (fallback) relations = [fallback]
      }
      // A child that moved DIFFERENTLY from its moved parent is a real
      // in-container restructure — but the agent must know the container
      // itself relocated too, or the child's coordinates read as absolute.
      const parent = b.parentId ? blocks.find((p) => p.id === b.parentId) : undefined
      const containerNote = parent && parent.kind === 'captured' && !parent.deleted && movedPastThreshold(parent)
        ? ` — within the ${label(parent)} container (which also moved)`
        : ''
      const childrenNote = parentsOfSuppressed.has(b.id) ? ' (its children move with it)' : ''
      const parts = [
        ...(relations.length ? [relations.join('; ')] : []),
        `position ${Math.round(before.x)},${Math.round(before.y)} → ${Math.round(after.x)},${Math.round(after.y)} (measured)`,
        ...(resized ? [`size ${rectStr(before)} → ${rectStr(after)} (${wPct - 100 >= 0 ? '+' : ''}${wPct - 100}% w, ${hPct - 100 >= 0 ? '+' : ''}${hPct - 100}% h)`] : []),
      ]
      directions.push({
        ...base,
        id: `wd-${b.id}-move`,
        op: 'move',
        description: `MOVE the ${ownLabel}${fileLine(b)}${mfeLoc}${childrenNote}: ${parts.join('; ')}${containerNote}${b.note ? ` — user said: "${b.note}"` : ''}${sharedEditNote}${anchorNotes}`,
        measured: {
          before: { ...before }, after: { ...after },
          dx: Math.round(dx), dy: Math.round(dy),
          ...(resized ? { wPct, hPct } : {}),
          ...(relations.length ? { relations } : {}),
        },
        ...(b.note ? { note: b.note } : {}),
      })
      continue
    }

    if (resized) {
      directions.push({
        ...base,
        id: `wd-${b.id}-resize`,
        op: 'resize',
        description: `RESIZE the ${ownLabel}${fileLine(b)}${mfeLoc}: ${rectStr(before)} → ${rectStr(after)} (${wPct - 100 >= 0 ? '+' : ''}${wPct - 100}% w, ${hPct - 100 >= 0 ? '+' : ''}${hPct - 100}% h) (measured)${b.note ? ` — user said: "${b.note}"` : ''}${sharedEditNote}${anchorNotes}`,
        measured: { before: { ...before }, after: { ...after }, wPct, hPct },
        ...(b.note ? { note: b.note } : {}),
      })
      continue
    }

    if (b.note) {
      directions.push({
        ...base,
        id: `wd-${b.id}-note`,
        op: 'note',
        description: `NOTE on the ${ownLabel}${fileLine(b)}${mfeLoc}: user said: "${b.note}"${anchorNotes}`,
        // Note-only directions still sort by where the block sits — without
        // a rect the top-down sort would pin them all to y=0.
        measured: { after: { ...b.rect } },
        note: b.note,
      })
    }
  }

  // Stable, badge-friendly order: top-down by where the block sits now
  // (deleted blocks by where they were).
  directions.sort((a, c) => {
    const ay = a.measured?.after?.y ?? a.measured?.before?.y ?? 0
    const cy = c.measured?.after?.y ?? c.measured?.before?.y ?? 0
    return ay - cy
  })
  return directions
}
