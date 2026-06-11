import type { WireframeDirectionChange, WireframeRect } from '../../schema'
import type { WireframeBlock, WireframeCanvasState } from '../../shared/wireframe-types'

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
 * containing → 'append' into it.
 */
export function directionAnchor(
  block: WireframeBlock,
  blocks: WireframeBlock[],
): { neighbor: WireframeBlock | null; position: 'before' | 'after' | 'append' | 'prepend' } {
  const donors = anchorDonors(blocks).filter((d) => d.id !== block.id)
  if (donors.length === 0) return { neighbor: null, position: 'append' }
  let best = donors[0]
  let bestDist = Infinity
  for (const d of donors) {
    const dist = edgeDistance(block.rect, d.rect)
    if (dist < bestDist) { best = d; bestDist = dist }
  }
  const r = best.rect
  const contains = block.rect.x >= r.x && block.rect.y >= r.y
    && block.rect.x + block.rect.width <= r.x + r.width
    && block.rect.y + block.rect.height <= r.y + r.height
  if (contains) return { neighbor: best, position: 'append' }
  return { neighbor: best, position: centerY(block.rect) >= centerY(r) ? 'after' : 'before' }
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

export function computeWireframeDirections(canvas: WireframeCanvasState): WireframeDirectionChange[] {
  const blocks = canvas.blocks
  const survivors = blocks.filter((b) => !b.deleted)
  const capturedOriginals = blocks.filter((b) => b.kind === 'captured' && !b.duplicateOf && b.originalRect)
  const unionWidth = capturedOriginals.length
    ? Math.max(...capturedOriginals.map((b) => b.originalRect!.x + b.originalRect!.width))
      - Math.min(...capturedOriginals.map((b) => b.originalRect!.x))
    : canvas.viewport.width
  const contentWidth = Math.max(canvas.viewport.width, unionWidth)

  const directions: WireframeDirectionChange[] = []

  for (const b of blocks) {
    const isAddition = b.kind !== 'captured' || !!b.duplicateOf

    // Added sketch material (palette drops, placeholders, duplicates).
    if (isAddition) {
      if (b.deleted) continue // added then deleted — never existed
      const ownLabel = label(b)
      const original = b.duplicateOf ? blocks.find((x) => x.id === b.duplicateOf) : undefined
      const isCapturedDup = !!original && original.kind === 'captured'
      const kind: 'component' | 'placeholder' | 'duplicate' =
        b.kind === 'palette' ? 'component' : isCapturedDup ? 'duplicate' : 'placeholder'

      // A duplicate of a captured block anchors AT its original — the agent
      // duplicates that exact markup. Everything else anchors at the nearest
      // surviving captured neighbor.
      let neighbor: WireframeBlock | null
      let position: 'before' | 'after' | 'append' | 'prepend'
      if (isCapturedDup && !original.deleted && original.anchor?.file) {
        neighbor = original
        position = centerY(b.rect) >= centerY(original.rect) ? 'after' : 'before'
      } else {
        ({ neighbor, position } = directionAnchor(b, blocks))
      }

      const componentName = b.component?.componentName
      const where = neighbor
        ? `${position === 'append' ? 'inside' : position} the ${label(neighbor)}${fileLine(neighbor)}`
        : 'on the page'
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
      const dataNote = b.data
        ? `; bind to the ${b.data.kind} ${b.data.name}${b.data.path ? ` → ${b.data.path}` : ''}${b.data.fields?.length ? ` (show ${b.data.fields.join(', ')})` : ''} [shape: ${b.data.shape_source}]`
        : ''
      directions.push({
        id: `wd-${b.id}-add`,
        type: 'wireframe_direction',
        op: 'add',
        description: `ADD ${what} ${where}${mdNote}${dataNote}${b.note ? ` — user said: "${b.note}"` : ''}`,
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
          ...(b.component?.props ? { props: b.component.props } : {}),
          ...(b.component?.previewProps ? { previewProps: b.component.previewProps } : {}),
          ...(kind === 'placeholder' ? { label: ownLabel } : {}),
          ...(b.md ? { md: b.md } : {}),
          ...(b.data ? { data: JSON.parse(JSON.stringify(b.data)) as typeof b.data } : {}),
          position,
        },
        ...(b.note ? { note: b.note } : {}),
      })
      continue
    }

    // Captured blocks: delete / move / resize / note against the original.
    const ownLabel = label(b)
    const base = {
      type: 'wireframe_direction' as const,
      file: b.anchor?.file ?? '',
      section: 'template' as const,
      line: b.anchor?.line ?? 0,
      ...(b.anchor?.component ? { component: b.anchor.component } : {}),
      block: { label: ownLabel, ...(b.anchor?.component ? { component: b.anchor.component } : {}), ...(b.anchor?.tag ? { tag: b.anchor.tag } : {}) },
    }

    if (b.deleted) {
      directions.push({
        ...base,
        id: `wd-${b.id}-delete`,
        op: 'delete',
        description: `DELETE the ${ownLabel}${fileLine(b)}${b.note ? ` — user said: "${b.note}"` : ''}`,
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

    if (movedFar) {
      // Moved (and possibly resized) — ONE direction so the agent never
      // double-applies; resize facts ride the move.
      const others = survivors.filter((o) => o.id !== b.id)
      const relations = computeRelations(b, others, contentWidth)
      const parts = [
        ...(relations.length ? [relations.join('; ')] : []),
        `position ${Math.round(before.x)},${Math.round(before.y)} → ${Math.round(after.x)},${Math.round(after.y)} (measured)`,
        ...(resized ? [`size ${rectStr(before)} → ${rectStr(after)} (${wPct - 100 >= 0 ? '+' : ''}${wPct - 100}% w, ${hPct - 100 >= 0 ? '+' : ''}${hPct - 100}% h)`] : []),
      ]
      directions.push({
        ...base,
        id: `wd-${b.id}-move`,
        op: 'move',
        description: `MOVE the ${ownLabel}${fileLine(b)}: ${parts.join('; ')}${b.note ? ` — user said: "${b.note}"` : ''}`,
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
        description: `RESIZE the ${ownLabel}${fileLine(b)}: ${rectStr(before)} → ${rectStr(after)} (${wPct - 100 >= 0 ? '+' : ''}${wPct - 100}% w, ${hPct - 100 >= 0 ? '+' : ''}${hPct - 100}% h) (measured)${b.note ? ` — user said: "${b.note}"` : ''}`,
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
        description: `NOTE on the ${ownLabel}${fileLine(b)}: user said: "${b.note}"`,
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
