import type { IncomingMessage, ServerResponse } from 'node:http'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

function findShellDist(): string {
  return path.resolve(__dirname, 'shell')
}

function findVendorDist(): string {
  return path.resolve(__dirname, 'vendor')
}

export function createShellMiddleware() {
  const shellDist = findShellDist()
  const vendorDist = findVendorDist()

  return async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    if (!req.url?.startsWith('/__annotask')) return next()

    // CORS for cross-port access (Webpack standalone server) — localhost only
    const origin = req.headers.origin as string | undefined
    if (origin) {
      try {
        const host = new URL(origin).hostname
        if (host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '::1') {
          res.setHeader('Access-Control-Allow-Origin', origin)
          res.setHeader('Vary', 'Origin')
        }
      } catch { /* invalid origin, skip CORS */ }
    }

    let filePath = req.url.replace('/__annotask', '') || '/'
    const queryIndex = filePath.indexOf('?')
    if (queryIndex !== -1) filePath = filePath.slice(0, queryIndex)
    if (filePath === '/' || filePath === '') filePath = '/index.html'

    // Skip API and WS paths
    if (filePath.startsWith('/api/') || filePath === '/ws') return next()

    // Serve vendor files (axe-core, html2canvas)
    if (filePath.startsWith('/vendor/')) {
      const vendorFile = path.join(vendorDist, filePath.replace('/vendor/', ''))
      if (!vendorFile.startsWith(vendorDist)) {
        res.statusCode = 403; res.end('Forbidden'); return
      }
      try {
        const data = await fsp.readFile(vendorFile)
        res.setHeader('Content-Type', 'application/javascript')
        res.setHeader('Cache-Control', 'public, max-age=86400')
        res.end(data)
      } catch {
        res.statusCode = 404; res.end('Vendor file not found'); return
      }
      return
    }

    const fullPath = path.join(shellDist, filePath)

    if (!fullPath.startsWith(shellDist)) {
      res.statusCode = 403
      res.end('Forbidden')
      return
    }

    try {
      const stat = await fsp.stat(fullPath)
      if (!stat.isFile()) throw new Error('not a file')
      const ext = path.extname(fullPath)
      const contentTypes: Record<string, string> = {
        '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css',
        '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
      }
      res.setHeader('Content-Type', contentTypes[ext] || 'application/octet-stream')
      const data = await fsp.readFile(fullPath)
      res.end(data)
    } catch {
      // SPA fallback — serve index.html
      const indexPath = path.join(shellDist, 'index.html')
      try {
        const html = await fsp.readFile(indexPath, 'utf-8')
        res.setHeader('Content-Type', 'text/html')
        res.end(html)
      } catch {
        res.statusCode = 404
        res.end('Annotask shell not built. Run: pnpm build:shell')
      }
    }
  }
}
