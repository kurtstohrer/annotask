/**
 * Webpack plugin for Annotask.
 * Starts a standalone server, adds the SFC transform loader,
 * and injects bridge + toggle scripts into HTML.
 */
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { startStandaloneServer } from '../server/standalone.js'
import { writeMfeServerInfo } from '../server/discovery.js'
import { bridgeClientScript } from '../plugin/bridge-client.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export interface AnnotaskWebpackOptions {
  port?: number
  mfe?: string
  server?: string
}

/** Must match the default in startStandaloneServer — the proxy rule is built
 * before the server starts, so both sides need to agree on the port. */
const DEFAULT_SERVER_PORT = 24678

function buildProxyRule(port: number) {
  // 127.0.0.1 (not localhost): the standalone server binds 127.0.0.1, and on
  // Node 17+ "localhost" can resolve to ::1 first, breaking the proxy.
  return { context: ['/__annotask'], target: `http://127.0.0.1:${port}`, ws: true }
}

function manualProxyHint(port: number): string {
  return [
    '[Annotask] Add this to your webpack devServer config manually:',
    '',
    '  devServer: {',
    '    proxy: [',
    `      { context: ['/__annotask'], target: 'http://127.0.0.1:${port}', ws: true },`,
    '    ],',
    '  }',
  ].join('\n')
}

export class AnnotaskWebpackPlugin {
  private options: AnnotaskWebpackOptions
  private serverUrl: string = ''

  constructor(options: AnnotaskWebpackOptions = {}) {
    this.options = options
  }

  /**
   * Inject the /__annotask proxy rule into compiler.options.devServer.
   * Must run synchronously during apply(): webpack-dev-server v5 reads
   * options.proxy in setupMiddlewares() BEFORE the first compile, and
   * @webpack-cli/serve snapshots compiler.options.devServer (Object.assign)
   * before server.start() — so mutating devServer from a compile hook can
   * never land. apply() runs inside createCompiler, which is early enough.
   */
  private injectDevServerProxy(compiler: any, port: number) {
    const rule = buildProxyRule(port)
    try {
      const devServer = compiler.options.devServer = compiler.options.devServer || {}
      const existing = devServer.proxy
      if (existing == null) {
        devServer.proxy = [rule]
      } else if (Array.isArray(existing)) {
        // v5 array form (also accepted by v4). Prepend so /__annotask wins
        // over any catch-all user entries; skip if a rule already covers it.
        const covered = existing.some((entry: any) =>
          Array.isArray(entry?.context) && entry.context.includes('/__annotask'))
        if (!covered) devServer.proxy = [rule, ...existing]
      } else if (typeof existing === 'object') {
        // v4 legacy object form ({ '/api': {...} }). Converting the user's
        // entries to the array form could change how dev-server v4 normalizes
        // them, so add ours as another keyed entry instead.
        if (!existing['/__annotask']) {
          existing['/__annotask'] = { target: rule.target, ws: true }
        }
      }
    } catch {
      // Frozen/sealed options throw in strict mode — fall through to the
      // verification below, which emits the actionable warning.
    }

    // Verify the mutation actually landed (sloppy-mode writes to frozen
    // objects fail silently, so a try/catch alone isn't enough).
    const proxy = compiler.options.devServer?.proxy
    const landed = Array.isArray(proxy)
      ? proxy.some((entry: any) => Array.isArray(entry?.context) && entry.context.includes('/__annotask'))
      : !!(proxy && typeof proxy === 'object' && (proxy as any)['/__annotask'])
    if (!landed) {
      console.warn(
        '[Annotask] Could not auto-inject the /__annotask proxy into devServer options '
        + '(unsupported proxy shape or frozen config). Requests to /__annotask/* will 404 '
        + 'on the app port until the proxy is configured.\n' + manualProxyHint(port))
    }
  }

  apply(compiler: any) {
    // Only activate in development
    if (compiler.options.mode !== 'development') return

    const projectRoot = compiler.context
    const loaderPath = path.resolve(__dirname, 'webpack-loader.js')

    // Add the SFC transform loader (enforce: pre, before vue-loader)
    compiler.options.module.rules.unshift({
      test: /\.(vue|svelte|[jt]sx?|ts|js)$/,
      enforce: 'pre',
      exclude: /node_modules/,
      use: [{
        loader: loaderPath,
        options: { projectRoot, mfe: this.options.mfe },
      }],
    })

    // Auto-inject the devServer proxy so /__annotask routes are forwarded to
    // the standalone server. This must happen here, synchronously — by the
    // time any compile hook fires, webpack-cli/dev-server have already
    // snapshotted devServer options (see injectDevServerProxy).
    const expectedPort = this.options.port || DEFAULT_SERVER_PORT
    if (!this.options.server) {
      this.injectDevServerProxy(compiler, expectedPort)
    }

    // Start standalone server, or point to remote server when server option is set
    let serverStarted = false
    compiler.hooks.beforeCompile.tapPromise('AnnotaskWebpackPlugin', async () => {
      if (serverStarted) return
      serverStarted = true
      if (this.options.server) {
        // Skip local server, point to remote server (root shell)
        if (this.options.mfe) {
          writeMfeServerInfo(projectRoot, this.options.server, this.options.mfe)
          console.log(`[Annotask] MFE '${this.options.mfe}' — using remote server at ${this.options.server}/__annotask/`)
        } else {
          console.log(`[Annotask] Using remote server at ${this.options.server}/__annotask/`)
        }
        this.serverUrl = this.options.server
      } else {
        try {
          const { port } = await startStandaloneServer({ projectRoot, port: this.options.port })
          this.serverUrl = `http://localhost:${port}`
          console.log(`[Annotask] Server running at ${this.serverUrl}/__annotask/`)

          // The proxy rule was locked in during apply(). If the preferred port
          // was busy, the server fell back to a random port (EADDRINUSE path in
          // startStandaloneServer) and the proxy now points at a dead port —
          // too late to fix the snapshot, so tell the user exactly what to do.
          if (port !== expectedPort) {
            console.warn(
              `[Annotask] Port ${expectedPort} was busy — server started on ${port} instead, `
              + `but the devServer proxy was already locked to ${expectedPort} at startup. `
              + `Free port ${expectedPort} (or pass an open port via the plugin's 'port' option) and restart, `
              + `or configure the proxy yourself.\n` + manualProxyHint(port))
          }
        } catch (err) {
          console.error('[Annotask] Failed to start server:', err)
        }
      }
    })

    // Inject scripts into HTML (works with html-webpack-plugin)
    // Skip injection when server option is set — the root shell handles bridge/toggle
    if (this.options.server) return

    compiler.hooks.compilation.tap('AnnotaskWebpackPlugin', (compilation: any) => {
      // Find HtmlWebpackPlugin from registered plugins
      const htmlPluginConstructor = compiler.options.plugins
        ?.map((p: any) => p.constructor)
        .find((c: any) => c && typeof c.getHooks === 'function')

      if (!htmlPluginConstructor) return

      const hooks = htmlPluginConstructor.getHooks(compilation)
      hooks.beforeEmit.tapAsync('AnnotaskWebpackPlugin', (data: any, cb: any) => {
        const scripts = `\n<script>${bridgeClientScript()}</script>`
        // Function replacer: a string replacement would expand `$'`/`$&`
        // inside the bridge source (React fiber key prefixes) into replace()
        // patterns and corrupt the script.
        data.html = data.html.replace('</body>', () => scripts + '\n</body>')
        cb(null, data)
      })
    })
  }
}
