import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { createProjectState, ensureAnnotaskIgnored } from '../state'
import { createTaskThreadStore } from '../task-thread'
import { assertTransition } from '../schemas'

function mkTmpRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'annotask-state-test-'))
}

const noopBroadcast = () => {}

describe('createProjectState — task store serialization', () => {
  let root: string
  beforeEach(() => { root = mkTmpRoot() })
  afterEach(async () => { await fsp.rm(root, { recursive: true, force: true }) })

  it('persists a single addTask', async () => {
    const state = createProjectState(root, noopBroadcast)
    const t = await state.addTask({ type: 'annotation', description: 'hello' }) as any
    expect(t.id).toMatch(/^task-/)
    expect(t.status).toBe('pending')
    // Round-trips through disk — flush completes in background after the
    // response resolves, so tests that read raw disk must drain first.
    await state.flush()
    const onDisk = JSON.parse(fs.readFileSync(path.join(root, '.annotask', 'tasks.json'), 'utf-8'))
    expect(onDisk.tasks).toHaveLength(1)
    expect(onDisk.tasks[0].id).toBe(t.id)
    state.dispose()
  })

  it('concurrent updateTask to disjoint fields does not lose writes', async () => {
    const state = createProjectState(root, noopBroadcast)
    const t = await state.addTask({ type: 'annotation', description: 'base' }) as any

    // Fire many concurrent updates to different fields. Before the mutex was added
    // these could interleave on the flush queue and drop earlier mutations.
    const updates = await Promise.all([
      state.updateTask(t.id, { description: 'A' }),
      state.updateTask(t.id, { feedback: 'B' }),
      state.updateTask(t.id, { resolution: 'C' }),
      state.updateTask(t.id, { notes: 'D' }),
      state.updateTask(t.id, { blocked_reason: 'E' }),
    ])
    for (const u of updates) expect((u as any).error).toBeUndefined()

    const tasks = state.getTasks().tasks
    expect(tasks).toHaveLength(1)
    const final = tasks[0]
    expect(final.description).toBe('A')
    expect(final.feedback).toBe('B')
    expect(final.resolution).toBe('C')
    expect(final.notes).toBe('D')
    expect(final.blocked_reason).toBe('E')

    // Disk agrees with memory.
    await state.flush()
    const onDisk = JSON.parse(fs.readFileSync(path.join(root, '.annotask', 'tasks.json'), 'utf-8'))
    expect(onDisk.tasks[0]).toMatchObject({
      description: 'A', feedback: 'B', resolution: 'C', notes: 'D', blocked_reason: 'E',
    })
    state.dispose()
  })

  it('concurrent addTasks all persist with unique ids', async () => {
    const state = createProjectState(root, noopBroadcast)
    const N = 25
    const added = await Promise.all(
      Array.from({ length: N }, (_, i) => state.addTask({ type: 'annotation', description: `t${i}` }))
    )
    const ids = new Set(added.map((t: any) => t.id))
    expect(ids.size).toBe(N)

    const tasks = state.getTasks().tasks
    expect(tasks).toHaveLength(N)
    await state.flush()
    const onDisk = JSON.parse(fs.readFileSync(path.join(root, '.annotask', 'tasks.json'), 'utf-8'))
    expect(onDisk.tasks).toHaveLength(N)
    state.dispose()
  })

  it('concurrent delete + update on same task does not corrupt the store', async () => {
    const state = createProjectState(root, noopBroadcast)
    const t = await state.addTask({ type: 'annotation', description: 'base' }) as any

    // Whichever wins the lock first, the second must see a consistent state.
    const [a, b] = await Promise.all([
      state.deleteTask(t.id),
      state.updateTask(t.id, { description: 'late' }),
    ])
    // One op succeeded, the other got "not found" — never both success, never both fail.
    const successes = [a, b].filter(r => (r as any).error === undefined)
    const notFound = [a, b].filter(r => (r as any).error === 'Task not found')
    expect(successes).toHaveLength(1)
    expect(notFound).toHaveLength(1)

    expect(state.getTasks().tasks).toHaveLength(0)
    await state.flush()
    state.dispose()
  })

  it('accepted task is removed and its screenshot file is unlinked', async () => {
    const state = createProjectState(root, noopBroadcast)
    // Create a screenshot that matches SAFE_SCREENSHOT_RE
    const shotDir = path.join(root, '.annotask', 'screenshots')
    await fsp.mkdir(shotDir, { recursive: true })
    const shotName = 'screenshot-test-1.png'
    await fsp.writeFile(path.join(shotDir, shotName), Buffer.from([0x89, 0x50, 0x4e, 0x47]))

    const t = await state.addTask({ type: 'annotation', description: 'x', screenshot: shotName }) as any
    await state.updateTask(t.id, { status: 'in_progress' })
    await state.updateTask(t.id, { status: 'review' })
    await state.updateTask(t.id, { status: 'accepted' })

    // Screenshot unlink chains off the flush, so wait for disk work to settle.
    await state.flush()
    expect(state.getTasks().tasks).toHaveLength(0)
    expect(fs.existsSync(path.join(shotDir, shotName))).toBe(false)
    state.dispose()
  })

  it('deleteTask unlinks screenshot but ignores unsafe filenames', async () => {
    const state = createProjectState(root, noopBroadcast)
    const shotDir = path.join(root, '.annotask', 'screenshots')
    await fsp.mkdir(shotDir, { recursive: true })
    const safeName = 'screenshot-safe.png'
    await fsp.writeFile(path.join(shotDir, safeName), Buffer.from([0x89]))
    // A file that an attacker-controlled task might have referenced with a traversal name.
    // isSafeScreenshot should refuse to touch it, so unlink is a no-op.
    const sensitive = path.join(root, 'sensitive.txt')
    await fsp.writeFile(sensitive, 'keep me')

    const safe = await state.addTask({ type: 'annotation', description: 'a', screenshot: safeName }) as any
    const unsafe = await state.addTask({ type: 'annotation', description: 'b', screenshot: '../sensitive.txt' }) as any

    await state.deleteTask(safe.id)
    await state.deleteTask(unsafe.id)

    await state.flush()
    expect(fs.existsSync(path.join(shotDir, safeName))).toBe(false)
    expect(fs.existsSync(sensitive)).toBe(true)
    state.dispose()
  })

  it('updateTask on a missing id returns error without corrupting state', async () => {
    const state = createProjectState(root, noopBroadcast)
    const r = await state.updateTask('task-nonexistent', { status: 'in_progress' })
    expect(r).toEqual({ error: 'Task not found' })
    expect(state.getTasks().tasks).toHaveLength(0)
    state.dispose()
  })

  it('addTaskUsage accumulates token usage on the task', async () => {
    const state = createProjectState(root, noopBroadcast)
    const t = await state.addTask({ type: 'annotation', description: 'usage test' }) as any

    const first = await state.addTaskUsage(t.id, {
      inputTokens: 100,
      outputTokens: 40,
      cacheReadTokens: 5,
    })
    expect(first).not.toBeNull()
    expect(first!.inputTokens).toBe(100)
    expect(first!.outputTokens).toBe(40)
    expect(first!.cacheReadTokens).toBe(5)
    expect(first!.turns).toBe(1)
    expect(first!.lastUpdated).toBeGreaterThan(0)

    const second = await state.addTaskUsage(t.id, {
      inputTokens: 200,
      outputTokens: 80,
      cacheCreationTokens: 10,
    })
    expect(second!.inputTokens).toBe(300)
    expect(second!.outputTokens).toBe(120)
    expect(second!.cacheReadTokens).toBe(5)
    expect(second!.cacheCreationTokens).toBe(10)
    expect(second!.turns).toBe(2)

    const snap = state.getTasks().tasks[0] as any
    expect(snap.tokenUsage.turns).toBe(2)
    expect(snap.tokenUsage.inputTokens).toBe(300)
    await state.flush()
    state.dispose()
  })

  it('addTaskUsage returns null for unknown task ids (silently no-ops)', async () => {
    const state = createProjectState(root, noopBroadcast)
    const result = await state.addTaskUsage('task-does-not-exist', { inputTokens: 1, outputTokens: 1 })
    expect(result).toBeNull()
    await state.flush()
    state.dispose()
  })

  it('quarantines a corrupt tasks.json before falling back to empty', async () => {
    const dir = path.join(root, '.annotask')
    fs.mkdirSync(dir, { recursive: true })
    const corruptBytes = '{"version":"1.0","tasks":[{"id":"task-trunc'
    fs.writeFileSync(path.join(dir, 'tasks.json'), corruptBytes)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const state = createProjectState(root, noopBroadcast)
    expect(state.getTasks().tasks).toHaveLength(0)

    // The corrupt original is preserved next to tasks.json so the next
    // mutation's atomic flush can't silently destroy it.
    const quarantined = fs.readdirSync(dir).filter(f => f.startsWith('tasks.json.corrupt-'))
    expect(quarantined).toHaveLength(1)
    expect(fs.readFileSync(path.join(dir, quarantined[0]), 'utf-8')).toBe(corruptBytes)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('quarantined'))
    warn.mockRestore()
    state.dispose()
  })

  it('does not quarantine when tasks.json simply does not exist', async () => {
    const state = createProjectState(root, noopBroadcast)
    expect(state.getTasks().tasks).toHaveLength(0)
    const dir = path.join(root, '.annotask')
    const entries = fs.existsSync(dir) ? fs.readdirSync(dir) : []
    expect(entries.filter(f => f.includes('corrupt'))).toHaveLength(0)
    state.dispose()
  })

  it('updateTask guard runs inside the lock — concurrent transition race has exactly one winner', async () => {
    const state = createProjectState(root, noopBroadcast)
    const t = await state.addTask({ type: 'annotation', description: 'race' }) as any

    // Both callers validated `pending → in_progress` before queuing (the old
    // pre-lock check would let both through). The guard re-asserts against
    // the task as it exists under the mutex, so the second sees in_progress.
    const guard = (task: Record<string, unknown>) => assertTransition(task.status, 'in_progress')
    const [a, b] = await Promise.all([
      state.updateTask(t.id, { status: 'in_progress' }, { guard }),
      state.updateTask(t.id, { status: 'in_progress' }, { guard }),
    ]) as any[]

    const winners = [a, b].filter(r => r.error === undefined)
    const losers = [a, b].filter(r => r.error === 'Invalid transition')
    expect(winners).toHaveLength(1)
    expect(losers).toHaveLength(1)
    expect(losers[0].reason).toContain('Invalid state transition')
    expect(state.getTasks().tasks[0].status).toBe('in_progress')
    await state.flush()
    state.dispose()
  })

  it('a rejected guard leaves the task untouched', async () => {
    const state = createProjectState(root, noopBroadcast)
    const t = await state.addTask({ type: 'annotation', description: 'guarded' }) as any
    const r = await state.updateTask(t.id, { status: 'accepted' }, {
      guard: (task) => assertTransition(task.status, 'accepted'),
    }) as any
    expect(r.error).toBe('Invalid transition')
    const snap = state.getTasks().tasks[0]
    expect(snap.status).toBe('pending')
    // The accepted-branch cleanup must not have removed the task.
    expect(state.getTasks().tasks).toHaveLength(1)
    await state.flush()
    state.dispose()
  })

  it('loads an existing tasks.json on first read', async () => {
    const dir = path.join(root, '.annotask')
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'tasks.json'), JSON.stringify({
      version: '1.0',
      tasks: [{ id: 'task-existing', type: 'annotation', description: 'preloaded', status: 'pending' }],
    }))

    const state = createProjectState(root, noopBroadcast)
    const snapshot = state.getTasks()
    expect(snapshot.tasks).toHaveLength(1)
    expect(snapshot.tasks[0].id).toBe('task-existing')

    // Mutation should preserve the preloaded task.
    await state.addTask({ type: 'annotation', description: 'added' })
    expect(state.getTasks().tasks).toHaveLength(2)
    state.dispose()
  })
})

