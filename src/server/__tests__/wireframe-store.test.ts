import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createWireframeStore, WireframeRevConflictError } from '../wireframe-store'
import { emptyWireframeDocument, isWireframeDocument, type WireframeDocument, type WireframeInstance } from '../../shared/wireframe-types'

function instance(id: string, extra: Partial<WireframeInstance> = {}): WireframeInstance {
  return {
    id,
    kind: 'component',
    anchor: { file: 'PlanetsPage.vue', line: 9, position: 'append' },
    inserted: { tag: 'planetcard', componentName: 'PlanetCard' },
    fidelity: 'live',
    mounted: true,
    createdAt: 1,
    ...extra,
  }
}

describe('wireframe-store', () => {
  let root: string

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'annotask-wf-'))
  })

  afterEach(async () => {
    await fsp.rm(root, { recursive: true, force: true })
  })

  it('returns an empty document when wireframe.json is missing', async () => {
    const store = createWireframeStore(root)
    expect(await store.get()).toEqual(emptyWireframeDocument())
  })

  it('round-trips a document through set() then get(), stamping the first rev', async () => {
    const store = createWireframeStore(root)
    const doc: WireframeDocument = {
      version: '1.0',
      updatedAt: 42,
      routes: [
        { route: '/planets', instances: [instance('wfi-1')] },
      ],
    }
    const saved = await store.set(doc)
    expect(saved).toEqual({ ...doc, rev: 1 })
    // Persisted to disk and readable by a fresh store instance.
    expect(fs.existsSync(path.join(root, '.annotask', 'wireframe.json'))).toBe(true)
    expect(await createWireframeStore(root).get()).toEqual({ ...doc, rev: 1 })
  })

  it('falls back to the empty default on malformed JSON or a bad shape', async () => {
    const dir = path.join(root, '.annotask')
    await fsp.mkdir(dir, { recursive: true })
    const file = path.join(dir, 'wireframe.json')

    await fsp.writeFile(file, '{ not valid json', 'utf-8')
    expect(await createWireframeStore(root).get()).toEqual(emptyWireframeDocument())

    await fsp.writeFile(file, JSON.stringify({ version: '0.9', routes: 'nope' }), 'utf-8')
    expect(await createWireframeStore(root).get()).toEqual(emptyWireframeDocument())

    // Instance-depth: one malformed instance poisons the whole on-disk doc.
    await fsp.writeFile(file, JSON.stringify({
      version: '1.0', updatedAt: 1,
      routes: [{ route: '/', instances: [{ id: 'wfi-x' /* no kind/anchor/inserted */ }] }],
    }), 'utf-8')
    expect(await createWireframeStore(root).get()).toEqual(emptyWireframeDocument())
  })

  describe('rev compare-and-set', () => {
    it('increments rev on every successful set that round-trips the current rev', async () => {
      const store = createWireframeStore(root)
      const v1 = await store.set({ version: '1.0', updatedAt: 1, routes: [] })
      expect(v1.rev).toBe(1)
      const v2 = await store.set({ version: '1.0', updatedAt: 2, rev: v1.rev, routes: [] })
      expect(v2.rev).toBe(2)
      const v3 = await store.set({ version: '1.0', updatedAt: 3, rev: v2.rev, routes: [] })
      expect(v3.rev).toBe(3)
      expect((await store.get()).rev).toBe(3)
    })

    it('rejects a stale rev with WireframeRevConflictError', async () => {
      const store = createWireframeStore(root)
      const v1 = await store.set({ version: '1.0', updatedAt: 1, routes: [] })
      await store.set({ version: '1.0', updatedAt: 2, rev: v1.rev, routes: [] })
      await expect(store.set({ version: '1.0', updatedAt: 3, rev: v1.rev, routes: [] }))
        .rejects.toBeInstanceOf(WireframeRevConflictError)
      // The losing write must not have touched the file.
      expect((await store.get()).rev).toBe(2)
    })

    it('rejects a missing rev once the doc has one', async () => {
      const store = createWireframeStore(root)
      await store.set({ version: '1.0', updatedAt: 1, routes: [] })
      await expect(store.set({ version: '1.0', updatedAt: 2, routes: [] }))
        .rejects.toBeInstanceOf(WireframeRevConflictError)
    })

    it('accepts one rev-less write against a legacy doc and stamps it', async () => {
      // Simulate a doc written before the rev field existed.
      const dir = path.join(root, '.annotask')
      await fsp.mkdir(dir, { recursive: true })
      await fsp.writeFile(path.join(dir, 'wireframe.json'), JSON.stringify({
        version: '1.0', updatedAt: 1, routes: [{ route: '/', instances: [instance('wfi-legacy')] }],
      }), 'utf-8')
      const store = createWireframeStore(root)
      const saved = await store.set({ version: '1.0', updatedAt: 2, routes: [] })
      expect(saved.rev).toBe(1)
      // From now on the CAS is enforced.
      await expect(store.set({ version: '1.0', updatedAt: 3, routes: [] }))
        .rejects.toBeInstanceOf(WireframeRevConflictError)
    })
  })
})

