import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { parseViteProxy, scanDataSources, clearDataSourceCache } from '../data-source-scanner.js'
import { scanApiSchemas, clearApiSchemaCache } from '../api-schema-scanner.js'

describe('parseViteProxy', () => {
  it('extracts object-shorthand proxies', () => {
    const src = `
      import { defineConfig } from 'vite'
      export default defineConfig({
        server: {
          port: 4220,
          proxy: {
            '/api': { target: 'http://localhost:4320', changeOrigin: true },
          },
        },
      })`
    expect(parseViteProxy(src)).toEqual([
      { prefix: '/api', target: 'http://localhost:4320' },
    ])
  })

  it('extracts string-shorthand proxies', () => {
    const src = `export default { server: { proxy: {
      '/api': 'http://localhost:5000',
      '/graphql': { target: 'http://localhost:6000' },
    } } }`
    expect(parseViteProxy(src)).toEqual([
      { prefix: '/graphql', target: 'http://localhost:6000' },
      { prefix: '/api', target: 'http://localhost:5000' },
    ])
  })

  it('skips non-http targets (ws://, regex keys)', () => {
    const src = `export default { server: { proxy: {
      '/ws': { target: 'ws://localhost:7000' },
      '/good': { target: 'http://localhost:8000' },
    } } }`
    expect(parseViteProxy(src)).toEqual([
      { prefix: '/good', target: 'http://localhost:8000' },
    ])
  })

  it('returns empty array when no proxy block is present', () => {
    expect(parseViteProxy('export default { server: { port: 1234 } }')).toEqual([])
  })

  it('returns empty array on nonsense input', () => {
    expect(parseViteProxy('// just a comment')).toEqual([])
  })
})

describe('scanDataSources — proxy-aware resolved_endpoint', () => {
  it('rewrites path-only endpoints using the nearest vite.config proxy', async () => {
    const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'annotask-scan-'))
    try {
      await fsp.writeFile(path.join(tmp, 'package.json'), JSON.stringify({
        name: 'root',
        // Minimal dep list — the scanner only needs to find *something*
        // recognized to run the entry pass.
        dependencies: { 'vue-router': '4.0.0' },
      }))
      const mfeDir = path.join(tmp, 'apps', 'mfe-vue')
      await fsp.mkdir(path.join(mfeDir, 'src', 'composables'), { recursive: true })
      await fsp.writeFile(path.join(mfeDir, 'vite.config.ts'), `
        export default {
          server: { proxy: { '/api': { target: 'http://localhost:4320', changeOrigin: true } } },
        }
      `)
      await fsp.writeFile(path.join(mfeDir, 'src', 'composables', 'useHealth.ts'), `
        export function useHealth() {
          return fetch('/api/health').then(r => r.json())
        }
      `)

      clearDataSourceCache()
      const cat = await scanDataSources(tmp)
      const entry = cat.project_entries.find(e => e.name === 'useHealth')
      expect(entry).toBeDefined()
      expect(entry!.endpoint).toBe('/api/health')
      expect(entry!.resolved_endpoint).toBe('http://localhost:4320/api/health')
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true })
    }
  })

  it('leaves resolved_endpoint undefined when no vite.config is reachable', async () => {
    const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'annotask-scan-'))
    try {
      await fsp.writeFile(path.join(tmp, 'package.json'), JSON.stringify({
        name: 'root', dependencies: { 'vue-router': '4.0.0' },
      }))
      await fsp.mkdir(path.join(tmp, 'src', 'composables'), { recursive: true })
      await fsp.writeFile(path.join(tmp, 'src', 'composables', 'useHealth.ts'), `
        export function useHealth() { return fetch('/api/health') }
      `)
      clearDataSourceCache()
      const cat = await scanDataSources(tmp)
      const entry = cat.project_entries.find(e => e.name === 'useHealth')
      expect(entry?.resolved_endpoint).toBeUndefined()
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true })
    }
  })
})

describe('scanApiSchemas — schema.origin from OpenAPI servers', () => {
  it('extracts origin from filesystem OpenAPI servers field', async () => {
    const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'annotask-schema-'))
    try {
      // Workspace root package.json so resolveWorkspace doesn't bail.
      await fsp.writeFile(path.join(tmp, 'package.json'), JSON.stringify({ name: 'root' }))
      const svcDir = path.join(tmp, 'services', 'go-api')
      await fsp.mkdir(svcDir, { recursive: true })
      await fsp.writeFile(path.join(svcDir, 'openapi.json'), JSON.stringify({
        openapi: '3.0.3',
        info: { title: 'go-api', version: '0.0.1' },
        servers: [{ url: 'http://localhost:4330' }],
        paths: {
          '/api/health': { get: { responses: { '200': { description: 'OK' } } } },
        },
      }))
      clearApiSchemaCache()
      const cat = await scanApiSchemas(tmp, {})
      const schema = cat.schemas.find(s => s.title === 'go-api')
      expect(schema).toBeDefined()
      expect(schema!.origin).toBe('http://localhost:4330')
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true })
    }
  })
})
