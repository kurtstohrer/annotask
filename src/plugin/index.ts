import type { Plugin, ViteDevServer } from 'vite'
import { transformFile } from './transform.js'
import { toggleButtonScript } from './toggle-button.js'
import { bridgeClientScript } from './bridge-client.js'
import { createAnnotaskServer } from '../server/index.js'
import { writeServerInfo } from '../server/discovery.js'

export interface AnnotaskOptions {
  /** @experimental Not yet implemented. OpenAPI spec path or URL */
  openapi?: string
}

export function annotask(options: AnnotaskOptions = {}): Plugin[] {
  let projectRoot = ''

  const transformPlugin: Plugin = {
    name: 'annotask:transform',
    enforce: 'pre',
    apply: 'serve',

    configResolved(config) {
      projectRoot = config.root
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
        }
        if (injection) {
          return { code: code + injection, map: null }
        }
      }

      // Transform source files to inject data-annotask-* attributes
      if (!id.endsWith('.vue') && !id.endsWith('.svelte') && !/\.[jt]sx$/.test(id)) return null

      const result = transformFile(code, id, projectRoot)
      if (!result) return null

      // Register imported PascalCase components globally
      let output = result
      const importRegex = /import\s+(\w+)\s+from\s+['"]([^'"]+)['"]/g
      let match
      const registrations: string[] = []
      while ((match = importRegex.exec(result)) !== null) {
        const [, name, source] = match
        if (name[0] === name[0].toUpperCase() && name[0] !== name[0].toLowerCase() && !source.startsWith('.')) {
          registrations.push(`window.__ANNOTASK_COMPONENTS__['${name}'] = ${name}`)
        }
      }
      if (registrations.length > 0) {
        const regCode = `\nif (typeof window !== 'undefined') { window.__ANNOTASK_COMPONENTS__ = window.__ANNOTASK_COMPONENTS__ || {}; ${registrations.join('; ')} }\n`
        // Vue SFCs: inject before </script>. JSX/Svelte: append to end of file.
        if (id.endsWith('.vue') && output.includes('</script>')) {
          output = output.replace(/<\/script>/, regCode + '</script>')
        } else {
          output += regCode
        }
      }

      return { code: output, map: null }
    },

    transformIndexHtml(html) {
      return {
        html,
        tags: [
          {
            tag: 'script',
            attrs: { type: 'module' },
            children: toggleButtonScript(),
            injectTo: 'body',
          },
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
      const uiServer = createAnnotaskServer({ projectRoot })

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
        writeServerInfo(projectRoot, port)
      })

      console.log('[Annotask] Design tool available at /__annotask/')
      console.log('[Annotask] WebSocket: ws://localhost:<port>/__annotask/ws')
      console.log('[Annotask] API: http://localhost:<port>/__annotask/api/report')
    },
  }

  return [transformPlugin, servePlugin]
}

export default annotask
