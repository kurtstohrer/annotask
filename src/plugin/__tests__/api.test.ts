import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import http from 'http'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createAPIMiddleware } from '../../server/api'
import { createWireframeStore } from '../../server/wireframe-store'
import { createSessionStore } from '../../server/session-store'
import { createSnapshotStore } from '../../server/file-snapshots'
import type { WireframeDocument, WireframeInstance } from '../../shared/wireframe-types'
import { emptyDesignSessionDocument, type DesignSessionDocument, type SessionEntry } from '../../shared/design-session-types'

function createTestServer(options: Parameters<typeof createAPIMiddleware>[0]) {
  const middleware = createAPIMiddleware(options)

  const server = http.createServer((req, res) => {
    middleware(req, res, () => {
      res.statusCode = 404
      res.end('Not found')
    })
  })

  return server
}

function request(server: http.Server, method: string, path: string, body?: unknown, extraHeaders?: Record<string, string>): Promise<{ status: number; data: any; raw: string }> {
  return new Promise((resolve, reject) => {
    const url = new URL(path, `http://localhost:${(server.address() as any).port}`)
    const options: http.RequestOptions = { method, hostname: url.hostname, port: url.port, path: url.pathname + url.search, headers: { ...extraHeaders } }
    if (body !== undefined) {
      options.headers = { ...options.headers, 'Content-Type': 'application/json' }
    }
    const req = http.request(options, (res) => {
      let raw = ''
      res.on('data', (chunk) => { raw += chunk })
      res.on('end', () => {
        let data: any
        try { data = JSON.parse(raw) } catch { data = raw }
        resolve({ status: res.statusCode!, data, raw })
      })
    })
    req.on('error', reject)
    if (body !== undefined) req.write(JSON.stringify(body))
    req.end()
  })
}

