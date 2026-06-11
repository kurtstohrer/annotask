import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { applyDesignSession, verifyAppliedEntries, revertApplyBatch, releaseApplyTask, acceptApplyTask, type ApplySessionOptions } from '../apply-session'
import { createSessionStore } from '../session-store'
import { createWireframeStore } from '../wireframe-store'
import { createSnapshotStore } from '../file-snapshots'
import { clearBindingClassifyCache } from '../binding-classify'
import type { DesignSessionDocument, SessionEntry } from '../../shared/design-session-types'
import type { WireframeInstance } from '../../shared/wireframe-types'

const PAGE = `<template>
  <div class="page">
    <h1 class="title">Planets</h1>
    <Button label="Reset" />
  </div>
</template>
`

function textEntry(id: string, after = 'Worlds'): SessionEntry {
  return {
    id, ordinal: 1, ts: 1, route: '/planets',
    change: {
      id: `c-${id}`, type: 'text_update', description: `Change text to “${after}”`,
      file: 'src/Page.vue', section: 'template', line: 3, element: 'h1', before: 'Planets', after,
    } as SessionEntry['change'],
    anchor: { file: 'src/Page.vue', line: 3, targetTag: 'h1' },
    live: { status: 'pending' },
  }
}

function propEntry(id: string): SessionEntry {
  return {
    id, ordinal: 2, ts: 2, route: '/planets',
    change: {
      id: `c-${id}`, type: 'component_prop_update', description: 'Set Button label to "Clear"',
      file: 'src/Page.vue', section: 'template', line: 4, element: 'Button',
      prop: 'label', before: 'Reset', after: 'Clear', binding: 'literal',
    } as SessionEntry['change'],
    anchor: { file: 'src/Page.vue', line: 4, targetTag: 'Button' },
    live: { status: 'pending' },
  }
}

function instance(id: string): WireframeInstance {
  return {
    id, kind: 'component',
    anchor: { file: 'src/Page.vue', line: 2, position: 'append', targetTag: 'div' },
    inserted: { tag: 'planetcard', componentName: 'PlanetCard' },
    fidelity: 'live', mounted: true, status: 'placed', createdAt: 1,
  }
}

