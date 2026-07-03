import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { isSafeScreenshot } from './validation.js'
import { createRuntimeEndpointStore, type RuntimeEndpointStore } from './runtime-endpoints.js'
import { createAgentConfigStore } from './agent-configs.js'
import type { AgentConfigs, AgentConfigEntry } from './agent-configs.js'
import { createWireframeStore } from './wireframe-store.js'
import { createSessionStore } from './session-store.js'
import type { NetworkCall, RuntimeEndpointCatalog, TokenUsage } from '../schema.js'
import { isWireframeDocument, type WireframeDocument } from '../shared/wireframe-types.js'
import { emptyDesignSessionDocument, type DesignSessionDocument } from '../shared/design-session-types.js'

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
  /**
   * Update a task. `opts.guard` runs INSIDE the task lock against the task as
   * it exists at update time — the HTTP layer passes its status-transition
   * assert here so two concurrent PATCHes can't both pass a pre-lock check
   * (TOCTOU). A non-null guard return aborts the update and surfaces as
   * `{ error: 'Invalid transition', reason }`.
   */
  updateTask: (
    id: string,
    updates: Record<string, unknown>,
    opts?: { guard?: (task: Record<string, unknown>) => string | null },
  ) => Promise<unknown>
  /**
   * Increment a task's `tokenUsage` rollup. Called from the task-thread store's
   * onAppend hook when an assistant turn lands with usage. Silently no-ops on
   * unknown task ids — the conversation log can outlive the task record
   * (e.g. an accepted task is removed while a late-arriving usage event is
   * still in flight).
   */
  addTaskUsage: (id: string, usage: Partial<TokenUsage>) => Promise<TokenUsage | null>
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
  /** Read per-persona project directions from `.annotask/agents.json`. */
  getAgentConfigs: () => Promise<AgentConfigs>
  /** Write one persona's project directions and return the updated file. */
  setAgentConfig: (personaId: string, entry: Partial<AgentConfigEntry>) => Promise<AgentConfigs>
  /** Read the persisted multi-route wireframe document (`.annotask/wireframe.json`). */
  getWireframe: () => Promise<WireframeDocument>
  /** Replace the wireframe document, persist atomically, broadcast, and return it. */
  setWireframe: (doc: WireframeDocument) => Promise<WireframeDocument>
  /** Read the persisted design-session journal (`.annotask/design-session.json`). */
  getDesignSession: () => Promise<DesignSessionDocument>
  /** Replace the design-session journal (CAS on rev), broadcast, and return it. */
  setDesignSession: (doc: DesignSessionDocument) => Promise<DesignSessionDocument>
  /** Server-owned reset to an empty session (discard / accept-all) — not CAS-gated. */
  clearDesignSession: () => Promise<DesignSessionDocument>
  /** Wait for any pending writes to complete. Use before process shutdown. */
  flush: () => Promise<void>
  /**
   * Health of the tasks.json disk-write path. Mutations reply 200 before the
   * fire-and-forget flush lands, so a failing disk write would otherwise lose
   * data silently — this lets `/api/status` report `persistence: 'degraded'`.
   */
  getPersistenceHealth: () => PersistenceHealth
  dispose: () => void
}

export interface PersistenceHealth {
  ok: boolean
  consecutiveFailures: number
  lastError: string | null
}

function clampNonNeg(n: number | undefined): number {
  if (n == null || !Number.isFinite(n) || n < 0) return 0
  return n
}

/** Atomic write: write to tmp file then rename into place. Exported so other
 *  `.annotask/` writers (init commit/skip) share the same crash-safe pattern
 *  instead of racing the sync readers here with a plain writeFile. */
export async function atomicWrite(filePath: string, data: string) {
  const dir = path.dirname(filePath)
  await fsp.mkdir(dir, { recursive: true })
  const tmpPath = filePath + `.tmp.${process.pid}.${Date.now()}`
  await fsp.writeFile(tmpPath, data, 'utf-8')
  await fsp.rename(tmpPath, filePath)
}

