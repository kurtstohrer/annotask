import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { isSafeScreenshot } from './validation.js'
import { createRuntimeEndpointStore, type RuntimeEndpointStore } from './runtime-endpoints.js'
import type { NetworkCall, RuntimeEndpointCatalog } from '../schema.js'

const DEFAULT_DESIGN_SPEC = {
  initialized: false,
  version: '1.0' as const,
  framework: null,
  themes: [],
  defaultTheme: 'default',
  colors: [],
  typography: { families: [], scale: [], weights: [] },
  spacing: [],
  borders: { radius: [] },
  icons: null,
  components: null,
}

/**
 * Upgrade a design-spec read from disk to the variant-aware shape.
 *
 * Old specs stored one resolved value per token as `value: string`. The new
 * shape is `values: Record<themeId, string>`. Normalization wraps any legacy
 * value into `{ [defaultId]: value }` and synthesizes a single `default` theme
 * when the spec has no `themes` array, so the Theme page can key everything by
 * theme id uniformly.
 */
function normalizeDesignSpec(raw: any): any {
  if (!raw || typeof raw !== 'object') return raw
  const themes = Array.isArray(raw.themes) && raw.themes.length > 0
    ? raw.themes
    : [{ id: 'default', name: 'Default', selector: { kind: 'default' } }]
  const defaultTheme = raw.defaultTheme || themes[0].id
  const defaultId = defaultTheme

  function normalizeToken(tok: any): any {
    if (!tok || typeof tok !== 'object') return tok
    if (tok.values && typeof tok.values === 'object') return tok
    if (typeof tok.value === 'string') {
      const { value, ...rest } = tok
      return { ...rest, values: { [defaultId]: value } }
    }
    return { ...tok, values: {} }
  }

  function normalizeArr(arr: any): any[] {
    return Array.isArray(arr) ? arr.map(normalizeToken) : []
  }

  return {
    ...raw,
    themes,
    defaultTheme,
    colors: normalizeArr(raw.colors),
    typography: {
      families: normalizeArr(raw?.typography?.families),
      scale: normalizeArr(raw?.typography?.scale),
      weights: Array.isArray(raw?.typography?.weights) ? raw.typography.weights : [],
    },
    spacing: normalizeArr(raw.spacing),
    borders: {
      radius: normalizeArr(raw?.borders?.radius),
    },
  }
}

export interface ProjectState {
  getDesignSpec: () => unknown
  getConfig: () => unknown
  getTasks: () => { version: string; tasks: any[] }
  addTask: (task: Record<string, unknown>) => Promise<unknown>
  updateTask: (id: string, updates: Record<string, unknown>) => Promise<unknown>
  deleteTask: (id: string) => Promise<unknown>
  /** Persist per-task interaction history alongside tasks.json so agents can
   *  fetch it on demand even when the user didn't embed it in the task payload. */
  saveInteractionHistory: (taskId: string, snapshot: unknown) => Promise<void>
  readInteractionHistory: (taskId: string) => Promise<unknown | null>
  /** Same contract for the selected element's rendered outerHTML. */
  saveRenderedHtml: (taskId: string, html: string) => Promise<void>
  readRenderedHtml: (taskId: string) => Promise<string | null>
  getPerformanceSnapshot: () => unknown
  setPerformanceSnapshot: (data: unknown) => void
  /** Ingest a batch of iframe-captured network calls into the runtime endpoint catalog. */
  ingestNetworkCalls: (calls: NetworkCall[]) => void
  /** Read the aggregated runtime endpoint catalog. */
  getRuntimeEndpointCatalog: () => RuntimeEndpointCatalog
  /** Drop the runtime endpoint catalog (in-memory + on-disk). */
  clearRuntimeEndpoints: () => void
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
  const interactionHistoryDir = path.join(projectRoot, '.annotask', 'interaction-history')
  const renderedHtmlDir = path.join(projectRoot, '.annotask', 'rendered-html')

  // Matches the `task-${Date.now()}-${random}` shape minted by addTask. Used as
  // a defense-in-depth check on task-id before concatenating it into a sidecar
  // path — the HTTP / MCP layers already validate, but this keeps the filesystem
  // touchpoint safe against any caller wiring up state directly in tests.
  const SAFE_TASK_ID = /^task-[A-Za-z0-9_-]+$/

  function sidecarPath(dir: string, taskId: string): string | null {
    if (!SAFE_TASK_ID.test(taskId)) return null
    return path.join(dir, `${taskId}.json`)
  }

  async function writeSidecar(dir: string, taskId: string, data: unknown): Promise<void> {
    const p = sidecarPath(dir, taskId)
    if (!p) return
    await atomicWrite(p, JSON.stringify(data, null, 2))
  }

  async function readSidecar<T>(dir: string, taskId: string): Promise<T | null> {
    const p = sidecarPath(dir, taskId)
    if (!p) return null
    try {
      const raw = await fsp.readFile(p, 'utf-8')
      return JSON.parse(raw) as T
    } catch {
      return null
    }
  }

  async function unlinkSidecar(dir: string, taskId: string): Promise<void> {
    const p = sidecarPath(dir, taskId)
    if (!p) return
    try { await fsp.unlink(p) } catch { /* already gone */ }
  }

  async function saveInteractionHistory(taskId: string, snapshot: unknown): Promise<void> {
    await writeSidecar(interactionHistoryDir, taskId, snapshot)
  }