describe('transcript cleanup (onTaskRemoved → taskThread.clear)', () => {
  let root: string
  beforeEach(() => { root = mkTmpRoot() })
  afterEach(async () => { await fsp.rm(root, { recursive: true, force: true }) })

  /** Wire state + thread store the way src/server/index.ts does. */
  function makeWiredState() {
    const taskThread = createTaskThreadStore({ projectRoot: root })
    const state = createProjectState(root, noopBroadcast, {
      onTaskRemoved: (taskId) => { void taskThread.clear(taskId) },
    })
    return { state, taskThread }
  }

  function transcriptPath(taskId: string): string {
    return path.join(root, '.annotask', 'conversations', `${taskId}.jsonl`)
  }

  /** The unlink chains off the flush continuation — poll briefly. */
  async function waitGone(p: string): Promise<boolean> {
    for (let i = 0; i < 40; i++) {
      if (!fs.existsSync(p)) return true
      await new Promise(r => setTimeout(r, 25))
    }
    return !fs.existsSync(p)
  }

  it('removes the conversation transcript when a task is accepted', async () => {
    const { state, taskThread } = makeWiredState()
    const t = await state.addTask({ type: 'annotation', description: 'chatty' }) as any
    await taskThread.append(t.id, { role: 'user', content: 'please fix' })
    expect(fs.existsSync(transcriptPath(t.id))).toBe(true)

    await state.updateTask(t.id, { status: 'in_progress' })
    await state.updateTask(t.id, { status: 'review' })
    await state.updateTask(t.id, { status: 'accepted' })
    await state.flush()

    expect(await waitGone(transcriptPath(t.id))).toBe(true)
    state.dispose()
  })

  it('removes the conversation transcript when a task is deleted', async () => {
    const { state, taskThread } = makeWiredState()
    const t = await state.addTask({ type: 'annotation', description: 'doomed' }) as any
    await taskThread.append(t.id, { role: 'user', content: 'never mind' })
    expect(fs.existsSync(transcriptPath(t.id))).toBe(true)

    await state.deleteTask(t.id)
    await state.flush()

    expect(await waitGone(transcriptPath(t.id))).toBe(true)
    state.dispose()
  })

  it('does not fire onTaskRemoved for plain status updates', async () => {
    const removed: string[] = []
    const state = createProjectState(root, noopBroadcast, {
      onTaskRemoved: (id) => { removed.push(id) },
    })
    const t = await state.addTask({ type: 'annotation', description: 'alive' }) as any
    await state.updateTask(t.id, { status: 'in_progress' })
    await state.flush()
    expect(removed).toHaveLength(0)
    state.dispose()
  })
})

