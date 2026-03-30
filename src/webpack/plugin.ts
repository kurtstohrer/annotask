/**
 * Webpack plugin for Annotask.
 * Starts a standalone server, adds the SFC transform loader,
 * and injects bridge + toggle scripts into HTML.
 */
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { startStandaloneServer } from '../server/standalone.js'
import { bridgeClientScript } from '../plugin/bridge-client.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export interface AnnotaskWebpackOptions {
  port?: number
}

export class AnnotaskWebpackPlugin {
  private options: AnnotaskWebpackOptions
  private serverUrl: string = ''

  constructor(options: AnnotaskWebpackOptions = {}) {
    this.options = options
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
        options: { projectRoot },
      }],
    })

    // Start standalone server
    let serverStarted = false
    compiler.hooks.beforeCompile.tapPromise('AnnotaskWebpackPlugin', async () => {
      if (serverStarted) return
      serverStarted = true
      try {
        const { port } = await startStandaloneServer({ projectRoot, port: this.options.port })
        this.serverUrl = `http://localhost:${port}`
        console.log(`[Annotask] Server running at ${this.serverUrl}/__annotask/`)
      } catch (err) {
        console.error('[Annotask] Failed to start server:', err)
      }
    })

    // Inject scripts into HTML (works with html-webpack-plugin)
    compiler.hooks.compilation.tap('AnnotaskWebpackPlugin', (compilation: any) => {
      // Find HtmlWebpackPlugin from registered plugins
      const htmlPluginConstructor = compiler.options.plugins
        ?.map((p: any) => p.constructor)
        .find((c: any) => c && typeof c.getHooks === 'function')

      if (!htmlPluginConstructor) return

      const hooks = htmlPluginConstructor.getHooks(compilation)
      hooks.beforeEmit.tapAsync('AnnotaskWebpackPlugin', (data: any, cb: any) => {
        const scripts = `\n<script>${bridgeClientScript()}</script>`
        data.html = data.html.replace('</body>', scripts + '\n</body>')
        cb(null, data)
      })
    })
  }
}