  async function readInteractionHistory(taskId: string): Promise<unknown | null> {
    return readSidecar(interactionHistoryDir, taskId)
  }

  async function saveRenderedHtml(taskId: string, html: string): Promise<void> {
    // Sidecar stores a wrapper so future fields (e.g. captured_at, selector)
    // can slot in without breaking readers.
    await writeSidecar(renderedHtmlDir, taskId, { html, captured_at: Date.now() })
  }

  async function readRenderedHtml(taskId: string): Promise<string | null> {
    const rec = await readSidecar<{ html?: unknown }>(renderedHtmlDir, taskId)
    if (rec && typeof rec.html === 'string') return rec.html
    return null
  }

  async function cleanTaskSidecars(taskId: string): Promise<void> {
    await Promise.allSettled([
      unlinkSidecar(interactionHistoryDir, taskId),
      unlinkSidecar(renderedHtmlDir, taskId),
    ])
  }

  // In-memory task cache — all mutations serialize through taskLock so reads and writes can't interleave.
  let taskCache: { version: string; tasks: any[] } | null = null
  let taskLock: Promise<unknown> = Promise.resolve()
  // Disk-flush serialization. Mutations respond as soon as the in-memory cache
  // is updated; the rename-based atomic write runs on this chain so concurrent
  // writes can't interleave temp files. Failures are logged but don't fail the
  // response — the client has already seen the new state via the WS broadcast
  // and the next mutation's flush will pick up the full state anyway.
  let taskFlushChain: Promise<unknown> = Promise.resolve()
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

  // Pre-warm the cache so the first POST doesn't pay for a sync readFileSync
  // on the request path. Uncached reads are cheap at boot but stack up under
  // burst creates right after restart.
  getTasksSnapshot()

  /** Serialize mutations. Each op sees the final state of the previous op. */
  function withTaskLock<T>(fn: () => Promise<T> | T): Promise<T> {
    const run = taskLock.then(() => fn())
    taskLock = run.catch(() => { /* isolate: next op should still run */ })
    return run
  }

  /**
   * Fire-and-forget the disk write. JSON serialization happens synchronously
   * here so the payload reflects THIS caller's view even if later mutations
   * mutate `data` in-place before the write starts. Returns a promise so
   * callers that need ordering (e.g. screenshot unlink after a successful
   * accept-write) can chain off it without blocking the response.
   */
  function queueFlushTasks(data: { version: string; tasks: any[] }): Promise<void> {
    const payload = JSON.stringify(data, null, 2)
    const run = taskFlushChain.then(async () => {
      // Reserve a window during which the fs.watch callback should ignore its own write event.
      // rename() can emit watch events asynchronously, so widen the window a bit past the write.
      selfWriteUntil = Date.now() + 500
      await atomicWrite(tasksPath, payload)
      selfWriteUntil = Date.now() + 500
    }).catch(err => {
      console.warn('[Annotask] task flush failed:', err)
    })
    taskFlushChain = run
    return run
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
      const parsed = JSON.parse(fs.readFileSync(specPath, 'utf-8'))
      cachedDesignSpec = { initialized: true, ...normalizeDesignSpec(parsed) }
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
      // Flush in background. Clients see the update through the WS broadcast
      // below; the disk write persists behind the response.
      void queueFlushTasks(data)
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
      let sidecarsToClean: string | null = null
      if (updates.status === 'accepted') {
        screenshotToUnlink = task.screenshot
        sidecarsToClean = id
        data.tasks = data.tasks.filter((t: any) => t.id !== id)
      }
      const flushed = queueFlushTasks(data)
      // Unlink after the write succeeds so the screenshot isn't deleted if
      // the write fails. Chained off the flush, but not awaited — response
      // goes out as soon as the in-memory state is consistent.
      if (screenshotToUnlink) void flushed.then(() => unlinkScreenshot(screenshotToUnlink))
      if (sidecarsToClean) void flushed.then(() => cleanTaskSidecars(sidecarsToClean!))
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
      const flushed = queueFlushTasks(data)
      if (screenshotToUnlink) void flushed.then(() => unlinkScreenshot(screenshotToUnlink))
      void flushed.then(() => cleanTaskSidecars(id))
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

  // ── Runtime endpoint catalog ──
  const runtimeEndpoints: RuntimeEndpointStore = createRuntimeEndpointStore(projectRoot)

  function ingestNetworkCalls(calls: NetworkCall[]): void {
    runtimeEndpoints.ingest(calls)
    // Notify any live WebSocket listeners so the Data view can update without
    // polling. Event name mirrors the existing 'tasks:updated' broadcast.
    broadcast('runtime-endpoints:updated', runtimeEndpoints.getCatalog())
  }

  function getRuntimeEndpointCatalog(): RuntimeEndpointCatalog {
    return runtimeEndpoints.getCatalog()
  }

  function clearRuntimeEndpoints(): void {
    runtimeEndpoints.clear()
    broadcast('runtime-endpoints:updated', runtimeEndpoints.getCatalog())
  }

  async function flush() {
    await Promise.allSettled([taskLock, taskFlushChain, perfLock, runtimeEndpoints.flush()])
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
    saveInteractionHistory,
    readInteractionHistory,
    saveRenderedHtml,
    readRenderedHtml,
    getPerformanceSnapshot,
    setPerformanceSnapshot,
    ingestNetworkCalls,
    getRuntimeEndpointCatalog,
    clearRuntimeEndpoints,
    flush,
    dispose,
  }
}
