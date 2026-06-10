import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest'
import http from 'node:http'
import { AddressInfo } from 'node:net'
import { createAPIMiddleware } from '../../server/api'
import { runCli } from '../index'

// ── Harness ───────────────────────────────────────────
// Real createAPIMiddleware on an ephemeral port (same pattern as
// src/plugin/__tests__/api.test.ts) + the CLI driven in-process via runCli.
// stdout is captured through a console.log spy; `inProcess: true` makes the
// CLI's exit() unwind into the resolved exit code instead of killing vitest.

function createTestServer(options: Parameters<typeof createAPIMiddleware>[0]) {
  const middleware = createAPIMiddleware(options)
  return http.createServer((req, res) => {
    middleware(req, res, () => {
      res.statusCode = 404
      res.end('Not found')
    })
  })
}

/** A task with every field the --mcp output is supposed to strip in list mode. */
const seededTask = {
  id: 'task-1',
  type: 'annotation',
  status: 'pending',
  description: 'Make the header sticky',
  file: 'src/App.vue',
  line: 12,
  visual: { x: 10, y: 20, marker: 'pin' },
  interaction_history: { route_path: ['/'], actions: [{ kind: 'click', target: 'button' }] },
  context: { rendered: '<div class="header">embedded outerHTML blob</div>', element_tag: 'div' },
}

function makeOptions() {
  const tasks: Array<Record<string, unknown>> = [{ ...seededTask, context: { ...seededTask.context } }]
  return {
    // Repo root so source-excerpt can read real files through resolveProjectFile.
    projectRoot: process.cwd(),
    getReport: () => ({ version: '1.0', changes: [] }),
    getConfig: () => ({ version: '1.0' }),
    getDesignSpec: () => ({ version: '1.0', initialized: false }),
    getTasks: () => ({ version: '1.0', tasks }),
    addTask: (task: Record<string, unknown>) => {
      const newTask = { id: `task-${Date.now()}`, status: 'pending', ...task }
      tasks.push(newTask)
      return newTask
    },
    updateTask: (id: string, updates: Record<string, unknown>) => {
      const task = tasks.find(t => t.id === id)
      if (!task) return { error: 'Task not found' }
      Object.assign(task, updates)
      return task
    },
    deleteTask: (id: string) => {
      const idx = tasks.findIndex(t => t.id === id)
      if (idx === -1) return { error: 'Task not found' }
      tasks.splice(idx, 1)
      return { deleted: id }
    },
    saveInteractionHistory: async (_id: string, _snapshot: unknown) => { /* no-op for tests */ },
    readInteractionHistory: async (_id: string) => null,
    saveRenderedHtml: async (_id: string, _html: string) => { /* no-op for tests */ },
    readRenderedHtml: async (_id: string) => null,
    getPerformance: () => null as unknown,
    setPerformance: (_data: unknown) => { /* no-op for tests */ },
    ingestNetworkCalls: (_calls: unknown[]) => { /* no-op for tests */ },
    getRuntimeEndpointCatalog: () => ({ version: '1.0' as const, updatedAt: 0, endpoints: [] }),
    clearRuntimeEndpoints: () => { /* no-op for tests */ },
    taskThread: {
      read: async (_id: string) => [],
      append: async (_id: string, input: { role: 'user' | 'assistant' | 'system' | 'tool'; content: string }) => ({
        id: 'msg-test', ts: 0, role: input.role, content: input.content,
      }),
      update: async (_id: string, msgId: string, patch: { content?: string }) => ({
        id: msgId, ts: 0, role: 'assistant' as const, content: patch.content ?? '',
      }),
      subscribe: () => () => { /* no-op */ },
      clear: async () => { /* no-op */ },
    },
    agentSpawn: {
      registry: { abort: () => false, size: () => 0, taskRunning: () => false, killAll: () => { /* no-op */ } },
      handleSpawn: async (_req: unknown, res: { statusCode: number; end: (s?: string) => void }) => {
        res.statusCode = 501; res.end('not supported in this test')
      },
    },
    agentDetect: {
      detect: async () => ({
        'claude-local': { found: false },
        'codex-local': { found: false },
        'opencode-local': { found: false },
        'copilot-local': { found: false },
        copilot: { found: false },
        openrouter: { hasEnv: false },
        ts: 0,
      }),
      invalidate: () => { /* no-op */ },
    },
    initRunner: {
      start: () => ({ running: false, steps: [] }),
      cancel: () => { /* no-op */ },
      commit: async () => ({ running: false, steps: [], result: 'success' as const }),
      skip: async () => ({ running: false, steps: [], result: 'success' as const }),
      reset: () => ({ running: false, steps: [] }),
      getState: () => ({ running: false, steps: [] }),
    },
    getAgentConfigs: async () => ({
      version: 1 as const,
      agents: { general: { projectDirections: 'Prefer composables over mixins' } },
    }),
    setAgentConfig: async () => ({ version: 1 as const, agents: {} }),
    getWireframe: async () => ({ version: '1.0' as const, updatedAt: 0, routes: [] }),
    setWireframe: async (doc: any) => doc,
    renderInPlaceEnabled: false,
    writeDraft: async () => ({ draftId: 'draft-test' }),
    revertDraft: async () => ({ reverted: true }),
    usageLedger: {
      append: async (e: { scope: 'task' | 'init' | 'apply' | 'chat' }) => ({ ts: 0, scope: e.scope, inputTokens: 0, outputTokens: 0 }),
      readAll: async () => [],
      summary: async () => ({
        totals: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, turns: 0 },
        byScope: {
          task: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, turns: 0 },
          init: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, turns: 0 },
          apply: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, turns: 0 },
          chat: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, turns: 0 },
        },
        byProvider: {},
        firstAt: null,
        lastAt: null,
      }),
      recent: async () => [],
    },
  }
}

