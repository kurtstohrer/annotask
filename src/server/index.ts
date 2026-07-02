import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Duplex } from 'node:stream'
import { createAPIMiddleware } from './api.js'
import { createWSServer, type AnnotaskWSServer } from './ws-server.js'
import { createShellMiddleware } from './serve-shell.js'
import { createProjectState, type ProjectState } from './state.js'
import { createMcpMiddleware } from '../mcp/server.js'
import { onCatalogRefreshed, scanComponentLibraries } from './component-scanner.js'
import { createTaskThreadStore } from './task-thread.js'
import { createAgentSpawnHandler } from './agent-spawn.js'
import { createAgentDetector } from './agent-detect.js'
import { createInitRunner } from './init.js'
import { createUsageLedger } from './usage-ledger.js'
import { createSnapshotStore } from './file-snapshots.js'
import { releaseApplyTask, type ApplySessionOptions } from './apply-session.js'

export interface AnnotaskServer {
  middleware: (req: IncomingMessage, res: ServerResponse, next: () => void) => void
  handleUpgrade: (req: IncomingMessage, socket: Duplex, head: Buffer) => void
  broadcast: (event: string, data: unknown) => void
  getReport: () => unknown
  /** Await any pending task/perf writes. Call before dispose to avoid losing the last write. */
  flush: () => Promise<void>
  dispose: () => void
}

export interface AnnotaskServerOptions {
  projectRoot: string
  /** Extra HTTP endpoints to probe for OpenAPI / GraphQL schemas. */
  apiSchemaUrls?: string[]
  /** Extra project-relative schema file paths. */
  apiSchemaFiles?: string[]
  /** Hostnames allowed in the Host header beyond localhost / IP literals —
   *  the host the server announces plus any user-configured allowed hosts.
   *  A function because the bind host is only known once listening starts. */
  allowedHosts?: () => readonly string[]
}

