import http from 'node:http'
import { createAnnotaskServer } from './index.js'
import { writeServerInfo, removeServerInfo } from './discovery.js'

export interface StandaloneServerOptions {
  projectRoot: string
  port?: number
}

export async function startStandaloneServer(options: StandaloneServerOptions): Promise<{
  port: number
  close: () => void
}> {
  const port = options.port || 24678
  const uiServer = createAnnotaskServer({ projectRoot: options.projectRoot })

  const httpServer = http.createServer((req, res) => {
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

  return new Promise((resolve, reject) => {
    httpServer.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        httpServer.listen(0, () => {
          const addr = httpServer.address() as { port: number }
          writeServerInfo(options.projectRoot, addr.port)
          resolve({
            port: addr.port,
            close: () => { removeServerInfo(options.projectRoot); uiServer.dispose(); httpServer.close() },
          })
        })
      } else {
        reject(err)
      }
    })

    httpServer.listen(port, () => {
      writeServerInfo(options.projectRoot, port)
      resolve({
        port,
        close: () => { removeServerInfo(options.projectRoot); uiServer.dispose(); httpServer.close() },
      })
    })
  })
}
