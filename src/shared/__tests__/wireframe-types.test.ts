import { describe, it, expect } from 'vitest'
import {
  isWireframeDataBinding,
  isWireframeBlock,
  isWireframeDocument,
  migrateWireframeDocument,
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

describe('migrateWireframeDocument (version-bump safety — never silently wipe)', () => {
  it('passes a valid current-version doc through unchanged', () => {
    const doc = docWith([paletteBlock()])
    expect(migrateWireframeDocument(doc)).toEqual(doc)
  })

  it('stamps the current version onto a pre-versioned (early-format) doc instead of wiping it', () => {
    const legacy = { updatedAt: 1, rev: 2, routes: [{ route: '/', instances: [] }] } // no `version`
    const migrated = migrateWireframeDocument(legacy)
    expect(migrated).not.toBeNull()
    expect(migrated!.version).toBe('1.0')
    expect(migrated!.routes).toEqual([{ route: '/', instances: [] }])
  })

  it('returns null for a newer/unknown version (caller leaves the file alone, not overwrites)', () => {
    expect(migrateWireframeDocument({ version: '99.0', updatedAt: 1, routes: [] })).toBeNull()
  })

  it('returns null for genuinely malformed input (preserves same-version strictness)', () => {
    expect(migrateWireframeDocument(null)).toBeNull()
    expect(migrateWireframeDocument({ version: '1.0', updatedAt: 1, routes: 'nope' })).toBeNull()
    // One bad instance still fails — the PUT-boundary contract is unchanged.
    expect(migrateWireframeDocument({ version: '1.0', updatedAt: 1, routes: [{ route: '/', instances: [{ id: 'x' }] }] })).toBeNull()
  })
})

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

  it('accepts the verifiable-evidence fields when well-formed', () => {
    expect(isWireframeDataBinding(binding({
      path_source: 'schema-picked',
      match_confidence: 0.9,
      schema_location: 'openapi.json',
      schema_kind: 'openapi',
      op: { method: 'GET', path: '/api/planets' },
      method: 'GET',
      resolved_endpoint: '/api/planets',
      details_confidence: 'high',
    }))).toBe(true)
  })

  it('rejects malformed evidence fields', () => {
    expect(isWireframeDataBinding(binding({ path_source: 'invented' as never }))).toBe(false)
    expect(isWireframeDataBinding(binding({ details_confidence: 'certain' as never }))).toBe(false)
    expect(isWireframeDataBinding(binding({ match_confidence: 1.5 }))).toBe(false)   // >1
    expect(isWireframeDataBinding(binding({ match_confidence: -0.1 }))).toBe(false)  // <0
    expect(isWireframeDataBinding(binding({ match_confidence: 'high' as never }))).toBe(false)
    expect(isWireframeDataBinding(binding({ schema_location: '' }))).toBe(false)
    expect(isWireframeDataBinding(binding({ op: { method: 'GET' } as never }))).toBe(false) // missing path
    expect(isWireframeDataBinding(binding({ op: 'GET /x' as never }))).toBe(false)
  })
})

describe('WireframeBlock.data + .md validation', () => {
  it('accepts bindings on palette AND placeholder blocks (kind-agnostic)', () => {
    expect(isWireframeBlock(paletteBlock({ data: binding() }))).toBe(true)
    expect(isWireframeBlock(placeholderBlock({ data: binding({ shape_source: 'source-details' }) }))).toBe(true)
  })

  it('accepts a markdown body on a drawn section and rejects non-strings', () => {
    expect(isWireframeBlock(placeholderBlock({ md: '## Related planets\n- name and type' }))).toBe(true)
    expect(isWireframeBlock(placeholderBlock({ md: 42 as never }))).toBe(false)
    // md + data round-trip through the document validator together.
    expect(isWireframeDocument(docWith([placeholderBlock({ md: 'spec', data: binding() })]))).toBe(true)
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

describe('WireframeBlockAnchor.fingerprint validation', () => {
  function capturedBlock(extra: Partial<WireframeBlock> = {}): WireframeBlock {
    return {
      id: 'wfb-3',
      kind: 'captured',
      rect: { x: 0, y: 0, width: 800, height: 300 },
      originalRect: { x: 0, y: 0, width: 800, height: 300 },
      z: 1,
      createdAt: 1,
      anchor: { file: '', line: 0, tag: 'div', cssClass: 'remote-widget' },
      ...extra,
    }
  }
  const fp = { selector: 'main:nth-of-type(1) > div:nth-of-type(2)', textHead: 'Remote widget', htmlHead: '<div class="remote-widget"></div>' }

  it('accepts an anchorless captured block carrying the full three-string fingerprint', () => {
    expect(isWireframeBlock(capturedBlock({ anchor: { file: '', line: 0, fingerprint: fp } }))).toBe(true)
    // Round-trips through the document validator too (PUT boundary).
    expect(isWireframeDocument(docWith([capturedBlock({ anchor: { file: '', line: 0, fingerprint: fp } })]))).toBe(true)
  })

  it('accepts legacy anchors without a fingerprint', () => {
    expect(isWireframeBlock(capturedBlock())).toBe(true)
  })

  it('rejects a malformed fingerprint (wrong type, missing key, non-string field)', () => {
    expect(isWireframeBlock(capturedBlock({ anchor: { file: '', line: 0, fingerprint: 'div.x' as never } }))).toBe(false)
    expect(isWireframeBlock(capturedBlock({ anchor: { file: '', line: 0, fingerprint: { selector: 'div', textHead: 'x' } as never } }))).toBe(false)
    expect(isWireframeBlock(capturedBlock({ anchor: { file: '', line: 0, fingerprint: { ...fp, htmlHead: 42 } as never } }))).toBe(false)
  })

  it('accepts a grep-resolved anchor (resolvedBy + retained fingerprint) and round-trips the document', () => {
    const anchor = { file: 'src/Widget.vue', line: 12, resolvedBy: 'grep' as const, fingerprint: fp }
    expect(isWireframeBlock(capturedBlock({ anchor }))).toBe(true)
    expect(isWireframeDocument(docWith([capturedBlock({ anchor })]))).toBe(true)
  })

  it('rejects a resolvedBy value other than "grep"', () => {
    expect(isWireframeBlock(capturedBlock({ anchor: { file: 'src/Widget.vue', line: 12, resolvedBy: 'guess' as never } }))).toBe(false)
    expect(isWireframeBlock(capturedBlock({ anchor: { file: 'src/Widget.vue', line: 12, resolvedBy: 1 as never } }))).toBe(false)
  })

  it('accepts a fragment anchor (file "" + fragmentUrl) and rejects a non-string fragmentUrl', () => {
    expect(isWireframeBlock(capturedBlock({ anchor: { file: '', line: 0, fragmentUrl: 'POST /search' } }))).toBe(true)
    expect(isWireframeDocument(docWith([capturedBlock({ anchor: { file: '', line: 0, fragmentUrl: 'POST /search' } })]))).toBe(true)
    expect(isWireframeBlock(capturedBlock({ anchor: { file: '', line: 0, fragmentUrl: 42 as never } }))).toBe(false)
  })
})
