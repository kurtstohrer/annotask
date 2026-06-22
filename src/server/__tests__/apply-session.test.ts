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

function directionEntry(id: string, route = '/planets', ordinal = 1): SessionEntry {
  return {
    id, ordinal, ts: ordinal, route,
    change: {
      id: `c-${id}`, type: 'wireframe_direction', op: 'move',
      description: 'MOVE the grid (src/Page.vue:2): now above the filters (was below)',
      file: 'src/Page.vue', section: 'template', line: 2,
      block: { label: 'grid', tag: 'div' },
      measured: {
        before: { x: 0, y: 180, width: 800, height: 600 },
        after: { x: 0, y: 90, width: 800, height: 600 },
        dx: 0, dy: -90, relations: ['now above the filters (was below)'],
      },
    } as SessionEntry['change'],
    anchor: { file: 'src/Page.vue', line: 2, targetTag: 'div' },
    live: { status: 'pending' },
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

  it('release (task deleted mid-run): applying entries return to pending; the batch seals failed and stays revertible', async () => {
    await seedSession([textEntry('se-1')])
    const result = await applyDesignSession(options, '/planets')
    if ('error' in result) throw new Error('apply failed')

    // Agent half-wrote, then the task was deleted.
    await fsp.writeFile(path.join(root, 'src/Page.vue'), PAGE.replace('Planets', 'Half'), 'utf-8')
    await releaseApplyTask(options, result.taskId)

    const session = await options.getDesignSession()
    expect(session.entries[0].live.status).toBe('pending')
    expect(session.entries[0].taskId).toBeUndefined()

    // The batch is sealed 'failed' (not left 'running'), so the undo guard lets
    // it through — undo restores the clean pre-apply bytes despite the half-write.
    const snap = await options.snapshots.state()
    expect(snap.batches).toHaveLength(1)
    expect(snap.batches[0].status).toBe('failed')
    const undo = await revertApplyBatch(options, result.batchId)
    expect(undo.reverted).toEqual(['src/Page.vue'])
    expect(await fsp.readFile(path.join(root, 'src/Page.vue'), 'utf-8')).toBe(PAGE)
  })

  it('re-apply after deny re-seals the batch so undo stays byte-exact', async () => {
    await seedSession([textEntry('se-1')])
    const result = await applyDesignSession(options, '/planets')
    if ('error' in result) throw new Error('apply failed')

    // First agent run + review: the edit lands, the entry flips written.
    await fsp.writeFile(path.join(root, 'src/Page.vue'), PAGE.replace('Planets', 'Worlds'), 'utf-8')
    clearBindingClassifyCache()
    await verifyAppliedEntries(options, result.taskId)
    expect((await options.getDesignSession()).entries[0].live.status).toBe('written')

    // User DENIES; the agent re-runs on the SAME task and writes DIFFERENT
    // bytes, then review fires again. No entry is 'applying' now (it's written),
    // so the re-seal must key off the task — otherwise lastAppliedHash stays at
    // v1 while disk holds v2, and undo would falsely cry "edited outside Annotask".
    await fsp.writeFile(path.join(root, 'src/Page.vue'), PAGE.replace('Planets', 'Galaxies'), 'utf-8')
    clearBindingClassifyCache()
    await verifyAppliedEntries(options, result.taskId)

    const undo = await revertApplyBatch(options, result.batchId)
    expect(undo.skipped).toEqual([])
    expect(undo.reverted).toEqual(['src/Page.vue'])
    expect(await fsp.readFile(path.join(root, 'src/Page.vue'), 'utf-8')).toBe(PAGE)
  })

  it('verify seals a pure-instances apply (no session entries) so its batch is revertible', async () => {
    // Build-this-route: placements only, no panel edits — toVerify is empty, but
    // the batch still needs a hash baseline or undo can't restore it.
    const wf = await options.getWireframe()
    await options.setWireframe({ ...wf, updatedAt: 1, routes: [{ route: '/planets', instances: [instance('wfi-1')] }] })
    const result = await applyDesignSession(options, '/planets')
    if ('error' in result) throw new Error('apply failed')

    await fsp.writeFile(path.join(root, 'src/Page.vue'), PAGE.replace('Planets', 'Worlds'), 'utf-8')
    await verifyAppliedEntries(options, result.taskId)

    const snap = await options.snapshots.state()
    expect(snap.batches[0].status).toBe('done')
    const undo = await revertApplyBatch(options, result.batchId)
    expect(undo.reverted).toEqual(['src/Page.vue'])
    expect(await fsp.readFile(path.join(root, 'src/Page.vue'), 'utf-8')).toBe(PAGE)
  })

  describe('wireframe directions (W3)', () => {
    it('apply is route-scoped for directions, session-wide for legacy entries, and stamps the screenshot + canvas', async () => {
      await seedSession([
        directionEntry('wd-here', '/planets', 1),
        directionEntry('wd-elsewhere', '/moons', 2),
        textEntry('se-style'), // legacy entries stay session-wide
      ])
      const wf = await options.getWireframe()
      await options.setWireframe({
        ...wf, updatedAt: 1,
        routes: [{
          route: '/planets', instances: [],
          canvas: {
            capturedAt: 1,
            viewport: { width: 1280, height: 800, docWidth: 1280, docHeight: 2400, scale: 2 },
            blocks: [],
          },
        }],
      })

      const result = await applyDesignSession(options, '/planets', { screenshot: 'screenshot-1-abc.png' })
      expect('error' in result).toBe(false)
      if ('error' in result) return

      expect(tasks).toHaveLength(1)
      expect(tasks[0].screenshot).toBe('screenshot-1-abc.png')
      expect(String(tasks[0].description)).toContain('Implement the wireframe sketch on /planets')
      expect(String(tasks[0].description)).toContain('Pixel positions are hints')
      const ctx = tasks[0].context as { session: { entries: Array<{ id: string }> } }
      expect(ctx.session.entries.map((e) => e.id).sort()).toEqual(['se-style', 'wd-here'])

      // The other route's direction stays pending; the canvas locks to the task.
      const session = await options.getDesignSession()
      expect(session.entries.find((e) => e.id === 'wd-elsewhere')!.live.status).toBe('pending')
      const wfAfter = await options.getWireframe()
      expect(wfAfter.routes[0].canvas).toMatchObject({ status: 'building', taskId: result.taskId })
    })

    it('an add direction with md + data rides into the task context VERBATIM (entryForTask passes change whole)', async () => {
      const md = '## Related planets\n- name and type for each'
      const data = {
        kind: 'composable', name: 'usePlanets', module: 'src/composables/usePlanets.ts',
        path: 'planets[]', fields: ['name', 'type'], shape_source: 'api-schema',
      }
      const entry = directionEntry('wd-sec', '/planets', 1)
      const change = entry.change as unknown as Record<string, unknown>
      change.op = 'add'
      change.added = { kind: 'placeholder', label: 'related planets', md, data, position: 'after' }
      await seedSession([entry])

      const result = await applyDesignSession(options, '/planets')
      if ('error' in result) throw new Error(result.error)

      const ctx = tasks[0].context as { session: { entries: Array<{ change: { added?: { md?: string; data?: unknown } } }> } }
      expect(ctx.session.entries).toHaveLength(1)
      expect(ctx.session.entries[0].change.added!.md).toBe(md)
      expect(ctx.session.entries[0].change.added!.data).toEqual(data)
    })

    it('an anchorless add (no donor → file "") mints the task and snapshots nothing — never crashes the apply', async () => {
      // A page with no data-annotask anchors: the add has nowhere to ground, so
      // file/line come back ''. The OLD code threw on snapshotFiles('') AFTER
      // minting the task, stranding an orphan task with no batch (and feeding
      // the lifecycle wedge). Now empty anchors are filtered out of the set.
      const entry: SessionEntry = {
        id: 'wd-floating', ordinal: 1, ts: 1, route: '/planets',
        change: {
          id: 'c-wd-floating', type: 'wireframe_direction', op: 'add',
          description: 'ADD component <Hero> on the page',
          file: '', section: 'template', line: 0,
          block: { label: 'Hero' },
          added: { kind: 'component', componentName: 'Hero', position: 'append' },
          measured: { after: { x: 0, y: 0, width: 320, height: 120 } },
        } as unknown as SessionEntry['change'],
        anchor: { file: '', line: 0 },
        live: { status: 'pending' },
      }
      await seedSession([entry])

      const result = await applyDesignSession(options, '/planets')
      expect('error' in result).toBe(false)
      if ('error' in result) return
      expect(tasks).toHaveLength(1)
      // No file snapshotted (the only anchor was empty) — but the batch exists
      // and stays revertible, and the direction still rides the task context.
      const snap = await options.snapshots.state()
      expect(Object.keys(snap.files)).toEqual([])
      expect(snap.batches.map((b) => b.id)).toEqual([result.batchId])
      const ctx = tasks[0].context as { session: { entries: Array<{ id: string }> } }
      expect(ctx.session.entries.map((e) => e.id)).toEqual(['wd-floating'])
    })

    it('verify trusts directions with NO source read — the anchor file may be gone entirely', async () => {
      await seedSession([directionEntry('wd-1')])
      const result = await applyDesignSession(options, '/planets')
      if ('error' in result) throw new Error(result.error)

      // The agent legitimately restructured: the anchored file no longer exists.
      await fsp.rm(path.join(root, 'src/Page.vue'))

      await verifyAppliedEntries(options, result.taskId)
      const session = await options.getDesignSession()
      expect(session.entries[0].live.status).toBe('written')
      const snap = await options.snapshots.state()
      expect(snap.batches[0].status).toBe('done') // sealed
    })

    it('undo-batch returns direction entries to pending with the taskId cleared', async () => {
      await seedSession([directionEntry('wd-1')])
      const before = await fsp.readFile(path.join(root, 'src/Page.vue'), 'utf-8')
      const result = await applyDesignSession(options, '/planets')
      if ('error' in result) throw new Error(result.error)

      // Agent rewrites, then review seals the batch — undo is only reachable on
      // a sealed batch (the running-batch guard refuses an unsealed one).
      await fsp.writeFile(path.join(root, 'src/Page.vue'), '<template><p>agent rewrote</p></template>', 'utf-8')
      await verifyAppliedEntries(options, result.taskId)
      const reverted = await revertApplyBatch(options, result.batchId)
      expect(reverted.reverted).toEqual(['src/Page.vue'])
      expect(await fsp.readFile(path.join(root, 'src/Page.vue'), 'utf-8')).toBe(before)

      const session = await options.getDesignSession()
      expect(session.entries[0].live.status).toBe('pending')
      expect(session.entries[0].taskId).toBeUndefined()
    })

    it('accept clears direction entries and rotates an emptied session', async () => {
      await seedSession([directionEntry('wd-1')])
      const result = await applyDesignSession(options, '/planets')
      if ('error' in result) throw new Error(result.error)
      await verifyAppliedEntries(options, result.taskId)

      const { rotated } = await acceptApplyTask(options, result.taskId)
      expect(rotated).toBe(true)
      expect((await options.getDesignSession()).entries).toEqual([])
      expect((await options.snapshots.state()).batches).toEqual([])
    })
  })
})
