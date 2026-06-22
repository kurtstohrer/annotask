import http from 'node:http'
import { createAnnotaskServer } from './index.js'
import { writeServerInfo, removeServerInfo } from './discovery.js'

export interface StandaloneServerOptions {
  projectRoot: string
  port?: number
}

export async function startStandaloneServer(options: StandaloneServerOptions): Promise<{
  port: number
  close: () => Promise<void>
}> {
  const port = options.port || 24678
  // The standalone server binds 127.0.0.1 only, so the API middleware's Host
  // gate (DNS rebinding) passes on the IP literal already — the array exists
  // so the announced host stays allowed if the bind logic ever changes.
  const extraAllowedHosts: string[] = []
  const uiServer = createAnnotaskServer({
    projectRoot: options.projectRoot,
    allowedHosts: () => extraAllowedHosts,
  })

  const httpServer = http.createServer((req, res) => {
    // Vite serves /__annotask/preview-module through its on-demand /@fs/
    // transform pipeline; webpack has no equivalent (a raw .vue/.svelte URL
    // would be untransformable in the browser). Answer honestly and FAST so
    // ensureComponentLoaded falls into the labeled 'not-registered'
    // placeholder — off-route palette mounts are a documented Vite-only
    // capability; on-route components work the same under both bundlers.
    if (req.url?.startsWith('/__annotask/preview-module')) {
      res.statusCode = 404
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ error: 'preview-module unavailable under webpack: components must be loaded by a visited route' }))
      return
    }
    uiServer.middleware(req, res, () => {
      res.statusCode = 404
      res.end('Not found')
    })
  })

  httpServer.on('upgrade', (req, socket, head) => {
    if (req.url === '/__annotask/ws') {
      uiServer.handleUpgrade(req, socket, head)
    }
  })

  async function shutdown() {
    removeServerInfo(options.projectRoot)
    // Wait for in-flight task writes before closing so the last mutation isn't lost.
    await uiServer.flush()
    uiServer.dispose()
    await new Promise<void>(resolve => httpServer.close(() => resolve()))
  }

  return new Promise((resolve, reject) => {
    httpServer.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        httpServer.listen(0, '127.0.0.1', () => {
          const addr = httpServer.address() as { port: number; address: string }
          writeServerInfo(options.projectRoot, addr.port, addr.address)
          extraAllowedHosts.push(addr.address)
          resolve({ port: addr.port, close: shutdown })
        })
      } else {
        reject(err)
      }
    })

    httpServer.listen(port, '127.0.0.1', () => {
      writeServerInfo(options.projectRoot, port, '127.0.0.1')
      extraAllowedHosts.push('127.0.0.1')
      resolve({ port, close: shutdown })
    })
  })
}
