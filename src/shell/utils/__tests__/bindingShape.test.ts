import { describe, it, expect } from 'vitest'
import { flattenShape, fieldCandidates, buildBinding } from '../bindingShape'
import type { DataShapeNode } from '../../../schema'

// Cat[] with a nested owner object and a cycle-ref leaf — mirrors the server
// fixture in data-source-shape.test.ts.
const CATS: DataShapeNode = {
  kind: 'array',
  item: {
    kind: 'object',
    children: {
      name: { kind: 'scalar', scalar: 'string' },
      price: { kind: 'scalar', scalar: 'number' },
      owner: { kind: 'object', children: { email: { kind: 'scalar', scalar: 'string' } } },
      parent: { kind: 'ref', ref: 'Cat' },
    },
  },
}

describe('flattenShape', () => {
  it('collapsed root shows one row, expandable + selectable, array path "[]"', () => {
    const rows = flattenShape(CATS, new Set())
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ path: '[]', key: '(response)', depth: 0, selectable: true, expandable: true })
  })

  it('expanding an array surfaces its item-object keys under the array path', () => {
    const rows = flattenShape(CATS, new Set(['[]']))
    expect(rows.map(r => r.path)).toEqual(['[]', '[].name', '[].price', '[].owner', '[].parent'])
    const owner = rows.find(r => r.key === 'owner')!
    expect(owner).toMatchObject({ depth: 1, selectable: true, expandable: true })
    const name = rows.find(r => r.key === 'name')!
    expect(name).toMatchObject({ selectable: false, expandable: false })
  })

  it('nested expansion produces dotted paths', () => {
    const rows = flattenShape(CATS, new Set(['[]', '[].owner']))
    expect(rows.map(r => r.path)).toContain('[].owner.email')
  })

  it('an object root yields plain keys; nested arrays append []', () => {
    const root: DataShapeNode = {
      kind: 'object',
      children: {
        data: { kind: 'object', children: { user: { kind: 'object', children: {} } } },
        items: { kind: 'array', item: { kind: 'scalar', scalar: 'string' } },
      },
    }
    const rows = flattenShape(root, new Set(['', 'data', 'items[]']))
    const paths = rows.map(r => r.path)
    expect(paths).toContain('data.user')
    expect(paths).toContain('items[]')
    // Scalar array item renders a synthetic row under the array path.
    expect(rows.find(r => r.key === '(item)')?.path).toBe('items[].(item)')
  })

  it('ref leaves do not expand', () => {
    const rows = flattenShape(CATS, new Set(['[]', 'parent']))
    expect(rows.filter(r => r.path.startsWith('parent.')).length).toBe(0)
  })
})

describe('fieldCandidates', () => {
  it('arrays offer their item-object scalar/ref keys', () => {
    expect(fieldCandidates(CATS)).toEqual(['name', 'price', 'parent'])
  })

  it('objects offer their own scalar/ref keys', () => {
    expect(fieldCandidates(CATS.item!)).toEqual(['name', 'price', 'parent'])
    expect(fieldCandidates({ kind: 'object', children: { email: { kind: 'scalar', scalar: 'string' } } })).toEqual(['email'])
  })

  it('non-objects offer nothing', () => {
    expect(fieldCandidates({ kind: 'scalar', scalar: 'string' })).toEqual([])
    expect(fieldCandidates({ kind: 'ref', ref: 'Cat' })).toEqual([])
    expect(fieldCandidates({ kind: 'array', item: { kind: 'scalar', scalar: 'string' } })).toEqual([])
  })
})

describe('buildBinding', () => {
  const entry = { kind: 'composable' as const, name: 'usePlanets', file: 'src/composables/usePlanets.ts', endpoint: '/api/solar/planets' }

  it('assembles a valid plain-JSON binding (module = catalog file)', () => {
    const b = buildBinding(entry, { path: 'planets[]', fields: ['name', 'type'], shape_source: 'api-schema' })
    expect(b).toEqual({
      kind: 'composable',
      name: 'usePlanets',
      module: 'src/composables/usePlanets.ts',
      endpoint: '/api/solar/planets',
      path: 'planets[]',
      fields: ['name', 'type'],
      shape_source: 'api-schema',
    })
  })

  it('trims and drops empty path/fields', () => {
    const b = buildBinding(entry, { path: '  ', fields: [' name ', ''], shape_source: 'none' })
    expect(b.path).toBeUndefined()
    expect(b.fields).toEqual(['name'])
  })

  it('omits module/endpoint when the entry lacks them', () => {
    const b = buildBinding({ kind: 'fetch', name: 'apiHealth', file: '', endpoint: undefined }, { shape_source: 'none' })
    expect(b).toEqual({ kind: 'fetch', name: 'apiHealth', shape_source: 'none' })
  })

  it('throws on an unbuildable binding instead of persisting garbage', () => {
    expect(() => buildBinding({ kind: 'composable', name: '', file: 'x.ts', endpoint: undefined }, { shape_source: 'none' })).toThrow()
  })
})
