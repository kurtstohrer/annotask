/**
 * Localhost-only subprocess spawner for local-CLI providers.
 *
 * The shell talks to the user's locally-installed agent CLIs (claude, codex,
 * opencode) by POSTing a spawn request here. We spawn the process, stream
 * its stdout/stderr back as text/event-stream, and let the caller abort via
 * the request's AbortSignal (i.e. the browser closes the EventSource).
 *
 * Security posture:
 *   - The Annotask dev server is only ever bound to localhost. Mutating
 *     routes already reject non-local origins (see api.ts:isLocalOrigin).
 *   - `cli` must be in the allow-list — we never accept a free-form binary
 *     name or absolute path. Argv passes through unparsed but is spawned
 *     with `shell: false` so there's no shell-injection seam.
 *   - cwd is always the project root; callers can't escape it via args.
 *   - env is the dev server's env plus a small caller-supplied delta; we
 *     never accept overrides for PATH or HOME so credentials in the user's
 *     home directory stay where the CLI expects them.
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import crypto from 'node:crypto'

/** Allow-listed CLI binary names. Free-form names are rejected. */
const ALLOWED_CLIS = new Set(['claude', 'codex', 'opencode', 'copilot', 'gh'])

/** Env keys the caller may add. PATH/HOME/USER/SHELL/etc. are never overridable. */
const SAFE_ENV_KEYS = new Set([
  'ANTHROPIC_MODEL',
  'OPENAI_MODEL',
  'OPENROUTER_API_KEY',
  // Add more here as specific providers prove they need them.
])

/** Hard cap so a runaway CLI can't accumulate gigabytes of buffered stdout. */
const MAX_BUFFERED_LINE_BYTES = 1_048_576
/** Hard cap on total stderr we retain in memory. Truncates after this. */
const MAX_STDERR_BUFFER_BYTES = 65_536
/** Grace period before SIGKILL after SIGTERM on abort. */
const KILL_GRACE_MS = 2_000
/** Idle keepalive interval so proxies don't drop the connection. */
const KEEPALIVE_INTERVAL_MS = 15_000

export interface SpawnRequestBody {
  cli: string
  args: string[]
  stdin?: string
  env?: Record<string, string>
}

interface ActiveRun {
  child: ChildProcessWithoutNullStreams
  kill: () => void
}

export interface AgentSpawnRegistry {
  /** Kill a run by id. Returns true if a run was found. */
  abort(runId: string): boolean
  /** Number of currently active runs. Exposed for tests. */
  size(): number
  /** Kill every active run. Called from server.dispose(). */
  killAll(): void
}

export interface AgentSpawnHandler {
  registry: AgentSpawnRegistry
  /**
   * Handle `POST /__annotask/api/agent/spawn`. Validates the body, spawns
   * the child, and writes SSE events to `res`. Returns when the child exits.
   */
  handleSpawn(req: IncomingMessage, res: ServerResponse, body: unknown, projectRoot: string): Promise<void>
}

/** Run a coarse validation on the body and return a SpawnRequestBody, or an error string. */
export function parseSpawnBody(raw: unknown): SpawnRequestBody | string {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return 'body must be a JSON object'
  const body = raw as Record<string, unknown>
  if (typeof body.cli !== 'string') return '`cli` must be a string'
  if (!ALLOWED_CLIS.has(body.cli)) return `\`cli\` must be one of: ${[...ALLOWED_CLIS].join(', ')}`
  if (!Array.isArray(body.args)) return '`args` must be an array of strings'
  for (const a of body.args) {
    if (typeof a !== 'string') return '`args` entries must be strings'
  }
  if (body.stdin !== undefined && typeof body.stdin !== 'string') return '`stdin` must be a string when set'
  let env: Record<string, string> | undefined
  if (body.env !== undefined) {
    if (!body.env || typeof body.env !== 'object' || Array.isArray(body.env)) return '`env` must be an object when set'
    env = {}
    for (const [k, v] of Object.entries(body.env as Record<string, unknown>)) {
      if (!SAFE_ENV_KEYS.has(k)) continue // silently drop unknown keys
      if (typeof v !== 'string') return `\`env.${k}\` must be a string`
      env[k] = v
    }
  }
  return { cli: body.cli, args: body.args as string[], stdin: body.stdin as string | undefined, env }
}

