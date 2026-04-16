import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Duplex } from 'node:stream'
import { createAPIMiddleware } from './api.js'
import { createWSServer, type AnnotaskWSServer } from './ws-server.js'
import { createShellMiddleware } from './serve-shell.js'
import { createProjectState, type ProjectState } from './state.js'
import { createMcpMiddleware } from '../mcp/server.js'

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
}

export function createAnnotaskServer(options: AnnotaskServerOptions): AnnotaskServer {
  const wsServer = createWSServer()
  const state = createProjectState(options.projectRoot, wsServer.broadcast)

  const apiMiddleware = createAPIMiddleware({
    projectRoot: options.projectRoot,
    getReport: () => wsServer.getReport(),
    getConfig: () => state.getConfig(),
    getDesignSpec: () => state.getDesignSpec(),
    getTasks: () => state.getTasks(),
    addTask: (task) => state.addTask(task),
    updateTask: (id, updates) => state.updateTask(id, updates),
    deleteTask: (id) => state.deleteTask(id),
    getPerformance: () => state.getPerformanceSnapshot(),
    setPerformance: (data) => state.setPerformanceSnapshot(data),
  })

  const mcpMiddleware = createMcpMiddleware({
    projectRoot: options.projectRoot,
    getDesignSpec: () => state.getDesignSpec(),
    getTasks: () => state.getTasks(),
    addTask: (task) => state.addTask(task),
    updateTask: (id, updates) => state.updateTask(id, updates),
    deleteTask: (id) => state.deleteTask(id),
  })

  const shellMiddleware = createShellMiddleware()

  const middleware = (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    // MCP first, then API, then shell (shell is SPA fallback)
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
    dispose: () => { state.dispose(); wsServer.dispose() },
  }
}

export { createProjectState, type ProjectState } from './state.js'
export { createWSServer, type AnnotaskWSServer } from './ws-server.js'
export { createAPIMiddleware, type APIOptions } from './api.js'
export { createShellMiddleware } from './serve-shell.js'
