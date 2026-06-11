/**
 * Snap/align math for the wireframe canvas — pure so the thresholds and
 * tie-breaking are testable without pointer choreography. Snapping adjusts
 * the dragged rect's origin so one of its edges/centers lands exactly on a
 * neighbor's edge/center; the returned guides are the lines the canvas draws
 * while the snap is active.
 */

export interface SnapRect {
  x: number
  y: number
  width: number
  height: number
}

export interface SnapGuide {
  axis: 'x' | 'y'
  /** Document-coordinate position of the alignment line. */
  at: number
}

export interface SnapResult {
  x: number
  y: number
  guides: SnapGuide[]
}

const DEFAULT_THRESHOLD = 6

function lines(rect: SnapRect, axis: 'x' | 'y'): number[] {
  return axis === 'x'
    ? [rect.x, rect.x + rect.width / 2, rect.x + rect.width]
    : [rect.y, rect.y + rect.height / 2, rect.y + rect.height]
}

/**
 * Snap `rect` against `others` (the rects it could align with). Per axis the
 * smallest in-threshold delta wins; ties keep the first candidate in `others`
 * order, which is z-stable. Returns the adjusted origin plus the guide lines.
 */
export function computeSnap(rect: SnapRect, others: SnapRect[], threshold = DEFAULT_THRESHOLD): SnapResult {
  let bestX: { delta: number; at: number } | null = null
  let bestY: { delta: number; at: number } | null = null

  for (const other of others) {
    for (const target of lines(other, 'x')) {
      for (const own of lines(rect, 'x')) {
        const delta = target - own
        if (Math.abs(delta) <= threshold && (!bestX || Math.abs(delta) < Math.abs(bestX.delta))) {
          bestX = { delta, at: target }
        }
      }
    }
    for (const target of lines(other, 'y')) {
      for (const own of lines(rect, 'y')) {
        const delta = target - own
        if (Math.abs(delta) <= threshold && (!bestY || Math.abs(delta) < Math.abs(bestY.delta))) {
          bestY = { delta, at: target }
        }
      }
    }
  }

  const guides: SnapGuide[] = []
  if (bestX) guides.push({ axis: 'x', at: bestX.at })
  if (bestY) guides.push({ axis: 'y', at: bestY.at })
  return {
    x: rect.x + (bestX?.delta ?? 0),
    y: rect.y + (bestY?.delta ?? 0),
    guides,
  }
}
