/**
 * HTTP-level tests for the agent-spawn route: the REAL createAPIMiddleware
 * wired to a REAL createAgentSpawnHandler over a real socket — only the child
 * process itself is faked (spawnImpl seam). The unit suite
 * (agent-spawn.test.ts) covers handler internals with fake req/res objects;
 * this file covers what only the middleware layer can: the same-port origin
 * gate (api.test.ts stubs handleSpawn, so it does NOT cover this), SSE
 * status/headers/framing on the wire, the concurrency refusal, client-
 * disconnect kills, and the ANNOTASK_MAX_PERMISSION cap as a caller sees it.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import http from 'node:http'
import { EventEmitter } from 'node:events'
import type { ChildProcessWithoutNullStreams, spawn as nodeSpawn } from 'node:child_process'
import { createAPIMiddleware } from '../api.js'
import { createAgentSpawnHandler } from '../agent-spawn.js'
import { emptyWireframeDocument, type WireframeDocument } from '../../shared/wireframe-types.js'

const SPAWN_PATH = '/__annotask/api/agent/spawn'
const MAX_LINE = 1_048_576 // mirrors MAX_BUFFERED_LINE_BYTES in agent-spawn.ts

// ── Fake child process (mirrors FakeChild in agent-spawn.test.ts) ──
// `pid` is deliberately ABSENT here: killChild then takes the direct
// child.kill path instead of process.kill(-pid), so no real signal can ever
// escape the test process. The group-kill (-pid) path is covered by the unit
// suite with a spied process.kill.
class FakeStream extends EventEmitter {
  setEncoding() { /* noop */ }
  write(_data: unknown, cb?: () => void) { if (cb) cb(); return true }
  end() { /* noop */ }
}
class FakeChild extends EventEmitter {
  stdin = new FakeStream()
  stdout = new FakeStream()
  stderr = new FakeStream()
  killed = false
  closed = false
  kill() { this.killed = true; return true }
  /** Resolve the handler's wait by emitting the child's `close` (idempotent
   *  so the afterEach drain can't double-emit on already-finished children). */
  finish(code = 0) {
    if (this.closed) return
    this.closed = true
    this.emit('close', code, null)
  }
}

/** Poll until `cond` holds — bridges "request sent" to "handler spawned child". */
function waitFor(cond: () => boolean, what: string, timeoutMs = 2_000): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now()
    const tick = () => {
      if (cond()) return resolve()
      if (Date.now() - start > timeoutMs) return reject(new Error(`timed out waiting for ${what}`))
      setTimeout(tick, 5)
    }
    tick()
  })
}