describe('apply-session', () => {
  let root: string
  let options: ApplySessionOptions
  let tasks: Array<Record<string, unknown>>

  async function seedSession(entries: SessionEntry[]): Promise<void> {
    const store = createSessionStore(root)
    const current = await store.get()
    const doc: DesignSessionDocument = { version: '1.0', sessionId: 'ds-test', startedAt: 1, updatedAt: 1, rev: current.rev, entries }
    await store.set(doc)
  }

  beforeEach(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'annotask-apply-'))
    clearBindingClassifyCache()
    await fsp.mkdir(path.join(root, 'src'), { recursive: true })
    await fsp.writeFile(path.join(root, 'src/Page.vue'), PAGE, 'utf-8')
    tasks = []
    const sessionStore = createSessionStore(root)
    const wireframeStore = createWireframeStore(root)
    options = {
      projectRoot: root,
      getDesignSession: () => sessionStore.get(),
      setDesignSession: (doc) => sessionStore.set(doc),
      getWireframe: () => wireframeStore.get(),
      setWireframe: (doc) => wireframeStore.set(doc),
      addTask: (task) => {
        const t = { ...task, id: `task-${tasks.length + 1}` }
        tasks.push(t)
        return t
      },
      snapshots: createSnapshotStore(root),
    }
  })

  afterEach(async () => {
    await fsp.rm(root, { recursive: true, force: true })
  })

  it('apply: snapshots the touched files, creates ONE task with both context halves, stamps statuses', async () => {
    await seedSession([textEntry('se-1'), propEntry('se-2')])
    const wf = await options.getWireframe()
    await options.setWireframe({ ...wf, updatedAt: 1, routes: [{ route: '/planets', instances: [instance('wfi-1')] }] })

    const result = await applyDesignSession(options, '/planets')
    expect('error' in result).toBe(false)
    if ('error' in result) return

    // ONE task, both context halves, envelope cruft stripped.
    expect(tasks).toHaveLength(1)
    const ctx = tasks[0].context as { wireframe: { instances: unknown[] }; session: { session_id: string; entries: Array<Record<string, unknown>> } }
    expect(ctx.wireframe.instances).toHaveLength(1)
    expect(ctx.session.session_id).toBe('ds-test')
    expect(ctx.session.entries.map((e) => e.id)).toEqual(['se-1', 'se-2'])
    expect(ctx.session.entries[0].eid).toBeUndefined()

    // Snapshot journal exists BEFORE any agent could run.
    const snap = await options.snapshots.state()
    expect(Object.keys(snap.files)).toEqual(['src/Page.vue'])
    expect(snap.batches.map((b) => b.id)).toEqual([result.batchId])

    // Instances 'building', entries 'applying'.
    const wfAfter = await options.getWireframe()
    expect(wfAfter.routes[0].instances[0]).toMatchObject({ status: 'building', taskId: result.taskId })
    const session = await options.getDesignSession()
    for (const e of session.entries) {
      expect(e.live).toMatchObject({ status: 'applying', applyBatchId: result.batchId })
      expect(e.taskId).toBe(result.taskId)
    }
  })

  it('apply: nothing pending → error, no task', async () => {
    const result = await applyDesignSession(options, '/planets')
    expect(result).toEqual({ error: 'nothing to apply' })
    expect(tasks).toHaveLength(0)
  })

  it('verify: a landed edit flips written (exact-anchor proof); a missing one flips failed; the batch seals', async () => {
    await seedSession([textEntry('se-1'), propEntry('se-2')])
    const result = await applyDesignSession(options, '/planets')
    if ('error' in result) throw new Error('apply failed')

    // "The agent" applies ONLY the text edit.
    await fsp.writeFile(path.join(root, 'src/Page.vue'), PAGE.replace('Planets', 'Worlds'), 'utf-8')
    clearBindingClassifyCache()

    await verifyAppliedEntries(options, result.taskId)

    const session = await options.getDesignSession()
    const byId = Object.fromEntries(session.entries.map((e) => [e.id, e]))
    expect(byId['se-1'].live.status).toBe('written')
    expect(byId['se-2'].live.status).toBe('failed')
    expect(byId['se-2'].live.error).toMatch(/not found in source/)

    const snap = await options.snapshots.state()
    expect(snap.batches[0].status).toBe('done')
  })

  it('undo-batch: restores pre-apply bytes and returns the batch entries to pending', async () => {
    await seedSession([textEntry('se-1')])
    const result = await applyDesignSession(options, '/planets')
    if ('error' in result) throw new Error('apply failed')

    await fsp.writeFile(path.join(root, 'src/Page.vue'), PAGE.replace('Planets', 'Worlds'), 'utf-8')
    clearBindingClassifyCache()
    await verifyAppliedEntries(options, result.taskId)

    const undo = await revertApplyBatch(options, result.batchId)
    expect(undo.reverted).toEqual(['src/Page.vue'])
    expect(await fsp.readFile(path.join(root, 'src/Page.vue'), 'utf-8')).toBe(PAGE)

    const session = await options.getDesignSession()
    expect(session.entries[0].live.status).toBe('pending')
    expect(session.entries[0].taskId).toBeUndefined()
  })

  it('accept: keeps the agent bytes, drops the snapshot journal, clears the task entries, signals rotation', async () => {
    await seedSession([textEntry('se-1')])
    const result = await applyDesignSession(options, '/planets')
    if ('error' in result) throw new Error('apply failed')

    const agentBytes = PAGE.replace('Planets', 'Worlds')
    await fsp.writeFile(path.join(root, 'src/Page.vue'), agentBytes, 'utf-8')
    clearBindingClassifyCache()
    await verifyAppliedEntries(options, result.taskId)

    const { rotated } = await acceptApplyTask(options, result.taskId)
    expect(rotated).toBe(true)
    // Bytes kept (the new baseline), journal gone.
    expect(await fsp.readFile(path.join(root, 'src/Page.vue'), 'utf-8')).toBe(agentBytes)
    expect((await options.snapshots.state()).files).toEqual({})
    expect((await options.getDesignSession()).entries).toEqual([])
  })

  it('release (task deleted mid-run): applying entries return to pending; the batch stays revertible', async () => {
    await seedSession([textEntry('se-1')])
    const result = await applyDesignSession(options, '/planets')
    if ('error' in result) throw new Error('apply failed')

    // Agent half-wrote, then the task was deleted.
    await fsp.writeFile(path.join(root, 'src/Page.vue'), PAGE.replace('Planets', 'Half'), 'utf-8')
    await releaseApplyTask(options, result.taskId)

    const session = await options.getDesignSession()
    expect(session.entries[0].live.status).toBe('pending')
    expect(session.entries[0].taskId).toBeUndefined()

    const snap = await options.snapshots.state()
    expect(snap.batches).toHaveLength(1)
  })
})
