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

function request(server: http.Server, method: string, path: string, body?: unknown): Promise<{ status: number; data: any; raw: string }> {
  return new Promise((resolve, reject) => {
    const url = new URL(path, `http://localhost:${(server.address() as any).port}`)
    const options: http.RequestOptions = { method, hostname: url.hostname, port: url.port, path: url.pathname, headers: {} }
    if (body !== undefined) {
      options.headers = { 'Content-Type': 'application/json' }
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

  const options = {
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
})