describe('CLI --mcp parity and structured errors', () => {
  let server: http.Server
  let serverUrl = ''
  let deadUrl = ''
  let logs: string[] = []

  beforeAll(async () => {
    server = createTestServer(makeOptions() as Parameters<typeof createAPIMiddleware>[0])
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    serverUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`

    // A port that *was* bound and is now closed — guaranteed-dead endpoint
    // without racing against other processes grabbing it.
    const dead = http.createServer()
    await new Promise<void>((resolve) => dead.listen(0, '127.0.0.1', resolve))
    deadUrl = `http://127.0.0.1:${(dead.address() as AddressInfo).port}`
    await new Promise<void>((resolve) => dead.close(() => resolve()))
  })

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  })

  beforeEach(() => {
    logs = []
    vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => { logs.push(a.join(' ')) })
    vi.spyOn(console, 'error').mockImplementation(() => { /* silence human stderr */ })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  /** Run the CLI in-process and parse its single-line JSON stdout. */
  async function run(argv: string[]): Promise<{ code: number; out: any }> {
    const code = await runCli([...argv, `--server=${serverUrl}`], { inProcess: true })
    return { code, out: logs.length > 0 ? JSON.parse(logs[logs.length - 1]) : null }
  }

  it('tasks --mcp returns summaries with visual/context stripped', async () => {
    const { code, out } = await run(['tasks', '--mcp'])
    expect(code).toBe(0)
    expect(out.count).toBe(1)
    const task = out.tasks[0]
    expect(task.id).toBe('task-1')
    expect(task.visual).toBeUndefined()
    expect(task.context).toBeUndefined()
    // Summary lifting keeps the triage-relevant locator field.
    expect(task.element_tag).toBe('div')
  })

  it('tasks --mcp --detail strips visual, interaction_history, and context.rendered', async () => {
    const { code, out } = await run(['tasks', '--mcp', '--detail'])
    expect(code).toBe(0)
    const task = out.tasks[0]
    expect(task.visual).toBeUndefined()
    expect(task.interaction_history).toBeUndefined()
    expect(task.context.rendered).toBeUndefined()
    expect(task.context.element_tag).toBe('div')
  })

  it('source-excerpt --mcp grounds an arbitrary file/line', async () => {
    const { code, out } = await run(['source-excerpt', '--file=src/schema.ts', '--line=10', '--context-lines=5', '--mcp'])
    expect(code).toBe(0)
    expect(out.file).toBe('src/schema.ts')
    expect(out.error).toBeUndefined()
    expect(out.excerpt).toBeTruthy()
    expect(out.excerpt_hash).toMatch(/^[0-9a-f]{16}$/)
  })

  it('agent-directions --mcp returns one persona or not_configured', async () => {
    const one = await run(['agent-directions', 'general', '--mcp'])
    expect(one.code).toBe(0)
    expect(one.out.persona_id).toBe('general')
    expect(one.out.projectDirections).toBe('Prefer composables over mixins')

    const missing = await run(['agent-directions', 'designer', '--mcp'])
    expect(missing.code).toBe(0)
    expect(missing.out.not_configured).toBe(true)
  })

  it('playbook --mcp serves the bundled companion without a dev server', async () => {
    // No --server needed: playbook reads the packaged skill files directly.
    const code = await runCli(['playbook', 'wireframe_apply', '--mcp'], { inProcess: true })
    expect(code).toBe(0)
    const out = JSON.parse(logs[logs.length - 1])
    expect(out.task_type).toBe('wireframe_apply')
    expect(out.file).toBe('WIREFRAME_APPLY.md')
    expect(out.content).toContain('# Wireframe Apply')
  })

  it('prints a structured JSON error envelope when the server is down', async () => {
    const code = await runCli(['tasks', '--mcp', `--server=${deadUrl}`], { inProcess: true })
    expect(code).toBe(1)
    const out = JSON.parse(logs[logs.length - 1])
    expect(out.error.code).toBe('server_unreachable')
    expect(typeof out.error.message).toBe('string')
    expect(out.error.message).toMatch(/Failed to fetch tasks/)
  })

  it('prints a structured usage error under --mcp', async () => {
    // source-excerpt without its required --file/--line flags.
    const code = await runCli(['source-excerpt', '--mcp', `--server=${serverUrl}`], { inProcess: true })
    expect(code).toBe(1)
    const out = JSON.parse(logs[logs.length - 1])
    expect(out.error.code).toBe('usage')
    expect(out.error.message).toMatch(/Usage: annotask source-excerpt/)
  })

  it('not_found errors use the envelope too (task --mcp with bogus id)', async () => {
    const { code, out } = await run(['task', 'nope-404', '--mcp'])
    expect(code).toBe(1)
    expect(out.error.code).toBe('not_found')
    expect(out.error.message).toMatch(/Task not found: nope-404/)
  })
})