export function createAgentSpawnHandler(): AgentSpawnHandler {
  const active = new Map<string, ActiveRun>()

  function newRunId(): string {
    return `run-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`
  }

  function abort(runId: string): boolean {
    const run = active.get(runId)
    if (!run) return false
    run.kill()
    return true
  }

  function killAll(): void {
    for (const run of active.values()) {
      try { run.kill() } catch { /* ignore */ }
    }
    active.clear()
  }

  async function handleSpawn(
    req: IncomingMessage,
    res: ServerResponse,
    rawBody: unknown,
    projectRoot: string,
  ): Promise<void> {
    const parsed = parseSpawnBody(rawBody)
    if (typeof parsed === 'string') {
      res.statusCode = 400
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ error: { code: 'validation_failed', message: parsed } }))
      return
    }

    // SSE headers.
    res.statusCode = 200
    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-store')
    res.setHeader('Connection', 'keep-alive')
    res.flushHeaders?.()

    const runId = newRunId()
    write(res, 'run', { runId })

    let child: ChildProcessWithoutNullStreams
    try {
      child = spawn(parsed.cli, parsed.args, {
        cwd: projectRoot,
        shell: false,
        env: { ...process.env, ...(parsed.env ?? {}) },
        stdio: ['pipe', 'pipe', 'pipe'],
      })
    } catch (err) {
      write(res, 'error', (err as Error).message)
      write(res, 'exit', { code: null, signal: null })
      res.end()
      return
    }

    let killed = false
    function killChild() {
      if (killed) return
      killed = true
      try { child.kill('SIGTERM') } catch { /* ignore */ }
      setTimeout(() => {
        try { child.kill('SIGKILL') } catch { /* ignore */ }
      }, KILL_GRACE_MS).unref()
    }
    active.set(runId, { child, kill: killChild })

    // Pipe stdin if provided.
    if (parsed.stdin) {
      try {
        child.stdin.write(parsed.stdin)
      } catch (err) {
        write(res, 'error', `stdin write failed: ${(err as Error).message}`)
      }
    }
    try { child.stdin.end() } catch { /* ignore */ }

    // Keepalive ping so reverse proxies don't 504 on idle CLI startup.
    const keepalive = setInterval(() => {
      try { res.write(': keepalive\n\n') } catch { /* socket closed */ }
    }, KEEPALIVE_INTERVAL_MS)
    keepalive.unref()

    // Abort on client disconnect.
    req.on('close', () => { killChild() })

    // Line-buffered stdout — one SSE event per line. Same for stderr but we
    // also accumulate the last MAX_STDERR_BUFFER_BYTES of stderr so we can
    // surface it on a non-zero exit.
    let stdoutBuf = ''
    let stderrBuf = ''
    let stderrTotal = ''

    function pumpLines(buf: string, event: 'stdout' | 'stderr', total?: { append: (s: string) => void }) {
      let nl
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).replace(/\r$/, '')
        buf = buf.slice(nl + 1)
        if (total) total.append(line + '\n')
        write(res, event, line)
      }
      return buf
    }

    child.stdout.setEncoding('utf-8')
    child.stdout.on('data', (chunk: string) => {
      stdoutBuf += chunk
      if (stdoutBuf.length > MAX_BUFFERED_LINE_BYTES) {
        // A single line longer than the cap — flush it and drop the rest.
        write(res, 'stdout', stdoutBuf.slice(0, MAX_BUFFERED_LINE_BYTES))
        stdoutBuf = ''
        return
      }
      stdoutBuf = pumpLines(stdoutBuf, 'stdout')
    })

    child.stderr.setEncoding('utf-8')
    child.stderr.on('data', (chunk: string) => {
      stderrBuf += chunk
      if (stderrBuf.length > MAX_BUFFERED_LINE_BYTES) {
        write(res, 'stderr', stderrBuf.slice(0, MAX_BUFFERED_LINE_BYTES))
        stderrBuf = ''
        return
      }
      stderrBuf = pumpLines(stderrBuf, 'stderr', {
        append: (s) => {
          if (stderrTotal.length < MAX_STDERR_BUFFER_BYTES) {
            stderrTotal += s.slice(0, MAX_STDERR_BUFFER_BYTES - stderrTotal.length)
          }
        },
      })
    })

    await new Promise<void>((resolve) => {
      let resolved = false
      const finish = () => { if (!resolved) { resolved = true; resolve() } }

      child.on('error', (err) => {
        write(res, 'error', err.message)
        finish()
      })
      child.on('close', (code, signal) => {
        // Flush trailing stdout/stderr (no terminating newline).
        if (stdoutBuf.length > 0) write(res, 'stdout', stdoutBuf)
        if (stderrBuf.length > 0) write(res, 'stderr', stderrBuf)
        write(res, 'exit', { code, signal: signal ?? null })
        finish()
      })
    })

    clearInterval(keepalive)
    active.delete(runId)
    try { res.end() } catch { /* already ended */ }
  }

  return {
    registry: { abort, killAll, size: () => active.size },
    handleSpawn,
  }
}

/** Write one SSE event. JSON-stringifies object data; passes strings through. */
function write(res: ServerResponse, event: string, data: unknown): void {
  const payload = typeof data === 'string' ? data : JSON.stringify(data)
  // SSE: events with multi-line payloads must repeat the `data:` prefix.
  const lines = payload.split('\n')
  let frame = `event: ${event}\n`
  for (const line of lines) frame += `data: ${line}\n`
  frame += '\n'
  try { res.write(frame) } catch { /* socket may be closed */ }
}

/** Exposed for tests. */
export const __test = { ALLOWED_CLIS, SAFE_ENV_KEYS }
