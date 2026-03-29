import fs from 'node:fs'
import path from 'node:path'

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
  dispose: () => void
}

export function createProjectState(projectRoot: string, broadcast: (event: string, data: unknown) => void): ProjectState {
  let cachedDesignSpec: unknown = null
  let specWatcher: fs.FSWatcher | null = null
  const tasksPath = path.join(projectRoot, '.annotask', 'tasks.json')

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
        })
      } catch { cachedDesignSpec = null }
    }
    return cachedDesignSpec ?? DEFAULT_DESIGN_SPEC
  }

  function getConfig(): unknown {
    const spec = getDesignSpec() as any
    return { initialized: !!spec?.initialized, ...spec }
  }

  function readTasks(): { version: string; tasks: any[] } {
    try { return JSON.parse(fs.readFileSync(tasksPath, 'utf-8')) } catch { return { version: '1.0', tasks: [] } }
  }

  function writeTasks(data: { version: string; tasks: any[] }) {
    const dir = path.dirname(tasksPath)
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(tasksPath, JSON.stringify(data, null, 2))
  }

  function addTask(task: Record<string, unknown>) {
    const data = readTasks()
    const id = `task-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
    const newTask = { id, status: 'pending', createdAt: Date.now(), updatedAt: Date.now(), ...task }
    data.tasks.push(newTask)
    writeTasks(data)
    broadcast('tasks:updated', data)
    return newTask
  }

  function updateTask(id: string, updates: Record<string, unknown>) {
    const data = readTasks()
    const task = data.tasks.find((t: any) => t.id === id)
    if (!task) return { error: 'Task not found' }
    Object.assign(task, updates, { updatedAt: Date.now() })
    if (updates.status === 'accepted') data.tasks = data.tasks.filter((t: any) => t.id !== id)
    writeTasks(data)
    broadcast('tasks:updated', data)
    return task
  }

  function dispose() {
    if (specWatcher) { specWatcher.close(); specWatcher = null }
  }

  return { getDesignSpec, getConfig, getTasks: readTasks, addTask, updateTask, dispose }
}
