import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { isSafeScreenshot } from './validation.js'

const DEFAULT_DESIGN_SPEC = {
  initialized: false,
  version: '1.0' as const,
  framework: null,
  colors: [],
  typography: { families: [], scale: [], weights: [] },
  spacing: [],
  borders: { radius: [] },
  icons: null,
  components: null,
}

export interface ProjectState {
  getDesignSpec: () => unknown
  getConfig: () => unknown
  getTasks: () => { version: string; tasks: any[] }
  addTask: (task: Record<string, unknown>) => Promise<unknown>
  updateTask: (id: string, updates: Record<string, unknown>) => Promise<unknown>
  deleteTask: (id: string) => Promise<unknown>
  getPerformanceSnapshot: () => unknown
  setPerformanceSnapshot: (data: unknown) => void
  /** Wait for any pending writes to complete. Use before process shutdown. */
  flush: () => Promise<void>
  dispose: () => void
}

/** Atomic write: write to tmp file then rename into place */
async function atomicWrite(filePath: string, data: string) {
  const dir = path.dirname(filePath)
  await fsp.mkdir(dir, { recursive: true })
  const tmpPath = filePath + `.tmp.${process.pid}.${Date.now()}`
  await fsp.writeFile(tmpPath, data, 'utf-8')
  await fsp.rename(tmpPath, filePath)
}

export function createProjectState(projectRoot: string, broadcast: (event: string, data: unknown) => void): ProjectState {
  let cachedDesignSpec: unknown = null
  let specWatcher: fs.FSWatcher | null = null
  const tasksPath = path.join(projectRoot, '.annotask', 'tasks.json')
  const screenshotsDir = path.join(projectRoot, '.annotask', 'screenshots')

  // In-memory task cache — all mutations serialize through taskLock so reads and writes can't interleave.
  let taskCache: { version: string; tasks: any[] } | null = null
  let taskLock: Promise<unknown> = Promise.resolve()
  // Watcher fires on our own rename; skip events within this window after a self-write.
  let selfWriteUntil = 0

  function loadTasksFromDisk(): { version: string; tasks: any[] } {
    try {
      return JSON.parse(fs.readFileSync(tasksPath, 'utf-8'))
    } catch {
      return { version: '1.0', tasks: [] }
    }
  }

  function getTasksSnapshot(): { version: string; tasks: any[] } {
    if (!taskCache) taskCache = loadTasksFromDisk()
    return taskCache
  }

  /** Serialize mutations. Each op sees the final state of the previous op. */
  function withTaskLock<T>(fn: () => Promise<T> | T): Promise<T> {
    const run = taskLock.then(() => fn())
    taskLock = run.catch(() => { /* isolate: next op should still run */ })
    return run
  }

  async function flushTasks(data: { version: string; tasks: any[] }) {
    // Reserve a window during which the fs.watch callback should ignore its own write event.
    // rename() can emit watch events asynchronously, so widen the window a bit past the write.
    selfWriteUntil = Date.now() + 500
    await atomicWrite(tasksPath, JSON.stringify(data, null, 2))
    selfWriteUntil = Date.now() + 500
  }

  function screenshotPathIfSafe(name: unknown): string | null {
    if (!isSafeScreenshot(name)) return null
    return path.join(screenshotsDir, name)
  }

  async function unlinkScreenshot(name: unknown): Promise<void> {
    const p = screenshotPathIfSafe(name)
    if (!p) return
    try { await fsp.unlink(p) } catch { /* file may already be gone */ }
  }

  function getDesignSpec(): unknown {
    if (cachedDesignSpec !== null) return cachedDesignSpec
    const specPath = path.join(projectRoot, '.annotask', 'design-spec.json')
    try {
      cachedDesignSpec = { initialized: true, ...JSON.parse(fs.readFileSync(specPath, 'utf-8')) }
    } catch {
      cachedDesignSpec = DEFAULT_DESIGN_SPEC
    }
    if (!specWatcher) {
      const configDir = path.join(projectRoot, '.annotask')
      try {
        if (!fs.existsSync(configDir)) fs.mkdirSync(configDir, { recursive: true })
        specWatcher = fs.watch(configDir, (_, filename) => {
          if (filename === 'design-spec.json') {
            cachedDesignSpec = null
            broadcast('designspec:updated', null)
          }
          if (filename === 'tasks.json') {
            // Ignore events caused by our own atomic writes.
            if (Date.now() < selfWriteUntil) return
            // External edit — drop cache so the next read picks up the disk version.
            taskCache = null
          }
        })
      } catch { cachedDesignSpec = null }
    }
    return cachedDesignSpec ?? DEFAULT_DESIGN_SPEC
  }

  function getConfig(): unknown {
    const spec = getDesignSpec() as any
    return { initialized: !!spec?.initialized, ...spec }
  }

  async function addTask(task: Record<string, unknown>) {
    return withTaskLock(async () => {
      const data = getTasksSnapshot()
      const id = `task-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
      const newTask = { ...task, id, status: 'pending' as const, createdAt: Date.now(), updatedAt: Date.now() }
      data.tasks.push(newTask)
      await flushTasks(data)
      broadcast('tasks:updated', data)
      return newTask
    })
  }

  async function updateTask(id: string, updates: Record<string, unknown>) {
    return withTaskLock(async () => {
      const data = getTasksSnapshot()
      const task = data.tasks.find((t: any) => t.id === id)
      if (!task) return { error: 'Task not found' }
      Object.assign(task, updates, { updatedAt: Date.now() })
      let screenshotToUnlink: unknown = null
      if (updates.status === 'accepted') {
        screenshotToUnlink = task.screenshot
        data.tasks = data.tasks.filter((t: any) => t.id !== id)
      }
      await flushTasks(data)
      // Unlink after the write succeeds so the screenshot isn't deleted if the write fails.
      if (screenshotToUnlink) await unlinkScreenshot(screenshotToUnlink)
      broadcast('tasks:updated', data)
      return task
    })
  }

  async function deleteTask(id: string) {
    return withTaskLock(async () => {
      const data = getTasksSnapshot()
      const task = data.tasks.find((t: any) => t.id === id)
      if (!task) return { error: 'Task not found' }
      const screenshotToUnlink = task.screenshot
      data.tasks = data.tasks.filter((t: any) => t.id !== id)
      await flushTasks(data)
      if (screenshotToUnlink) await unlinkScreenshot(screenshotToUnlink)
      broadcast('tasks:updated', data)
      return { deleted: id }
    })
  }

  // ── Performance snapshot ──
  const perfPath = path.join(projectRoot, '.annotask', 'performance.json')
  let perfSnapshot: unknown = null
  let perfLock: Promise<unknown> = Promise.resolve()

  function getPerformanceSnapshot(): unknown {
    if (perfSnapshot !== null) return perfSnapshot
    try { perfSnapshot = JSON.parse(fs.readFileSync(perfPath, 'utf-8')) } catch {}
    return perfSnapshot
  }

  function setPerformanceSnapshot(data: unknown) {
    perfSnapshot = data
    const run = perfLock.then(() => atomicWrite(perfPath, JSON.stringify(data, null, 2)))
    perfLock = run.catch(() => {})
  }

  async function flush() {
    await Promise.allSettled([taskLock, perfLock])
  }

  function dispose() {
    if (specWatcher) { specWatcher.close(); specWatcher = null }
  }

  return {
    getDesignSpec,
    getConfig,
    getTasks: getTasksSnapshot,
    addTask,
    updateTask,
    deleteTask,
    getPerformanceSnapshot,
    setPerformanceSnapshot,
    flush,
    dispose,
  }
}