describe('API endpoints', () => {
  let server: http.Server
  const tasks: any[] = []

  let perfSnapshot: unknown = null
  // Real wireframe store on a temp dir — the rev CAS and the accept/delete
  // lifecycle hooks are exactly what these tests exercise, so stubbing the
  // store would test nothing.
  let wireframeRoot: string
  let wireframeStore: ReturnType<typeof createWireframeStore>
  let sessionStore: ReturnType<typeof createSessionStore>
  const options = {
    projectRoot: '/tmp/annotask-test',
    getReport: () => ({ version: '1.0', changes: [] }),
    getConfig: () => ({ version: '1.0' }),
    getDesignSpec: () => ({ version: '1.0', initialized: false }),
    getTasks: () => ({ version: '1.0', tasks }),
    addTask: (task: Record<string, unknown>) => {
      const newTask = { id: `task-${Date.now()}`, status: 'pending', ...task }
      tasks.push(newTask)
      return newTask
    },
    updateTask: (id: string, updates: Record<string, unknown>, opts?: { guard?: (task: Record<string, unknown>) => string | null }) => {
      const task = tasks.find(t => t.id === id)
      if (!task) return { error: 'Task not found' }
      // Mirror the real store: the transition guard runs against the task as
      // it exists at update time (state.ts runs it inside the task lock).
      if (opts?.guard) {
        const reason = opts.guard(task)
        if (reason) return { error: 'Invalid transition', reason }
      }
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
    getPerformance: () => perfSnapshot,
    setPerformance: (data: unknown) => { perfSnapshot = data },
    ingestNetworkCalls: (_calls: unknown[]) => { /* no-op for tests */ },
    getRuntimeEndpointCatalog: () => ({ version: '1.0' as const, updatedAt: 0, endpoints: [] }),
    clearRuntimeEndpoints: () => { /* no-op for tests */ },
    // Embedded-chat stubs — these tests don't exercise the chat endpoints,
    // but APIOptions requires them. Each stub returns a sensible empty value.
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
    getAgentConfigs: async () => ({ version: 1 as const, agents: {} }),
    setAgentConfig: async () => ({ version: 1 as const, agents: {} }),
    getWireframe: async () => wireframeStore.get(),
    setWireframe: async (doc: WireframeDocument) => wireframeStore.set(doc),
    getDesignSession: async () => sessionStore.get(),
    setDesignSession: async (doc: DesignSessionDocument) => sessionStore.set(doc),
    clearDesignSession: async () => {
      const fresh = emptyDesignSessionDocument(`ds-${Date.now()}`)
      fresh.startedAt = Date.now()
      fresh.updatedAt = Date.now()
      return sessionStore.replace(fresh)
    },
    snapshots: undefined as never, // assigned a real store on the temp dir in beforeAll
    usageLedger: {
      append: async (e: { scope: 'task' | 'init' | 'apply' | 'chat' }) => ({ ts: 0, scope: e.scope, inputTokens: 0, outputTokens: 0 }),
      readAll: async () => [],
      summary: async () => ({
        totals: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, turns: 0, estimatedTurns: 0 },
        byScope: {
          task: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, turns: 0, estimatedTurns: 0 },
          init: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, turns: 0, estimatedTurns: 0 },
          apply: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, turns: 0, estimatedTurns: 0 },
          chat: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, turns: 0, estimatedTurns: 0 },
        },
        byProvider: {},
        firstAt: null,
        lastAt: null,
      }),
      recent: async () => [],
    },
  }

  beforeAll(async () => {
    wireframeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'annotask-api-wf-'))
    wireframeStore = createWireframeStore(wireframeRoot)
    sessionStore = createSessionStore(wireframeRoot)
    ;(options as { snapshots: unknown }).snapshots = createSnapshotStore(wireframeRoot)
    server = createTestServer(options)
    await new Promise<void>((resolve) => server.listen(0, resolve))
  })

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()))
    await fsp.rm(wireframeRoot, { recursive: true, force: true })
  })

  it('GET /api/report returns report', async () => {
    const { status, data } = await request(server, 'GET', '/__annotask/api/report')
    expect(status).toBe(200)
    expect(data.version).toBe('1.0')
    expect(data.changes).toEqual([])
  })

  it('GET /api/config returns config', async () => {
    const { status, data } = await request(server, 'GET', '/__annotask/api/config')
    expect(status).toBe(200)
    expect(data.version).toBe('1.0')
  })

  it('GET /api/design-spec returns design spec', async () => {
    const { status, data } = await request(server, 'GET', '/__annotask/api/design-spec')
    expect(status).toBe(200)
    expect(data.version).toBe('1.0')
  })

  it('GET /api/tasks returns task list', async () => {
    const { status, data } = await request(server, 'GET', '/__annotask/api/tasks')
    expect(status).toBe(200)
    expect(data.tasks).toEqual(tasks)
  })

  it('GET /api/project-components returns the Project library envelope', async () => {
    const { status, data } = await request(server, 'GET', '/__annotask/api/project-components')
    expect(status).toBe(200)
    expect(data.library.name).toBe('Project')
    expect(Array.isArray(data.library.components)).toBe(true)
    expect(typeof data.scannedAt).toBe('number')
  })

  it('GET /api/status returns ok', async () => {
    const { status, data } = await request(server, 'GET', '/__annotask/api/status')
    expect(status).toBe(200)
    expect(data.status).toBe('ok')
    expect(data.tool).toBe('annotask')
  })

  it('OPTIONS returns 200 with CORS headers', async () => {
    const { status } = await request(server, 'OPTIONS', '/__annotask/api/report')
    expect(status).toBe(200)
  })

  it('GET /api/unknown returns 404 with structured error envelope', async () => {
    const { status, data } = await request(server, 'GET', '/__annotask/api/unknown')
    expect(status).toBe(404)
    expect(data.error.message).toBe('Not found')
    expect(data.error.code).toBe('not_found')
  })

  describe('POST /api/tasks', () => {
    it('creates task with valid body', async () => {
      const { status, data } = await request(server, 'POST', '/__annotask/api/tasks', {
        type: 'style_update',
        description: 'Change color',
      })
      expect(status).toBe(200)
      expect(data.status).toBe('pending')
      expect(data.type).toBe('style_update')
    })

    it('rejects missing type field', async () => {
      const { status, data } = await request(server, 'POST', '/__annotask/api/tasks', {
        description: 'No type',
      })
      expect(status).toBe(400)
      expect(data.error.message).toContain('type')
    })

    it('rejects missing description field', async () => {
      const { status, data } = await request(server, 'POST', '/__annotask/api/tasks', {
        type: 'style_update',
      })
      expect(status).toBe(400)
      expect(data.error.message).toContain('description')
    })

    it('rejects invalid JSON', async () => {
      const { status, data } = await new Promise<any>((resolve, reject) => {
        const url = new URL('/__annotask/api/tasks', `http://localhost:${(server.address() as any).port}`)
        const req = http.request({ method: 'POST', hostname: url.hostname, port: url.port, path: url.pathname, headers: { 'Content-Type': 'application/json' } }, (res) => {
          let raw = ''
          res.on('data', (chunk) => { raw += chunk })
          res.on('end', () => resolve({ status: res.statusCode, data: JSON.parse(raw) }))
        })
        req.on('error', reject)
        req.write('not json{{{')
        req.end()
      })
      expect(status).toBe(400)
      expect(data.error.message).toContain('Invalid JSON')
    })

    it('rejects array body', async () => {
      const { status, data } = await request(server, 'POST', '/__annotask/api/tasks', [1, 2, 3])
      expect(status).toBe(400)
      expect(data.error.message).toContain('object')
    })

    it('rejects unknown task type', async () => {
      const { status, data } = await request(server, 'POST', '/__annotask/api/tasks', {
        type: 'bogus_type',
        description: 'Should be rejected',
      })
      expect(status).toBe(400)
      expect(data.error.message).toMatch(/task type|enum|type/i)
    })

    it('accepts every canonical task type', async () => {
      const canonical = [
        'annotation', 'section_request', 'style_update', 'theme_update',
        'a11y_fix', 'error_fix', 'perf_fix', 'wireframe_apply',
      ]
      for (const type of canonical) {
        const { status, data } = await request(server, 'POST', '/__annotask/api/tasks', {
          type,
          description: `canonical ${type}`,
        })
        expect(status, `type=${type}`).toBe(200)
        expect(data.type, `type=${type}`).toBe(type)
      }
    })
  })

  describe('PATCH /api/tasks/:id', () => {
    it('updates task with valid status', async () => {
      const taskId = tasks[0]?.id
      expect(taskId).toBeTruthy()
      // Must follow valid transitions: pending → in_progress → applied
      await request(server, 'PATCH', `/__annotask/api/tasks/${taskId}`, { status: 'in_progress' })
      const { status, data } = await request(server, 'PATCH', `/__annotask/api/tasks/${taskId}`, { status: 'applied' })
      expect(status).toBe(200)
      expect(data.status).toBe('applied')
    })

    it('rejects invalid status value', async () => {
      const taskId = tasks[0]?.id
      const { status, data } = await request(server, 'PATCH', `/__annotask/api/tasks/${taskId}`, { status: 'invalid_status' })
      expect(status).toBe(400)
      expect(data.error.message).toContain('Invalid status')
    })

    it('returns error for nonexistent task', async () => {
      const { data } = await request(server, 'PATCH', '/__annotask/api/tasks/nonexistent', { status: 'applied' })
      expect(data.error.message).toBe('Task not found')
    })
  })

  describe('agent feedback (needs_info)', () => {
    it('accepts needs_info status with valid agent_feedback', async () => {
      const taskId = tasks[0]?.id
      // Transition: applied → in_progress → needs_info
      await request(server, 'PATCH', `/__annotask/api/tasks/${taskId}`, { status: 'in_progress' })
      const { status, data } = await request(server, 'PATCH', `/__annotask/api/tasks/${taskId}`, {
        status: 'needs_info',
        agent_feedback: [{
          asked_at: Date.now(),
          message: 'Need clarification on auth',
          questions: [
            { id: 'q1', text: 'Which auth library?', type: 'choice', options: ['NextAuth', 'Clerk', 'Custom'] },
            { id: 'q2', text: 'Where is the session config?', type: 'text' },
          ],
        }],
      })
      expect(status).toBe(200)
      expect(data.status).toBe('needs_info')
      expect(data.agent_feedback).toHaveLength(1)
      expect(data.agent_feedback[0].questions).toHaveLength(2)
    })

    it('rejects non-array agent_feedback', async () => {
      const taskId = tasks[0]?.id
      const { status, data } = await request(server, 'PATCH', `/__annotask/api/tasks/${taskId}`, {
        agent_feedback: 'not an array',
      })
      expect(status).toBe(400)
      expect(data.error.message).toContain('array')
    })

    it('rejects agent_feedback entry without questions', async () => {
      const taskId = tasks[0]?.id
      const { status, data } = await request(server, 'PATCH', `/__annotask/api/tasks/${taskId}`, {
        agent_feedback: [{ asked_at: Date.now(), questions: [] }],
      })
      expect(status).toBe(400)
      expect(data.error.message).toContain('non-empty questions')
    })

    it('rejects choice question without options', async () => {
      const taskId = tasks[0]?.id
      const { status, data } = await request(server, 'PATCH', `/__annotask/api/tasks/${taskId}`, {
        agent_feedback: [{
          asked_at: Date.now(),
          questions: [{ id: 'q1', text: 'Pick one', type: 'choice' }],
        }],
      })
      expect(status).toBe(400)
      expect(data.error.message).toContain('options')
    })

    it('rejects invalid question type', async () => {
      const taskId = tasks[0]?.id
      const { status, data } = await request(server, 'PATCH', `/__annotask/api/tasks/${taskId}`, {
        agent_feedback: [{
          asked_at: Date.now(),
          questions: [{ id: 'q1', text: 'Something', type: 'radio' }],
        }],
      })
      expect(status).toBe(400)
      expect(data.error.message).toContain('type')
    })

    it('accepts blocked status with blocked_reason', async () => {
      const taskId = tasks[0]?.id
      // Transition: needs_info → in_progress → blocked
      await request(server, 'PATCH', `/__annotask/api/tasks/${taskId}`, { status: 'in_progress' })
      const { status, data } = await request(server, 'PATCH', `/__annotask/api/tasks/${taskId}`, {
        status: 'blocked',
        blocked_reason: 'Performance issue in third-party vue-router v4 — needs upstream fix',
      })
      expect(status).toBe(200)
      expect(data.status).toBe('blocked')
      expect(data.blocked_reason).toContain('vue-router')
    })

    it('accepts reply with answers and status back to in_progress', async () => {
      const taskId = tasks[0]?.id
      const { status, data } = await request(server, 'PATCH', `/__annotask/api/tasks/${taskId}`, {
        status: 'in_progress',
        agent_feedback: [{
          asked_at: Date.now() - 60000,
          message: 'Need clarification on auth',
          questions: [
            { id: 'q1', text: 'Which auth library?', type: 'choice', options: ['NextAuth', 'Clerk', 'Custom'] },
          ],
          answered_at: Date.now(),
          answers: [{ id: 'q1', value: 'NextAuth' }],
        }],
      })
      expect(status).toBe(200)
      expect(data.status).toBe('in_progress')
      expect(data.agent_feedback[0].answers).toHaveLength(1)
      expect(data.agent_feedback[0].answers[0].value).toBe('NextAuth')
    })
  })

  describe('POST /tasks field whitelisting', () => {
    it('strips server-controlled fields from POST body', async () => {
      const { status, data } = await request(server, 'POST', '/__annotask/api/tasks', {
        type: 'annotation',
        description: 'Test task',
        id: 'attacker-id',
        status: 'accepted',
        createdAt: 0,
        updatedAt: 0,
        feedback: 'injected feedback',
        resolution: 'fake resolution',
      })
      expect(status).toBe(200)
      // Server-controlled fields should not be overridden
      expect(data.id).not.toBe('attacker-id')
      expect(data.status).toBe('pending')
      expect(data.createdAt).not.toBe(0)
      // Fields not in POSTABLE_TASK_FIELDS should be stripped
      expect(data.feedback).toBeUndefined()
      expect(data.resolution).toBeUndefined()
    })
  })

  describe('screenshot filename validation', () => {
    it('rejects PATCH with path-traversal screenshot filename', async () => {
      const taskId = tasks[0]?.id
      const { status, data } = await request(server, 'PATCH', `/__annotask/api/tasks/${taskId}`, {
        screenshot: '../../tasks.json',
      })
      expect(status).toBe(400)
      expect(data.error.message).toContain('screenshot')
    })

    it('rejects PATCH with non-png screenshot filename', async () => {
      const taskId = tasks[0]?.id
      const { status, data } = await request(server, 'PATCH', `/__annotask/api/tasks/${taskId}`, {
        screenshot: 'malicious.html',
      })
      expect(status).toBe(400)
      expect(data.error.message).toContain('screenshot')
    })

    it('accepts valid screenshot filename', async () => {
      const taskId = tasks[0]?.id
      const { status, data } = await request(server, 'PATCH', `/__annotask/api/tasks/${taskId}`, {
        screenshot: 'screenshot-12345-abc.png',
      })
      expect(status).toBe(200)
      expect(data.screenshot).toBe('screenshot-12345-abc.png')
    })
  })

  describe('task state transitions', () => {
    let transitionTaskId: string

    it('creates a fresh task for transition tests', async () => {
      const { status, data } = await request(server, 'POST', '/__annotask/api/tasks', {
        type: 'annotation',
        description: 'Transition test task',
      })
      expect(status).toBe(200)
      transitionTaskId = data.id
      expect(data.status).toBe('pending')
    })

    it('rejects pending → accepted (skips required states)', async () => {
      const { status, data } = await request(server, 'PATCH', `/__annotask/api/tasks/${transitionTaskId}`, {
        status: 'accepted',
      })
      expect(status).toBe(400)
      expect(data.error.message).toContain('Invalid state transition')
    })

    it('rejects pending → review (skips in_progress)', async () => {
      const { status, data } = await request(server, 'PATCH', `/__annotask/api/tasks/${transitionTaskId}`, {
        status: 'review',
      })
      expect(status).toBe(400)
      expect(data.error.message).toContain('Invalid state transition')
    })

    it('allows pending → in_progress', async () => {
      const { status, data } = await request(server, 'PATCH', `/__annotask/api/tasks/${transitionTaskId}`, {
        status: 'in_progress',
      })
      expect(status).toBe(200)
      expect(data.status).toBe('in_progress')
    })

    it('rejects in_progress → accepted (must go through review)', async () => {
      const { status, data } = await request(server, 'PATCH', `/__annotask/api/tasks/${transitionTaskId}`, {
        status: 'accepted',
      })
      expect(status).toBe(400)
      expect(data.error.message).toContain('Invalid state transition')
    })

    it('allows in_progress → review', async () => {
      const { status, data } = await request(server, 'PATCH', `/__annotask/api/tasks/${transitionTaskId}`, {
        status: 'review',
      })
      expect(status).toBe(200)
      expect(data.status).toBe('review')
    })

    it('allows review → accepted', async () => {
      const { status, data } = await request(server, 'PATCH', `/__annotask/api/tasks/${transitionTaskId}`, {
        status: 'accepted',
      })
      expect(status).toBe(200)
    })

    it('concurrent pending → in_progress PATCHes: exactly one wins (guard runs at update time)', async () => {
      const created = await request(server, 'POST', '/__annotask/api/tasks', {
        type: 'annotation',
        description: 'Race test task',
      })
      expect(created.status).toBe(200)
      const id = created.data.id
      const [a, b] = await Promise.all([
        request(server, 'PATCH', `/__annotask/api/tasks/${id}`, { status: 'in_progress' }),
        request(server, 'PATCH', `/__annotask/api/tasks/${id}`, { status: 'in_progress' }),
      ])
      const ok = [a, b].filter(r => r.status === 200)
      const rejected = [a, b].filter(r => r.status === 400)
      expect(ok).toHaveLength(1)
      expect(rejected).toHaveLength(1)
      expect(rejected[0].data.error.code).toBe('invalid_transition')
      expect(rejected[0].data.error.message).toContain('Invalid state transition')
    })
  })

  describe('host validation (DNS-rebinding gate)', () => {
    afterEach(() => {
      delete process.env.ANNOTASK_ALLOWED_HOSTS
    })

    it('blocks GET /api/tasks with a non-local Host header', async () => {
      const { status, data } = await request(server, 'GET', '/__annotask/api/tasks', undefined, { Host: 'evil.example' })
      expect(status).toBe(403)
      expect(data.error.code).toBe('forbidden_host')
    })

    it('blocks the screenshot route with a non-local Host header', async () => {
      const { status, data } = await request(server, 'GET', '/__annotask/screenshots/screenshot-1-a.png', undefined, { Host: 'evil.example:5173' })
      expect(status).toBe(403)
      expect(data.error.code).toBe('forbidden_host')
    })

    it('blocks mutations with a non-local Host header even when Origin is local', async () => {
      const { status, data } = await request(server, 'POST', '/__annotask/api/tasks', {
        type: 'annotation', description: 'rebound',
      }, { Host: 'evil.example', Origin: 'http://localhost:5173' })
      expect(status).toBe(403)
      expect(data.error.code).toBe('forbidden_host')
    })

    it('allows explicit localhost and IP-literal Host headers', async () => {
      const local = await request(server, 'GET', '/__annotask/api/tasks', undefined, { Host: 'localhost:9999' })
      expect(local.status).toBe(200)
      const lan = await request(server, 'GET', '/__annotask/api/tasks', undefined, { Host: '192.168.1.20:5173' })
      expect(lan.status).toBe(200)
    })

    it('allows a host listed in ANNOTASK_ALLOWED_HOSTS', async () => {
      process.env.ANNOTASK_ALLOWED_HOSTS = 'evil.example'
      const { status } = await request(server, 'GET', '/__annotask/api/tasks', undefined, { Host: 'evil.example' })
      expect(status).toBe(200)
    })

    it('allows hosts threaded via the allowedHosts option (announced bind host)', async () => {
      const gated = createTestServer({ ...options, allowedHosts: () => ['dev.example.com'] })
      await new Promise<void>((resolve) => gated.listen(0, resolve))
      try {
        const ok = await request(gated, 'GET', '/__annotask/api/tasks', undefined, { Host: 'dev.example.com:5173' })
        expect(ok.status).toBe(200)
        const blocked = await request(gated, 'GET', '/__annotask/api/tasks', undefined, { Host: 'other.example.com' })
        expect(blocked.status).toBe(403)
        expect(blocked.data.error.code).toBe('forbidden_host')
      } finally {
        await new Promise<void>((resolve) => gated.close(() => resolve()))
      }
    })
  })

  describe('origin validation', () => {
    it('blocks POST from non-local origin', async () => {
      const { status, data } = await request(server, 'POST', '/__annotask/api/tasks', {
        type: 'annotation',
        description: 'From remote',
      }, { Origin: 'https://evil.example.com' })
      expect(status).toBe(403)
      expect(data.error.message).toContain('Forbidden')
    })

    it('blocks PATCH from non-local origin', async () => {
      const taskId = tasks[0]?.id
      const { status, data } = await request(server, 'PATCH', `/__annotask/api/tasks/${taskId}`, {
        description: 'hacked',
      }, { Origin: 'https://evil.example.com' })
      expect(status).toBe(403)
      expect(data.error.message).toContain('Forbidden')
    })

    it('allows mutation from localhost origin', async () => {
      const { status } = await request(server, 'POST', '/__annotask/api/tasks', {
        type: 'annotation',
        description: 'From localhost',
      }, { Origin: 'http://localhost:5173' })
      expect(status).toBe(200)
    })
  })

  describe('wireframe GET/PUT', () => {
    it('GET returns an empty document on a fresh project', async () => {
      const { status, data } = await request(server, 'GET', '/__annotask/api/wireframe')
      expect(status).toBe(200)
      expect(data.version).toBe('1.0')
      expect(Array.isArray(data.routes)).toBe(true)
    })

    it('PUT persists a document and GET returns it (with route filtering)', async () => {
      const doc: WireframeDocument = {
        version: '1.0',
        updatedAt: 1,
        routes: [
          { route: '/planets', instances: [
            { id: 'wfi-1', kind: 'component', anchor: { file: 'PlanetsPage.vue', line: 12, position: 'append' }, inserted: { tag: 'planetcard', componentName: 'PlanetCard' }, fidelity: 'live', mounted: true, createdAt: 1 },
          ] },
          { route: '/', instances: [] },
        ],
      }
      const put = await request(server, 'PUT', '/__annotask/api/wireframe', doc as unknown as Record<string, unknown>)
      expect(put.status).toBe(200)
      expect(put.data.routes).toHaveLength(2)
      // First write against a rev-less doc stamps the rev.
      expect(put.data.rev).toBe(1)

      const all = await request(server, 'GET', '/__annotask/api/wireframe')
      expect(all.data.routes).toHaveLength(2)
      expect(all.data.rev).toBe(1)

      const filtered = await request(server, 'GET', '/__annotask/api/wireframe?route=/planets')
      expect(filtered.data.routes).toHaveLength(1)
      expect(filtered.data.routes[0].instances[0].id).toBe('wfi-1')
    })

    it('PUT rejects a non-wireframe body', async () => {
      const { status, data } = await request(server, 'PUT', '/__annotask/api/wireframe', { nope: true })
      expect(status).toBe(400)
      expect(data.error.code).toBe('validation_failed')
    })

    it('PUT rejects a document with one malformed instance', async () => {
      const current = await request(server, 'GET', '/__annotask/api/wireframe')
      const { status, data } = await request(server, 'PUT', '/__annotask/api/wireframe', {
        version: '1.0', updatedAt: 2, rev: current.data.rev,
        routes: [{ route: '/planets', instances: [{ id: 'wfi-bad' /* no kind/anchor/inserted */ }] }],
      })
      expect(status).toBe(400)
      expect(data.error.code).toBe('validation_failed')
    })

    it('PUT with the current rev succeeds and increments; stale/missing rev → 409 conflict', async () => {
      const current = await request(server, 'GET', '/__annotask/api/wireframe')
      const rev = current.data.rev as number

      const ok = await request(server, 'PUT', '/__annotask/api/wireframe', {
        ...current.data, updatedAt: Date.now(), rev,
      })
      expect(ok.status).toBe(200)
      expect(ok.data.rev).toBe(rev + 1)

      // Replaying the same (now stale) rev — the other-tab scenario.
      const stale = await request(server, 'PUT', '/__annotask/api/wireframe', {
        ...current.data, updatedAt: Date.now(), rev,
      })
      expect(stale.status).toBe(409)
      expect(stale.data.error.code).toBe('conflict')

      // Missing rev once the doc carries one is just as stale.
      const { rev: _omitted, ...revless } = current.data
      const missing = await request(server, 'PUT', '/__annotask/api/wireframe', {
        ...revless, updatedAt: Date.now(),
      })
      expect(missing.status).toBe(409)
      expect(missing.data.error.code).toBe('conflict')

      // The losing writes must not have advanced the doc.
      const after = await request(server, 'GET', '/__annotask/api/wireframe')
      expect(after.data.rev).toBe(rev + 1)
    })
  })

  describe('design-session GET/PUT/DELETE', () => {
    function sessionEntry(id: string, extra: Partial<SessionEntry> = {}): SessionEntry {
      return {
        id,
        ordinal: 1,
        ts: 1,
        route: '/planets',
        change: {
          id: `c-${id}`, type: 'style_update', description: 'x', file: 'PlanetsPage.vue',
          section: 'style', line: 9, element: 'h1', property: 'color', before: 'red', after: 'blue',
        } as SessionEntry['change'],
        anchor: { file: 'PlanetsPage.vue', line: 9 },
        live: { status: 'pending' },
        ...extra,
      }
    }

    it('GET returns an empty document on a fresh project', async () => {
      const { status, data } = await request(server, 'GET', '/__annotask/api/design-session')
      expect(status).toBe(200)
      expect(data.version).toBe('1.0')
      expect(data.entries).toEqual([])
      expect(typeof data.sessionId).toBe('string')
    })

    it('PUT persists the journal (stamping the first rev) and CAS-rejects a stale rev', async () => {
      const doc: DesignSessionDocument = {
        version: '1.0', sessionId: 'ds-test-1', startedAt: 1, updatedAt: 1,
        entries: [sessionEntry('se-1')],
      }
      const put = await request(server, 'PUT', '/__annotask/api/design-session', doc as unknown as Record<string, unknown>)
      expect(put.status).toBe(200)
      expect(put.data.rev).toBe(1)
      expect(put.data.entries).toHaveLength(1)

      const got = await request(server, 'GET', '/__annotask/api/design-session')
      expect(got.data.entries[0].id).toBe('se-1')

      // Round-tripping the current rev wins; replaying it is the other-tab loss.
      const ok = await request(server, 'PUT', '/__annotask/api/design-session', {
        ...got.data, updatedAt: Date.now(), entries: [sessionEntry('se-1'), sessionEntry('se-2', { ordinal: 2 })],
      })
      expect(ok.status).toBe(200)
      expect(ok.data.rev).toBe(2)

      const stale = await request(server, 'PUT', '/__annotask/api/design-session', {
        ...got.data, updatedAt: Date.now(),
      })
      expect(stale.status).toBe(409)
      expect(stale.data.error.code).toBe('conflict')
    })

    it('PUT rejects a non-session body and a document with one malformed entry', async () => {
      const bad = await request(server, 'PUT', '/__annotask/api/design-session', { nope: true })
      expect(bad.status).toBe(400)
      expect(bad.data.error.code).toBe('validation_failed')

      const current = await request(server, 'GET', '/__annotask/api/design-session')
      const oneBad = await request(server, 'PUT', '/__annotask/api/design-session', {
        ...current.data, entries: [sessionEntry('se-good'), { id: 'se-bad' }],
      })
      expect(oneBad.status).toBe(400)
      expect(oneBad.data.error.code).toBe('validation_failed')
    })

    it('DELETE discards the session: clears the journal and removes session-created placements', async () => {
      // Seed the wireframe doc with one session-owned instance and one foreign one.
      const wf = await request(server, 'GET', '/__annotask/api/wireframe')
      const seeded = await request(server, 'PUT', '/__annotask/api/wireframe', {
        version: '1.0', updatedAt: Date.now(), rev: wf.data.rev,
        routes: [{
          route: '/planets',
          instances: [
            { id: 'wfi-session', kind: 'component', anchor: { file: 'PlanetsPage.vue', line: 12, position: 'append' }, inserted: { tag: 'planetcard', componentName: 'PlanetCard' }, fidelity: 'live', mounted: true, createdAt: 1 },
            { id: 'wfi-keep', kind: 'component', anchor: { file: 'PlanetsPage.vue', line: 20, position: 'append' }, inserted: { tag: 'tag' }, fidelity: 'live', mounted: true, createdAt: 1 },
          ],
        }],
      })
      expect(seeded.status).toBe(200)

      // Seed the session journal with a placement cross-ref + an element edit.
      const current = await request(server, 'GET', '/__annotask/api/design-session')
      const put = await request(server, 'PUT', '/__annotask/api/design-session', {
        ...current.data, updatedAt: Date.now(),
        entries: [
          sessionEntry('se-place', { instanceId: 'wfi-session', change: { id: 'c-place', type: 'component_insert', description: 'place', file: 'PlanetsPage.vue', section: 'template', line: 12, insert_position: 'append', inserted: { tag: 'planetcard' } } as never }),
          sessionEntry('se-style', { ordinal: 2 }),
        ],
      })
      expect(put.status).toBe(200)

      const del = await request(server, 'DELETE', '/__annotask/api/design-session')
      expect(del.status).toBe(200)
      expect(del.data.removedInstances).toBe(1)
      expect(del.data.revertedFiles).toEqual([])

      const after = await request(server, 'GET', '/__annotask/api/design-session')
      expect(after.data.entries).toEqual([])
      expect(after.data.sessionId).not.toBe(put.data.sessionId)

      const wfAfter = await request(server, 'GET', '/__annotask/api/wireframe')
      const ids = wfAfter.data.routes.flatMap((r: { instances: Array<{ id: string }> }) => r.instances.map((i) => i.id))
      expect(ids).toContain('wfi-keep')
      expect(ids).not.toContain('wfi-session')
    })
  })

  describe('wireframe lifecycle closure (task accept / delete hooks)', () => {
    function instance(id: string, extra: Partial<WireframeInstance> = {}): WireframeInstance {
      return {
        id,
        kind: 'component',
        anchor: { file: 'PlanetsPage.vue', line: 9, position: 'append' },
        inserted: { tag: 'planetcard', componentName: 'PlanetCard' },
        fidelity: 'live',
        mounted: true,
        createdAt: 1,
        ...extra,
      }
    }

    /** PUT the routes payload with the current rev (CAS round-trip). */
    async function putRoutes(routes: WireframeDocument['routes']): Promise<void> {
      const current = await request(server, 'GET', '/__annotask/api/wireframe')
      const put = await request(server, 'PUT', '/__annotask/api/wireframe', {
        version: '1.0', updatedAt: Date.now(), rev: current.data.rev, routes,
      })
      expect(put.status).toBe(200)
    }

    it('accepting a wireframe_apply task removes its instances (and only its instances)', async () => {
      const created = await request(server, 'POST', '/__annotask/api/tasks', {
        type: 'wireframe_apply', description: 'Build /planets',
      })
      expect(created.status).toBe(200)
      const taskId = created.data.id as string

      await putRoutes([
        { route: '/planets', instances: [
          instance('wfi-owned-1', { status: 'building', taskId }),
          instance('wfi-owned-2', { status: 'building', taskId }),
          instance('wfi-other', { status: 'placed' }),
        ] },
      ])

      // Walk the full lifecycle the agent would: lock → review → accept.
      await request(server, 'PATCH', `/__annotask/api/tasks/${taskId}`, { status: 'in_progress' })
      await request(server, 'PATCH', `/__annotask/api/tasks/${taskId}`, { status: 'review' })
      const accepted = await request(server, 'PATCH', `/__annotask/api/tasks/${taskId}`, { status: 'accepted' })
      expect(accepted.status).toBe(200)

      const after = await request(server, 'GET', '/__annotask/api/wireframe')
      const planets = after.data.routes.find((r: { route: string }) => r.route === '/planets')
      expect(planets.instances.map((i: { id: string }) => i.id)).toEqual(['wfi-other'])
    })

    it('deleting a wireframe_apply task reverts its instances to placed and clears taskId', async () => {
      const created = await request(server, 'POST', '/__annotask/api/tasks', {
        type: 'wireframe_apply', description: 'Build /moons',
      })
      expect(created.status).toBe(200)
      const taskId = created.data.id as string

      await putRoutes([
        { route: '/moons', instances: [
          instance('wfi-reverted', { status: 'building', taskId }),
        ] },
      ])

      const deleted = await request(server, 'DELETE', `/__annotask/api/tasks/${taskId}`)
      expect(deleted.status).toBe(200)

      const after = await request(server, 'GET', '/__annotask/api/wireframe')
      const moons = after.data.routes.find((r: { route: string }) => r.route === '/moons')
      expect(moons.instances).toHaveLength(1)
      expect(moons.instances[0].status).toBe('placed')
      expect(moons.instances[0].taskId).toBeUndefined()
    })

    it('accepting a non-wireframe task leaves the wireframe document untouched', async () => {
      const before = await request(server, 'GET', '/__annotask/api/wireframe')
      const created = await request(server, 'POST', '/__annotask/api/tasks', {
        type: 'annotation', description: 'unrelated',
      })
      const taskId = created.data.id as string
      await request(server, 'PATCH', `/__annotask/api/tasks/${taskId}`, { status: 'in_progress' })
      await request(server, 'PATCH', `/__annotask/api/tasks/${taskId}`, { status: 'review' })
      await request(server, 'PATCH', `/__annotask/api/tasks/${taskId}`, { status: 'accepted' })
      const after = await request(server, 'GET', '/__annotask/api/wireframe')
      expect(after.data.rev).toBe(before.data.rev)
    })
  })

  describe('wireframe-snapshots upload/serve/delete', () => {
    // 1x1 transparent PNG
    const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
    const dataUrl = `data:image/png;base64,${PNG_B64}`

    afterAll(async () => {
      await fsp.rm(path.join(options.projectRoot, '.annotask', 'wireframe-snapshots'), { recursive: true, force: true })
    })

    it('uploads under the shell-minted id, serves it back as PNG, deletes it', async () => {
      const up = await request(server, 'POST', '/__annotask/api/wireframe-snapshots', { id: 'wfb-test-1', data: dataUrl })
      expect(up.status).toBe(200)
      expect(up.data.filename).toBe('wfb-test-1.png')

      const served = await request(server, 'GET', '/__annotask/wireframe-snapshots/wfb-test-1.png')
      expect(served.status).toBe(200)
      expect(served.raw.length).toBeGreaterThan(0)

      const del = await request(server, 'DELETE', '/__annotask/api/wireframe-snapshots/wfb-test-1.png')
      expect(del.status).toBe(200)
      expect(del.data.deleted).toBe('wfb-test-1.png')

      const gone = await request(server, 'GET', '/__annotask/wireframe-snapshots/wfb-test-1.png')
      expect(gone.status).toBe(404)
    })

    it('re-upload under the same id overwrites (recapture semantics)', async () => {
      await request(server, 'POST', '/__annotask/api/wireframe-snapshots', { id: 'wfb-test-2', data: dataUrl })
      const again = await request(server, 'POST', '/__annotask/api/wireframe-snapshots', { id: 'wfb-test-2', data: dataUrl })
      expect(again.status).toBe(200)
      expect(again.data.filename).toBe('wfb-test-2.png')
    })

    it('rejects ids that are not shell-mintable (traversal/case/format)', async () => {
      for (const id of ['../escape', 'a/b', 'UPPER', 'wfb_underscore', '', '-leading']) {
        const res = await request(server, 'POST', '/__annotask/api/wireframe-snapshots', { id, data: dataUrl })
        expect(res.status, `id ${JSON.stringify(id)} must be rejected`).toBe(400)
      }
    })

    it('rejects non-PNG payloads and oversized bodies', async () => {
      const badType = await request(server, 'POST', '/__annotask/api/wireframe-snapshots', { id: 'wfb-test-3', data: 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=' })
      expect(badType.status).toBe(400)
      // Over the 4MB decoded cap → clean 413 from the buffer check (the raised
      // image-body read cap lets the body arrive so the real boundary answers).
      const pngSig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
      const big = `data:image/png;base64,${Buffer.concat([pngSig, Buffer.alloc(4 * 1024 * 1024 + 16)]).toString('base64')}`
      const result = await request(server, 'POST', '/__annotask/api/wireframe-snapshots', { id: 'wfb-test-4', data: big })
      expect(result.status).toBe(413)
      expect(fs.existsSync(path.join(options.projectRoot, '.annotask', 'wireframe-snapshots', 'wfb-test-4.png'))).toBe(false)
    })

    it('accepts a legal PNG between 3MB and 4MB (base64 inflation must not shrink the cap)', async () => {
      // ~3.5MB decoded → ~4.7MB JSON body: over the old global body cap, under
      // the promised 4MB image cap. Retina block captures live in this band.
      const pngSig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
      const legal = `data:image/png;base64,${Buffer.concat([pngSig, Buffer.alloc(3_500_000)]).toString('base64')}`
      const up = await request(server, 'POST', '/__annotask/api/wireframe-snapshots', { id: 'wfb-test-5', data: legal })
      expect(up.status).toBe(200)
      expect(up.data.filename).toBe('wfb-test-5.png')
    })

    it('serve and delete refuse filenames outside the minted-id shape', async () => {
      expect((await request(server, 'GET', '/__annotask/wireframe-snapshots/..%2Fescape.png')).status).toBe(400)
      expect((await request(server, 'GET', '/__annotask/wireframe-snapshots/NOPE.PNG')).status).toBe(400)
      expect((await request(server, 'DELETE', '/__annotask/api/wireframe-snapshots/..%2Fescape.png')).status).toBe(400)
    })
  })
})
