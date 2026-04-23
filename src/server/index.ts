import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Duplex } from 'node:stream'
import { createAPIMiddleware } from './api.js'
import { createWSServer, type AnnotaskWSServer } from './ws-server.js'
import { createShellMiddleware } from './serve-shell.js'
import { createProjectState, type ProjectState } from './state.js'
import { createMcpMiddleware } from '../mcp/server.js'
import { onCatalogRefreshed, scanComponentLibraries } from './component-scanner.js'

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
  const state = createProjectState(options.projectRoot, wsServer.broadcast)

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
    dispose: () => { offCatalog(); state.dispose(); wsServer.dispose() },
  }
}

export { createProjectState, type ProjectState } from './state.js'
export { createWSServer, type AnnotaskWSServer } from './ws-server.js'
export { createAPIMiddleware, type APIOptions } from './api.js'
export { createShellMiddleware } from './serve-shell.js'
