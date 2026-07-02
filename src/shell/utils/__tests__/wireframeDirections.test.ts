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
    // Regression lock: a BARE placeholder's payload and description stay
    // byte-stable — md/data must not leak empty fields or new phrasing in.
    expect(dirs[0].added!.md).toBeUndefined()
    expect(dirs[0].added!.data).toBeUndefined()
    expect(dirs[0].description).toContain('placeholder "pagination here"')
    expect(dirs[0].description).toContain('keep it visibly a placeholder')
    expect(dirs[0].description).not.toContain('markdown spec')
    expect(dirs[0].description).not.toContain('bind to the')
  })

  it('a section (md + binding) rides added.md/.data verbatim; the description summarizes honestly', () => {
    const blocks = planetsBlocks()
    const md = '## Related planets\n- name and type for each'
    blocks.push({
      id: 'sec-1',
      kind: 'placeholder',
      rect: { x: 60, y: 790, width: 360, height: 120 },
      z: 9,
      createdAt: 2,
      label: 'related planets',
      md,
      data: {
        kind: 'composable',
        name: 'usePlanets',
        module: 'src/composables/usePlanets.ts',
        path: 'planets[]',
        fields: ['name', 'type'],
        shape_source: 'api-schema',
      },
    })
    const dirs = computeWireframeDirections(canvasWith(blocks))
    expect(dirs).toHaveLength(1)
    // Verbatim channels — never paraphrased, never blended with geometry.
    expect(dirs[0].added!.md).toBe(md)
    expect(dirs[0].added!.data).toEqual({
      kind: 'composable',
      name: 'usePlanets',
      module: 'src/composables/usePlanets.ts',
      path: 'planets[]',
      fields: ['name', 'type'],
      shape_source: 'api-schema',
    })
    expect(dirs[0].measured!.after).toBeDefined()
    // The description quotes only the md's first line + an honest binding summary.
    expect(dirs[0].description).toContain('drawn section "related planets"')
    expect(dirs[0].description).not.toContain('keep it visibly a placeholder') // the md spec IS the contract
    expect(dirs[0].description).toContain('first line: "Related planets"')
    expect(dirs[0].description).not.toContain('name and type for each')
    expect(dirs[0].description).toContain('bind to the composable usePlanets → planets[] (show name, type)')
    expect(dirs[0].description).toContain('[shape: api-schema]')
    // A list path adds a v-for loop note (render all items, not the sketch count).
    expect(dirs[0].description).toContain('render a v-for over planets[]')
  })

  it('a bound palette component carries added.data too', () => {
    const blocks = planetsBlocks()
    blocks.push({
      id: 'pal-2',
      kind: 'palette',
      rect: { x: 60, y: 790, width: 320, height: 100 },
      z: 9,
      createdAt: 2,
      component: { tag: 'planetcard', componentName: 'PlanetCard', module: './components/PlanetCard.vue' },
      fidelity: 'isolated-preview',
      data: { kind: 'composable', name: 'usePlanets', path: 'planets[]', shape_source: 'api-schema' },
    })
    const dirs = computeWireframeDirections(canvasWith(blocks))
    expect(dirs).toHaveLength(1)
    expect(dirs[0].added).toMatchObject({
      kind: 'component',
      componentName: 'PlanetCard',
      data: { name: 'usePlanets', path: 'planets[]' },
    })
    expect(dirs[0].description).toContain('bind to the composable usePlanets')
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

describe('computeWireframeDirections — shared anchors (loop-rendered)', () => {
  // A v-for/map mints N blocks that all share ONE (file, line) anchor — a
  // source-level edit there hits every instance, so directions must say so.
  function loopCards(): WireframeBlock[] {
    return [
      captured('card-1', 0, 100, 200),
      captured('card-2', 110, 100, 200),
      captured('card-3', 220, 100, 200),
    ]
  }

  it('a delete on one loop card carries sharedAnchor ordinal + the CAUTION text', () => {
    const blocks = loopCards()
    blocks[1].deleted = true
    const dirs = computeWireframeDirections(canvasWith(blocks))
    expect(dirs).toHaveLength(1)
    expect(dirs[0].op).toBe('delete')
    // Document order (y then x): card-2 is the 2nd of 3 sharers — the
    // deleted block itself counts among them.
    expect(dirs[0].sharedAnchor).toEqual({ ordinal: 2, of: 3 })
    expect(dirs[0].description).toContain(
      ' — CAUTION: 3 blocks share this anchor (likely loop-rendered); removing the source element removes ALL of them. '
      + 'Verify with annotask_get_binding_classification; if the user meant one item, ask via needs_info.',
    )
  })

  it('a move on one loop card carries sharedAnchor + the every-instance note; deleted sharers still count', () => {
    const blocks = loopCards()
    blocks[2].deleted = true // still shares the anchor
    blocks[0].rect = { ...blocks[0].rect, y: 400 }
    const dirs = computeWireframeDirections(canvasWith(blocks))
    const move = dirs.find((d) => d.op === 'move')!
    expect(move.sharedAnchor).toEqual({ ordinal: 1, of: 3 })
    expect(move.description).toContain(
      ' — note: 3 blocks share this anchor (loop-rendered); the source-level change applies to every instance.',
    )
  })

  it('uniquely-anchored blocks carry no sharedAnchor and no loop text', () => {
    const blocks = planetsBlocks()
    blocks[1].deleted = true
    const dirs = computeWireframeDirections(canvasWith(blocks))
    expect('sharedAnchor' in dirs[0]).toBe(false)
    expect(dirs[0].description).not.toContain('share this anchor')
  })
})

describe('computeWireframeDirections — exploded parent/child moves', () => {
  // An exploded container (shell) whose children carry parentId — dragging
  // the parent moves the children with it on the canvas.
  function explodedBlocks(): WireframeBlock[] {
    return [
      captured('layout', 0, 400, 10, { shell: true }),
      captured('child-a', 50, 100, 20, { parentId: 'layout' }),
      captured('child-b', 200, 100, 30, { parentId: 'layout' }),
    ]
  }

  it('children dragged with the parent (same delta ±2px) are suppressed; the parent says so', () => {
    const blocks = explodedBlocks()
    blocks[0].rect = { ...blocks[0].rect, y: 300 }
    blocks[1].rect = { ...blocks[1].rect, y: 351 } // dy 301 vs parent's 300 — within ±2
    blocks[2].rect = { ...blocks[2].rect, y: 500 } // dy 300 exactly
    const dirs = computeWireframeDirections(canvasWith(blocks))
    expect(dirs).toHaveLength(1)
    expect(dirs[0].block.label).toBe('layout')
    expect(dirs[0].op).toBe('move')
    expect(dirs[0].description).toContain(' (its children move with it)')
  })

  it('a child that moved DIFFERENTLY from its moved parent keeps its direction with the container note', () => {
    const blocks = explodedBlocks()
    blocks[0].rect = { ...blocks[0].rect, y: 300 }
    blocks[1].rect = { ...blocks[1].rect, x: 200, y: 351 } // dx 200 diverges
    const dirs = computeWireframeDirections(canvasWith(blocks))
    const parent = dirs.find((d) => d.block.label === 'layout')!
    const child = dirs.find((d) => d.block.label === 'child-a')!
    expect(child.op).toBe('move')
    expect(child.description).toContain(' — within the layout container (which also moved)')
    // No child was suppressed, so the parent claims nothing about children.
    expect(parent.description).not.toContain('its children move with it')
  })

  it('a child whose parent did NOT move keeps its direction unchanged', () => {
    const blocks = explodedBlocks()
    blocks[1].rect = { ...blocks[1].rect, y: 351 }
    const dirs = computeWireframeDirections(canvasWith(blocks))
    expect(dirs).toHaveLength(1)
    expect(dirs[0].block.label).toBe('child-a')
    expect(dirs[0].op).toBe('move')
    expect(dirs[0].description).not.toContain('within the')
    expect(dirs[0].description).not.toContain('also moved')
  })
})

describe('computeWireframeDirections — relation guarantee', () => {
  it('a diagonal move into empty space gains the nearest-block fallback relation', () => {
    const blocks = planetsBlocks()
    // Grid heads off to the right — no order flip, no full width, no alignment.
    blocks[2].rect = { ...blocks[2].rect, x: 900, y: 50 }
    const dirs = computeWireframeDirections(canvasWith(blocks))
    const move = dirs.find((d) => d.block.label === 'grid')!
    expect(move.measured?.relations).toEqual([
      'nearest the page-header (src/pages/PlanetsPage.vue:85), roughly right of it',
    ])
    expect(move.description).toContain('nearest the page-header')
  })

  it('a near-tie anchor donor on an ADD is named as the alternative anchor', () => {
    const blocks = planetsBlocks()
    // Squeezed between filters (2px above) and grid (2px below) — a near-tie.
    blocks.push({
      id: 'ph-mid', kind: 'placeholder', rect: { x: 60, y: 162, width: 360, height: 16 },
      z: 9, createdAt: 2, label: 'promo',
    })
    const dirs = computeWireframeDirections(canvasWith(blocks))
    expect(dirs).toHaveLength(1)
    expect(dirs[0].file).toBe('src/pages/PlanetsPage.vue')
    expect(dirs[0].line).toBe(94) // filters won
    expect(dirs[0].description).toContain('; alternative anchor: the grid (src/pages/PlanetsPage.vue:128)')
  })

  it('a clear anchor winner names no alternative', () => {
    const blocks = planetsBlocks()
    blocks.push({
      id: 'ph-far', kind: 'placeholder', rect: { x: 60, y: 790, width: 360, height: 80 },
      z: 9, createdAt: 2, label: 'pagination here',
    })
    const dirs = computeWireframeDirections(canvasWith(blocks))
    expect(dirs[0].description).not.toContain('alternative anchor')
  })
})

describe('computeWireframeDirections — note-op sort position', () => {
  it('a note direction sorts by its block rect, not y=0', () => {
    const blocks = planetsBlocks()
    blocks[1].note = 'make this a carousel' // filters, y100
    blocks[2].rect = { ...blocks[2].rect, y: 20 } // grid moves above it
    const dirs = computeWireframeDirections(canvasWith(blocks))
    const note = dirs.find((d) => d.op === 'note')!
    expect(note.measured?.after?.y).toBe(100)
    expect(dirs.map((d) => d.block.label)).toEqual(['grid', 'filters'])
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

describe('computeWireframeDirections — multi-MFE', () => {
  it('a moved captured block carries its MFE as a location note + structured field', () => {
    const blocks = [
      captured('board', 0, 300, 5, { anchor: { file: '../mfe-react-workflows/src/Board.tsx', line: 5, sourceTag: 'board', tag: 'section', mfe: 'react-workflows' } }),
      captured('queue', 320, 300, 9, { anchor: { file: '../mfe-react-workflows/src/Queue.tsx', line: 9, sourceTag: 'queue', tag: 'section', mfe: 'react-workflows' } }),
    ]
    blocks[0].rect = { ...blocks[0].rect, y: 700 } // board moves below queue
    const dirs = computeWireframeDirections(canvasWith(blocks))
    const board = dirs.find((d) => d.block.label === 'board')!
    expect(board.op).toBe('move')
    expect(board.mfe).toBe('react-workflows')
    expect(board.description).toContain('in MFE "react-workflows"')
    expect(board.file).toBe('../mfe-react-workflows/src/Board.tsx')
  })

  it('a non-MFE captured block omits the mfe field and note', () => {
    const blocks = planetsBlocks()
    blocks[2].rect = { ...blocks[2].rect, y: 90 } // grid moves up
    const grid = computeWireframeDirections(canvasWith(blocks)).find((d) => d.block.label === 'grid')!
    expect('mfe' in grid).toBe(false)
    expect(grid.description).not.toContain('in MFE')
  })

  it('an ADD dropped near an MFE-anchored donor inherits the donor MFE for import-from', () => {
    const donor = captured('board', 0, 300, 5, { anchor: { file: '../mfe-react-workflows/src/Board.tsx', line: 5, sourceTag: 'board', tag: 'section', mfe: 'react-workflows' } })
    // A user-drawn placeholder section dropped just below the donor — no own mfe.
    const ph: WireframeBlock = { id: 'cta', kind: 'placeholder', rect: { x: 0, y: 290, width: 800, height: 60 }, z: 2, createdAt: 2, label: 'CTA' }
    const dirs = computeWireframeDirections(canvasWith([donor, ph]))
    const add = dirs.find((d) => d.op === 'add')!
    expect(add.added?.mfe).toBe('react-workflows')
    expect(add.description).toContain('import from MFE "react-workflows"')
  })
})

describe('computeWireframeDirections — anchorless DOM fingerprints', () => {
  const FP = {
    selector: 'main:nth-of-type(1) > div:nth-of-type(2)',
    textHead: 'Remote widget',
    htmlHead: '<div class="remote-widget">Remote widget</div>',
  }
  const HINT = ' — unanchored: DOM fingerprint attached; resolve it to source with annotask_resolve_fingerprint before editing'

  /** A captured block from an un-instrumented region: file '' + fingerprint. */
  function anchorless(id: string, y: number, height: number, extra: Partial<WireframeBlock> = {}): WireframeBlock {
    const rect = { x: 0, y, width: 800, height }
    return {
      id,
      kind: 'captured',
      rect: { ...rect },
      originalRect: { ...rect },
      z: 1,
      createdAt: 1,
      anchor: { file: '', line: 0, tag: 'div', cssClass: 'remote-widget', fingerprint: FP },
      ...extra,
    }
  }

  it('a deleted anchorless block rides the fingerprint and flags the description', () => {
    const blocks = [...planetsBlocks(), anchorless('remote', 800, 200, { deleted: true })]
    const dirs = computeWireframeDirections(canvasWith(blocks))
    const del = dirs.find((d) => d.op === 'delete')!
    expect(del.file).toBe('')
    expect(del.fingerprint).toEqual(FP)
    expect(del.description.endsWith(HINT)).toBe(true)
  })

  it('a moved anchorless block rides the fingerprint and flags the description', () => {
    const blocks = [...planetsBlocks(), anchorless('remote', 800, 200)]
    blocks[3].rect = { ...blocks[3].rect, y: 90 } // moves above the filters
    const dirs = computeWireframeDirections(canvasWith(blocks))
    const move = dirs.find((d) => d.block.label === 'remote-widget')!
    expect(move.op).toBe('move')
    expect(move.fingerprint).toEqual(FP)
    expect(move.description.endsWith(HINT)).toBe(true)
  })

  it('a note-only anchorless block rides the fingerprint too', () => {
    const blocks = [...planetsBlocks(), anchorless('remote', 800, 200, { note: 'make it blue' })]
    const dirs = computeWireframeDirections(canvasWith(blocks))
    const note = dirs.find((d) => d.op === 'note')!
    expect(note.fingerprint).toEqual(FP)
    expect(note.description.endsWith(HINT)).toBe(true)
  })

  it('an anchorless block WITHOUT a fingerprint (legacy capture) emits no field and no hint', () => {
    const blocks = [...planetsBlocks(),
      anchorless('remote', 800, 200, { deleted: true, anchor: { file: '', line: 0, tag: 'div', cssClass: 'remote-widget' } })]
    const del = computeWireframeDirections(canvasWith(blocks)).find((d) => d.op === 'delete')!
    expect('fingerprint' in del).toBe(false)
    expect(del.description).not.toContain('annotask_resolve_fingerprint')
  })

  it('regression pin: an anchored block never carries a fingerprint even when its anchor has one persisted', () => {
    // Defensive: fingerprint should never coexist with a real file, but if a
    // doc carried both, the direction must trust the file and drop the hint.
    const blocks = planetsBlocks()
    blocks[1].deleted = true
    blocks[1].anchor = { ...blocks[1].anchor!, fingerprint: FP }
    const del = computeWireframeDirections(canvasWith(blocks)).find((d) => d.op === 'delete')!
    expect(del.file).toBe('src/pages/PlanetsPage.vue')
    expect('fingerprint' in del).toBe(false)
    expect(del.description).not.toContain('annotask_resolve_fingerprint')
  })

  it('an ADD whose donors are all unanchored invents nothing — no fingerprint, no hint', () => {
    // Only anchorless captured blocks on the canvas: no honest donor exists,
    // so the add stays file '' / line 0 exactly as before this feature.
    const ph: WireframeBlock = { id: 'cta', kind: 'placeholder', rect: { x: 0, y: 290, width: 800, height: 60 }, z: 2, createdAt: 2, label: 'CTA' }
    const dirs = computeWireframeDirections(canvasWith([anchorless('remote', 0, 200), ph]))
    const add = dirs.find((d) => d.op === 'add')!
    expect(add.file).toBe('')
    expect(add.line).toBe(0)
    expect('fingerprint' in add).toBe(false)
    expect(add.description).not.toContain('annotask_resolve_fingerprint')
  })
})