/**
 * Best-effort: make sure `.annotask/` is gitignored. Transcripts
 * (conversations/*.jsonl), screenshots, and sidecars accumulate under
 * `.annotask/` — before this helper the only thing keeping them out of
 * commits was an instruction inside the LLM skill text. Only touches
 * projects that have a `.git` (dir or worktree file), appends exactly once,
 * and never throws — a read-only checkout must not break server boot.
 */
export function ensureAnnotaskIgnored(projectRoot: string): void {
  try {
    if (!fs.existsSync(path.join(projectRoot, '.git'))) return
    const gitignorePath = path.join(projectRoot, '.gitignore')
    let existing = ''
    try { existing = fs.readFileSync(gitignorePath, 'utf-8') } catch { /* no .gitignore yet */ }
    // Already covered when any line is `.annotask` / `.annotask/` / `/.annotask/`.
    if (/^\/?\.annotask\/?\s*$/m.test(existing)) return
    const prefix = existing.length > 0 && !existing.endsWith('\n') ? '\n' : ''
    fs.appendFileSync(gitignorePath, `${prefix}# Annotask local data (tasks, screenshots, conversation transcripts)\n.annotask/\n`, 'utf-8')
  } catch { /* best-effort — never block boot */ }
}

export interface ProjectStateOptions {
  /**
   * Fired when `design-spec.json` disappears from disk (the file is unlinked
   * outside the normal init write flow). Used by the init runner to drop its
   * in-memory step state — the wizard's "all green checkmarks from last run"
   * survives a `rm -rf .annotask/*` until something tells it the world has
   * changed.
   */
  onSpecCleared?: () => void
  /**
   * Fired after a task leaves the store for good (accepted or deleted) and
   * the removal has been flushed to disk. Lets the server clean per-task
   * sidecars state.ts doesn't own — today the conversation transcript
   * (`.annotask/conversations/<id>.jsonl`, owned by the task-thread store).
   * Screenshot / interaction-history / rendered-html cleanup stays in here.
   */
  onTaskRemoved?: (taskId: string) => void
}

