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
}

export function createAnnotaskServer(options: AnnotaskServerOptions): AnnotaskServer {
  const wsServer = createWSServer()
  // Forward-declared so state.ts can notify the init runner when its source
  // of truth (design-spec.json) is unlinked. The runner is built below; until
  // then this is a no-op callback.
  let onSpecCleared: () => void = () => { /* set below */ }
  const state = createProjectState(options.projectRoot, wsServer.broadcast, {
    onSpecCleared: () => onSpecCleared(),
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
      }).catch((err) => {
        // eslint-disable-next-line no-console
        console.warn(`[annotask] usage ledger append failed for task ${taskId}:`, err)
      })
    },
  })
  const agentSpawn = createAgentSpawnHandler()
  const agentDetect = createAgentDetector()
  const initRunner = createInitRunner({
    projectRoot: options.projectRoot,
    broadcast: wsServer.broadcast,
    agentDetect,
    usageLedger,
  })
  onSpecCleared = () => { initRunner.reset() }

  const apiMiddleware = createAPIMiddleware({
    projectRoot: options.projectRoot,
    apiSchemaUrls: options.apiSchemaUrls,
    apiSchemaFiles: options.apiSchemaFiles,
    getReport: () => wsServer.getReport(),
    getConfig: () => state.getConfig(),
    getDesignSpec: () => state.getDesignSpec(),
    getTasks: () => state.getTasks(),
    addTask: (task) => state.addTask(task),
    updateTask: (id, updates) => state.updateTask(id, updates),
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
    usageLedger,
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
    dispose: () => { agentSpawn.registry.killAll(); offCatalog(); state.dispose(); wsServer.dispose() },
  }
}

export { createProjectState, type ProjectState } from './state.js'
export { createWSServer, type AnnotaskWSServer } from './ws-server.js'
export { createAPIMiddleware, type APIOptions } from './api.js'
export { createShellMiddleware } from './serve-shell.js'
