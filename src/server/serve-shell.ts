import type { IncomingMessage, ServerResponse } from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

function findShellDist(): string {
  return path.resolve(__dirname, 'shell')
}

export function createShellMiddleware() {
  const shellDist = findShellDist()

  return (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    if (!req.url?.startsWith('/__annotask')) return next()

    // CORS for cross-port access (Webpack standalone server)
    res.setHeader('Access-Control-Allow-Origin', '*')

    let filePath = req.url.replace('/__annotask', '') || '/'
    const queryIndex = filePath.indexOf('?')
    if (queryIndex !== -1) filePath = filePath.slice(0, queryIndex)
    if (filePath === '/' || filePath === '') filePath = '/index.html'

    // Skip API and WS paths
    if (filePath.startsWith('/api/') || filePath === '/ws') return next()

    const fullPath = path.join(shellDist, filePath)

    if (!fullPath.startsWith(shellDist)) {
      res.statusCode = 403
      res.end('Forbidden')
      return
    }

    if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isFile()) {
      const indexPath = path.join(shellDist, 'index.html')
      if (fs.existsSync(indexPath)) {
        res.setHeader('Content-Type', 'text/html')
        res.end(fs.readFileSync(indexPath, 'utf-8'))
        return
      }
      res.statusCode = 404
      res.end('Annotask shell not built. Run: pnpm build:shell')
      return
    }

    const ext = path.extname(fullPath)
    const contentTypes: Record<string, string> = {
      '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css',
      '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
    }
    res.setHeader('Content-Type', contentTypes[ext] || 'application/octet-stream')
    res.end(fs.readFileSync(fullPath))
  }
}
