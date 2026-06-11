import { describe, it, expect, beforeEach } from 'vitest'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { schemaToShape, resolveDataSourceShape } from '../data-source-shape.js'
import { clearDataSourceCache } from '../data-source-scanner.js'
import { clearApiSchemaCache } from '../api-schema-scanner.js'
import { resolveEndpoint } from '../api-schema-resolver.js'
import type { ApiSchemaCatalog, DataSourceShape } from '../../schema.js'

describe('schemaToShape — pure walker', () => {
  it('walks nested objects and array-of-object', () => {
    expect(schemaToShape({
      type: 'object',
      properties: {
        items: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, price: { type: 'number' } } } },
        total: { type: 'integer' },
      },
    })).toEqual({
      kind: 'object',
      children: {
        items: { kind: 'array', item: { kind: 'object', children: { name: { kind: 'scalar', scalar: 'string' }, price: { kind: 'scalar', scalar: 'number' } } } },
        total: { kind: 'scalar', scalar: 'integer' },
      },
    })
  })

  it('degrades residual $ref cycle markers to named ref leaves', () => {
    expect(schemaToShape({ type: 'object', properties: { parent: { $ref: '#/components/schemas/Cat' } } }))
      .toEqual({ kind: 'object', children: { parent: { kind: 'ref', ref: 'Cat' } } })
  })

  it('degrades GraphQL $type markers to named ref leaves', () => {
    expect(schemaToShape({ $type: 'Planet[]' })).toEqual({ kind: 'ref', ref: 'Planet[]' })
  })

  it('merges allOf object members', () => {
    expect(schemaToShape({
      allOf: [
        { type: 'object', properties: { id: { type: 'string' } } },
        { type: 'object', properties: { name: { type: 'string' } } },
      ],
    })).toEqual({ kind: 'object', children: { id: { kind: 'scalar', scalar: 'string' }, name: { kind: 'scalar', scalar: 'string' } } })
  })

  it('takes the first object-ish oneOf/anyOf variant', () => {
    expect(schemaToShape({
      oneOf: [{ type: 'string' }, { type: 'object', properties: { ok: { type: 'boolean' } } }],
    })).toEqual({ kind: 'object', children: { ok: { kind: 'scalar', scalar: 'boolean' } } })
    expect(schemaToShape({ anyOf: [{ type: 'number' }] })).toEqual({ kind: 'unknown' })
  })

  it('caps recursion depth instead of walking forever', () => {
    // Self-nesting deeper than the cap — the tail degrades to unknown.
    let node: Record<string, unknown> = { type: 'string' }
    for (let i = 0; i < 12; i++) node = { type: 'object', properties: { child: node } }
    let walked = schemaToShape(node)
    let depth = 0
    while (walked.kind === 'object' && walked.children?.child) { walked = walked.children.child; depth++ }
    expect(walked.kind).toBe('unknown')
    expect(depth).toBeGreaterThan(4)
  })

  it('returns unknown for unwalkable input', () => {
    expect(schemaToShape({})).toEqual({ kind: 'unknown' })
    expect(schemaToShape({ type: 7 as never })).toEqual({ kind: 'unknown' })
  })
})

describe('resolveEndpoint — method-mismatch deranking (sanity)', () => {
  it('a method mismatch still matches the path but with reduced confidence', () => {
    const catalog: ApiSchemaCatalog = {
      schemas: [{
        kind: 'openapi', source: 'file', location: 'openapi.json', in_repo: true,
        operation_count: 1,
        operations: [{ method: 'GET', path: '/api/cats', response_schema: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' } } } }, schema_refs: ['Cat'] }],
      }],
      scannedAt: 0,
    }
    const exact = resolveEndpoint(catalog, '/api/cats', 'GET')
    const mismatched = resolveEndpoint(catalog, '/api/cats', 'POST')
    expect(exact?.confidence).toBe(1)
    expect(mismatched).not.toBeNull()
    expect(mismatched!.confidence).toBeLessThan(1)
  })
})

const OPENAPI_FIXTURE = {
  openapi: '3.0.0',
  info: { title: 'Cats API', version: '1.0.0' },
  paths: {
    '/api/cats': {
      get: {
        operationId: 'listCats',
        responses: {
          '200': {
            content: {
              'application/json': {
                schema: { type: 'array', items: { $ref: '#/components/schemas/Cat' } },
              },
            },
          },
        },
      },
    },
  },
  components: {
    schemas: {
      Cat: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          price: { type: 'number' },
          owner: { $ref: '#/components/schemas/Owner' },
          // Self-reference — resolveRefs leaves a cycle marker the walker
          // must degrade to a ref leaf, never expand.
          parent: { $ref: '#/components/schemas/Cat' },
        },
      },
      Owner: { type: 'object', properties: { email: { type: 'string' } } },
    },
  },
}

