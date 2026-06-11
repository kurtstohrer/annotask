import { describe, it, expect } from 'vitest'
import { computeSnap } from '../wireframeSnap'

describe('computeSnap', () => {
  const neighbor = { x: 100, y: 200, width: 300, height: 100 } // edges x: 100/250/400, y: 200/250/300

  it('snaps a near-aligned left edge onto the neighbor edge and reports the guide', () => {
    const dragged = { x: 104, y: 500, width: 50, height: 50 }
    const r = computeSnap(dragged, [neighbor])
    expect(r.x).toBe(100)
    expect(r.y).toBe(500) // y is far from every candidate — untouched
    expect(r.guides).toEqual([{ axis: 'x', at: 100 }])
  })

  it('snaps centers to centers', () => {
    // dragged center x = 252 → neighbor center 250 (delta -2)
    const dragged = { x: 227, y: 196, width: 50, height: 50 }
    const r = computeSnap(dragged, [neighbor])
    expect(r.x).toBe(225) // center 250
    expect(r.y).toBe(200) // top edge 196 → 200
  })

  it('snaps right edge to left edge (adjacent placement)', () => {
    const dragged = { x: 45, y: 600, width: 50, height: 50 } // right = 95, near neighbor left 100
    const r = computeSnap(dragged, [neighbor])
    expect(r.x).toBe(50)
    expect(r.guides).toContainEqual({ axis: 'x', at: 100 })
  })

  it('beyond the threshold nothing snaps', () => {
    const dragged = { x: 110, y: 500, width: 50, height: 50 }
    const r = computeSnap(dragged, [neighbor])
    expect(r).toEqual({ x: 110, y: 500, guides: [] })
  })

  it('the smallest delta wins per axis across multiple neighbors', () => {
    const a = { x: 100, y: 0, width: 4, height: 4 } // x-lines 100/102/104
    const b = { x: 108, y: 0, width: 4, height: 4 } // x-lines 108/110/112
    const dragged = { x: 105, y: 500, width: 50, height: 50 }
    const r = computeSnap(dragged, [a, b])
    expect(r.x).toBe(104) // |Δ|=1 to a's right edge beats |Δ|=3 to b's left
  })

  it('respects a custom threshold', () => {
    const dragged = { x: 92, y: 500, width: 50, height: 50 }
    expect(computeSnap(dragged, [neighbor], 6).x).toBe(92)
    expect(computeSnap(dragged, [neighbor], 10).x).toBe(100)
  })
})
