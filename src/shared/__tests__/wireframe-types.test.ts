import { describe, it, expect } from 'vitest'
import {
  isWireframeDataBinding,
  isWireframeBlock,
  isWireframeDocument,
  type WireframeBlock,
  type WireframeDataBinding,
  type WireframeDocument,
} from '../wireframe-types'

function binding(extra: Partial<WireframeDataBinding> = {}): WireframeDataBinding {
  return {
    kind: 'composable',
    name: 'usePlanets',
    module: 'src/composables/usePlanets.ts',
    path: 'planets[]',
    fields: ['name', 'type'],
    shape_source: 'api-schema',
    ...extra,
  }
}

function paletteBlock(extra: Partial<WireframeBlock> = {}): WireframeBlock {
  return {
    id: 'wfb-1',
    kind: 'palette',
    rect: { x: 0, y: 0, width: 100, height: 40 },
    z: 1,
    createdAt: 1,
    component: { tag: 'planetcard', componentName: 'PlanetCard' },
    ...extra,
  }
}

function placeholderBlock(extra: Partial<WireframeBlock> = {}): WireframeBlock {
  return {
    id: 'wfb-2',
    kind: 'placeholder',
    rect: { x: 0, y: 60, width: 200, height: 80 },
    z: 2,
    createdAt: 1,
    label: 'related planets',
    ...extra,
  }
}

function docWith(blocks: WireframeBlock[]): WireframeDocument {
  return {
    version: '1.0',
    updatedAt: 0,
    rev: 1,
    routes: [{
      route: '/planets',
      instances: [],
      canvas: {
        capturedAt: 1,
        viewport: { width: 1280, height: 800, docWidth: 1280, docHeight: 2000, scale: 1 },
        blocks,
      },
    }],
  }
}

describe('isWireframeDataBinding', () => {
  it('accepts the full contract and a minimal one', () => {
    expect(isWireframeDataBinding(binding())).toBe(true)
    expect(isWireframeDataBinding({ kind: 'fetch', name: 'loadCats', shape_source: 'none' })).toBe(true)
  })

  it('rejects malformed bindings', () => {
    expect(isWireframeDataBinding(null)).toBe(false)
    expect(isWireframeDataBinding('usePlanets')).toBe(false)
    expect(isWireframeDataBinding([])).toBe(false)
    expect(isWireframeDataBinding(binding({ kind: 'webhook' as never }))).toBe(false)
    expect(isWireframeDataBinding(binding({ name: '' }))).toBe(false)
    expect(isWireframeDataBinding(binding({ shape_source: 'guessed' as never }))).toBe(false)
    expect(isWireframeDataBinding({ kind: 'fetch', name: 'x' })).toBe(false) // missing shape_source
    expect(isWireframeDataBinding(binding({ module: '' }))).toBe(false)
    expect(isWireframeDataBinding(binding({ path: 42 as never }))).toBe(false)
    expect(isWireframeDataBinding(binding({ fields: 'name,type' as never }))).toBe(false)
    expect(isWireframeDataBinding(binding({ fields: ['name', 7] as never }))).toBe(false)
    expect(isWireframeDataBinding(binding({ fields: [''] }))).toBe(false)
  })
})

describe('WireframeBlock.data validation', () => {
  it('accepts bindings on palette AND placeholder blocks (kind-agnostic)', () => {
    expect(isWireframeBlock(paletteBlock({ data: binding() }))).toBe(true)
    expect(isWireframeBlock(placeholderBlock({ data: binding({ shape_source: 'source-details' }) }))).toBe(true)
  })

  it('accepts legacy blocks without data', () => {
    expect(isWireframeBlock(paletteBlock())).toBe(true)
    expect(isWireframeBlock(placeholderBlock())).toBe(true)
  })

  it('rejects malformed data at block depth', () => {
    expect(isWireframeBlock(paletteBlock({ data: { name: 'usePlanets' } as never }))).toBe(false)
    expect(isWireframeBlock(placeholderBlock({ data: binding({ kind: 'nope' as never }) }))).toBe(false)
  })

  it('one bad binding rejects the whole document (PUT boundary)', () => {
    expect(isWireframeDocument(docWith([paletteBlock({ data: binding() })]))).toBe(true)
    expect(isWireframeDocument(docWith([
      paletteBlock({ data: binding() }),
      placeholderBlock({ data: { kind: 'composable' } as never }),
    ]))).toBe(false)
  })
})
