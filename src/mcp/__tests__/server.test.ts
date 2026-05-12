import { describe, it, expect } from 'vitest'
import http from 'node:http'
import { AddressInfo } from 'node:net'
import { createMcpMiddleware, type McpDeps } from '../server'
import { getSystemPrompt } from '../../skills/index.js'

function makeDeps(): McpDeps {
  return {
    projectRoot: process.cwd(),
    getDesignSpec: () => null,
    getTasks: () => ({ version: '1.0', tasks: [] }),
    addTask: async (t) => t,
    updateTask: async (_id, u) => u,
    deleteTask: async () => ({ ok: true }),
    readInteractionHistory: async () => null,
    readRenderedHtml: async () => null,
  }
}

async function rpc(url: string, body: object): Promise<any> {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Origin': 'http://localhost',
    },
    body: JSON.stringify(body),
  })
  if (res.status === 202) return null
  return res.json()
}

describe('MCP server — initialize.instructions', () => {
  it('returns the annotask-apply skill body as initialize.instructions', async () => {
    const middleware = createMcpMiddleware(makeDeps())
    const server = http.createServer((req, res) => {
      middleware(req, res, () => { res.statusCode = 404; res.end() })
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const { port } = server.address() as AddressInfo
    const url = `http://127.0.0.1:${port}/__annotask/mcp`

    try {
      const response = await rpc(url, {
        jsonrpc: '2.0',
        method: 'initialize',
        id: 1,
        params: { protocolVersion: '2025-03-26' },
      })

      expect(response).toBeTruthy()
      expect(response.result.protocolVersion).toBe('2025-03-26')
      expect(response.result.serverInfo.name).toBe('annotask')
      // Instructions must come from the shared loader so the MCP surface and
      // the embedded runner can never drift.
      const expected = getSystemPrompt()
      expect(response.result.instructions).toBe(expected)
      expect(response.result.instructions).toMatch(/annotask-apply/i)
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })

  it('still answers tools/list (existing surface unchanged)', async () => {
    const middleware = createMcpMiddleware(makeDeps())
    const server = http.createServer((req, res) => {
      middleware(req, res, () => { res.statusCode = 404; res.end() })
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const { port } = server.address() as AddressInfo
    const url = `http://127.0.0.1:${port}/__annotask/mcp`
    try {
      const response = await rpc(url, { jsonrpc: '2.0', method: 'tools/list', id: 2 })
      expect(Array.isArray(response.result.tools)).toBe(true)
      const names = response.result.tools.map((t: any) => t.name)
      expect(names).toContain('annotask_get_tasks')
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })
})