describe('ensureAnnotaskIgnored', () => {
  let root: string
  beforeEach(() => { root = mkTmpRoot() })
  afterEach(async () => { await fsp.rm(root, { recursive: true, force: true }) })

  const gitignorePath = () => path.join(root, '.gitignore')

  it('appends a .annotask/ entry once when the project is a git repo', () => {
    fs.mkdirSync(path.join(root, '.git'))
    fs.writeFileSync(gitignorePath(), 'node_modules/\n')

    ensureAnnotaskIgnored(root)
    const after = fs.readFileSync(gitignorePath(), 'utf-8')
    expect(after).toContain('node_modules/')
    expect(after).toContain('.annotask/')

    // Idempotent — a second boot must not duplicate the entry.
    ensureAnnotaskIgnored(root)
    const matches = fs.readFileSync(gitignorePath(), 'utf-8').match(/^\.annotask\/$/gm)
    expect(matches).toHaveLength(1)
  })

  it('creates .gitignore when missing and handles a file without trailing newline', () => {
    fs.mkdirSync(path.join(root, '.git'))
    ensureAnnotaskIgnored(root)
    expect(fs.readFileSync(gitignorePath(), 'utf-8')).toContain('.annotask/')

    // No-trailing-newline case: the entry must land on its own line.
    fs.writeFileSync(gitignorePath(), 'dist')
    ensureAnnotaskIgnored(root)
    expect(fs.readFileSync(gitignorePath(), 'utf-8')).toMatch(/^dist\n/)
    expect(fs.readFileSync(gitignorePath(), 'utf-8').match(/^\.annotask\/$/gm)).toHaveLength(1)
  })

  it('respects existing entry variants (.annotask, /.annotask/)', () => {
    fs.mkdirSync(path.join(root, '.git'))
    for (const variant of ['.annotask', '/.annotask/', '.annotask/']) {
      fs.writeFileSync(gitignorePath(), `${variant}\n`)
      ensureAnnotaskIgnored(root)
      expect(fs.readFileSync(gitignorePath(), 'utf-8')).toBe(`${variant}\n`)
    }
  })

  it('does nothing outside a git repo', () => {
    ensureAnnotaskIgnored(root)
    expect(fs.existsSync(gitignorePath())).toBe(false)
  })

  it('runs on createProjectState boot', () => {
    fs.mkdirSync(path.join(root, '.git'))
    const state = createProjectState(root, noopBroadcast)
    expect(fs.readFileSync(gitignorePath(), 'utf-8')).toContain('.annotask/')
    state.dispose()
  })
})

