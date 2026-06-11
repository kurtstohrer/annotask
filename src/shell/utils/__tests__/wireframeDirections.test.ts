import { describe, it, expect } from 'vitest'
import { computeWireframeDirections, directionAnchor } from '../wireframeDirections'
import type { WireframeBlock, WireframeCanvasState } from '../../../shared/wireframe-types'

function captured(id: string, y: number, height: number, line: number, extra: Partial<WireframeBlock> = {}): WireframeBlock {
  const rect = { x: 0, y, width: 800, height }
  return {
    id,
    kind: 'captured',
    rect: { ...rect },
    originalRect: { ...rect },
    z: 1,
    createdAt: 1,
    anchor: { file: 'src/pages/PlanetsPage.vue', line, component: 'PlanetsPage', sourceTag: id, tag: 'div' },
    ...extra,
  }
}

function canvasWith(blocks: WireframeBlock[]): WireframeCanvasState {
  return {
    capturedAt: 1,
    viewport: { width: 1280, height: 800, docWidth: 1280, docHeight: 2400, scale: 2 },
    blocks,
  }
}

// The /planets shape: page header, filters toolbar, planet grid.
function planetsBlocks(): WireframeBlock[] {
  return [
    captured('page-header', 0, 80, 85),
    captured('filters', 100, 60, 94),
    captured('grid', 180, 600, 128),
  ]
}

