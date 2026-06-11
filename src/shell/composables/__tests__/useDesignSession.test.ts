// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { useDesignSession } from '../useDesignSession'
import { useStyleEditor } from '../useStyleEditor'
import type { InsertChangeRecord } from '../useStyleEditor'

function emptyServerDoc(rev?: number) {
  return { version: '1.0', sessionId: 'ds-server', startedAt: 0, updatedAt: 0, ...(rev !== undefined ? { rev } : {}), entries: [] }
}

function jsonResponse(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body }
}

const meta = { file: 'src/App.vue', line: '10', component: 'App' }

function placementInput(instanceId: string, overrides: Partial<Parameters<ReturnType<typeof useDesignSession>['record']>[0]> = {}) {
  const change: InsertChangeRecord = {
    id: `wf-${instanceId}`,
    type: 'component_insert',
    description: 'Place <PlanetCard> append div',
    file: 'src/pages/PlanetsPage.vue',
    section: 'template',
    line: 9,
    component: 'PlanetsPage',
    insert_position: 'append',
    inserted: { tag: 'planetcard' },
  }
  return {
    change,
    anchor: { file: 'src/pages/PlanetsPage.vue', line: 9, position: 'append' as const },
    route: '/planets',
    eid: `container-${instanceId}`,
    instanceId,
    ...overrides,
  }
}