export function createProjectState(
  projectRoot: string,
  broadcast: (event: string, data: unknown) => void,
  options: ProjectStateOptions = {},
): ProjectState {
  let cachedDesignSpec: unknown = null
  let specWatcher: fs.FSWatcher | null = null
  // Canonical boot-time spot for keeping `.annotask/` out of version control —
  // every server entry (Vite plugin, Webpack plugin, standalone) constructs a
  // project state exactly once.
  ensureAnnotaskIgnored(projectRoot)
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
  // Flush-failure tracking — see getPersistenceHealth.
  let flushFailureCount = 0
  let lastFlushError: string | null = null

  function loadTasksFromDisk(): { version: string; tasks: any[] } {
    try {
      const parsed = JSON.parse(fs.readFileSync(tasksPath, 'utf-8'))
      // Tolerate a bare-array file (hand-written resets, older tooling) and
      // a missing `tasks` key — a wrong-shape parse would otherwise crash
      // the first addTask() and take the whole dev server down with it.
      if (Array.isArray(parsed)) return { version: '1.0', tasks: parsed }
      if (!Array.isArray(parsed?.tasks)) return { version: parsed?.version ?? '1.0', tasks: [] }
      return parsed
    } catch (err) {
      // Distinguish "no file yet" (normal first boot) from a corrupt-but-
      // recoverable file. Falling back to empty is fine in memory, but the
      // next mutation's atomic flush would overwrite the corrupt file with
      // `[]` — quarantine a copy first so the user (or an agent) can hand-
      // recover the tasks. Best-effort: a failed copy never blocks boot.
      if (fs.existsSync(tasksPath)) {
        const quarantinePath = `${tasksPath}.corrupt-${new Date().toISOString().replace(/[:.]/g, '-')}`
        try {
          fs.copyFileSync(tasksPath, quarantinePath)
          console.warn(`[Annotask] tasks.json is unreadable (${(err as Error).message}) — quarantined a copy at ${quarantinePath}`)
        } catch { /* best-effort */ }
      }
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
      flushFailureCount = 0
      lastFlushError = null
    }).catch(err => {
      // The HTTP response already went out before this write ran, so a failure
      // here is silent data loss across restarts — track it for /api/status.
      flushFailureCount += 1
      lastFlushError = err instanceof Error ? err.message : String(err)
      console.error(`[Annotask] task flush failed (${flushFailureCount} consecutive) — task changes are NOT being persisted to ${tasksPath}:`, err)
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
      // Honor the file's own `initialized` field. The init wizard sets it
      // to `true` only when the user explicitly commits — an agent-written
      // spec that hasn't been accepted yet has no `initialized` key and
      // should keep the wizard open (defaults to false, not true).
      const normalized = normalizeDesignSpec(parsed)
      cachedDesignSpec = { initialized: parsed.initialized === true, ...normalized }
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
            // If the file is gone entirely (user wiped .annotask/), tell the
            // init runner to drop its remembered "all steps done" state so the
            // wizard reopens cleanly without checkmarks from the last run.
            // fs.watch fires before/around the write, so check synchronously.
            try {
              fs.statSync(specPath)
            } catch {
              options.onSpecCleared?.()
            }
          }
          if (filename === 'tasks.json') {
            // Ignore events caused by our own atomic writes.
            if (Date.now() < selfWriteUntil) return
            // External edit — drop cache so the next read picks up the disk version.
            taskCache = null
          }
          if (filename === 'wireframe.json') {
            // Ignore our own atomic writes; on a genuine external edit tell live
            // listeners to re-load (the store reads fresh, so no cache to clear).
            if (Date.now() < wireframeSelfWriteUntil) return
            broadcast('wireframe:updated', null)
          }
          if (filename === 'design-session.json') {
            if (Date.now() < sessionSelfWriteUntil) return
            broadcast('session:updated', null)
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

  async function updateTask(
    id: string,
    updates: Record<string, unknown>,
    opts: { guard?: (task: Record<string, unknown>) => string | null } = {},
  ) {
    return withTaskLock(async () => {
      const data = getTasksSnapshot()
      const task = data.tasks.find((t: any) => t.id === id)
      if (!task) return { error: 'Task not found' }
      // Run the caller's guard against the task as it exists NOW, under the
      // lock. The HTTP/MCP boundaries validate transitions before queuing,
      // but that check races concurrent updates — this one can't.
      if (opts.guard) {
        const reason = opts.guard(task)
        if (reason) return { error: 'Invalid transition', reason }
      }
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
      // the write fails. Appended to the flush chain (not awaited here) — the
      // response goes out as soon as the in-memory state is consistent, but
      // flush() still covers the cleanup's disk work.
      if (screenshotToUnlink || sidecarsToClean) {
        taskFlushChain = flushed.then(async () => {
          if (screenshotToUnlink) await unlinkScreenshot(screenshotToUnlink)
          if (sidecarsToClean) {
            await cleanTaskSidecars(sidecarsToClean)
            options.onTaskRemoved?.(sidecarsToClean)
          }
        }).catch(() => { /* cleanup is best-effort */ })
      }
      broadcast('tasks:updated', data)
      return task
    })
  }

  async function addTaskUsage(id: string, usage: Partial<TokenUsage>): Promise<TokenUsage | null> {
    return withTaskLock(async () => {
      const data = getTasksSnapshot()
      const task = data.tasks.find((t: any) => t.id === id)
      if (!task) return null
      const prev: TokenUsage = task.tokenUsage ?? {
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        turns: 0,
        lastUpdated: 0,
      }
      const next: TokenUsage = {
        inputTokens: prev.inputTokens + clampNonNeg(usage.inputTokens),
        outputTokens: prev.outputTokens + clampNonNeg(usage.outputTokens),
        cacheReadTokens: prev.cacheReadTokens + clampNonNeg(usage.cacheReadTokens),
        cacheCreationTokens: prev.cacheCreationTokens + clampNonNeg(usage.cacheCreationTokens),
        turns: prev.turns + 1,
        lastUpdated: Date.now(),
      }
      task.tokenUsage = next
      task.updatedAt = Date.now()
      void queueFlushTasks(data)
      broadcast('tasks:updated', data)
      return next
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
      taskFlushChain = flushed.then(async () => {
        if (screenshotToUnlink) await unlinkScreenshot(screenshotToUnlink)
        await cleanTaskSidecars(id)
        options.onTaskRemoved?.(id)
      }).catch(() => { /* cleanup is best-effort */ })
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

  // ── Agent configs (.annotask/agents.json) ──
  const agentConfigStore = createAgentConfigStore(projectRoot)

  // ── Wireframe document (.annotask/wireframe.json) ──
  const wireframeStore = createWireframeStore(projectRoot)
  // Watcher fires on our own rename; skip events within this window after a self-write.
  let wireframeSelfWriteUntil = 0

  // Boot-time GC for canvas snapshot PNGs: failed uploads, crashed sessions,
  // and recapture races strand files no doc references. Boot is the only safe
  // moment (no in-flight upload can race a fresh process); the mtime guard
  // keeps anything recent enough to plausibly belong to a just-written doc.
  void (async () => {
    const dir = path.join(projectRoot, '.annotask', 'wireframe-snapshots')
    let names: string[]
    try { names = await fsp.readdir(dir) } catch { return }
    if (names.length === 0) return
    // Read the doc RAW: the store's get() falls back to an EMPTY document on
    // a malformed file, and "empty references" would let the sweep nuke every
    // legitimately-referenced PNG. A doc that exists but doesn't validate
    // aborts the GC; a doc that doesn't exist leaves only true orphans.
    const referenced = new Set<string>()
    try {
      const raw = await fsp.readFile(path.join(projectRoot, '.annotask', 'wireframe.json'), 'utf-8')
      let doc: unknown
      try { doc = JSON.parse(raw) } catch { return }
      if (!isWireframeDocument(doc)) return
      for (const route of doc.routes) {
        if (!route.canvas) continue
        for (const b of route.canvas.blocks) if (b.image) referenced.add(b.image)
        if (route.canvas.fullImage) referenced.add(route.canvas.fullImage)
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') return
      // No doc at all → every PNG is an orphan; the mtime guard still applies.
    }
    const cutoff = Date.now() - 60 * 60 * 1000
    let removed = 0
    for (const name of names) {
      if (referenced.has(name) || !name.endsWith('.png')) continue
      const p = path.join(dir, name)
      try {
        const st = await fsp.stat(p)
        if (st.mtimeMs >= cutoff) continue
        await fsp.unlink(p)
        removed++
      } catch { /* best effort */ }
    }
    if (removed > 0) console.warn(`[Annotask] wireframe-snapshot GC removed ${removed} orphaned file(s)`)
  })()

  async function setWireframe(doc: WireframeDocument): Promise<WireframeDocument> {
    wireframeSelfWriteUntil = Date.now() + 500
    const saved = await wireframeStore.set(doc)
    wireframeSelfWriteUntil = Date.now() + 500
    // Notify live listeners (other shells/tabs) so they re-load without polling.
    broadcast('wireframe:updated', saved)
    return saved
  }

  // ── Design-session journal (.annotask/design-session.json) ──
  const sessionStore = createSessionStore(projectRoot)
  let sessionSelfWriteUntil = 0

  async function setDesignSession(doc: DesignSessionDocument): Promise<DesignSessionDocument> {
    sessionSelfWriteUntil = Date.now() + 500
    const saved = await sessionStore.set(doc)
    sessionSelfWriteUntil = Date.now() + 500
    broadcast('session:updated', saved)
    return saved
  }

  async function clearDesignSession(): Promise<DesignSessionDocument> {
    sessionSelfWriteUntil = Date.now() + 500
    const fresh = emptyDesignSessionDocument(`ds-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`)
    fresh.startedAt = Date.now()
    fresh.updatedAt = Date.now()
    // Server-owned reset — bypasses CAS so discard works from any tab state.
    const saved = await sessionStore.replace(fresh)
    sessionSelfWriteUntil = Date.now() + 500
    broadcast('session:updated', saved)
    return saved
  }

  // ── Runtime endpoint catalog ──
  const runtimeEndpoints: RuntimeEndpointStore = createRuntimeEndpointStore(projectRoot)
  // The iframe posts a network-call batch roughly every ~1s, and the shell's
  // only listener (`useDataSources.ts`) ignores the broadcast payload and
  // re-fetches via GET on receipt — so broadcasting the full catalog (up to
  // MAX_ENDPOINTS rows) on every single ingest was pure waste over the WS.
  // Throttle to a lightweight `{ updatedAt }` signal instead; listeners that
  // want the data already re-fetch it themselves.
  const RUNTIME_BROADCAST_THROTTLE_MS = 1000
  let runtimeBroadcastTimer: NodeJS.Timeout | null = null

  function sendRuntimeBroadcast(): void {
    broadcast('runtime-endpoints:updated', { updatedAt: runtimeEndpoints.getCatalog().updatedAt })
  }

  function scheduleRuntimeBroadcast(): void {
    if (runtimeBroadcastTimer) return
    runtimeBroadcastTimer = setTimeout(() => {
      runtimeBroadcastTimer = null
      sendRuntimeBroadcast()
    }, RUNTIME_BROADCAST_THROTTLE_MS)
    runtimeBroadcastTimer.unref?.()
  }

  function ingestNetworkCalls(calls: NetworkCall[]): void {
    runtimeEndpoints.ingest(calls)
    // Notify any live WebSocket listeners so the Data view can update without
    // polling. Event name mirrors the existing 'tasks:updated' broadcast.
    scheduleRuntimeBroadcast()
  }

  function getRuntimeEndpointCatalog(): RuntimeEndpointCatalog {
    return runtimeEndpoints.getCatalog()
  }

  function clearRuntimeEndpoints(): void {
    runtimeEndpoints.clear()
    // A deliberate, infrequent action — send immediately rather than riding
    // the throttle, and drop any pending throttled broadcast so it can't
    // fire right after with stale-looking (but harmless, since the payload
    // is just a timestamp) timing.
    if (runtimeBroadcastTimer) { clearTimeout(runtimeBroadcastTimer); runtimeBroadcastTimer = null }
    sendRuntimeBroadcast()
  }

  async function flush() {
    // Covers the Vite-plugin dev-server path too, PROVIDED something calls
    // state.flush()/dispose() on shutdown — today that wiring exists for the
    // standalone/proxy server entries (see standalone.ts, proxy-serve.ts)
    // but the Vite plugin's configureServer() never calls flush()/dispose()
    // on server close, so a burst of runtime-endpoint writes right before an
    // in-process dev-server restart can still be lost there. That gap lives
    // in src/plugin/index.ts, outside this file.
    await Promise.allSettled([taskLock, taskFlushChain, perfLock, runtimeEndpoints.flush()])
  }

  function dispose() {
    if (specWatcher) { specWatcher.close(); specWatcher = null }
    if (runtimeBroadcastTimer) { clearTimeout(runtimeBroadcastTimer); runtimeBroadcastTimer = null }
  }

  return {
    getDesignSpec,
    getConfig,
    getTasks: getTasksSnapshot,
    addTask,
    updateTask,
    addTaskUsage,
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
    getAgentConfigs: agentConfigStore.get,
    setAgentConfig: agentConfigStore.set,
    getWireframe: wireframeStore.get,
    setWireframe,
    getDesignSession: sessionStore.get,
    setDesignSession,
    clearDesignSession,
    flush,
    getPersistenceHealth: () => ({
      ok: flushFailureCount === 0,
      consecutiveFailures: flushFailureCount,
      lastError: lastFlushError,
    }),
    dispose,
  }
}
