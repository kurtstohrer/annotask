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

  it('skips snapshot targets outside the containment root (never snapshots them, never aborts the batch)', async () => {
    // Single-package project (no workspace): containment is projectRoot. An
    // escaping target is SKIPPED rather than throwing — one bad anchor must not
    // abort the whole snapshot and strand a just-minted task. Containment still
    // holds: the escaping file is never added to the journal.
    const store = createSnapshotStore(root)
    await write(file, ORIGINAL)
    const outsideAbs = path.join(os.tmpdir(), 'annotask-outside.vue')
    await expect(store.snapshotFiles(['../outside.vue', outsideAbs, file], { id: 'ab-1', taskId: 't1' })).resolves.toBeUndefined()
    expect(Object.keys((await store.state()).files)).toEqual([file]) // only the in-root file
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

    it('nets a STAGED new file (created + `git add`-ed by the agent); undo deletes it', async () => {
      gitInit()
      const store = createSnapshotStore(root)
      await store.snapshotFiles([file], { id: 'ab-1', taskId: 'task-1' })

      // The agent creates a component AND stages it — it shows up as 'A ' in
      // porcelain (never '??'), so the untracked net alone would miss it.
      await write('src/Staged.vue', '<template>staged</template>')
      execFileSync('git', ['add', 'src/Staged.vue'], { cwd: root, stdio: 'ignore' })
      await store.sealBatch('ab-1')

      expect((await store.state()).batches[0].created).toEqual(['src/Staged.vue'])

      const result = await store.revertBatch('ab-1')
      expect(result.reverted).toContain('src/Staged.vue')
      expect(fs.existsSync(path.join(root, 'src/Staged.vue'))).toBe(false)
    })

    it('a user-edited STAGED created file is kept (hash guard) on undo', async () => {
      gitInit()
      const store = createSnapshotStore(root)
      await store.snapshotFiles([file], { id: 'ab-1', taskId: 'task-1' })
      await write('src/Staged.vue', '<template>agent</template>')
      execFileSync('git', ['add', 'src/Staged.vue'], { cwd: root, stdio: 'ignore' })
      await store.sealBatch('ab-1')

      await write('src/Staged.vue', '<template>agent + my edits</template>')
      const result = await store.revertBatch('ab-1')
      expect(result.skipped).toEqual(['src/Staged.vue'])
      expect(await read('src/Staged.vue')).toBe('<template>agent + my edits</template>')
    })

    it('a pre-existing user untracked file the agent stages is NEVER netted', async () => {
      gitInit()
      const store = createSnapshotStore(root)
      await write('src/UserDraft.vue', '<template>mine</template>')
      await store.snapshotFiles([file], { id: 'ab-1', taskId: 'task-1' })

      execFileSync('git', ['add', 'src/UserDraft.vue'], { cwd: root, stdio: 'ignore' })
      await store.sealBatch('ab-1')

      expect((await store.state()).batches[0].created).toBeUndefined()
      await store.revertBatch('ab-1')
      expect(await read('src/UserDraft.vue')).toBe('<template>mine</template>')
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

  describe('byte-exact coverage — git auto-extend (undo covers the agent\'s whole footprint)', () => {
    function gitInit(): void {
      const git = (args: string[]) => execFileSync('git', args, { cwd: root, stdio: 'ignore' })
      git(['init', '-q'])
      // Repo-level identity so `git stash create` (the baseline) can commit.
      git(['config', 'user.email', 'ci@annotask.test'])
      git(['config', 'user.name', 'annotask-ci'])
      git(['add', '-A'])
      git(['commit', '-q', '-m', 'baseline'])
    }
    const SHARED = '<template><nav class="layout">shared layout</nav></template>\n'

    it('undo restores a NON-anchor file the agent also edited (not just the predicted anchors)', async () => {
      await write('src/Shared.vue', SHARED)
      gitInit()
      const store = createSnapshotStore(root)
      // The apply predicts only the anchor file…
      await store.snapshotFiles([file], { id: 'ab-1', taskId: 'task-1' })
      // …but the freeform agent edits the anchor AND a shared layout it was
      // never told about — the case that made undo silently partial.
      await write(file, ORIGINAL.replace('Planets', 'Worlds'))
      await write('src/Shared.vue', SHARED.replace('shared layout', 'rebuilt layout'))
      await store.sealBatch('ab-1')

      // Seal folded the off-anchor file into the batch.
      expect((await store.state()).batches[0].files).toContain('src/Shared.vue')

      const result = await store.revertBatch('ab-1')
      expect(result.reverted.sort()).toEqual([file, 'src/Shared.vue'].sort())
      expect(await read(file)).toBe(ORIGINAL)
      expect(await read('src/Shared.vue')).toBe(SHARED) // byte-exact, never a predicted anchor
    })

    it('undo RECREATES a file the agent deleted (byte-exact, from held bytes)', async () => {
      await write('src/Doomed.vue', SHARED)
      gitInit()
      const store = createSnapshotStore(root)
      await store.snapshotFiles([file], { id: 'ab-1', taskId: 'task-1' })
      await fsp.rm(path.join(root, 'src/Doomed.vue')) // the agent deletes it
      await store.sealBatch('ab-1')

      expect((await store.state()).batches[0].files).toContain('src/Doomed.vue')
      const result = await store.revertBatch('ab-1')
      expect(result.reverted).toContain('src/Doomed.vue')
      expect(fs.existsSync(path.join(root, 'src/Doomed.vue'))).toBe(true)
      expect(await read('src/Doomed.vue')).toBe(SHARED)
    })

    it('a user edit to an auto-extended file after seal is honoured (diverged, not clobbered)', async () => {
      await write('src/Shared.vue', SHARED)
      gitInit()
      const store = createSnapshotStore(root)
      await store.snapshotFiles([file], { id: 'ab-1', taskId: 'task-1' })
      await write('src/Shared.vue', SHARED.replace('shared layout', 'agent layout'))
      await store.sealBatch('ab-1')

      // The user keeps working on the agent's output, THEN undoes.
      const mine = SHARED.replace('shared layout', 'agent layout + my tweak')
      await write('src/Shared.vue', mine)
      const result = await store.revertBatch('ab-1')
      expect(result.skipped).toContain('src/Shared.vue')
      expect(await read('src/Shared.vue')).toBe(mine) // never clobbered
    })

    it('discard restores every auto-extended file to the session base across batches', async () => {
      await write('src/Shared.vue', SHARED)
      gitInit()
      const store = createSnapshotStore(root)
      await store.snapshotFiles([file], { id: 'ab-1', taskId: 'task-1' })
      await write('src/Shared.vue', SHARED.replace('shared layout', 'v1'))
      await store.sealBatch('ab-1')
      await store.snapshotFiles([file], { id: 'ab-2', taskId: 'task-2' })
      await write('src/Shared.vue', SHARED.replace('shared layout', 'v2'))
      await store.sealBatch('ab-2')

      await store.revertAll()
      expect(await read('src/Shared.vue')).toBe(SHARED) // session base, not v1/v2
    })
  })

  describe('running-batch guard (no clobbering a live, unsealed apply)', () => {
    it('revertBatch refuses a still-running batch — the agent may be mid-write', async () => {
      const store = createSnapshotStore(root)
      // snapshot but DON'T seal: the batch is 'running', files have no
      // lastAppliedHash, so an unguarded restore would clobber blindly.
      await store.snapshotFiles([file], { id: 'ab-1', taskId: 'task-1' })
      await write(file, ORIGINAL.replace('Planets', 'half-written'))

      await expect(store.revertBatch('ab-1')).rejects.toThrow(/still running/)
      // The in-progress bytes are untouched.
      expect(await read(file)).toBe(ORIGINAL.replace('Planets', 'half-written'))
    })

    it('revertAll refuses while any batch is still running', async () => {
      const store = createSnapshotStore(root)
      await store.snapshotFiles([file], { id: 'ab-1', taskId: 'task-1' })
      await write(file, ORIGINAL.replace('Planets', 'half-written'))
      await expect(store.revertAll()).rejects.toThrow(/still running/)
      expect(await read(file)).toBe(ORIGINAL.replace('Planets', 'half-written'))
    })

    it('sealing the batch as failed makes it revertible again (the abandon path)', async () => {
      const store = createSnapshotStore(root)
      await store.snapshotFiles([file], { id: 'ab-1', taskId: 'task-1' })
      await write(file, ORIGINAL.replace('Planets', 'half-written'))

      // releaseApplyTask seals 'failed' on abandon — now the guard passes and
      // undo restores the clean pre-apply bytes.
      await store.sealBatchByTask('task-1', { failed: true })
      const result = await store.revertBatch('ab-1')
      expect(result.reverted).toEqual([file])
      expect(await read(file)).toBe(ORIGINAL)
    })
  })

  describe('sealBatchByTask (the review hook seals by task, not batch id)', () => {
    it('seals the batch for a task and re-seals to the NEW bytes on a second review', async () => {
      const store = createSnapshotStore(root)
      await store.snapshotFiles([file], { id: 'ab-1', taskId: 'task-1' })

      // First agent run + review.
      const v1 = ORIGINAL.replace('Planets', 'Worlds')
      await write(file, v1)
      await store.sealBatchByTask('task-1')
      expect((await store.state()).batches[0].status).toBe('done')

      // Deny → re-apply: the SAME batch, the agent writes NEW bytes, review
      // fires again. Without a re-seal the undo guard would think v2 diverged.
      const v2 = ORIGINAL.replace('Planets', 'Galaxies')
      await write(file, v2)
      await store.sealBatchByTask('task-1')

      // The file is NOT diverged (the seal caught up to v2)…
      expect((await store.state()).files[file]?.status).toBe('clean')
      // …and undo restores the clean pre-apply bytes byte-for-byte.
      const result = await store.revertBatch('ab-1')
      expect(result.reverted).toEqual([file])
      expect(await read(file)).toBe(ORIGINAL)
    })

    it('is a no-op when no batch matches the task', async () => {
      const store = createSnapshotStore(root)
      await store.snapshotFiles([file], { id: 'ab-1', taskId: 'task-1' })
      await expect(store.sealBatchByTask('task-unknown')).resolves.toBeUndefined()
      expect((await store.state()).batches[0].status).toBe('running')
    })
  })
})

// A captured MFE block anchors host-project-root-relative (`../mfe-x/...`). The
// snapshot store must resolve that under the WORKSPACE root (like code-context)
// rather than throwing "escapes the project root" — otherwise cross-MFE undo is
// dead. Two MFEs sharing a package-local path stay distinct because the `../`
// paths differ.
describe('file-snapshots — workspace-aware (cross-MFE)', () => {
  let ws: string       // workspace (monorepo) root
  let host: string     // the running package = snapshot store's projectRoot

  beforeEach(async () => {
    ws = fs.mkdtempSync(path.join(os.tmpdir(), 'annotask-ws-'))
    await fsp.writeFile(path.join(ws, 'pnpm-workspace.yaml'), "packages:\n  - 'apps/*'\n", 'utf-8')
    host = path.join(ws, 'apps', 'host')
    for (const pkg of ['host', 'mfe-a', 'mfe-b']) {
      await fsp.mkdir(path.join(ws, 'apps', pkg, 'src'), { recursive: true })
      await fsp.writeFile(path.join(ws, 'apps', pkg, 'package.json'), JSON.stringify({ name: `@x/${pkg}` }), 'utf-8')
    }
    // Both MFEs expose the SAME package-local path — the collision the host
    // anchor disambiguates via `../mfe-a/...` vs `../mfe-b/...`.
    await fsp.writeFile(path.join(ws, 'apps', 'mfe-a', 'src', 'App.tsx'), 'A-ORIGINAL\n', 'utf-8')
    await fsp.writeFile(path.join(ws, 'apps', 'mfe-b', 'src', 'App.tsx'), 'B-ORIGINAL\n', 'utf-8')
  })

  afterEach(async () => { await fsp.rm(ws, { recursive: true, force: true }) })

  it('snapshots + byte-exact reverts two sibling MFEs that share a package-local path', async () => {
    const store = createSnapshotStore(host)
    const aRel = '../mfe-a/src/App.tsx'
    const bRel = '../mfe-b/src/App.tsx'
    await store.snapshotFiles([aRel, bRel], { id: 'ab-1', taskId: 't1' })

    // Both got distinct snapshot entries (the dedup hole would have collapsed them).
    const state = await store.state()
    expect(Object.keys(state.files).sort()).toEqual([aRel, bRel].sort())

    await fsp.writeFile(path.join(ws, 'apps', 'mfe-a', 'src', 'App.tsx'), 'A-EDITED\n', 'utf-8')
    await fsp.writeFile(path.join(ws, 'apps', 'mfe-b', 'src', 'App.tsx'), 'B-EDITED\n', 'utf-8')
    await store.sealBatch('ab-1')

    const result = await store.revertBatch('ab-1')
    expect(result.reverted.sort()).toEqual([aRel, bRel].sort())
    expect(result.skipped).toEqual([])
    expect(await fsp.readFile(path.join(ws, 'apps', 'mfe-a', 'src', 'App.tsx'), 'utf-8')).toBe('A-ORIGINAL\n')
    expect(await fsp.readFile(path.join(ws, 'apps', 'mfe-b', 'src', 'App.tsx'), 'utf-8')).toBe('B-ORIGINAL\n')
  })

  it('still refuses a target that escapes the workspace root (skips it, never throws)', async () => {
    const store = createSnapshotStore(host)
    // ../../../ escapes even the workspace root — must be skipped, not snapshotted.
    await store.snapshotFiles(['../../../../../../etc/hosts', '../mfe-a/src/App.tsx'], { id: 'ab-1', taskId: 't1' })
    const files = Object.keys((await store.state()).files)
    expect(files).toEqual(['../mfe-a/src/App.tsx'])
  })
})

// In a pnpm/yarn monorepo the git toplevel is the WORKSPACE root, not the
// package running the dev server. The baseline must survive that shape: git
// runs at the toplevel and repo-relative paths translate to projectRoot-
// relative (`../mfe-child/…`) — otherwise the auto-extend and created-net are
// silently OFF in exactly the multi-MFE topology they exist for.
describe('file-snapshots — monorepo git baseline (toplevel = workspace root)', () => {
  let ws: string       // workspace (monorepo) root = git toplevel
  let host: string     // the running package = snapshot store's projectRoot

  const git = (args: string[], cwd: string) => execFileSync('git', args, { cwd, stdio: 'ignore' })
  function gitInit(cwd: string): void {
    git(['init', '-q'], cwd)
    // Repo-level identity so `git stash create` (the baseline) can commit.
    git(['config', 'user.email', 'ci@annotask.test'], cwd)
    git(['config', 'user.name', 'annotask-ci'], cwd)
    git(['add', '-A'], cwd)
    git(['commit', '-q', '-m', 'baseline'], cwd)
  }

  beforeEach(async () => {
    ws = fs.mkdtempSync(path.join(os.tmpdir(), 'annotask-mono-'))
    await fsp.writeFile(path.join(ws, 'pnpm-workspace.yaml'), "packages:\n  - 'packages/*'\n", 'utf-8')
    host = path.join(ws, 'packages', 'host')
    for (const pkg of ['host', 'mfe-child']) {
      await fsp.mkdir(path.join(ws, 'packages', pkg, 'src'), { recursive: true })
      await fsp.writeFile(path.join(ws, 'packages', pkg, 'package.json'), JSON.stringify({ name: `@x/${pkg}` }), 'utf-8')
    }
    await fsp.writeFile(path.join(host, 'src', 'Page.vue'), 'HOST-ORIGINAL\n', 'utf-8')
    await fsp.writeFile(path.join(ws, 'packages', 'mfe-child', 'src', 'App.tsx'), 'CHILD-ORIGINAL\n', 'utf-8')
  })

  afterEach(async () => { await fsp.rm(ws, { recursive: true, force: true }) })

  it('seal auto-extends with a sibling-package file the agent edited; revert restores its bytes', async () => {
    gitInit(ws)
    const store = createSnapshotStore(host)
    // The apply predicts only the host anchor…
    await store.snapshotFiles(['src/Page.vue'], { id: 'ab-1', taskId: 't1' })
    // …but the agent edits the anchor AND a sibling MFE's file.
    await fsp.writeFile(path.join(host, 'src', 'Page.vue'), 'HOST-EDITED\n', 'utf-8')
    await fsp.writeFile(path.join(ws, 'packages', 'mfe-child', 'src', 'App.tsx'), 'CHILD-EDITED\n', 'utf-8')
    await store.sealBatch('ab-1')

    expect((await store.state()).batches[0].files).toContain('../mfe-child/src/App.tsx')

    const result = await store.revertBatch('ab-1')
    expect(result.reverted.sort()).toEqual(['../mfe-child/src/App.tsx', 'src/Page.vue'].sort())
    expect(result.skipped).toEqual([])
    expect(await fsp.readFile(path.join(host, 'src', 'Page.vue'), 'utf-8')).toBe('HOST-ORIGINAL\n')
    expect(await fsp.readFile(path.join(ws, 'packages', 'mfe-child', 'src', 'App.tsx'), 'utf-8')).toBe('CHILD-ORIGINAL\n')
  })

  it('nets agent-created files (untracked AND staged) with translated paths; undo deletes them', async () => {
    gitInit(ws)
    const store = createSnapshotStore(host)
    await store.snapshotFiles(['src/Page.vue'], { id: 'ab-1', taskId: 't1' })

    await fsp.writeFile(path.join(host, 'src', 'New.vue'), 'agent-new\n', 'utf-8')
    await fsp.writeFile(path.join(ws, 'packages', 'mfe-child', 'src', 'Staged.tsx'), 'agent-staged\n', 'utf-8')
    git(['add', 'packages/mfe-child/src/Staged.tsx'], ws)
    await store.sealBatch('ab-1')

    const created = (await store.state()).batches[0].created ?? []
    expect([...created].sort()).toEqual(['../mfe-child/src/Staged.tsx', 'src/New.vue'].sort())

    const result = await store.revertBatch('ab-1')
    expect(result.reverted).toContain('src/New.vue')
    expect(result.reverted).toContain('../mfe-child/src/Staged.tsx')
    expect(fs.existsSync(path.join(host, 'src', 'New.vue'))).toBe(false)
    expect(fs.existsSync(path.join(ws, 'packages', 'mfe-child', 'src', 'Staged.tsx'))).toBe(false)
  })

  it('the monorepo baseline survives a restart (gitToplevel persisted; a rehydrated store seals correctly)', async () => {
    gitInit(ws)
    const store = createSnapshotStore(host)
    await store.snapshotFiles(['src/Page.vue'], { id: 'ab-1', taskId: 't1' })
    await store.flush()

    await fsp.writeFile(path.join(ws, 'packages', 'mfe-child', 'src', 'App.tsx'), 'CHILD-EDITED\n', 'utf-8')

    // "Restart": a fresh store rehydrates the running batch and seals it —
    // the persisted toplevel must still key the path translation.
    const restarted = createSnapshotStore(host)
    await restarted.sealBatchByTask('t1')
    expect((await restarted.state()).batches[0].files).toContain('../mfe-child/src/App.tsx')

    const result = await restarted.revertBatch('ab-1')
    expect(result.reverted).toContain('../mfe-child/src/App.tsx')
    expect(await fsp.readFile(path.join(ws, 'packages', 'mfe-child', 'src', 'App.tsx'), 'utf-8')).toBe('CHILD-ORIGINAL\n')
  })

  it('refuses the baseline when the git toplevel is OUTSIDE the workspace root (anchors-only coverage)', async () => {
    // Git repo an ancestor of the workspace root — translated `../` paths
    // could escape containment, so the baseline must be refused (today's
    // conservative fallback: predicted anchor files only).
    const outer = fs.mkdtempSync(path.join(os.tmpdir(), 'annotask-outer-'))
    try {
      const wsRoot = path.join(outer, 'ws')
      const hostRoot = path.join(wsRoot, 'packages', 'host')
      for (const pkg of ['host', 'mfe-child']) {
        await fsp.mkdir(path.join(wsRoot, 'packages', pkg, 'src'), { recursive: true })
        await fsp.writeFile(path.join(wsRoot, 'packages', pkg, 'package.json'), JSON.stringify({ name: `@x/${pkg}` }), 'utf-8')
      }
      await fsp.writeFile(path.join(wsRoot, 'pnpm-workspace.yaml'), "packages:\n  - 'packages/*'\n", 'utf-8')
      await fsp.writeFile(path.join(hostRoot, 'src', 'Page.vue'), 'HOST-ORIGINAL\n', 'utf-8')
      await fsp.writeFile(path.join(wsRoot, 'packages', 'mfe-child', 'src', 'App.tsx'), 'CHILD-ORIGINAL\n', 'utf-8')
      gitInit(outer)

      const store = createSnapshotStore(hostRoot)
      await store.snapshotFiles(['src/Page.vue'], { id: 'ab-1', taskId: 't1' })
      await fsp.writeFile(path.join(hostRoot, 'src', 'Page.vue'), 'HOST-EDITED\n', 'utf-8')
      await fsp.writeFile(path.join(wsRoot, 'packages', 'mfe-child', 'src', 'App.tsx'), 'CHILD-EDITED\n', 'utf-8')
      await store.sealBatch('ab-1')

      // No auto-extend happened — the batch stayed anchors-only.
      expect((await store.state()).batches[0].files).toEqual(['src/Page.vue'])
      const result = await store.revertBatch('ab-1')
      expect(result.reverted).toEqual(['src/Page.vue'])
      expect(await fsp.readFile(path.join(hostRoot, 'src', 'Page.vue'), 'utf-8')).toBe('HOST-ORIGINAL\n')
      // The sibling edit is untouched (undo never claimed to cover it).
      expect(await fsp.readFile(path.join(wsRoot, 'packages', 'mfe-child', 'src', 'App.tsx'), 'utf-8')).toBe('CHILD-EDITED\n')
    } finally {
      await fsp.rm(outer, { recursive: true, force: true })
    }
  })
})
