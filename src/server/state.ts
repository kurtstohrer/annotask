import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'

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
  addTask: (task: Record<string, unknown>) => unknown
  updateTask: (id: string, updates: Record<string, unknown>) => unknown
  deleteTask: (id: string) => unknown
  getPerformanceSnapshot: () => unknown
  setPerformanceSnapshot: (data: unknown) => void
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

  // In-memory task cache — loaded once from disk, written back atomically on mutation
  let taskCache: { version: string; tasks: any[] } | null = null
  let writeQueue: Promise<void> = Promise.resolve()

  function loadTasksSync(): { version: string; tasks: any[] } {
    if (taskCache) return taskCache
    try {
      taskCache = JSON.parse(fs.readFileSync(tasksPath, 'utf-8'))
    } catch {
      taskCache = { version: '1.0', tasks: [] }
    }
    return taskCache!
  }

  /** Queue an atomic write so concurrent mutations don't race */
  function flushTasks() {
    const data = taskCache
    if (!data) return
    writeQueue = writeQueue
      .then(() => atomicWrite(tasksPath, JSON.stringify(data, null, 2)))
      .catch(() => { /* write errors are non-fatal for the in-memory state */ })
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
          cachedDesignSpec = null
          if (filename === 'design-spec.json') broadcast('designspec:updated', null)
          if (filename === 'tasks.json') {
            // External edit — reload from disk
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

  function addTask(task: Record<string, unknown>) {
    const data = loadTasksSync()
    const id = `task-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
    const newTask = { ...task, id, status: 'pending' as const, createdAt: Date.now(), updatedAt: Date.now() }
    data.tasks.push(newTask)
    flushTasks()
    broadcast('tasks:updated', data)
    return newTask
  }

  function updateTask(id: string, updates: Record<string, unknown>) {
    const data = loadTasksSync()
    const task = data.tasks.find((t: any) => t.id === id)
    if (!task) return { error: 'Task not found' }
    Object.assign(task, updates, { updatedAt: Date.now() })
    if (updates.status === 'accepted') {
      if (task.screenshot && /^[a-zA-Z0-9_-]+\.png$/.test(task.screenshot)) {
        const screenshotPath = path.join(projectRoot, '.annotask', 'screenshots', task.screenshot)
        fsp.unlink(screenshotPath).catch(() => {})
      }
      data.tasks = data.tasks.filter((t: any) => t.id !== id)
    }
    flushTasks()
    broadcast('tasks:updated', data)
    return task
  }

  function deleteTask(id: string) {
    const data = loadTasksSync()
    const task = data.tasks.find((t: any) => t.id === id)
    if (!task) return { error: 'Task not found' }
    if (task.screenshot && /^[a-zA-Z0-9_-]+\.png$/.test(task.screenshot)) {
      const screenshotPath = path.join(projectRoot, '.annotask', 'screenshots', task.screenshot)
      fsp.unlink(screenshotPath).catch(() => {})
    }
    data.tasks = data.tasks.filter((t: any) => t.id !== id)
    flushTasks()
    broadcast('tasks:updated', data)
    return { deleted: id }
  }

  // ── Performance snapshot ──
  const perfPath = path.join(projectRoot, '.annotask', 'performance.json')
  let perfSnapshot: unknown = null

  function getPerformanceSnapshot(): unknown {
    if (perfSnapshot !== null) return perfSnapshot
    try { perfSnapshot = JSON.parse(fs.readFileSync(perfPath, 'utf-8')) } catch {}
    return perfSnapshot
  }

  function setPerformanceSnapshot(data: unknown) {
    perfSnapshot = data
    writeQueue = writeQueue
      .then(() => atomicWrite(perfPath, JSON.stringify(data, null, 2)))
      .catch(() => {})
  }

  function dispose() {
    if (specWatcher) { specWatcher.close(); specWatcher = null }
  }

  return { getDesignSpec, getConfig, getTasks: loadTasksSync, addTask, updateTask, deleteTask, getPerformanceSnapshot, setPerformanceSnapshot, dispose }
}
