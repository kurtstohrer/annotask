import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { createSnapshotStore } from '../file-snapshots'

const ORIGINAL = `<template>
  <h1 class="title">Planets</h1>
</template>
`

describe('file-snapshots', () => {
  let root: string
  let file: string

  async function write(rel: string, content: string): Promise<void> {
    const abs = path.join(root, rel)
    await fsp.mkdir(path.dirname(abs), { recursive: true })
    await fsp.writeFile(abs, content, 'utf-8')
  }

  async function read(rel: string): Promise<string> {
    return fsp.readFile(path.join(root, rel), 'utf-8')
  }

  beforeEach(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'annotask-snap-'))
    file = 'src/PlanetsPage.vue'
    await write(file, ORIGINAL)
  })

  afterEach(async () => {
    await fsp.rm(root, { recursive: true, force: true })
  })

  it('snapshot → agent write → revertBatch restores pre-batch bytes byte-for-byte', async () => {
    const store = createSnapshotStore(root)
    await store.snapshotFiles([file], { id: 'ab-1', taskId: 'task-1' })
    // The journal must exist BEFORE the agent runs (crash safety).
    expect(fs.existsSync(path.join(root, '.annotask', 'file-snapshots.json'))).toBe(true)

    await write(file, ORIGINAL.replace('Planets', 'Worlds'))
    await store.sealBatch('ab-1')

    const result = await store.revertBatch('ab-1')
    expect(result.reverted).toEqual([file])
    expect(result.skipped).toEqual([])
    expect(await read(file)).toBe(ORIGINAL)
    // Fully-undone session → empty journal.
    expect((await store.state()).files).toEqual({})
    expect((await store.state()).batches).toEqual([])
  })

  it('captures the session base ONCE across batches; revertAll restores it', async () => {
    const store = createSnapshotStore(root)
    await store.snapshotFiles([file], { id: 'ab-1', taskId: 't1' })
    await write(file, ORIGINAL.replace('Planets', 'Worlds'))
    await store.sealBatch('ab-1')

    await store.snapshotFiles([file], { id: 'ab-2', taskId: 't2' })
    await write(file, ORIGINAL.replace('Planets', 'Galaxies'))
    await store.sealBatch('ab-2')

    const result = await store.revertAll()
    expect(result.reverted).toEqual([file])
    expect(await read(file)).toBe(ORIGINAL) // base, not the intermediate state
    expect((await store.state()).files).toEqual({})
  })

  it('undoing the last batch restores the previous batch state (LIFO); older batches are refused', async () => {
    const store = createSnapshotStore(root)
    const afterBatch1 = ORIGINAL.replace('Planets', 'Worlds')
    await store.snapshotFiles([file], { id: 'ab-1', taskId: 't1' })
    await write(file, afterBatch1)
    await store.sealBatch('ab-1')

    await store.snapshotFiles([file], { id: 'ab-2', taskId: 't2' })
    await write(file, ORIGINAL.replace('Planets', 'Galaxies'))
    await store.sealBatch('ab-2')

    await expect(store.revertBatch('ab-1')).rejects.toThrow(/most recent/)

    await store.revertBatch('ab-2')
    expect(await read(file)).toBe(afterBatch1)
    await store.revertBatch('ab-1')
    expect(await read(file)).toBe(ORIGINAL)
  })

  it('hash-guards restores: a user edit after the seal marks the file diverged and skips it', async () => {
    const store = createSnapshotStore(root)
    await store.snapshotFiles([file], { id: 'ab-1', taskId: 't1' })
    await write(file, ORIGINAL.replace('Planets', 'Worlds'))
    await store.sealBatch('ab-1')

    // The user edits in their own editor after the agent ran.
    const userEdit = (await read(file)) + '<!-- user edit -->\n'
    await write(file, userEdit)

    const result = await store.revertBatch('ab-1')
    expect(result.reverted).toEqual([])
    expect(result.skipped).toEqual([file])
    expect(await read(file)).toBe(userEdit) // never clobbered

    const state = await store.state()
    expect(state.files[file]?.status).toBe('diverged')

    // detachFile is the resolution: keep disk bytes, forget the file.
    await store.detachFile(file)
    expect((await store.state()).files[file]).toBeUndefined()
    expect(await read(file)).toBe(userEdit)
  })

  it('REHYDRATES across restarts (never auto-reverts) and revertAll still works after', async () => {
    const store = createSnapshotStore(root)
    await store.snapshotFiles([file], { id: 'ab-1', taskId: 't1' })
    const agentBytes = ORIGINAL.replace('Planets', 'Worlds')
    await write(file, agentBytes)
    await store.sealBatch('ab-1')
    await store.flush()

    // "Restart": a fresh store on the same root.
    const restarted = createSnapshotStore(root)
    // Agent-written work survives the restart.
    expect(await read(file)).toBe(agentBytes)
    const state = await restarted.state()
    expect(state.batches.map((b) => b.id)).toEqual(['ab-1'])
    expect(state.files[file]?.status).toBe('clean')

    const result = await restarted.revertAll()
    expect(result.reverted).toEqual([file])
    expect(await read(file)).toBe(ORIGINAL)
  })

  it('migrates a legacy render-in-place draft journal with the old restore-and-clear semantics', async () => {
    const modified = ORIGINAL + '<PlanetCard />\n'
    await write(file, modified)
    const legacy = {
      'draft-1': {
        absPath: path.join(root, file),
        original: ORIGINAL,
        modifiedHash: (await import('node:crypto')).createHash('sha256').update(modified).digest('hex'),
      },
    }
    await write('.annotask/draft-edits.json', JSON.stringify(legacy))

    const store = createSnapshotStore(root)
    await store.flush()
    expect(await read(file)).toBe(ORIGINAL)
    expect(fs.existsSync(path.join(root, '.annotask', 'draft-edits.json'))).toBe(false)
  })

  it('commit keeps the bytes and drops the journal (task-accept path)', async () => {
    const store = createSnapshotStore(root)
    await store.snapshotFiles([file], { id: 'ab-1', taskId: 't1' })
    const agentBytes = ORIGINAL.replace('Planets', 'Worlds')
    await write(file, agentBytes)
    await store.sealBatch('ab-1')

    await store.commit()
    expect(await read(file)).toBe(agentBytes)
    expect((await store.state()).files).toEqual({})
    expect(fs.existsSync(path.join(root, '.annotask', 'file-snapshots.json'))).toBe(false)
  })

  it('rejects snapshot targets outside the project root', async () => {
    const store = createSnapshotStore(root)
    await expect(store.snapshotFiles(['../outside.vue'], { id: 'ab-1', taskId: 't1' })).rejects.toThrow(/escapes/)
    const outsideAbs = path.join(os.tmpdir(), 'annotask-outside.vue')
    await expect(store.snapshotFiles([outsideAbs], { id: 'ab-2', taskId: 't2' })).rejects.toThrow(/escapes/)
  })

  describe('agent-created files (W4 netting — git projects)', () => {
    function gitInit(): void {
      const git = (args: string[]) => execFileSync('git', args, { cwd: root, stdio: 'ignore' })
      git(['init', '-q'])
      git(['add', '-A'])
      git(['-c', 'user.email=ci@annotask.test', '-c', 'user.name=annotask-ci', 'commit', '-q', '-m', 'baseline'])
    }

    it('seal nets new untracked files into the batch; undo deletes pristine copies', async () => {
      gitInit()
      const store = createSnapshotStore(root)
      // A pre-existing untracked file is the user's — never netted.
      await write('src/UserDraft.vue', '<template>mine</template>')
      await store.snapshotFiles([file], { id: 'ab-1', taskId: 'task-1' })

      // The agent edits the snapshotted file AND creates a new component.
      await write(file, ORIGINAL.replace('Planets', 'Worlds'))
      await write('src/Pagination.vue', '<template><nav class="placeholder">pagination here</nav></template>')
      await store.sealBatch('ab-1')

      const state = await store.state()
      expect(state.batches[0].created).toEqual(['src/Pagination.vue'])

      const result = await store.revertBatch('ab-1')
      expect(result.reverted.sort()).toEqual([file, 'src/Pagination.vue'].sort())
      expect(result.skipped).toEqual([])
      expect(await read(file)).toBe(ORIGINAL)
      expect(fs.existsSync(path.join(root, 'src/Pagination.vue'))).toBe(false)
      // The user's untracked draft was never touched.
      expect(await read('src/UserDraft.vue')).toBe('<template>mine</template>')
    })

    it('a user-edited created file is kept (and reported skipped) on undo', async () => {
      gitInit()
      const store = createSnapshotStore(root)
      await store.snapshotFiles([file], { id: 'ab-1', taskId: 'task-1' })
      await write('src/New.vue', '<template>agent</template>')
      await store.sealBatch('ab-1')

      await write('src/New.vue', '<template>agent + my edits</template>')
      const result = await store.revertBatch('ab-1')
      expect(result.skipped).toEqual(['src/New.vue'])
      expect(await read('src/New.vue')).toBe('<template>agent + my edits</template>')
    })

    it('revertAll (discard) deletes pristine created files across batches', async () => {
      gitInit()
      const store = createSnapshotStore(root)
      await store.snapshotFiles([file], { id: 'ab-1', taskId: 'task-1' })
      await write('src/A.vue', 'a')
      await store.sealBatch('ab-1')
      await store.snapshotFiles([file], { id: 'ab-2', taskId: 'task-2' })
      await write('src/B.vue', 'b')
      await store.sealBatch('ab-2')

      const result = await store.revertAll()
      expect(result.reverted).toContain('src/A.vue')
      expect(result.reverted).toContain('src/B.vue')
      expect(fs.existsSync(path.join(root, 'src/A.vue'))).toBe(false)
      expect(fs.existsSync(path.join(root, 'src/B.vue'))).toBe(false)
    })

    it('non-git projects skip the net silently (snapshotted files still restore)', async () => {
      const store = createSnapshotStore(root) // no git init
      await store.snapshotFiles([file], { id: 'ab-1', taskId: 'task-1' })
      await write(file, 'changed')
      await write('src/New.vue', 'agent file survives undo without git')
      await store.sealBatch('ab-1')
      const state = await store.state()
      expect(state.batches[0].created).toBeUndefined()
      const result = await store.revertBatch('ab-1')
      expect(result.reverted).toEqual([file])
      expect(fs.existsSync(path.join(root, 'src/New.vue'))).toBe(true)
    })
  })
})