describe('useDesignSession journal', () => {
  let session: ReturnType<typeof useDesignSession>
  let editor: ReturnType<typeof useStyleEditor>

  beforeEach(() => {
    session = useDesignSession()
    session.clear()
    session.sessionRoute.value = '/planets'
    session.activeBreakpointId.value = null
    editor = useStyleEditor()
  })

  describe('append-or-amend', () => {
    it('amends the journal entry during a continuous gesture (slider drag = one entry)', () => {
      editor.applyStyle('e-1', 'color', 'red', '', meta)
      editor.applyStyle('e-1', 'color', 'blue', '', meta)
      editor.applyStyle('e-1', 'color', 'green', '', meta)

      expect(session.entries.value).toHaveLength(1)
      const c = session.entries.value[0].change
      expect(c.type).toBe('style_update')
      if (c.type === 'style_update') {
        expect(c.before).toBe('') // preserved from first touch
        expect(c.after).toBe('green')
      }
    })

    it('appends on a non-adjacent re-edit so ordered undo steps back through actions', () => {
      editor.applyStyle('e-1', 'color', 'red', '', meta)
      editor.applyStyle('e-1', 'padding', '10px', '0px', meta)
      editor.applyStyle('e-1', 'color', 'blue', 'red', meta)

      // Journal: 3 ordered entries; projection: 2 collapsed records.
      expect(session.entries.value).toHaveLength(3)
      expect(editor.changes.value).toHaveLength(2)
      const color = editor.changes.value[0]
      if (color.type === 'style_update') {
        expect(color.before).toBe('') // first touch
        expect(color.after).toBe('blue') // latest value
      }

      // Undo reverts ONLY the latest action (blue → red), not the whole group.
      const undoInfo = editor.undo()
      expect(undoInfo).toEqual({ type: 'style', eid: 'e-1', property: 'color', value: 'red' })
      const colorAfterUndo = editor.changes.value[0]
      if (colorAfterUndo.type === 'style_update') expect(colorAfterUndo.after).toBe('red')
    })

    it('amends per-eid during a group-selection gesture instead of appending per tick', () => {
      // Tick 1: applyToGroup loops both eids; tick 2 repeats with a new value.
      editor.applyStyle('e-1', 'color', 'red', '', meta)
      editor.applyStyle('e-2', 'color', 'red', '', meta)
      editor.applyStyle('e-1', 'color', 'blue', '', meta)
      editor.applyStyle('e-2', 'color', 'blue', '', meta)

      expect(session.entries.value).toHaveLength(2)
      expect(editor.changes.value).toHaveLength(2)
    })

    it('splits collapse keys by breakpoint', () => {
      editor.applyStyle('e-1', 'padding', '20px', '10px', meta)
      session.activeBreakpointId.value = 'iphone-se'
      editor.applyStyle('e-1', 'padding', '8px', '20px', meta)

      expect(session.entries.value).toHaveLength(2)
      expect(session.entries.value[0].breakpointId).toBeNull()
      expect(session.entries.value[1].breakpointId).toBe('iphone-se')
      expect(editor.changes.value).toHaveLength(2)
    })

    it('does not amend an entry that was snapshotted into a task or already applied', () => {
      editor.applyStyle('e-1', 'color', 'red', '', meta)
      const entry = session.entries.value[0]
      session.setLiveState(entry.id, { status: 'written', applyBatchId: 'ab-1' })
      editor.applyStyle('e-1', 'color', 'blue', 'red', meta)

      expect(session.entries.value).toHaveLength(2)
      expect(session.entries.value[0].live.status).toBe('written')
      expect(session.entries.value[1].live.status).toBe('pending')
    })
  })

  describe('placements in the journal', () => {
    it('interleaves placement-create with style edits in one ordered undo stack', () => {
      editor.applyStyle('e-1', 'color', 'red', '', meta)
      session.record(placementInput('wfi-1'))
      editor.applyStyle('e-1', 'padding', '10px', '0px', meta)

      // Undo 1: the padding edit.
      expect(editor.undo()).toEqual({ type: 'style', eid: 'e-1', property: 'padding', value: '0px' })
      // Undo 2: the placement — returns the delete descriptor for doUndo.
      expect(editor.undo()).toEqual({ type: 'placement_delete', instanceId: 'wfi-1' })
      // Undo 3: the first style edit.
      expect(editor.undo()).toEqual({ type: 'style', eid: 'e-1', property: 'color', value: '' })
      expect(editor.undo()).toBeNull()
    })

    it('keeps placement entries out of the changes/report projection', () => {
      session.record(placementInput('wfi-1'))
      expect(editor.changes.value).toHaveLength(0)
      expect(editor.report.value).toBeNull()
    })

    it('keeps placement entries through clearChanges/removeChangesFor (wireframe lifecycle owns them)', () => {
      session.record(placementInput('wfi-1'))
      editor.applyStyle('e-1', 'color', 'red', '', { ...meta, file: 'src/pages/PlanetsPage.vue', line: '9' })

      editor.removeChangesFor('src/pages/PlanetsPage.vue', 9)
      expect(session.entries.value).toHaveLength(1)
      expect(session.entries.value[0].instanceId).toBe('wfi-1')

      editor.clearChanges()
      expect(session.entries.value).toHaveLength(1)
    })

    it('removeByInstanceId drops the placement entry (deletePlacement path)', () => {
      session.record(placementInput('wfi-1'))
      session.record(placementInput('wfi-2'))
      session.removeByInstanceId('wfi-1')
      expect(session.entries.value).toHaveLength(1)
      expect(session.entries.value[0].instanceId).toBe('wfi-2')
    })
  })

  describe('live-state projection', () => {
    it('excludes written/applying entries from changes and report (no double-apply)', () => {
      editor.applyStyle('e-1', 'color', 'blue', 'red', meta)
      editor.applyStyle('e-1', 'padding', '10px', '0px', meta)
      const [colorEntry, paddingEntry] = session.entries.value

      session.setLiveState(colorEntry.id, { status: 'written', applyBatchId: 'ab-1', writtenAt: 1 })
      expect(editor.changes.value).toHaveLength(1)
      expect(editor.report.value!.changes).toHaveLength(1)

      session.setLiveState(paddingEntry.id, { status: 'applying', applyBatchId: 'ab-2' })
      expect(editor.changes.value).toHaveLength(0)
      expect(editor.report.value).toBeNull()
    })

    it('keeps failed entries visible (they are pending work again)', () => {
      editor.applyStyle('e-1', 'color', 'blue', 'red', meta)
      session.setLiveState(session.entries.value[0].id, { status: 'failed', error: 'not found in source' })
      expect(editor.changes.value).toHaveLength(1)
    })
  })

  describe('persistence (debounced CAS PUT)', () => {
    let fetchMock: ReturnType<typeof vi.fn>

    beforeEach(async () => {
      fetchMock = vi.fn(async () => jsonResponse(200, emptyServerDoc()))
      vi.stubGlobal('fetch', fetchMock)
      session.readOnly.value = false
      session.syncError.value = null
      // Drain any flush queued by the outer clear(), then reset module rev
      // state by adopting a fresh empty server doc.
      await session.queueFlushNow()
      await session.load()
      fetchMock.mockClear()
      vi.useFakeTimers()
    })

    afterEach(async () => {
      await vi.runAllTimersAsync()
      vi.useRealTimers()
      vi.unstubAllGlobals()
    })

    it('debounces mutations into one single-flight PUT of the whole journal', async () => {
      fetchMock.mockImplementation(async (_url: string, init?: RequestInit) => {
        if (init?.method === 'PUT') {
          const body = JSON.parse(init.body as string)
          return jsonResponse(200, { ...body, rev: (body.rev ?? 0) + 1 })
        }
        return jsonResponse(200, emptyServerDoc())
      })

      editor.applyStyle('e-1', 'color', 'blue', 'red', meta)
      editor.applyStyle('e-1', 'color', 'green', 'red', meta) // amends within the window
      expect(fetchMock).not.toHaveBeenCalled()

      await vi.advanceTimersByTimeAsync(350)
      const puts = fetchMock.mock.calls.filter((c) => (c[1] as RequestInit | undefined)?.method === 'PUT')
      expect(puts).toHaveLength(1)
      const body = JSON.parse((puts[0][1] as RequestInit).body as string)
      expect(body.version).toBe('1.0')
      expect(body.entries).toHaveLength(1)
      expect(body.entries[0].change.after).toBe('green')

      // The stamped rev round-trips on the next flush.
      editor.applyStyle('e-1', 'padding', '10px', '0px', meta)
      await vi.advanceTimersByTimeAsync(350)
      const puts2 = fetchMock.mock.calls.filter((c) => (c[1] as RequestInit | undefined)?.method === 'PUT')
      expect(puts2).toHaveLength(2)
      expect(JSON.parse((puts2[1][1] as RequestInit).body as string).rev).toBe(1)
    })

    it('merges on 409 (server wins live/taskId, local wins presence) and retries once', async () => {
      editor.applyStyle('e-1', 'color', 'blue', 'red', meta)
      const localEntry = session.entries.value[0]
      const serverDoc = {
        version: '1.0', sessionId: 'ds-server', startedAt: 5, updatedAt: 6, rev: 7,
        entries: [
          { ...JSON.parse(JSON.stringify(localEntry)), live: { status: 'written', applyBatchId: 'ab-1' }, taskId: 'task-9' },
          { id: 'se-99', ordinal: 99, ts: 9, route: '/planets', change: { id: 'c-99', type: 'style_update', description: 'x', file: 'b.vue', section: 'style', line: 1, element: 'p', property: 'color', before: 'a', after: 'b' }, anchor: { file: 'b.vue', line: 1 }, live: { status: 'pending' } },
        ],
      }
      let putCount = 0
      fetchMock.mockImplementation(async (_url: string, init?: RequestInit) => {
        if (init?.method === 'PUT') {
          putCount++
          if (putCount === 1) return jsonResponse(409, { error: { code: 'conflict', message: 'stale' } })
          const body = JSON.parse(init.body as string)
          return jsonResponse(200, { ...body, rev: (body.rev ?? 0) + 1 })
        }
        return jsonResponse(200, serverDoc)
      })

      await vi.advanceTimersByTimeAsync(350)
      expect(putCount).toBe(2)
      expect(session.readOnly.value).toBe(false)
      // Server's live/taskId adopted on our entry; foreign entry appended.
      expect(localEntry.live.status).toBe('written')
      expect(localEntry.taskId).toBe('task-9')
      expect(session.entries.value.map((e) => e.id)).toContain('se-99')
    })

    it('goes read-only with a banner after two conflicts in a row', async () => {
      fetchMock.mockImplementation(async (_url: string, init?: RequestInit) => {
        if (init?.method === 'PUT') return jsonResponse(409, { error: { code: 'conflict', message: 'stale' } })
        return jsonResponse(200, emptyServerDoc(7))
      })
      editor.applyStyle('e-1', 'color', 'blue', 'red', meta)
      await vi.advanceTimersByTimeAsync(350)
      expect(session.readOnly.value).toBe(true)
      expect(session.syncError.value).toMatch(/another tab/)
    })

    it('load() adopts the persisted journal and reseeds counters', async () => {
      const persisted = {
        version: '1.0', sessionId: 'ds-restored', startedAt: 5, updatedAt: 6, rev: 3,
        entries: [
          { id: 'se-7', ordinal: 7, ts: 1, route: '/planets', change: { id: 'c-7', type: 'style_update', description: 'x', file: 'a.vue', section: 'style', line: 9, element: 'h1', property: 'color', before: 'red', after: 'blue' }, anchor: { file: 'a.vue', line: 9 }, live: { status: 'pending' } },
        ],
      }
      fetchMock.mockImplementation(async (_url: string, init?: RequestInit) => {
        if (init?.method === 'PUT') {
          const body = JSON.parse(init.body as string)
          return jsonResponse(200, { ...body, rev: (body.rev ?? 0) + 1 })
        }
        return jsonResponse(200, persisted)
      })

      await session.load()
      expect(session.entries.value).toHaveLength(1)

      editor.applyStyle('e-1', 'padding', '10px', '0px', meta)
      const fresh = session.entries.value[1]
      expect(fresh.id).toBe('se-8')
      expect(fresh.ordinal).toBe(8)
    })
  })

  describe('reload restore (reapplyPreviews)', () => {
    it('replays single-element style/class previews, re-stamps eids, and marks loop anchors stale', async () => {
      editor.applyStyle('e-old', 'color', 'blue', 'red', { file: 'a.vue', line: '5', component: 'A' })
      editor.recordClassChange('e-old2', 'x', 'y', { file: 'a.vue', line: '6', component: 'A' })
      const [styleEntry, classEntry] = session.entries.value

      const iframe = {
        findTemplateGroup: vi.fn(async (_file: string, line: string) =>
          line === '5' ? { eids: ['e-new'] } : { eids: ['a', 'b'] }),
        applyStyleVia: vi.fn(async () => 'before'),
        setClass: vi.fn(async () => 'before'),
      }

      await session.reapplyPreviews('/planets', iframe, { force: true })
      expect(iframe.applyStyleVia).toHaveBeenCalledWith('e-new', 'color', 'blue')
      expect(styleEntry.eid).toBe('e-new')
      // The class edit's anchor resolved to a 2-element loop group — replaying
      // one element's edit onto all N would be a silent fake → stale badge.
      expect(iframe.setClass).not.toHaveBeenCalled()
      expect(session.staleEntryIds.value).toContain(classEntry.id)
      expect(session.staleEntryIds.value).not.toContain(styleEntry.id)

      // De-dup: same route without force is a no-op.
      await session.reapplyPreviews('/planets', iframe)
      expect(iframe.applyStyleVia).toHaveBeenCalledTimes(1)
    })
  })

  describe('agent-apply client ops', () => {
    let fetchMock: ReturnType<typeof vi.fn>

    beforeEach(async () => {
      fetchMock = vi.fn(async () => jsonResponse(200, emptyServerDoc()))
      vi.stubGlobal('fetch', fetchMock)
      session.readOnly.value = false
      session.lastError.value = null
      session.snapshotState.value = { files: {}, batches: [] }
      await session.queueFlushNow()
      await session.load()
      fetchMock.mockClear()
    })

    afterEach(() => {
      vi.unstubAllGlobals()
    })

    it('applyNow flushes, POSTs the route, and returns the minted task/batch', async () => {
      editor.applyStyle('e-1', 'color', 'blue', 'red', meta)
      session.sessionRoute.value = '/planets'
      fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
        if (String(url).endsWith('/design-session/apply')) {
          expect(JSON.parse(init!.body as string)).toEqual({ route: '/planets' })
          return jsonResponse(200, { taskId: 'task-9', batchId: 'ab-1', entryIds: ['se-1'], instanceIds: [] })
        }
        if (String(url).endsWith('/design-session/snapshots')) {
          return jsonResponse(200, { files: { 'src/App.vue': { baseHash: 'x', status: 'clean' } }, batches: [{ id: 'ab-1', taskId: 'task-9', files: ['src/App.vue'], startedAt: 1, status: 'running' }] })
        }
        if (init?.method === 'PUT') {
          const body = JSON.parse(init.body as string)
          return jsonResponse(200, { ...body, rev: (body.rev ?? 0) + 1 })
        }
        return jsonResponse(200, emptyServerDoc(2))
      })

      const result = await session.applyNow()
      expect(result).toEqual({ taskId: 'task-9', batchId: 'ab-1' })
      expect(session.lastError.value).toBeNull()
      expect(session.snapshotState.value.batches.map((b) => b.id)).toEqual(['ab-1'])
      // The journal was flushed BEFORE the apply POST.
      const calls = fetchMock.mock.calls.map((c) => `${(c[1] as RequestInit | undefined)?.method ?? 'GET'} ${c[0]}`)
      const putIdx = calls.findIndex((c) => c.startsWith('PUT'))
      const applyIdx = calls.findIndex((c) => c.includes('/apply'))
      expect(putIdx).toBeGreaterThanOrEqual(0)
      expect(putIdx).toBeLessThan(applyIdx)
    })

    it('applyNow surfaces server refusals in lastError', async () => {
      fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
        if (String(url).endsWith('/design-session/apply')) {
          return jsonResponse(400, { error: { code: 'invalid_body', message: 'nothing to apply' } })
        }
        if (init?.method === 'PUT') {
          const body = JSON.parse(init.body as string)
          return jsonResponse(200, { ...body, rev: (body.rev ?? 0) + 1 })
        }
        return jsonResponse(200, emptyServerDoc())
      })
      expect(await session.applyNow()).toBeNull()
      expect(session.lastError.value).toMatch(/nothing to apply/)
    })

    it('undoLastBatch POSTs the newest batch id and reports unrestorable files', async () => {
      session.snapshotState.value = {
        files: { 'src/App.vue': { baseHash: 'x', status: 'clean' } },
        batches: [
          { id: 'ab-1', taskId: 't1', files: ['src/App.vue'], startedAt: 1, status: 'done' },
          { id: 'ab-2', taskId: 't2', files: ['src/App.vue'], startedAt: 2, status: 'done' },
        ],
      }
      fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
        if (String(url).endsWith('/design-session/undo-batch')) {
          expect(JSON.parse(init!.body as string)).toEqual({ batchId: 'ab-2' })
          return jsonResponse(200, { reverted: [], skipped: ['src/App.vue'] })
        }
        if (String(url).endsWith('/design-session/snapshots')) return jsonResponse(200, { files: {}, batches: [] })
        return jsonResponse(200, emptyServerDoc())
      })
      const result = await session.undoLastBatch()
      expect(result).toEqual({ reverted: [], skipped: ['src/App.vue'] })
      expect(session.lastError.value).toMatch(/outside Annotask/)
    })

    it('journal undo refuses to pop written/applying tails (batch undo owns them)', async () => {
      editor.applyStyle('e-1', 'color', 'blue', 'red', meta)
      session.setLiveState(session.entries.value[0].id, { status: 'written', applyBatchId: 'ab-1' })
      expect(editor.undo()).toBeNull()
      expect(session.entries.value).toHaveLength(1)
    })

    it('discardSession DELETEs and resets local state', async () => {
      editor.applyStyle('e-1', 'color', 'blue', 'red', meta)
      fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
        if (init?.method === 'DELETE') {
          return jsonResponse(200, { revertedFiles: ['src/App.vue'], failedFiles: [], removedInstances: 1 })
        }
        if (String(url).endsWith('/design-session/snapshots')) return jsonResponse(200, { files: {}, batches: [] })
        if (init?.method === 'PUT') {
          const body = JSON.parse(init.body as string)
          return jsonResponse(200, { ...body, rev: (body.rev ?? 0) + 1 })
        }
        return jsonResponse(200, emptyServerDoc(9))
      })
      const result = await session.discardSession()
      expect(result).toMatchObject({ revertedFiles: ['src/App.vue'], removedInstances: 1 })
      expect(session.entries.value).toHaveLength(0)
    })
  })

  describe('envelope', () => {
    it('stamps route, eid, ordinal, and anchor on recorded entries', () => {
      session.sessionRoute.value = '/moons'
      editor.applyStyle('e-9', 'color', 'blue', 'red', meta)
      const e = session.entries.value[0]
      expect(e.route).toBe('/moons')
      expect(e.eid).toBe('e-9')
      expect(e.ordinal).toBeGreaterThan(0)
      expect(e.anchor).toMatchObject({ file: 'src/App.vue', line: 10, component: 'App' })
      expect(e.live).toEqual({ status: 'pending' })
    })
  })
})
