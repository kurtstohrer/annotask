import type { Plugin, ViteDevServer } from 'vite'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { transformFile, transformHTML, injectComponentRegistry } from './transform.js'
import { bridgeClientScript } from './bridge-client.js'
import { createAnnotaskServer } from '../server/index.js'
import { writeServerInfo, writeMfeServerInfo } from '../server/discovery.js'

export interface AnnotaskOptions {
  /** @experimental Not yet implemented. OpenAPI spec path or URL */
  openapi?: string
  /** MFE identity for multi-project setups (e.g. '@myorg/my-mfe').
   *  Adds data-annotask-mfe attribute to all elements.
   *  When used alone, annotask runs normally (shell + server available).
   *  When combined with `server`, the local server is skipped and
   *  .annotask/server.json points to the remote root server. */
  mfe?: string
  /** Remote annotask server URL (e.g. 'http://localhost:24678').
   *  When set, the local annotask server is skipped — the root shell's
   *  plugin handles the server and UI injection. Writes .annotask/server.json
   *  pointing to this URL so skills/CLI connect to the root. */
  server?: string
  /** Extra HTTP endpoints to probe for OpenAPI / GraphQL schemas. Useful
   *  when backend services run on ports annotask can't auto-discover
   *  (non-docker-compose setups, remote staging, etc.). */
  apiSchemaUrls?: string[]
  /** Extra project-relative schema file paths (openapi.yaml, schema.graphql,
   *  *.schema.json). Takes precedence over filesystem auto-discovery. */
  apiSchemaFiles?: string[]
}