async function scaffold(files: Record<string, string>): Promise<string> {
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'annotask-shape-'))
  await fsp.writeFile(path.join(tmp, 'package.json'), JSON.stringify({
    name: 'root',
    dependencies: { 'vue-router': '4.0.0' },
  }))
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(tmp, rel)
    await fsp.mkdir(path.dirname(abs), { recursive: true })
    await fsp.writeFile(abs, content)
  }
  return tmp
}

describe('resolveDataSourceShape — honesty ladder', () => {
  beforeEach(() => {
    clearDataSourceCache()
    clearApiSchemaCache()
  })

  it("rung 1: 'api-schema' — endpoint matches an OpenAPI operation; shape is walkable with cycle-safe refs", async () => {
    const tmp = await scaffold({
      'openapi.json': JSON.stringify(OPENAPI_FIXTURE),
      'src/composables/useCats.ts': `
        export function useCats() {
          return fetch('/api/cats').then(r => r.json())
        }
      `,
    })
    try {
      const result = await resolveDataSourceShape({
        projectRoot: tmp, name: 'useCats',
        schemaScan: { apiSchemaFiles: ['openapi.json'] }, // explicit files ⇒ no dev-server probes (offline)
      })
      expect('error' in result).toBe(false)
      const shape = result as DataSourceShape
      expect(shape.shape_source).toBe('api-schema')
      expect(shape.schema_ref).toBe('Cat[]')
      expect(shape.match_confidence).toBe(1)
      expect(shape.schema_kind).toBe('openapi')
      expect(shape.shape).toEqual({
        kind: 'array',
        item: {
          kind: 'object',
          children: {
            name: { kind: 'scalar', scalar: 'string' },
            price: { kind: 'scalar', scalar: 'number' },
            owner: { kind: 'object', children: { email: { kind: 'scalar', scalar: 'string' } } },
            parent: { kind: 'ref', ref: 'Cat' }, // cycle marker stays a leaf
          },
        },
      })
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true })
    }
  })

  it("rung 2: 'source-details' — no schema match; verbatim return-type hints, NO fabricated tree", async () => {
    const tmp = await scaffold({
      'src/composables/useDogs.ts': `
        export interface DogsResult { dogs: string[] }
        export function useDogs(): DogsResult {
          return { dogs: [] }
        }
      `,
    })
    try {
      const result = await resolveDataSourceShape({
        projectRoot: tmp, name: 'useDogs',
        schemaScan: { apiSchemaFiles: ['missing.json'] },
      })
      expect('error' in result).toBe(false)
      const shape = result as DataSourceShape
      expect(shape.shape_source).toBe('source-details')
      expect(shape.return_type).toBe('DogsResult')
      expect(shape.details_confidence).toBeDefined()
      expect(shape.shape).toBeUndefined() // never expanded from a type name
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true })
    }
  })

  it("rung 3: 'none' — un-annotated source with no schema match is visibly blind", async () => {
    const tmp = await scaffold({
      'src/composables/useStuff.ts': `
        export function useStuff() {
          return fetch('/internal/stuff').then(r => r.json())
        }
      `,
    })
    try {
      const result = await resolveDataSourceShape({
        projectRoot: tmp, name: 'useStuff',
        schemaScan: { apiSchemaFiles: ['missing.json'] },
      })
      expect('error' in result).toBe(false)
      const shape = result as DataSourceShape
      expect(shape.shape_source).toBe('none')
      expect(shape.shape).toBeUndefined()
      expect(shape.return_type).toBeUndefined()
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true })
    }
  })

  it('ambiguous names list candidates; re-calling with file resolves', async () => {
    const sourceA = `
      export function useCats() { return fetch('/api/cats').then(r => r.json()) }
    `
    const tmp = await scaffold({
      'openapi.json': JSON.stringify(OPENAPI_FIXTURE),
      'src/composables/useCats.ts': sourceA,
      'src/legacy/useCats.ts': sourceA,
    })
    try {
      const ambiguous = await resolveDataSourceShape({
        projectRoot: tmp, name: 'useCats',
        schemaScan: { apiSchemaFiles: ['openapi.json'] },
      })
      expect(ambiguous).toMatchObject({ error: 'ambiguous' })
      const candidates = (ambiguous as { candidates: Array<{ file: string }> }).candidates
      expect(candidates.length).toBe(2)

      clearApiSchemaCache()
      const resolved = await resolveDataSourceShape({
        projectRoot: tmp, name: 'useCats', file: candidates[0].file,
        schemaScan: { apiSchemaFiles: ['openapi.json'] },
      })
      expect('error' in resolved).toBe(false)
      expect((resolved as DataSourceShape).shape_source).toBe('api-schema')
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true })
    }
  })

  it('unknown names return not_found', async () => {
    const tmp = await scaffold({
      'src/composables/useCats.ts': `export function useCats() { return fetch('/api/cats') }`,
    })
    try {
      const result = await resolveDataSourceShape({
        projectRoot: tmp, name: 'useNothing',
        schemaScan: { apiSchemaFiles: ['missing.json'] },
      })
      expect(result).toEqual({ error: 'not_found', name: 'useNothing' })
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true })
    }
  })
})
