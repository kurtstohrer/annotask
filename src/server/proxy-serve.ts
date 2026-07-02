/**
 * Universal proxy mode — `annotask serve --target <url>`.
 *
 * Hosts the full Annotask server (shell, API, MCP, WebSocket) on its own
 * port and reverse-proxies every non-/__annotask request to the target app,
 * injecting the bridge into proxied HTML on the way through. That gives any
 * site the design tool with ZERO build integration: production builds,
 * CDN/no-build pages, non-Node backends (Rails/Django/PHP), remote staging.
 *
 * What works without the transform: annotations, screenshots, a11y scan,
 * error/perf monitors, and wireframe capture. Source anchors come from
 * whatever the page itself offers — native framework debug metadata
 * (Astro/Svelte/React dev builds) where present, honest empty anchors plus
 * DOM fingerprints everywhere else (the resolve-fingerprint endpoint turns
 * those into candidate source locations at apply time).
 *
 * Proxy semantics, deliberately minimal:
 *   - Everything shares ONE origin (the proxy's), so the shell iframe, the
 *     bridge's /__annotask/vendor loads, and postMessage all just work.
 *   - HTML responses are buffered, decompressed when needed, and get the
 *     bridge injected before </body> (deduped on the bridge's own marker).
 *   - The target's content-security-policy and x-frame-options headers are
 *     dropped on proxied responses — the inline bridge and the shell iframe
 *     are the whole point of the tool, and it binds to localhost only.
 *   - Absolute redirects to the target origin are rewritten back onto the
 *     proxy so the browser never escapes it.
 *   - Non-/__annotask WebSocket upgrades tunnel through raw sockets so dev
 *     servers behind the proxy (Vite/Next HMR) keep working.
 */

import http from 'node:http'
import https from 'node:https'
import net from 'node:net'
import tls from 'node:tls'
import zlib from 'node:zlib'
import { createAnnotaskServer } from './index.js'
import { writeServerInfo, removeServerInfo } from './discovery.js'
import { bridgeClientScript } from '../plugin/bridge-client.js'

export interface ProxyServerOptions {
  projectRoot: string
  /** App to proxy — validated as an absolute http(s) URL by the caller. */
  target: string
  port?: number
}

/** HTML responses beyond this stream through UNINJECTED rather than buffer —
 *  no real document is this big; only a pathological/endless response is. */
const MAX_HTML_BUFFER_BYTES = 64 * 1024 * 1024

/** Hop-by-hop headers that must not be forwarded either direction. */
const HOP_BY_HOP = new Set([
  'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization',
  'te', 'trailer', 'transfer-encoding', 'upgrade',
])

/** Decompress a buffered body per its content-encoding. Returns null for an
 *  encoding we can't undo — the caller then passes the response through
 *  untouched rather than corrupting it with a plaintext injection. */
function decode(body: Buffer, encoding: string): Buffer | null {
  try {
    if (encoding === 'gzip') return zlib.gunzipSync(body)
    if (encoding === 'deflate') return zlib.inflateSync(body)
    if (encoding === 'br') return zlib.brotliDecompressSync(body)
    if (encoding === '' || encoding === 'identity') return body
  } catch { /* corrupt stream — pass through below */ }
  return null
}

/** Inject the bridge before </body> (or append when the document has none),
 *  deduped on the bridge IIFE's own __ANNOTASK_BRIDGE__ marker. The replacer
 *  is a FUNCTION on purpose: a string replacement would expand `$'`/`$&`
 *  sequences inside the bridge source (e.g. the React fiber key prefix
 *  '__reactFiber$') into replace() patterns and corrupt the script. */
function injectBridge(html: string): string {
  if (html.includes('__ANNOTASK_BRIDGE__')) return html
  const script = `<script>${bridgeClientScript()}</script>\n`
  return html.includes('</body>') ? html.replace('</body>', () => script + '</body>') : html + script
}

