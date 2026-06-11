import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createSessionStore, RevConflictError } from '../session-store'
import type { DesignSessionDocument, SessionEntry } from '../../shared/design-session-types'

function entry(id: string, extra: Partial<SessionEntry> = {}): SessionEntry {
  return {
    id,
    ordinal: 1,
    ts: 1,
    route: '/planets',
    change: {
      id: `c-${id}`, type: 'style_update', description: 'x', file: 'a.vue',
      section: 'style', line: 9, element: 'h1', property: 'color', before: 'red', after: 'blue',
    } as SessionEntry['change'],
    anchor: { file: 'a.vue', line: 9 },
    live: { status: 'pending' },
    ...extra,
  }
}

function doc(entries: SessionEntry[], rev?: number): DesignSessionDocument {
  return { version: '1.0', sessionId: 'ds-1', startedAt: 1, updatedAt: 1, ...(rev !== undefined ? { rev } : {}), entries }
}

describe('session-store', () => {
  let root: string

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'annotask-ds-'))
  })

  afterEach(async () => {
    await fsp.rm(root, { recursive: true, force: true })
  })

  it('returns an empty document when design-session.json is missing', async () => {
    const store = createSessionStore(root)
    const empty = await store.get()
    expect(empty.entries).toEqual([])
    expect(empty.sessionId).toBeTruthy()
    // Repeated GETs of the missing file agree on the fallback session id.
    expect((await store.get()).sessionId).toBe(empty.sessionId)
  })

  it('round-trips a document through set() then get(), stamping the first rev', async () => {
    const store = createSessionStore(root)
    const saved = await store.set(doc([entry('se-1')]))
    expect(saved.rev).toBe(1)
    expect(fs.existsSync(path.join(root, '.annotask', 'design-session.json'))).toBe(true)
    expect(await createSessionStore(root).get()).toEqual(saved)
  })

  it('falls back to the empty default on malformed JSON or a bad entry', async () => {
    const dir = path.join(root, '.annotask')
    await fsp.mkdir(dir, { recursive: true })
    const file = path.join(dir, 'design-session.json')

    await fsp.writeFile(file, '{ not valid json', 'utf-8')
    expect((await createSessionStore(root).get()).entries).toEqual([])

    // Entry-depth: one malformed entry poisons the whole on-disk doc.
    await fsp.writeFile(file, JSON.stringify(doc([{ id: 'se-bad' } as never])), 'utf-8')
    expect((await createSessionStore(root).get()).entries).toEqual([])
  })

  it('rejects a stale rev with RevConflictError and leaves the file untouched', async () => {
    const store = createSessionStore(root)
    const v1 = await store.set(doc([]))
    await store.set(doc([entry('se-1')], v1.rev))
    await expect(store.set(doc([entry('se-2')], v1.rev))).rejects.toBeInstanceOf(RevConflictError)
    const current = await store.get()
    expect(current.rev).toBe(2)
    expect(current.entries.map((e) => e.id)).toEqual(['se-1'])
  })

  it('replace() bypasses CAS (server-owned discard) but still bumps the rev', async () => {
    const store = createSessionStore(root)
    const v1 = await store.set(doc([entry('se-1')]))
    const replaced = await store.replace({ version: '1.0', sessionId: 'ds-2', startedAt: 9, updatedAt: 9, entries: [] })
    expect(replaced.rev).toBe((v1.rev ?? 0) + 1)
    expect(replaced.sessionId).toBe('ds-2')
    // A CAS writer holding the old rev now loses cleanly.
    await expect(store.set(doc([entry('se-3')], v1.rev))).rejects.toBeInstanceOf(RevConflictError)
  })
})
