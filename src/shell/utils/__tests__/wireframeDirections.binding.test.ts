import { describe, it, expect, vi } from 'vitest'

// Data binding is gated OFF for this release, so wireframeDirections strips a
// block's persisted `data` from new directions. This file mocks the gate ON to
// lock the flip-forward behavior: the binding (with its verifiable-evidence
// fields + path_source) must thread through into `added.data` and the honest
// description summary. When WIREFRAME_DATA_BINDING_ENABLED flips true for real,
// this is the contract that must still hold.
vi.mock('../../wireframeFeatures', () => ({
  WIREFRAME_DATA_BINDING_ENABLED: true,
  WIREFRAME_EXPLODE_ENABLED: true,
}))

import { computeWireframeDirections } from '../wireframeDirections'
import type { WireframeBlock, WireframeCanvasState } from '../../../shared/wireframe-types'

function captured(id: string, y: number, height: number, line: number): WireframeBlock {
  const rect = { x: 0, y, width: 800, height }
  return {
    id, kind: 'captured', rect: { ...rect }, originalRect: { ...rect }, z: 1, createdAt: 1,
    anchor: { file: 'src/pages/PlanetsPage.vue', line, component: 'PlanetsPage', sourceTag: id, tag: 'div' },
  }
}

function canvasWith(blocks: WireframeBlock[]): WireframeCanvasState {
  return {
    capturedAt: 1,
    viewport: { width: 1280, height: 800, docWidth: 1280, docHeight: 2400, scale: 2 },
    blocks,
  }
}

describe('computeWireframeDirections — binding threading (gate mocked ON)', () => {
  it('threads a schema-picked binding + evidence into added.data and the description', () => {
    const blocks = [captured('grid', 180, 600, 128)]
    blocks.push({
      id: 'sec-1',
      kind: 'placeholder',
      rect: { x: 60, y: 790, width: 360, height: 120 },
      z: 9,
      createdAt: 2,
      label: 'related planets',
      md: '## Related planets',
      data: {
        kind: 'composable',
        name: 'usePlanets',
        module: 'src/composables/usePlanets.ts',
        path: 'planets[]',
        fields: ['name', 'type'],
        shape_source: 'api-schema',
        path_source: 'schema-picked',
        match_confidence: 1,
        schema_location: 'openapi.json',
        op: { method: 'GET', path: '/api/planets' },
        method: 'GET',
        resolved_endpoint: '/api/planets',
      },
    })
    const dirs = computeWireframeDirections(canvasWith(blocks))
    expect(dirs).toHaveLength(1)
    // The full binding — including the new evidence fields — rides verbatim.
    expect(dirs[0].added!.data).toEqual({
      kind: 'composable',
      name: 'usePlanets',
      module: 'src/composables/usePlanets.ts',
      path: 'planets[]',
      fields: ['name', 'type'],
      shape_source: 'api-schema',
      path_source: 'schema-picked',
      match_confidence: 1,
      schema_location: 'openapi.json',
      op: { method: 'GET', path: '/api/planets' },
      method: 'GET',
      resolved_endpoint: '/api/planets',
    })
    // The description names the source, the shape tier AND the path provenance.
    expect(dirs[0].description).toContain('bind to the composable usePlanets → planets[] (show name, type)')
    expect(dirs[0].description).toContain('[shape: api-schema, path: schema-picked]')
    expect(dirs[0].description).toContain('render a v-for over planets[]')
  })

  it('a user-typed path is tagged as such in the summary (agent must re-ground)', () => {
    const blocks = [captured('grid', 180, 600, 128)]
    blocks.push({
      id: 'pal-2',
      kind: 'palette',
      rect: { x: 60, y: 790, width: 320, height: 100 },
      z: 9,
      createdAt: 2,
      component: { tag: 'planetcard', componentName: 'PlanetCard', module: './components/PlanetCard.vue' },
      fidelity: 'isolated-preview',
      data: { kind: 'composable', name: 'usePlanets', path: 'data.user', shape_source: 'none', path_source: 'user-typed' },
    })
    const dirs = computeWireframeDirections(canvasWith(blocks))
    expect(dirs).toHaveLength(1)
    expect(dirs[0].added!.data).toMatchObject({ path_source: 'user-typed', shape_source: 'none' })
    expect(dirs[0].description).toContain('[shape: none, path: user-typed]')
  })
})