export async function startProxyServer(options: ProxyServerOptions): Promise<{
  port: number
  close: () => Promise<void>
}> {
  const port = options.port || 24700
  const target = new URL(options.target)
  const isHttps = target.protocol === 'https:'
  const targetPort = Number(target.port) || (isHttps ? 443 : 80)

  const extraAllowedHosts: string[] = []
  const uiServer = createAnnotaskServer({
    projectRoot: options.projectRoot,
    allowedHosts: () => extraAllowedHosts,
  })

  function proxyRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
    if (process.env.ANNOTASK_PROXY_DEBUG) {
      console.log(`[proxy] ${req.method} ${req.url}`)
    }
    const headers: http.OutgoingHttpHeaders = {}
    for (const [k, v] of Object.entries(req.headers)) {
      if (v !== undefined && !HOP_BY_HOP.has(k)) headers[k] = v
    }
    headers.host = target.host
    // Identity keeps the common case injectable without a decode pass;
    // servers that compress anyway are handled by decode() below.
    headers['accept-encoding'] = 'identity'

    const preq = (isHttps ? https : http).request({
      hostname: target.hostname,
      port: targetPort,
      method: req.method,
      path: req.url,
      headers,
    }, (pres) => {
      const status = pres.statusCode ?? 502
      const outHeaders: http.OutgoingHttpHeaders = {}
      for (const [k, v] of Object.entries(pres.headers)) {
        if (v !== undefined && !HOP_BY_HOP.has(k)) outHeaders[k] = v
      }
      // The inline bridge and the shell iframe are the product — the
      // target's CSP/XFO would break both. Localhost-only exposure.
      delete outHeaders['content-security-policy']
      delete outHeaders['content-security-policy-report-only']
      delete outHeaders['x-frame-options']
      // Keep redirects on the proxy origin.
      const loc = outHeaders['location']
      if (typeof loc === 'string' && loc.startsWith(target.origin)) {
        outHeaders['location'] = loc.slice(target.origin.length) || '/'
      }

      const contentType = String(pres.headers['content-type'] ?? '')
      if (!contentType.includes('text/html')) {
        res.writeHead(status, outHeaders)
        pres.pipe(res)
        return
      }

      // HTML: buffer, decode, inject, re-measure. Buffering is bounded — a
      // pathological/endless HTML response must degrade to a raw stream, not
      // grow the heap until the whole server OOMs.
      const chunks: Buffer[] = []
      let buffered = 0
      let overflowed = false
      pres.on('data', (c: Buffer) => {
        if (overflowed) return
        buffered += c.length
        if (buffered > MAX_HTML_BUFFER_BYTES) {
          overflowed = true
          res.writeHead(status, outHeaders)
          for (const prior of chunks) res.write(prior)
          chunks.length = 0
          res.write(c)
          pres.pipe(res)
          return
        }
        chunks.push(c)
      })
      pres.on('error', () => { try { res.destroy() } catch { /* gone */ } })
      pres.on('end', () => {
        if (overflowed) return
        const raw = Buffer.concat(chunks)
        const encoding = String(pres.headers['content-encoding'] ?? '').trim().toLowerCase()
        const decoded = decode(raw, encoding)
        if (decoded === null) {
          // Unknown/corrupt encoding — honest pass-through beats corruption.
          res.writeHead(status, outHeaders)
          res.end(raw)
          return
        }
        const body = injectBridge(decoded.toString('utf-8'))
        delete outHeaders['content-encoding']
        outHeaders['content-length'] = String(Buffer.byteLength(body))
        res.writeHead(status, outHeaders)
        res.end(body)
      })
    })

    preq.on('error', (err) => {
      if (res.headersSent) { try { res.destroy() } catch { /* gone */ } return }
      res.writeHead(502, { 'Content-Type': 'text/html' })
      res.end(`<!doctype html><body style="font-family:system-ui;padding:40px;color:#333">
<h2>Annotask proxy: target unreachable</h2>
<p><code>${target.origin}</code> — ${String((err as Error).message)}</p>
<p>Start the app, then reload. The Annotask shell stays available at <a href="/__annotask/">/__annotask/</a>.</p>
</body>`)
    })

    req.pipe(preq)
  }

  const httpServer = http.createServer((req, res) => {
    if (req.url?.startsWith('/__annotask')) {
      uiServer.middleware(req, res, () => {
        res.statusCode = 404
        res.end('Not found')
      })
      return
    }
    proxyRequest(req, res)
  })

  // WebSocket upgrades: ours is handled in-process; everything else tunnels
  // raw to the target so HMR sockets survive the proxy hop.
  httpServer.on('upgrade', (req, socket, head) => {
    if (req.url === '/__annotask/ws') {
      uiServer.handleUpgrade(req, socket, head)
      return
    }
    const upstream: net.Socket = isHttps
      ? tls.connect({ host: target.hostname, port: targetPort, servername: target.hostname })
      : net.connect({ host: target.hostname, port: targetPort })
    upstream.on('error', () => { try { socket.destroy() } catch { /* gone */ } })
    socket.on('error', () => { try { upstream.destroy() } catch { /* gone */ } })
    const replay = () => {
      // Replay the upgrade request verbatim, host header rewritten.
      const lines = [`${req.method} ${req.url} HTTP/1.1`]
      for (let i = 0; i < req.rawHeaders.length; i += 2) {
        const name = req.rawHeaders[i]
        const value = name.toLowerCase() === 'host' ? target.host : req.rawHeaders[i + 1]
        lines.push(`${name}: ${value}`)
      }
      upstream.write(lines.join('\r\n') + '\r\n\r\n')
      if (head.length > 0) upstream.write(head)
      upstream.pipe(socket)
      socket.pipe(upstream)
    }
    if (isHttps) upstream.once('secureConnect', replay)
    else upstream.once('connect', replay)
  })

  async function shutdown() {
    removeServerInfo(options.projectRoot)
    await uiServer.flush()
    uiServer.dispose()
    await new Promise<void>((resolve) => httpServer.close(() => resolve()))
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