describe('computeWireframeDirections', () => {
  it('canvas jitter below thresholds produces zero directions', () => {
    const blocks = planetsBlocks()
    blocks[0].rect = { ...blocks[0].rect, x: 2, y: 1 } // 3px total
    blocks[1].rect = { ...blocks[1].rect, width: 803 } // 3px, <2%
    expect(computeWireframeDirections(canvasWith(blocks))).toEqual([])
  })

  it('a move past the threshold emits ONE direction with the order-flip relation', () => {
    const blocks = planetsBlocks()
    // Grid moves above the filters toolbar.
    blocks[2].rect = { ...blocks[2].rect, y: 90 }
    blocks[1].rect = { ...blocks[1].rect, y: 700 } // filters pushed below
    const dirs = computeWireframeDirections(canvasWith(blocks))
    expect(dirs).toHaveLength(2) // grid move + filters move
    const grid = dirs.find((d) => d.block.label === 'grid')!
    expect(grid.op).toBe('move')
    expect(grid.file).toBe('src/pages/PlanetsPage.vue')
    expect(grid.line).toBe(128)
    expect(grid.measured?.relations).toContain('now above the filters (was below)')
    expect(grid.measured?.dy).toBe(-90)
    expect(grid.description).toMatch(/^MOVE the grid \(src\/pages\/PlanetsPage\.vue:128\)/)
  })

  it('moved AND resized collapses into one move direction carrying the resize facts', () => {
    const blocks = planetsBlocks()
    blocks[2].rect = { x: 0, y: 90, width: 1200, height: 300 }
    blocks[1].rect = { ...blocks[1].rect, y: 700 }
    const dirs = computeWireframeDirections(canvasWith(blocks))
    const grid = dirs.find((d) => d.block.label === 'grid')!
    expect(grid.op).toBe('move')
    expect(grid.measured?.wPct).toBe(150)
    expect(grid.measured?.hPct).toBe(50)
    expect(dirs.filter((d) => d.block.label === 'grid')).toHaveLength(1)
  })

  it('resize-only emits px + % facts', () => {
    const blocks = planetsBlocks()
    blocks[1].rect = { ...blocks[1].rect, width: 400, height: 90 }
    const dirs = computeWireframeDirections(canvasWith(blocks))
    expect(dirs).toHaveLength(1)
    expect(dirs[0].op).toBe('resize')
    expect(dirs[0].measured).toMatchObject({ wPct: 50, hPct: 150 })
    expect(dirs[0].description).toContain('800x60 → 400x90')
    expect(dirs[0].description).toContain('(-50% w, +50% h)')
  })

  it('soft-deleted captured blocks emit delete anchored at their source', () => {
    const blocks = planetsBlocks()
    blocks[1].deleted = true
    const dirs = computeWireframeDirections(canvasWith(blocks))
    expect(dirs).toEqual([
      expect.objectContaining({
        op: 'delete',
        file: 'src/pages/PlanetsPage.vue',
        line: 94,
        description: 'DELETE the filters (src/pages/PlanetsPage.vue:94)',
      }),
    ])
  })

  it('palette drops emit add with REAL component names, anchored at the nearest captured neighbor', () => {
    const blocks = planetsBlocks()
    blocks.push({
      id: 'pal-1',
      kind: 'palette',
      rect: { x: 0, y: 800, width: 320, height: 140 }, // just below the grid
      z: 9,
      createdAt: 2,
      component: { tag: 'planetcard', componentName: 'PlanetCard', module: './components/PlanetCard.vue', props: { compact: true } },
      fidelity: 'isolated-preview',
    })
    const dirs = computeWireframeDirections(canvasWith(blocks))
    expect(dirs).toHaveLength(1)
    const add = dirs[0]
    expect(add.op).toBe('add')
    expect(add.added).toMatchObject({
      kind: 'component',
      componentName: 'PlanetCard',
      module: './components/PlanetCard.vue',
      props: { compact: true },
      position: 'after', // neighbor (grid) is visually above → insert after it
    })
    expect(add.file).toBe('src/pages/PlanetsPage.vue')
    expect(add.line).toBe(128) // grid anchor
    expect(add.description).toContain('ADD component <PlanetCard>')
  })

  it('placeholders carry the user label verbatim and stay visibly placeholders', () => {
    const blocks = planetsBlocks()
    blocks.push({
      id: 'ph-1',
      kind: 'placeholder',
      rect: { x: 60, y: 790, width: 360, height: 80 },
      z: 9,
      createdAt: 2,
      label: 'pagination here',
    })
    const dirs = computeWireframeDirections(canvasWith(blocks))
    expect(dirs).toHaveLength(1)
    expect(dirs[0].added).toMatchObject({ kind: 'placeholder', label: 'pagination here', position: 'after' })
    expect(dirs[0].description).toContain('placeholder "pagination here"')
    expect(dirs[0].description).toContain('keep it visibly a placeholder')
  })

  it('a note on an otherwise-unchanged block emits op note with the verbatim text', () => {
    const blocks = planetsBlocks()
    blocks[1].note = 'make this a carousel'
    const dirs = computeWireframeDirections(canvasWith(blocks))
    expect(dirs).toEqual([
      expect.objectContaining({
        op: 'note',
        note: 'make this a carousel',
        description: 'NOTE on the filters (src/pages/PlanetsPage.vue:94): user said: "make this a carousel"',
      }),
    ])
  })

  it('a note on a moved block rides the move direction — never a second entry', () => {
    const blocks = planetsBlocks()
    blocks[2].rect = { ...blocks[2].rect, y: 90 }
    blocks[2].note = 'keep the cards square'
    blocks[1].deleted = true
    const dirs = computeWireframeDirections(canvasWith(blocks))
    const grid = dirs.filter((d) => d.block.label === 'grid')
    expect(grid).toHaveLength(1)
    expect(grid[0].op).toBe('move')
    expect(grid[0].note).toBe('keep the cards square')
    expect(grid[0].description).toContain('user said: "keep the cards square"')
  })

  it('growing to ≥95% of content width emits the full-width relation', () => {
    const blocks = planetsBlocks()
    // Toolbar moves AND grows to full content width (content width = 1280 viewport).
    blocks[1].rect = { x: 0, y: 700, width: 1230, height: 60 }
    const dirs = computeWireframeDirections(canvasWith(blocks))
    const move = dirs.find((d) => d.block.label === 'filters')!
    expect(move.measured?.relations).toContain('now spans the full content width')
  })

  it('duplicates diff as add kind=duplicate, anchored at the original block', () => {
    const blocks = planetsBlocks()
    blocks.push({
      ...captured('grid-copy', 800, 600, 128),
      id: 'dup-1',
      duplicateOf: 'grid',
    })
    const dirs = computeWireframeDirections(canvasWith(blocks))
    expect(dirs).toHaveLength(1)
    expect(dirs[0].op).toBe('add')
    expect(dirs[0].added).toMatchObject({ kind: 'duplicate', position: 'after' })
    expect(dirs[0].file).toBe('src/pages/PlanetsPage.vue')
    expect(dirs[0].line).toBe(128) // the original grid's anchor
    expect(dirs[0].description).toContain("a duplicate of the grid block's markup")
  })

  it('an added-then-deleted block never appears', () => {
    const blocks = planetsBlocks()
    blocks.push({
      id: 'ph-dead', kind: 'placeholder', rect: { x: 0, y: 900, width: 100, height: 50 },
      z: 5, createdAt: 2, label: 'gone', deleted: true,
    })
    expect(computeWireframeDirections(canvasWith(blocks))).toEqual([])
  })

  it('directions come back top-down by current position (badge order)', () => {
    const blocks = planetsBlocks()
    blocks[0].deleted = true                              // header (was y0)
    blocks[2].rect = { ...blocks[2].rect, y: 90 }         // grid now y90
    blocks[1].rect = { ...blocks[1].rect, y: 700 }        // filters now y700
    const dirs = computeWireframeDirections(canvasWith(blocks))
    expect(dirs.map((d) => d.block.label)).toEqual(['page-header', 'grid', 'filters'])
  })
})

describe('directionAnchor', () => {
  it('prefers the nearest surviving captured donor; position describes the neighbor side', () => {
    const blocks = planetsBlocks()
    const above = { id: 'x', kind: 'placeholder' as const, rect: { x: 0, y: 60, width: 200, height: 30 }, z: 5, createdAt: 2, label: 'x' }
    // Sits between header (above) and filters (below) but touches filters.
    const near = directionAnchor({ ...above, rect: { x: 0, y: 95, width: 200, height: 30 } }, blocks)
    expect(near.neighbor?.id).toBe('filters')
    expect(near.position).toBe('before') // neighbor is below the block
  })

  it('returns append with no donors (placeholder-only canvas)', () => {
    const lone = { id: 'p', kind: 'placeholder' as const, rect: { x: 0, y: 0, width: 100, height: 50 }, z: 1, createdAt: 1, label: 'p' }
    expect(directionAnchor(lone, [lone])).toEqual({ neighbor: null, position: 'append' })
  })
})