export function annotask(options: AnnotaskOptions = {}): Plugin[] {
  let projectRoot = ''
  const mfe = options.mfe

  const transformPlugin: Plugin = {
    name: 'annotask:transform',
    enforce: 'pre',
    apply: 'serve',

    configResolved(config) {
      projectRoot = config.root

      // When a remote server is specified, write server.json pointing to it
      // so skills/CLI in this repo connect to the root's annotask server.
      if (mfe && options.server) {
        writeMfeServerInfo(projectRoot, options.server, mfe)
      }
    },

    // Inject data-annotask-* attributes in `load`, not `transform`, so we
    // always see the raw file contents before any other plugin transforms
    // them. This matters for Solid (vite-plugin-solid) and React (HMR
    // preamble), both of which are `enforce: 'pre'` and can run before us
    // if they appear earlier in the user's plugins array. Load runs before
    // any transform hook, so our attrs go into raw source and the
    // framework plugin's transform then converts the annotated source
    // normally (Solid's _tmpl$ output, React.createElement, etc.).
    load(id) {
      // Skip sub-requests like `file.vue?vue&type=template` — those are
      // virtual modules handled by framework plugins' own load hooks.
      if (id.includes('?')) return null
      if (!id.endsWith('.vue') && !id.endsWith('.svelte') && !/\.[jt]sx$/.test(id)) return null
      // Never instrument library source. Headless UI libs (Kobalte, Radix,
      // Headless UI, bits-ui, etc.) render user-provided elements through
      // their own internal JSX — if we stamp those internal files with
      // data-annotask-* attrs, the library's DOM output carries the library's
      // source path instead of the user's call-site, which breaks the arrow
      // tool's source resolution.
      if (id.includes('/node_modules/')) return null
      if (!fs.existsSync(id)) return null

      const raw = fs.readFileSync(id, 'utf-8')
      const annotated = transformFile(raw, id, projectRoot, mfe) ?? raw
      // Keystone: register this file's imported components into
      // window.__ANNOTASK_COMPONENTS__ so the bridge can live-mount real project
      // components (Vue/React/local + library) when a wireframe/insert drops one.
      // The Vite plugin previously injected the framework runtimes but never the
      // component map — so only globally-registered Vue components could mount.
      return injectComponentRegistry(annotated, id)
    },

    transform(code, id) {
      // Expose framework runtime for Annotask component rendering
      if (id.endsWith('/main.ts') || id.endsWith('/main.js') || id.endsWith('/main.tsx') || id.endsWith('/main.jsx')) {
        let injection = ''
        if (code.includes("from 'vue'") || code.includes('from "vue"')) {
          injection = `\n;import { createApp as __uf_createApp, h as __uf_h } from 'vue';\nwindow.__ANNOTASK_VUE__ = { createApp: __uf_createApp, h: __uf_h };\n`
        } else if (code.includes("from 'react'") || code.includes('from "react"')) {
          injection = `\n;import { createElement as __uf_createElement } from 'react';\nimport { createRoot as __uf_createRoot } from 'react-dom/client';\nwindow.__ANNOTASK_REACT__ = { createElement: __uf_createElement, createRoot: __uf_createRoot };\n`
        } else if (code.includes("from 'svelte'") || code.includes('from "svelte"')) {
          injection = `\n;import { mount as __uf_mount, unmount as __uf_unmount } from 'svelte';\nwindow.__ANNOTASK_SVELTE__ = { mount: __uf_mount, unmount: __uf_unmount };\n`
        } else if (code.includes("from 'solid-js") || code.includes('from "solid-js')) {
          injection = `\n;import { render as __uf_render } from 'solid-js/web';\nwindow.__ANNOTASK_SOLID__ = { render: __uf_render };\n`
        }
        if (injection) {
          return { code: code + injection, map: null }
        }
      }

      return null
    },

    transformIndexHtml(html, ctx) {
      const transformed = transformHTML(html, ctx.filename, projectRoot, mfe)
      // When embedded in a root (server option set), skip bridge/toggle — root handles that
      if (options.server) {
        return transformed ?? html
      }
      return {
        html: transformed ?? html,
        tags: [
          {
            tag: 'script',
            children: bridgeClientScript(),
            injectTo: 'body',
          },
        ],
      }
    },
  }

  const servePlugin: Plugin = {
    name: 'annotask:serve',
    apply: 'serve',

    configureServer(server: ViteDevServer) {
      // Hosts beyond localhost / IP literals that may reach /__annotask/*
      // (the API middleware's DNS-rebinding gate). Seeded from Vite's own
      // `server.allowedHosts` and the host the server actually announces, so
      // Annotask is never stricter than the app it's embedded in. Mutable
      // array + getter because the bind address is only known on 'listening'.
      const extraAllowedHosts: string[] = []
      const viteAllowed = server.config.server.allowedHosts
      if (viteAllowed === true) extraAllowedHosts.push('*')
      else if (Array.isArray(viteAllowed)) extraAllowedHosts.push(...viteAllowed)
      const cfgHost = server.config.server.host
      if (typeof cfgHost === 'string' && cfgHost.length > 0) extraAllowedHosts.push(cfgHost)

      const uiServer = createAnnotaskServer({
        projectRoot,
        apiSchemaUrls: options.apiSchemaUrls,
        apiSchemaFiles: options.apiSchemaFiles,
        allowedHosts: () => extraAllowedHosts,
      })

      // Resolve a bare module specifier (e.g. "primevue/button") to the RAW
      // source file as an /@fs/ URL so the iframe can dynamically import an
      // off-route catalog component for preview/placement. We deliberately
      // resolve the raw file (via Node, not Vite's optimizer) so importing it
      // serves+transforms a single module whose sub-deps map to already-
      // optimized chunks — avoiding a dep re-optimization full-page reload.
      const requireFromRoot = createRequire(pathToFileURL(projectRoot + '/package.json').href)
      server.middlewares.use((req, res, next) => {
        if (!req.url || !req.url.startsWith('/__annotask/preview-module')) return next()
        res.setHeader('Content-Type', 'application/json')
        const spec = new URL(req.url, 'http://localhost').searchParams.get('spec')
        if (!spec) { res.statusCode = 400; res.end('{"error":"missing spec"}'); return }
        try {
          const abs = requireFromRoot.resolve(spec).replace(/\\/g, '/')
          const root = projectRoot.replace(/\\/g, '/')
          const url = abs.startsWith(root + '/') ? abs.slice(root.length) : '/@fs/' + abs.replace(/^\//, '')
          res.end(JSON.stringify({ url }))
        } catch (e) {
          res.statusCode = 404; res.end(JSON.stringify({ error: String((e as Error)?.message || e) }))
        }
      })

      // Mount middleware on Vite's connect instance
      server.middlewares.use(uiServer.middleware)

      // Handle WebSocket upgrades
      server.httpServer?.on('upgrade', (req, socket, head) => {
        if (req.url === '/__annotask/ws') {
          uiServer.handleUpgrade(req, socket, head)
        }
      })

      // Write server.json so skills/CLI know where to connect
      server.httpServer?.once('listening', () => {
        const addr = server.httpServer?.address()
        const port = typeof addr === 'object' && addr ? addr.port : 5173
        const host = typeof addr === 'object' && addr ? addr.address : undefined
        writeServerInfo(projectRoot, port, host, mfe)
        // The announced host must also pass the Host gate — skills/CLI built
        // from server.json send it verbatim in their Host header.
        if (host) extraAllowedHosts.push(host)
        // Loud warning when bound beyond loopback (e.g. `vite --host`): the
        // Annotask API is unauthenticated and can spawn agents that write source
        // + run shell at the project root. On a non-loopback bind, anyone on the
        // LAN can reach it. See SECURITY.md. (Loopback binds stay quiet.)
        const loopback = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1', 'localhost'])
        if (host && !loopback.has(host)) {
          console.warn(
            `[Annotask] ⚠ SECURITY: bound to ${host}:${port} (beyond localhost). ` +
            `The Annotask dev API is UNAUTHENTICATED and can run your agent CLI ` +
            `with file-write + shell access at the project root — anyone on this ` +
            `network can reach it. Set ANNOTASK_MAX_PERMISSION=plan|default to cap ` +
            `it, and prefer an SSH tunnel over --host. See SECURITY.md.`,
          )
        }
      })

      console.log('[Annotask] Design tool available at /__annotask/')
      console.log('[Annotask] WebSocket: ws://localhost:<port>/__annotask/ws')
      console.log('[Annotask] API: http://localhost:<port>/__annotask/api/report')
      console.log('[Annotask] MCP: http://localhost:<port>/__annotask/mcp')

      // Inject bridge scripts into SSR HTML responses (Astro, etc.)
      // Sniffs content-type from writeHead, buffers only HTML responses,
      // and injects scripts before </body>.
      server.middlewares.use((req: any, res: any, next: any) => {
        if (req.url?.startsWith('/__annotask')) return next()

        const _end = res.end
        const _write = res.write
        const _writeHead = res.writeHead
        const chunks: string[] = []
        let isHtml = false
        let decided = false

        res.writeHead = function (statusCode: any, ...rest: any[]) {
          if (!decided) {
            decided = true
            const headers = rest.find((a: any) => typeof a === 'object' && a !== null)
            if (headers) {
              const ct = headers['content-type'] || headers['Content-Type']
              if (typeof ct === 'string') isHtml = ct.includes('text/html')
            }
            if (!isHtml) {
              const ct = res.getHeader('content-type')
              if (typeof ct === 'string') isHtml = ct.includes('text/html')
            }
          }
          return _writeHead.apply(res, [statusCode, ...rest])
        }

        res.write = function (chunk: any, ...args: any[]) {
          if (isHtml) {
            if (chunk != null) chunks.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString())
            return true
          }
          return _write.apply(res, [chunk, ...args] as any)
        }

        res.end = function (chunk: any, ...args: any[]) {
          if (isHtml) {
            if (chunk != null && chunk !== '') chunks.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString())
            if (chunks.length > 0) {
              let body = chunks.join('')
              if (body.includes('</body>') && !body.includes('__ANNOTASK_BRIDGE__')) {
                const scripts = `<script>${bridgeClientScript()}</script>\n`
                body = body.replace('</body>', scripts + '</body>')
              }
              return _end.call(res, body)
            }
          }
          return _end.apply(res, [chunk, ...args] as any)
        }

        next()
      })
    },
  }

  // When a remote server is specified, skip the serve plugin — no local
  // server, bridge, or toggle. The root shell's plugin handles all of that.
  // When only `mfe` is set (no server), annotask runs normally so the
  // shell is available for standalone testing.
  if (options.server) {
    return [transformPlugin]
  }

  return [transformPlugin, servePlugin]
}

export default annotask
