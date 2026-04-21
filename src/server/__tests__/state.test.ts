import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { createProjectState } from '../state'

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
