import { describe, it, expect } from 'vitest'
import http from 'node:http'
import os from 'node:os'
import fsp from 'node:fs/promises'
import nodePath from 'node:path'
import { AddressInfo } from 'node:net'
import { createMcpMiddleware, type McpDeps } from '../server'
import { getSystemPrompt } from '../../skills/index.js'

function makeDeps(overrides: Partial<McpDeps> = {}): McpDeps {
  return {
    projectRoot: process.cwd(),
    getDesignSpec: () => null,
    getTasks: () => ({ version: '1.0', tasks: [] }),
    addTask: async (t) => t,
    updateTask: async (_id, u) => u,
    deleteTask: async () => ({ ok: true }),
    readInteractionHistory: async () => null,
    readRenderedHtml: async () => null,
    ...overrides,
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

/** Spin the real HTTP middleware on an ephemeral port for the duration of `fn`. */
async function withServer(deps: McpDeps, fn: (url: string) => Promise<void>): Promise<void> {
  const middleware = createMcpMiddleware(deps)
  const server = http.createServer((req, res) => {
    middleware(req, res, () => { res.statusCode = 404; res.end() })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  try {
    await fn(`http://127.0.0.1:${port}/__annotask/mcp`)
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
}

/** Real tools/call through the JSON-RPC transport. Returns the envelope plus parsed text payload. */
async function toolCall(url: string, name: string, args: Record<string, unknown>): Promise<{ isError: boolean; text: string; json: any }> {
  const response = await rpc(url, { jsonrpc: '2.0', method: 'tools/call', id: 1, params: { name, arguments: args } })
  expect(response.result).toBeTruthy()
  const text: string = response.result.content?.[0]?.text ?? ''
  let json: any = null
  try { json = JSON.parse(text) } catch { /* non-JSON payloads (error strings) stay null */ }
  return { isError: response.result.isError === true, text, json }
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

  it('lists the agent-grounding tools (source excerpt, playbook, agent directions)', async () => {
    await withServer(makeDeps(), async (url) => {
      const response = await rpc(url, { jsonrpc: '2.0', method: 'tools/list', id: 3 })
      const names = response.result.tools.map((t: any) => t.name)
      expect(names).toContain('annotask_get_source_excerpt')
      expect(names).toContain('annotask_get_playbook')
      expect(names).toContain('annotask_get_agent_directions')
    })
  })
})

describe('MCP tools/call — annotask_get_source_excerpt', () => {
  it('grounds an arbitrary file/line to a source excerpt', async () => {
    await withServer(makeDeps(), async (url) => {
      const { isError, json } = await toolCall(url, 'annotask_get_source_excerpt', {
        file: 'src/schema.ts',
        line: 10,
        context_lines: 5,
      })
      expect(isError).toBe(false)
      expect(json.file).toBe('src/schema.ts')
      expect(json.error).toBeUndefined()
      expect(json.excerpt).toBeTruthy()
      expect(json.excerpt_hash).toMatch(/^[0-9a-f]{16}$/)
      // ±5 lines around line 10 — at most 11 lines.
      expect(json.excerpt.split('\n').length).toBeLessThanOrEqual(11)
      expect(json.excerpt_start_line).toBe(5)
    })
  })

  it('rejects escaping paths via resolveProjectFile containment', async () => {
    await withServer(makeDeps(), async (url) => {
      const { json } = await toolCall(url, 'annotask_get_source_excerpt', {
        file: '../'.repeat(12) + 'etc/passwd',
        line: 1,
      })
      // Same contract as GET /api/source-excerpt: a 200-shaped payload whose
      // `error` field flags the rejection, with no file contents leaked.
      expect(json.error).toBe('Invalid or escaping file path')
      expect(json.excerpt ?? '').toBe('')
    })
  })

  it('rejects missing/invalid arguments at the schema boundary', async () => {
    await withServer(makeDeps(), async (url) => {
      const { isError } = await toolCall(url, 'annotask_get_source_excerpt', { file: 'src/schema.ts' })
      expect(isError).toBe(true)
    })
  })
})

describe('MCP tools/call — annotask_get_playbook', () => {
  it('returns the WIREFRAME_APPLY companion for wireframe_apply', async () => {
    await withServer(makeDeps(), async (url) => {
      const { isError, json } = await toolCall(url, 'annotask_get_playbook', { task_type: 'wireframe_apply' })
      expect(isError).toBe(false)
      expect(json.task_type).toBe('wireframe_apply')
      expect(json.file).toBe('WIREFRAME_APPLY.md')
      expect(json.content).toContain('# Wireframe Apply')
      // Must be the real playbook, not a stub — anchors/instances are its core vocabulary.
      expect(json.content).toContain('anchor')
    })
  })

  it('returns a message (no content) for task types without a companion', async () => {
    await withServer(makeDeps(), async (url) => {
      const { isError, json } = await toolCall(url, 'annotask_get_playbook', { task_type: 'annotation' })
      expect(isError).toBe(false)
      expect(json.task_type).toBe('annotation')
      expect(json.content).toBeUndefined()
      expect(json.message).toMatch(/No companion playbook/)
    })
  })

  it('rejects unknown task types', async () => {
    await withServer(makeDeps(), async (url) => {
      const { isError, text } = await toolCall(url, 'annotask_get_playbook', { task_type: 'nonsense' })
      expect(isError).toBe(true)
      expect(text).toMatch(/Invalid task type/)
    })
  })
})

describe('MCP tools/call — annotask_get_agent_directions', () => {
  async function withAgentsJson(agents: Record<string, unknown>, fn: (deps: McpDeps) => Promise<void>): Promise<void> {
    const dir = await fsp.mkdtemp(nodePath.join(os.tmpdir(), 'annotask-mcp-test-'))
    try {
      await fsp.mkdir(nodePath.join(dir, '.annotask'), { recursive: true })
      await fsp.writeFile(nodePath.join(dir, '.annotask', 'agents.json'), JSON.stringify({ version: 1, agents }), 'utf-8')
      await fn(makeDeps({ projectRoot: dir }))
    } finally {
      await fsp.rm(dir, { recursive: true, force: true })
    }
  }

  it('returns all personas without persona_id', async () => {
    await withAgentsJson({ general: { projectDirections: 'Use Vue 3 SFC patterns' }, designer: { projectDirections: 'Tokens only' } }, async (deps) => {
      await withServer(deps, async (url) => {
        const { isError, json } = await toolCall(url, 'annotask_get_agent_directions', {})
        expect(isError).toBe(false)
        expect(json.version).toBe(1)
        expect(json.agents.general.projectDirections).toBe('Use Vue 3 SFC patterns')
        expect(json.agents.designer.projectDirections).toBe('Tokens only')
      })
    })
  })

  it('returns a single persona entry, and not_configured for unknown ids', async () => {
    await withAgentsJson({ general: { projectDirections: 'Use Vue 3 SFC patterns' } }, async (deps) => {
      await withServer(deps, async (url) => {
        const one = await toolCall(url, 'annotask_get_agent_directions', { persona_id: 'general' })
        expect(one.json.persona_id).toBe('general')
        expect(one.json.projectDirections).toBe('Use Vue 3 SFC patterns')

        const missing = await toolCall(url, 'annotask_get_agent_directions', { persona_id: 'bug-hunter' })
        expect(missing.isError).toBe(false)
        expect(missing.json.not_configured).toBe(true)
        expect(missing.json.projectDirections).toBe('')
      })
    })
  })
})

describe('MCP tools/call — task hygiene and guards', () => {
  const renderedTask = {
    id: 't1',
    type: 'annotation',
    status: 'pending',
    description: 'Make the header sticky',
    file: 'src/App.vue',
    line: 12,
    visual: { x: 1, y: 2 },
    interaction_history: { route_path: ['/'], actions: [{ kind: 'click' }] },
    context: { rendered: '<div class="header">big blob</div>', element_tag: 'div' },
  }

  it('get_tasks(detail=true) always strips context.rendered and interaction_history', async () => {
    const deps = makeDeps({ getTasks: () => ({ version: '1.0', tasks: [{ ...renderedTask }] }) })
    await withServer(deps, async (url) => {
      const { json } = await toolCall(url, 'annotask_get_tasks', { detail: true })
      expect(json.count).toBe(1)
      const task = json.tasks[0]
      expect(task.visual).toBeUndefined()
      expect(task.interaction_history).toBeUndefined()
      expect(task.context.rendered).toBeUndefined()
      // The rest of context survives — only the bulky snapshot comes off.
      expect(task.context.element_tag).toBe('div')
    })
  })

  it('get_task (single) still returns interaction_history and context.rendered', async () => {
    const deps = makeDeps({ getTasks: () => ({ version: '1.0', tasks: [{ ...renderedTask }] }) })
    await withServer(deps, async (url) => {
      const { json } = await toolCall(url, 'annotask_get_task', { task_id: 't1' })
      expect(json.interaction_history).toBeTruthy()
      expect(json.context.rendered).toContain('big blob')
    })
  })

  it('get_tasks paginates with limit/offset and reports total', async () => {
    const tasks = ['a', 'b', 'c'].map(id => ({ id, type: 'annotation', status: 'pending', description: id }))
    const deps = makeDeps({ getTasks: () => ({ version: '1.0', tasks }) })
    await withServer(deps, async (url) => {
      const paged = await toolCall(url, 'annotask_get_tasks', { limit: 1, offset: 1 })
      expect(paged.json.total).toBe(3)
      expect(paged.json.count).toBe(1)
      expect(paged.json.tasks[0].id).toBe('b')

      // No limit/offset → existing return-everything behavior.
      const all = await toolCall(url, 'annotask_get_tasks', {})
      expect(all.json.total).toBe(3)
      expect(all.json.count).toBe(3)
    })
  })

  it('update_task rejects invalid status transitions with the error envelope', async () => {
    const deps = makeDeps({
      getTasks: () => ({ version: '1.0', tasks: [{ id: 't1', type: 'annotation', status: 'pending', description: 'x' }] }),
    })
    await withServer(deps, async (url) => {
      const { isError, text } = await toolCall(url, 'annotask_update_task', { task_id: 't1', status: 'accepted' })
      expect(isError).toBe(true)
      expect(text).toMatch(/Invalid state transition: pending → accepted/)
    })
  })

  it('create_task rejects bogus task types', async () => {
    await withServer(makeDeps(), async (url) => {
      const { isError, text } = await toolCall(url, 'annotask_create_task', { type: 'totally_fake', description: 'x' })
      expect(isError).toBe(true)
      expect(text).toMatch(/Invalid task type/)
    })
  })
})