describe('wireframe-snapshot GC (boot sweep)', () => {
  let root: string

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'annotask-wfgc-'))
  })

  afterEach(async () => {
    await fsp.rm(root, { recursive: true, force: true })
  })

  it('removes stale orphaned PNGs; keeps referenced and recent files', async () => {
    const dir = path.join(root, '.annotask', 'wireframe-snapshots')
    await fsp.mkdir(dir, { recursive: true })
    await fsp.writeFile(path.join(root, '.annotask', 'wireframe.json'), JSON.stringify({
      version: '1.0', updatedAt: 1, rev: 1,
      routes: [{
        route: '/planets', instances: [],
        canvas: {
          capturedAt: 1,
          viewport: { width: 1280, height: 800, docWidth: 1280, docHeight: 2400, scale: 2 },
          fullImage: 'wf-full-1.png',
          blocks: [{
            id: 'wfb-1', kind: 'captured', rect: { x: 0, y: 0, width: 100, height: 50 }, z: 1, createdAt: 1,
            anchor: { file: 'a.vue', line: 1 }, originalRect: { x: 0, y: 0, width: 100, height: 50 },
            image: 'wfb-1.png',
          }],
        },
      }],
    }))
    const old = new Date(Date.now() - 2 * 60 * 60 * 1000)
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47])
    for (const name of ['wfb-1.png', 'wf-full-1.png', 'orphan-old.png', 'orphan-fresh.png']) {
      await fsp.writeFile(path.join(dir, name), png)
    }
    await fsp.utimes(path.join(dir, 'orphan-old.png'), old, old)
    // Referenced files keep their (old) mtime too — reference beats age.
    await fsp.utimes(path.join(dir, 'wfb-1.png'), old, old)

    const state = createProjectState(root, noopBroadcast)
    // The sweep is fire-and-forget — give it a few ticks to finish.
    await new Promise((r) => setTimeout(r, 250))
    state.dispose()

    expect(fs.existsSync(path.join(dir, 'wfb-1.png')), 'referenced block image kept').toBe(true)
    expect(fs.existsSync(path.join(dir, 'wf-full-1.png')), 'referenced full image kept').toBe(true)
    expect(fs.existsSync(path.join(dir, 'orphan-fresh.png')), 'recent orphan kept (mtime guard)').toBe(true)
    expect(fs.existsSync(path.join(dir, 'orphan-old.png')), 'stale orphan removed').toBe(false)
  })

  it('aborts entirely on a malformed wireframe.json — an unreadable doc must never read as "no references"', async () => {
    const dir = path.join(root, '.annotask', 'wireframe-snapshots')
    await fsp.mkdir(dir, { recursive: true })
    await fsp.writeFile(path.join(root, '.annotask', 'wireframe.json'), '{ truncated json')
    const old = new Date(Date.now() - 2 * 60 * 60 * 1000)
    await fsp.writeFile(path.join(dir, 'maybe-referenced.png'), Buffer.from([0x89]))
    await fsp.utimes(path.join(dir, 'maybe-referenced.png'), old, old)

    const state = createProjectState(root, noopBroadcast)
    await new Promise((r) => setTimeout(r, 250))
    state.dispose()

    expect(fs.existsSync(path.join(dir, 'maybe-referenced.png'))).toBe(true)
  })
})
