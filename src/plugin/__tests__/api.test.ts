import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import http from 'http'
import { createAPIMiddleware } from '../../server/api'

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
    const options: http.RequestOptions = { method, hostname: url.hostname, port: url.port, path: url.pathname, headers: { ...extraHeaders } }
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
    getPerformance: () => perfSnapshot,
    setPerformance: (data: unknown) => { perfSnapshot = data },
  }

  beforeAll(async () => {
    server = createTestServer(options)
    await new Promise<void>((resolve) => server.listen(0, resolve))
  })

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()))
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

  it('GET /api/unknown returns 404', async () => {
    const { status, data } = await request(server, 'GET', '/__annotask/api/unknown')
    expect(status).toBe(404)
    expect(data.error).toBe('Not found')
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
      expect(data.error).toContain('type')
    })

    it('rejects missing description field', async () => {
      const { status, data } = await request(server, 'POST', '/__annotask/api/tasks', {
        type: 'style_update',
      })
      expect(status).toBe(400)
      expect(data.error).toContain('description')
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
      expect(data.error).toContain('Invalid JSON')
    })

    it('rejects array body', async () => {
      const { status, data } = await request(server, 'POST', '/__annotask/api/tasks', [1, 2, 3])
      expect(status).toBe(400)
      expect(data.error).toContain('object')
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
      expect(data.error).toContain('Invalid status')
    })

    it('returns error for nonexistent task', async () => {
      const { data } = await request(server, 'PATCH', '/__annotask/api/tasks/nonexistent', { status: 'applied' })
      expect(data.error).toBe('Task not found')
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
      expect(data.error).toContain('array')
    })

    it('rejects agent_feedback entry without questions', async () => {
      const taskId = tasks[0]?.id
      const { status, data } = await request(server, 'PATCH', `/__annotask/api/tasks/${taskId}`, {
        agent_feedback: [{ asked_at: Date.now(), questions: [] }],
      })
      expect(status).toBe(400)
      expect(data.error).toContain('non-empty questions')
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
      expect(data.error).toContain('options')
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
      expect(data.error).toContain('type')
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
      expect(data.error).toContain('screenshot')
    })

    it('rejects PATCH with non-png screenshot filename', async () => {
      const taskId = tasks[0]?.id
      const { status, data } = await request(server, 'PATCH', `/__annotask/api/tasks/${taskId}`, {
        screenshot: 'malicious.html',
      })
      expect(status).toBe(400)
      expect(data.error).toContain('screenshot')
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
      expect(data.error).toContain('Invalid state transition')
    })

    it('rejects pending → review (skips in_progress)', async () => {
      const { status, data } = await request(server, 'PATCH', `/__annotask/api/tasks/${transitionTaskId}`, {
        status: 'review',
      })
      expect(status).toBe(400)
      expect(data.error).toContain('Invalid state transition')
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
      expect(data.error).toContain('Invalid state transition')
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
  })

  describe('origin validation', () => {
    it('blocks POST from non-local origin', async () => {
      const { status, data } = await request(server, 'POST', '/__annotask/api/tasks', {
        type: 'annotation',
        description: 'From remote',
      }, { Origin: 'https://evil.example.com' })
      expect(status).toBe(403)
      expect(data.error).toContain('Forbidden')
    })

    it('blocks PATCH from non-local origin', async () => {
      const taskId = tasks[0]?.id
      const { status, data } = await request(server, 'PATCH', `/__annotask/api/tasks/${taskId}`, {
        description: 'hacked',
      }, { Origin: 'https://evil.example.com' })
      expect(status).toBe(403)
      expect(data.error).toContain('Forbidden')
    })

    it('allows mutation from localhost origin', async () => {
      const { status } = await request(server, 'POST', '/__annotask/api/tasks', {
        type: 'annotation',
        description: 'From localhost',
      }, { Origin: 'http://localhost:5173' })
      expect(status).toBe(200)
    })
  })
})
