import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { getWorkspaceCatalog, clearWorkspaceCatalogCache } from '../workspace-catalog'
import { clearWorkspaceCache } from '../workspace'

async function writePkg(dir: string, name: string): Promise<void> {
  await fsp.mkdir(dir, { recursive: true })
  await fsp.writeFile(path.join(dir, 'package.json'), JSON.stringify({ name }), 'utf-8')
}

describe('workspace-catalog', () => {
  let ws: string
  let host: string

  beforeEach(async () => {
    ws = fs.mkdtempSync(path.join(os.tmpdir(), 'annotask-wscat-'))
    clearWorkspaceCache()
    clearWorkspaceCatalogCache()
    await fsp.writeFile(path.join(ws, 'pnpm-workspace.yaml'), "packages:\n  - '*'\n", 'utf-8')
    host = path.join(ws, 'host')
    await writePkg(host, 'host')
  })

  afterEach(async () => {
    await fsp.rm(ws, { recursive: true, force: true })
  })

  function mfeOf(catalog: Awaited<ReturnType<typeof getWorkspaceCatalog>>, name: string): string | undefined {
    return catalog.packages.find((p) => p.name === name)?.mfe
  }

  it('sniffs annotask({ mfe }) from a vite config', async () => {
    const dir = path.join(ws, 'mfe-shop')
    await writePkg(dir, 'mfe-shop')
    await fsp.writeFile(path.join(dir, 'vite.config.ts'), `
import { defineConfig } from 'vite'
import { annotask } from 'annotask/vite'
export default defineConfig({ plugins: [annotask({ mfe: 'shop' })] })
`, 'utf-8')

    const catalog = await getWorkspaceCatalog(host)
    expect(mfeOf(catalog, 'mfe-shop')).toBe('shop')
  })

  it('sniffs new AnnotaskWebpackPlugin({ mfe }) from a webpack config', async () => {
    const dir = path.join(ws, 'mfe-checkout')
    await writePkg(dir, 'mfe-checkout')
    await fsp.writeFile(path.join(dir, 'webpack.config.mjs'), `
import { AnnotaskWebpackPlugin } from 'annotask/webpack'
export default {
  plugins: [new AnnotaskWebpackPlugin({ mfe: 'checkout' })],
}
`, 'utf-8')

    const catalog = await getWorkspaceCatalog(host)
    expect(mfeOf(catalog, 'mfe-checkout')).toBe('checkout')
  })

  it('finds the webpack mfe option behind other options and across lines', async () => {
    const dir = path.join(ws, 'mfe-cart')
    await writePkg(dir, 'mfe-cart')
    await fsp.writeFile(path.join(dir, 'webpack.config.js'), `
const { AnnotaskWebpackPlugin } = require('annotask/webpack')
module.exports = {
  plugins: [
    new AnnotaskWebpackPlugin({
      port: 4000,
      mfe: "cart",
    }),
  ],
}
`, 'utf-8')

    const catalog = await getWorkspaceCatalog(host)
    expect(mfeOf(catalog, 'mfe-cart')).toBe('cart')
  })

  it('a webpack package without the annotask plugin stays a plain library', async () => {
    const dir = path.join(ws, 'shared-ui')
    await writePkg(dir, 'shared-ui')
    await fsp.writeFile(path.join(dir, 'webpack.config.js'), `
module.exports = { entry: './src/index.ts' }
`, 'utf-8')

    const catalog = await getWorkspaceCatalog(host)
    expect(mfeOf(catalog, 'shared-ui')).toBeUndefined()
  })

  it('server.json wins over the config sniff', async () => {
    const dir = path.join(ws, 'mfe-booted')
    await writePkg(dir, 'mfe-booted')
    await fsp.mkdir(path.join(dir, '.annotask'), { recursive: true })
    await fsp.writeFile(path.join(dir, '.annotask', 'server.json'), JSON.stringify({ mfe: 'booted' }), 'utf-8')
    await fsp.writeFile(path.join(dir, 'webpack.config.js'), `
const { AnnotaskWebpackPlugin } = require('annotask/webpack')
module.exports = { plugins: [new AnnotaskWebpackPlugin({ mfe: 'stale' })] }
`, 'utf-8')

    const catalog = await getWorkspaceCatalog(host)
    expect(mfeOf(catalog, 'mfe-booted')).toBe('booted')
  })
})