export function createAnnotaskServer(options: AnnotaskServerOptions): AnnotaskServer {
  const wsServer = createWSServer()
  // Forward-declared so state.ts can notify the init runner when its source
  // of truth (design-spec.json) is unlinked, and the task-thread store when a
  // task is removed for good. Both are built below; until then these are
  // no-op callbacks.
  let onSpecCleared: () => void = () => { /* set below */ }
  let onTaskRemoved: (taskId: string) => void = () => { /* set below */ }
  const state = createProjectState(options.projectRoot, wsServer.broadcast, {
    onSpecCleared: () => onSpecCleared(),
    onTaskRemoved: (taskId) => onTaskRemoved(taskId),
  })
  // Embedded-chat moving parts: per-task message log, subprocess streamer,
  // CLI-detection probe. All scoped to this server instance so a single
  // dispose() tears them down cleanly.
  // Project-wide token usage ledger. Used by:
  //   - task-thread onAppend (every assistant turn that carries usage)
  //   - init runner (token totals reported by the local CLI on finish)
  // It's an append-only JSONL so external tooling can `tail -f` and so the
  // shell, CLI, and MCP all read the same canonical record.
  const usageLedger = createUsageLedger({ projectRoot: options.projectRoot })
  const taskThread = createTaskThreadStore({
    projectRoot: options.projectRoot,
    onAppend: (taskId, msg) => {
      // Only assistant turns carry usage; user/tool messages are no-ops here.
      const u = msg.usage
      if (!u) return
      // Fire-and-forget (must not block the SSE response) but surface failures:
      // the usage ledger is the only audit trail for autonomous-agent spend, so
      // a silent disk/permission error would let accounting drift unnoticed.
      void state.addTaskUsage(taskId, {
        inputTokens: u.inputTokens,
        outputTokens: u.outputTokens,
        cacheReadTokens: u.cacheReadTokens ?? 0,
        cacheCreationTokens: u.cacheCreationTokens ?? 0,
      }).catch((err) => {
        // eslint-disable-next-line no-console
        console.warn(`[annotask] addTaskUsage failed for task ${taskId}:`, err)
      })
      void usageLedger.append({
        scope: 'task',
        taskId,
        ts: msg.ts,
        providerId: msg.providerId,
        model: msg.model,
        inputTokens: u.inputTokens,
        outputTokens: u.outputTokens,
        cacheReadTokens: u.cacheReadTokens,
        cacheCreationTokens: u.cacheCreationTokens,
        estimated: u.estimated,
      }).catch((err) => {
        // eslint-disable-next-line no-console
        console.warn(`[annotask] usage ledger append failed for task ${taskId}:`, err)
      })
    },
  })
  // Transcript cleanup: accept/delete clean every other per-task sidecar
  // (screenshot, interaction-history, rendered-html) inside state.ts, but the
  // conversation transcript lives in the thread store — clear it here, the
  // one layer that holds both. Fires after the task removal hits disk.
  onTaskRemoved = (taskId) => {
    void taskThread.clear(taskId)
  }
  // Orphaned-task reconcile. When an agent run ends (child exit) but the
  // orchestrating client never transitioned the task — e.g. the tab closed
  // mid-run, or the client crashed before its finalizing PATCH — the task is
  // left locked in `in_progress` (the spawn registry kills the *process* but
  // can't fix the *status*). We relinquish the lock back to `pending` so the
  // task is retryable instead of stranded. The transition guard runs INSIDE
  // the task lock, so a client transition that's merely slow still wins the
  // race rather than being clobbered (guard rejects → we no-op).
  function reconcileOrphanedTask(taskId: string, why: string): void {
    // Capture the type BEFORE the update — a wireframe_apply orphan needs its
    // apply batch sealed + entries released + canvas unlocked, exactly as the
    // HTTP in_progress→pending hook does. This path bypasses the HTTP handler,
    // so without the same closure the batch would stay 'running' and wedge
    // undo/discard/re-apply.
    const before = state.getTasks().tasks.find((t: { id?: string }) => t?.id === taskId) as { type?: string } | undefined
    void state.updateTask(
      taskId,
      { status: 'pending' },
      { guard: (t) => (t.status === 'in_progress' ? null : 'task already finalized') },
    ).then(async (res) => {
      // Guard rejected (client won the race) → nothing to report.
      if (res && typeof res === 'object' && 'error' in res) return
      // eslint-disable-next-line no-console
      console.warn(`[annotask] reconciled orphaned task ${taskId} → pending (${why})`)
      void finalizeFrozenPartial(taskId)
      if (before?.type === 'wireframe_apply') {
        try { await releaseApplyTask(applyOptions, taskId) }
        catch (err) {
          // eslint-disable-next-line no-console
          console.warn(`[annotask] orphan apply-release failed for ${taskId}:`, err)
        }
      }
    }).catch((err) => {
      // eslint-disable-next-line no-console
      console.warn(`[annotask] orphan reconcile failed for task ${taskId}:`, err)
    })
  }
  /**
   * A detached apply run exited cleanly (code 0) but its client never flipped
   * the status — the orchestrating tab reloaded/closed mid-run while the CLI
   * (kept alive by the spawn detach-grace) finished and wrote the files. Land
   * the task in `review` (the state the client would have set) so completed
   * work isn't reverted to `pending` and re-applied. Guarded to in_progress so
   * a returning client that finalizes first still wins.
   */
  function finalizeDetachedReview(taskId: string): void {
    void state.updateTask(
      taskId,
      { status: 'review', resolution: 'Applied by the embedded agent; finalized server-side after the tab was closed or reloaded mid-run. Review the changes.' },
      { guard: (t) => (t.status === 'in_progress' ? null : 'task already finalized') },
    ).then((res) => {
      if (res && typeof res === 'object' && 'error' in res) return
      // eslint-disable-next-line no-console
      console.warn(`[annotask] finalized detached run ${taskId} → review (clean exit)`)
      void finalizeFrozenPartial(taskId)
    }).catch((err) => {
      // eslint-disable-next-line no-console
      console.warn(`[annotask] detached review finalize failed for task ${taskId}:`, err)
    })
  }
  /**
   * Clear a stuck `isPartial:true` assistant turn left behind when the
   * streaming client vanished mid-run (only the client run loop ever clears it,
   * so without this the Conversation tab shows a turn frozen mid-stream
   * forever). Best-effort.
   */
  async function finalizeFrozenPartial(taskId: string): Promise<void> {
    try {
      const msgs = await taskThread.read(taskId)
      for (let i = msgs.length - 1; i >= 0; i--) {
        if (msgs[i].isPartial) {
          await taskThread.update(taskId, msgs[i].id, { isPartial: false })
          break
        }
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(`[annotask] clearing frozen partial failed for task ${taskId}:`, err)
    }
  }
  // The registry reports every run end; we grace-check a moment later (a normal
  // completion's client review/pending PATCH lands well within this window, so
  // it no-ops) and, if the task is still `in_progress`, finalize it. A child
  // that exited on its own with code 0 finished the apply (the client just
  // never flipped status — e.g. its tab reloaded) → land in `review`. Anything
  // else — a non-zero exit, or a child WE killed (detach-grace expiry, abort,
  // duration backstop) — reverts to `pending` so it stays retryable.
  // wireframe_apply always takes the pending path: its apply-batch lifecycle is
  // reconciled there and a server-side review flip would bypass it.
  const ORPHAN_FINALIZE_GRACE_MS = 12_000
  function scheduleOrphanFinalize(taskId: string, info: { killed: boolean; exitCode: number | null }): void {
    setTimeout(() => {
      const task = state.getTasks().tasks.find((t: { id?: string; status?: string; type?: string }) => t?.id === taskId)
      if (!task || task.status !== 'in_progress') return
      // A NEWER run already owns this task (a re-spawn landed in the window
      // between this run's child-exit — which cleared the byTask reservation —
      // and this delayed callback). Our finalize is stale: flipping the task
      // now would clobber the live run mid-edit. Bail and let that run finalize
      // itself. The finalizer is otherwise run-identity-unaware (it keys only
      // on taskId + status), so this guard is what prevents the clobber.
      if (agentSpawn.registry.taskRunning(taskId)) return
      const cleanCompletion = !info.killed && info.exitCode === 0 && task.type !== 'wireframe_apply'
      if (cleanCompletion) {
        finalizeDetachedReview(taskId)
      } else {
        reconcileOrphanedTask(taskId, info.killed ? 'run interrupted' : 'client never finalized')
      }
    }, ORPHAN_FINALIZE_GRACE_MS).unref()
  }
  const agentSpawn = createAgentSpawnHandler({ onRunEnd: scheduleOrphanFinalize })

  // Boot reconcile sweep. A task persisted as `in_progress` with no live run is
  // an orphan from a previous process (server restarted mid-run, or a tab
  // closed while the prior process's orphan-finalize timer — an in-memory
  // unref'd setTimeout — was pending and never fired). The fresh run registry
  // has no live runs at boot, so we can't tell an embedded orphan from a task
  // an EXTERNAL MCP agent (e.g. /annotask-apply in another editor) locked and
  // is still working across our restart. We therefore only reclaim tasks that
  // have clearly been sitting (older than BOOT_RECLAIM_MIN_AGE_MS): a freshly
  // killed embedded run is reverted to pending by its own still-open tab when
  // the SSE dies, and a live external agent's recent lock is left untouched.
  // Deferred a tick so it doesn't block boot; the task cache loads lazily.
  const BOOT_RECLAIM_MIN_AGE_MS = 120_000
  setImmediate(() => {
    try {
      const now = Date.now()
      for (const t of state.getTasks().tasks as Array<{ id?: string; status?: string; updatedAt?: number }>) {
        if (!t?.id || t.status !== 'in_progress') continue
        if (agentSpawn.registry.taskRunning(t.id)) continue
        const age = now - (typeof t.updatedAt === 'number' ? t.updatedAt : 0)
        if (age < BOOT_RECLAIM_MIN_AGE_MS) continue
        reconcileOrphanedTask(t.id, 'stale lock at boot')
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[annotask] boot orphan sweep failed:', err)
    }
  })
  const agentDetect = createAgentDetector()
  const initRunner = createInitRunner({
    projectRoot: options.projectRoot,
    broadcast: wsServer.broadcast,
    agentDetect,
    usageLedger,
  })
  onSpecCleared = () => { initRunner.reset() }

  // File-snapshot engine — the agent-apply safety net. The tool never authors
  // application source (the embedded agent does); snapshots make "Undo last
  // apply" and "Discard session" byte-exact. Always on: every write it ever
  // performs is an explicit, user-initiated restore.
  const snapshotStore = createSnapshotStore(options.projectRoot)

  // Shared apply-session options so the HTTP PATCH path AND the server-side
  // orphan reconcile / boot sweep drive a wireframe_apply task's lifecycle the
  // SAME way. Diverging here is exactly what stranded orphaned applies: an
  // in_progress run reclaimed without sealing its batch left undo/discard/
  // re-apply all dead and the canvas locked at 'building' forever.
  const applyOptions: ApplySessionOptions = {
    projectRoot: options.projectRoot,
    getDesignSession: () => state.getDesignSession(),
    setDesignSession: (doc) => state.setDesignSession(doc),
    getWireframe: () => state.getWireframe(),
    setWireframe: (doc) => state.setWireframe(doc),
    addTask: (task) => state.addTask(task),
    snapshots: snapshotStore,
  }

  const apiMiddleware = createAPIMiddleware({
    projectRoot: options.projectRoot,
    apiSchemaUrls: options.apiSchemaUrls,
    apiSchemaFiles: options.apiSchemaFiles,
    allowedHosts: options.allowedHosts,
    getReport: () => wsServer.getReport(),
    getConfig: () => state.getConfig(),
    getDesignSpec: () => state.getDesignSpec(),
    getTasks: () => state.getTasks(),
    addTask: (task) => state.addTask(task),
    updateTask: (id, updates, opts) => state.updateTask(id, updates, opts),
    deleteTask: (id) => state.deleteTask(id),
    saveInteractionHistory: (id, snapshot) => state.saveInteractionHistory(id, snapshot),
    readInteractionHistory: (id) => state.readInteractionHistory(id),
    saveRenderedHtml: (id, html) => state.saveRenderedHtml(id, html),
    readRenderedHtml: (id) => state.readRenderedHtml(id),
    getPerformance: () => state.getPerformanceSnapshot(),
    setPerformance: (data) => state.setPerformanceSnapshot(data),
    ingestNetworkCalls: (calls) => state.ingestNetworkCalls(calls),
    getRuntimeEndpointCatalog: () => state.getRuntimeEndpointCatalog(),
    clearRuntimeEndpoints: () => state.clearRuntimeEndpoints(),
    taskThread,
    agentSpawn,
    agentDetect,
    initRunner,
    getAgentConfigs: () => state.getAgentConfigs(),
    setAgentConfig: (id, entry) => state.setAgentConfig(id, entry),
    getWireframe: () => state.getWireframe(),
    setWireframe: (doc) => state.setWireframe(doc),
    getDesignSession: () => state.getDesignSession(),
    setDesignSession: (doc) => state.setDesignSession(doc),
    clearDesignSession: () => state.clearDesignSession(),
    snapshots: snapshotStore,
    usageLedger,
    getPersistenceHealth: () => state.getPersistenceHealth(),
  })

  const mcpMiddleware = createMcpMiddleware({
    projectRoot: options.projectRoot,
    getDesignSpec: () => state.getDesignSpec(),
    getTasks: () => state.getTasks(),
    addTask: (task) => state.addTask(task),
    updateTask: (id, updates) => state.updateTask(id, updates),
    deleteTask: (id) => state.deleteTask(id),
    readInteractionHistory: (id) => state.readInteractionHistory(id),
    readRenderedHtml: (id) => state.readRenderedHtml(id),
    getRuntimeEndpointCatalog: () => state.getRuntimeEndpointCatalog(),
    taskThread,
  })

  const shellMiddleware = createShellMiddleware()

  // Bridge background component refreshes to the shell: when the scan worker
  // lands with a new catalog, tell open shells to re-fetch /api/components so
  // the Components tab updates seamlessly without a user-driven reload.
  const offCatalog = onCatalogRefreshed((catalog) => {
    wsServer.broadcast('components:updated', { scannedAt: catalog.scannedAt })
  })

  // Warm the catalog in the background so the first Components-tab open is
  // instant. When the disk cache is fresh this short-circuits before any
  // worker spawns; when it's missing or stale it kicks off a scan in the
  // worker thread, which can't block the main event loop. Deferred one tick
  // so Vite's own boot work runs first.
  setImmediate(() => {
    scanComponentLibraries(options.projectRoot).catch(err => {
      console.warn('[Annotask] Component catalog warm-up failed:', err)
    })
  })

  const middleware = (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    // MCP → API → shell (shell is SPA fallback).
    // The `/__annotask/preview` route is handled in the Vite plugin itself so Vite's
    // `transformIndexHtml` pipeline can rewrite bare specifiers in the inline module script.
    mcpMiddleware(req, res, () => {
      apiMiddleware(req, res, () => {
        shellMiddleware(req, res, next)
      })
    })
  }

  return {
    middleware,
    handleUpgrade: (req, socket, head) => wsServer.handleUpgrade(req, socket, head),
    broadcast: (event, data) => wsServer.broadcast(event, data),
    getReport: () => wsServer.getReport(),
    flush: () => state.flush(),
    // flush, never revert: a live session is intentional user work and must
    // survive dev-server restarts (rehydrate); discard is user-initiated only.
    dispose: () => { void snapshotStore.flush(); agentSpawn.registry.killAll(); offCatalog(); state.dispose(); wsServer.dispose() },
  }
}

export { createProjectState, type ProjectState } from './state.js'
export { createWSServer, type AnnotaskWSServer } from './ws-server.js'
export { createAPIMiddleware, type APIOptions } from './api.js'
export { createShellMiddleware } from './serve-shell.js'