function request(
  server: http.Server,
  method: string,
  path: string,
  body?: unknown,
  extraHeaders?: Record<string, string>,
): Promise<{ status: number; headers: http.IncomingHttpHeaders; data: any; raw: string }> {
  return new Promise((resolve, reject) => {
    const port = (server.address() as { port: number }).port
    const options: http.RequestOptions = {
      method,
      hostname: 'localhost',
      port,
      path,
      headers: { ...extraHeaders, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    }
    const req = http.request(options, (res) => {
      let raw = ''
      res.on('data', (chunk) => { raw += chunk })
      res.on('end', () => {
        let data: any
        try { data = JSON.parse(raw) } catch { data = raw }
        resolve({ status: res.statusCode!, headers: res.headers, data, raw })
      })
    })
    req.on('error', reject)
    if (body !== undefined) req.write(JSON.stringify(body))
    req.end()
  })
}

describe('agent-spawn over HTTP (real middleware + real spawn handler)', () => {
  let server: http.Server
  const spawned: FakeChild[] = []
  const spawnImpl = (() => {
    const child = new FakeChild()
    spawned.push(child)
    return child as unknown as ChildProcessWithoutNullStreams
  }) as unknown as typeof nodeSpawn
  const agentSpawn = createAgentSpawnHandler({ spawnImpl })

  let wireframeDoc: WireframeDocument = emptyWireframeDocument()
  const options = {
    projectRoot: '/tmp/annotask-spawn-http-test',
    getReport: () => ({ version: '1.0', changes: [] }),
    getConfig: () => ({ version: '1.0' }),
    getDesignSpec: () => ({ version: '1.0', initialized: false }),
    getTasks: () => ({ version: '1.0', tasks: [] }),
    addTask: (task: Record<string, unknown>) => ({ id: 'task-test', status: 'pending', ...task }),
    updateTask: () => ({ error: 'Task not found' }),
    deleteTask: () => ({ error: 'Task not found' }),
    saveInteractionHistory: async () => { /* no-op for tests */ },
    readInteractionHistory: async () => null,
    saveRenderedHtml: async () => { /* no-op for tests */ },
    readRenderedHtml: async () => null,
    getPerformance: () => null,
    setPerformance: () => { /* no-op for tests */ },
    ingestNetworkCalls: () => { /* no-op for tests */ },
    getRuntimeEndpointCatalog: () => ({ version: '1.0' as const, updatedAt: 0, endpoints: [] }),
    clearRuntimeEndpoints: () => { /* no-op for tests */ },
    taskThread: {
      read: async () => [],
      append: async (_id: string, input: { role: 'user' | 'assistant' | 'system' | 'tool'; content: string }) => ({
        id: 'msg-test', ts: 0, role: input.role, content: input.content,
      }),
      update: async (_id: string, msgId: string, patch: { content?: string }) => ({
        id: msgId, ts: 0, role: 'assistant' as const, content: patch.content ?? '',
      }),
      subscribe: () => () => { /* no-op */ },
      clear: async () => { /* no-op */ },
    },
    // The one REAL collaborator under test.
    agentSpawn,
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
    getWireframe: async () => wireframeDoc,
    setWireframe: async (doc: WireframeDocument) => { wireframeDoc = doc; return doc },
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

  beforeAll(async () => {
    const middleware = createAPIMiddleware(options)
    server = http.createServer((req, res) => {
      middleware(req, res, () => { res.statusCode = 404; res.end('Not found') })
    })
    await new Promise<void>((resolve) => server.listen(0, resolve))
  })

  afterAll(async () => {
    agentSpawn.registry.killAll()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  })

  afterEach(async () => {
    delete process.env.ANNOTASK_MAX_PERMISSION
    // Drain: close any children a failed assertion left parked so their SSE
    // responses end and the active-run registry empties before the next test.
    for (const c of spawned) c.finish(0)
    await waitFor(() => agentSpawn.registry.size() === 0, 'active runs to drain')
    spawned.length = 0
  })

  function serverPort(): number {
    return (server.address() as { port: number }).port
  }

  it('403s a cross-port localhost Origin with origin_port_mismatch', async () => {
    const port = serverPort()
    const badPort = port === 9999 ? 9998 : 9999 // ephemeral ports can collide with the canned value
    const before = spawned.length
    const { status, data } = await request(server, 'POST', SPAWN_PATH, { cli: 'claude', args: [] }, {
      Origin: `http://localhost:${badPort}`,
    })
    expect(status).toBe(403)
    expect(data.error.code).toBe('origin_port_mismatch')
    expect(spawned.length).toBe(before) // refused before any child was spawned
  })

  it('streams SSE (run → stdout → exit) for a same-port Origin', async () => {
    const before = spawned.length
    const resP = request(server, 'POST', SPAWN_PATH, { cli: 'claude', args: ['--print'] }, {
      Origin: `http://localhost:${serverPort()}`,
    })
    await waitFor(() => spawned.length > before, 'child spawn')
    const child = spawned[spawned.length - 1]
    child.stdout.emit('data', 'hello world\n')
    child.finish(0)
    const { status, headers, raw } = await resP
    expect(status).toBe(200)
    expect(headers['content-type']).toBe('text/event-stream')
    expect(raw).toMatch(/event: run\ndata: \{"runId":"run-[^"]+"\}\n\n/)
    expect(raw).toContain('event: stdout\ndata: hello world\n')
    expect(raw).toContain('event: exit\ndata: {"code":0,"signal":null}')
  })

  it('passes with no Origin header at all (non-browser client, e.g. curl)', async () => {
    const before = spawned.length
    const resP = request(server, 'POST', SPAWN_PATH, { cli: 'codex', args: ['exec'] })
    await waitFor(() => spawned.length > before, 'child spawn')
    spawned[spawned.length - 1].finish(0)
    const { status, headers, raw } = await resP
    expect(status).toBe(200)
    expect(headers['content-type']).toBe('text/event-stream')
    expect(raw).toContain('event: run')
  })

  it('refuses the 5th concurrent spawn with 503 too_many_agents', async () => {
    const before = spawned.length
    const inflight: Array<ReturnType<typeof request>> = []
    for (let i = 0; i < 4; i++) {
      inflight.push(request(server, 'POST', SPAWN_PATH, { cli: 'claude', args: [] }))
    }
    await waitFor(() => spawned.length === before + 4, 'four parked children')
    expect(agentSpawn.registry.size()).toBe(4)

    const fifth = await request(server, 'POST', SPAWN_PATH, { cli: 'claude', args: [] })
    expect(fifth.status).toBe(503)
    expect(fifth.data.error.code).toBe('too_many_agents')
    expect(spawned.length).toBe(before + 4) // no fifth child was forked

    // Drain the four parked runs and confirm their streams completed normally.
    for (const c of spawned.slice(before)) c.finish(0)
    const results = await Promise.all(inflight)
    for (const r of results) expect(r.status).toBe(200)
  })

  it('kills the child when the client disconnects mid-stream', async () => {
    const before = spawned.length
    const clientReq = http.request({
      method: 'POST',
      hostname: 'localhost',
      port: serverPort(),
      path: SPAWN_PATH,
      headers: { 'Content-Type': 'application/json' },
    })
    clientReq.on('error', () => { /* expected after destroy */ })
    clientReq.on('response', (res) => {
      res.on('data', () => { /* keep the stream flowing */ })
      res.on('error', () => { /* expected after destroy */ })
    })
    clientReq.end(JSON.stringify({ cli: 'claude', args: [] }))

    await waitFor(() => spawned.length > before, 'child spawn')
    const child = spawned[spawned.length - 1]
    expect(child.killed).toBe(false)

    clientReq.destroy()
    await waitFor(() => child.killed, 'child kill on client disconnect')
    child.finish(143) // simulate the SIGTERM landing so the run drains
  })

  describe('ANNOTASK_MAX_PERMISSION cap at the route level', () => {
    it('403s a bypass spawn under cap=default — canonical flag AND synonym spellings', async () => {
      process.env.ANNOTASK_MAX_PERMISSION = 'default'
      const before = spawned.length

      const direct = await request(server, 'POST', SPAWN_PATH, {
        cli: 'claude', args: ['--print', '--dangerously-skip-permissions'],
      })
      expect(direct.status).toBe(403)
      expect(direct.data.error.code).toBe('permission_exceeds_cap')

      // Regression: the synonym pair form used to derive as `plan` and walk
      // straight past the cap.
      const synonym = await request(server, 'POST', SPAWN_PATH, {
        cli: 'claude', args: ['--print', '--permission-mode', 'bypassPermissions'],
      })
      expect(synonym.status).toBe(403)
      expect(synonym.data.error.code).toBe('permission_exceeds_cap')

      // Same hole on codex: sandbox-removal via the pair form.
      const codexSynonym = await request(server, 'POST', SPAWN_PATH, {
        cli: 'codex', args: ['exec', '--sandbox', 'danger-full-access'],
      })
      expect(codexSynonym.status).toBe(403)
      expect(codexSynonym.data.error.code).toBe('permission_exceeds_cap')

      expect(spawned.length).toBe(before) // every refusal happened pre-spawn
    })

    it('still allows a default-level spawn under cap=default', async () => {
      process.env.ANNOTASK_MAX_PERMISSION = 'default'
      const before = spawned.length
      const resP = request(server, 'POST', SPAWN_PATH, { cli: 'codex', args: ['exec', '--full-auto'] })
      await waitFor(() => spawned.length > before, 'child spawn')
      spawned[spawned.length - 1].finish(0)
      const { status } = await resP
      expect(status).toBe(200)
    })
  })

  it('truncates a >1MiB single-line stdout chunk and repeats data: prefixes for multi-line payloads', async () => {
    const before = spawned.length
    const resP = request(server, 'POST', SPAWN_PATH, { cli: 'claude', args: [] })
    await waitFor(() => spawned.length > before, 'child spawn')
    const child = spawned[spawned.length - 1]

    // One newline-free chunk over the cap: flushed truncated, remainder dropped.
    child.stdout.emit('data', 'x'.repeat(MAX_LINE + 64))
    // One oversized chunk WITH an embedded newline: the truncated flush is a
    // multi-line SSE payload, so the frame must repeat the `data: ` prefix.
    child.stdout.emit('data', 'first\nsecond' + 'z'.repeat(MAX_LINE))
    child.finish(0)

    const { status, raw } = await resP
    expect(status).toBe(200)
    const single = /event: stdout\ndata: (x+)\n\n/.exec(raw)
    expect(single).not.toBeNull()
    expect(single![1].length).toBe(MAX_LINE)
    expect(raw).toContain('event: stdout\ndata: first\ndata: second')
  })
})