describe('isWireframeDocument instance-depth validation', () => {
  function docWith(instances: unknown[]): unknown {
    return { version: '1.0', updatedAt: 1, routes: [{ route: '/', instances }] }
  }

  it('accepts a well-formed document including the lifecycle fields', () => {
    expect(isWireframeDocument(docWith([
      instance('wfi-1', { status: 'building', taskId: 'task-1', previewProps: { label: 'Hi' } }),
      instance('wfi-2'), // legacy: no status/taskId/previewProps
    ]))).toBe(true)
    expect(isWireframeDocument({ ...docWith([]) as Record<string, unknown>, rev: 4 })).toBe(true)
  })

  it('rejects an instance missing id / kind / anchor / inserted', () => {
    expect(isWireframeDocument(docWith([{ ...instance('wfi-1'), id: undefined }]))).toBe(false)
    expect(isWireframeDocument(docWith([{ ...instance('wfi-1'), kind: 'bogus' }]))).toBe(false)
    expect(isWireframeDocument(docWith([{ ...instance('wfi-1'), anchor: null }]))).toBe(false)
    expect(isWireframeDocument(docWith([{ ...instance('wfi-1'), inserted: 'planetcard' }]))).toBe(false)
  })

  it('rejects malformed anchor fields', () => {
    expect(isWireframeDocument(docWith([instance('wfi-1', { anchor: { file: 7, line: 9, position: 'append' } as never })]))).toBe(false)
    expect(isWireframeDocument(docWith([instance('wfi-1', { anchor: { file: 'a.vue', line: '9', position: 'append' } as never })]))).toBe(false)
    expect(isWireframeDocument(docWith([instance('wfi-1', { anchor: { file: 'a.vue', line: 9, position: 'inside' } as never })]))).toBe(false)
  })

  it('rejects an inserted object without a string tag', () => {
    expect(isWireframeDocument(docWith([instance('wfi-1', { inserted: { componentName: 'PlanetCard' } as never })]))).toBe(false)
  })

  it('rejects malformed optional lifecycle fields', () => {
    expect(isWireframeDocument(docWith([instance('wfi-1', { status: 'done' as never })]))).toBe(false)
    expect(isWireframeDocument(docWith([instance('wfi-1', { taskId: 42 as never })]))).toBe(false)
    expect(isWireframeDocument(docWith([instance('wfi-1', { previewProps: ['nope'] as never })]))).toBe(false)
  })

  it('rejects a non-numeric rev', () => {
    expect(isWireframeDocument({ version: '1.0', updatedAt: 1, rev: '3', routes: [] })).toBe(false)
  })

  it('one bad instance rejects the whole document (PUT boundary)', () => {
    expect(isWireframeDocument(docWith([instance('wfi-good'), { id: 'wfi-bad' }]))).toBe(false)
  })
})
