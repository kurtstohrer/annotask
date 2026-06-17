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
 *     routes reject non-local origins, and spawn routes additionally
 *     enforce same-port origin matching (see api.ts:originMatchesPort).
 *   - `cli` must be in the allow-list — we never accept a free-form binary
 *     name or absolute path. Argv passes through unparsed but is spawned
 *     with `shell: false` so there's no shell-injection seam.
 *   - cwd is always the project root; callers can't escape it via args.
 *   - env is the dev server's env plus a small caller-supplied delta; we
 *     never accept overrides for PATH or HOME so credentials in the user's
 *     home directory stay where the CLI expects them. PATH is augmented
 *     server-side with `ANNOTASK_HOST_PATH` (if set) so dockerized installs
 *     can locate host-mounted CLI binaries — same env var used by the
 *     CLI-detection probe.
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'

/** Allow-listed CLI binary names. Free-form names are rejected. */
const ALLOWED_CLIS = new Set(['claude', 'codex', 'opencode', 'copilot'])

/** Task id shape (`task-<...>`). Keys the per-task run registry. */
const SAFE_TASK_ID = /^task-[A-Za-z0-9_-]+$/

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
/**
 * Absolute server-side ceiling on a single spawned CLI run. Last-resort
 * backstop *beneath* the client-side stall watchdog (default 10 min) — set
 * higher so the client aborts first in the normal case; this only catches a
 * child that outlives a disconnected/dead client. Kills the child on expiry.
 */
const MAX_SPAWN_DURATION_MS = 15 * 60_000
/**
 * Max concurrent CLI child processes. The client auto-run driver serializes
 * per tab, but multiple open tabs or a buggy/looping client are not otherwise
 * bounded — without a cap they could fan out N agents editing the same files
 * at once. Excess spawns are refused with a `too_many_agents` error.
 */
const MAX_CONCURRENT_SPAWNS = 4

/**
 * PATH passed to spawned CLIs. Appends `ANNOTASK_HOST_PATH` (if set) so
 * dockerized installs that mount host-side binaries can find them — matches
 * the lookup behavior of the CLI-detection probe in `agent-detect.ts`.
 *
 * Exported so init.ts and agent-models.ts (which also fork CLIs) can use
 * the same logic without duplicating the env-var handling.
 */
export function effectiveSpawnPath(): string {
  const base = process.env.PATH ?? ''
  const host = process.env.ANNOTASK_HOST_PATH
  if (!host) return base
  const sep = process.platform === 'win32' ? ';' : ':'
  return base ? `${base}${sep}${host}` : host
}

/**
 * When the dev server runs as root inside a container with a host home
 * directory mounted (typical Docker layout), drop the spawned CLI to the
 * uid/gid that owns that directory. Several CLIs (notably Claude Code with
 * `--dangerously-skip-permissions`) refuse to run as root for safety; the
 * host user ultimately owns the auth files the CLI needs to read, so
 * matching their uid is the right call.
 *
 * Returns an empty object outside Docker (non-root, or no host home set),
 * so this is a no-op for normal local installs.
 */
export function hostUserSpawnOptions(): { uid?: number; gid?: number; env?: Record<string, string> } {
  // getuid is only defined on POSIX platforms.
  const getuid = (process as NodeJS.Process & { getuid?: () => number }).getuid
  if (typeof getuid !== 'function' || getuid.call(process) !== 0) return {}
  const hostHome = process.env.ANNOTASK_HOST_HOME
  if (!hostHome) return {}
  try {
    const st = fs.statSync(hostHome)
    // Set HOME for the child so the CLI reads auth files from the mounted
    // host home rather than the container's /root.
    return { uid: st.uid, gid: st.gid, env: { HOME: hostHome } }
  } catch {
    return {}
  }
}

export interface SpawnRequestBody {
  cli: string
  args: string[]
  stdin?: string
  env?: Record<string, string>
  /** Optional task this run is applying. Keys the run registry so one task
   *  can't be double-spawned (e.g. two tabs auto-running it) and so the run
   *  end can be reported for orphaned-task finalization. */
  taskId?: string
}

interface ActiveRun {
  child: ChildProcessWithoutNullStreams
  kill: () => void
  taskId?: string
}

export interface AgentSpawnRegistry {
  /** Kill a run by id. Returns true if a run was found. */
  abort(runId: string): boolean
  /** Number of currently active runs. Exposed for tests. */
  size(): number
  /** True iff a live run exists for this task id. */
  taskRunning(taskId: string): boolean
  /** Kill every active run. Called from server.dispose(). */
  killAll(): void
}

export interface AgentSpawnOptions {
  /**
   * Fired once a run that carried a `taskId` ends (child closed or errored),
   * for normal completion AND interrupted/orphaned runs alike. The wiring in
   * index.ts uses it to finalize a task the client never transitioned (e.g.
   * the orchestrating tab closed mid-run) — it grace-checks "still in_progress?"
   * so a normal completion (client about to set `review`) is a no-op.
   *
   * `info.killed` is true when WE terminated the child (client disconnect,
   * explicit abort, or the duration backstop) and false when it exited on its
   * own — lets the finalizer word its reason honestly instead of always
   * blaming a closed tab.
   */
  onRunEnd?: (taskId: string, info: { killed: boolean }) => void
  /** Test seam: inject a child-process factory (defaults to node:child_process spawn). */
  spawnImpl?: typeof spawn
}

export interface AgentSpawnHandler {
  registry: AgentSpawnRegistry
  /**
   * Handle `POST /__annotask/api/agent/spawn`. Validates the body, spawns
   * the child, and writes SSE events to `res`. Returns when the child exits.
   */
  handleSpawn(req: IncomingMessage, res: ServerResponse, body: unknown, projectRoot: string): Promise<void>
}

/**
 * Optional server-side ceiling on the permission level a spawn may request.
 * Set `ANNOTASK_MAX_PERMISSION=plan|default` to refuse any spawn whose argv
 * carries flags exceeding it — a floor a same-origin page cannot talk past,
 * for shared / CI / locked-down setups. Unset (or `bypass`) imposes no cap.
 *
 * Permission semantics are assembled client-side (the browser builds argv),
 * so this is the one place the server re-derives the *level* from the flags
 * and enforces a policy of its own rather than trusting the caller.
 */
const PERMISSION_LEVEL = { plan: 0, default: 1, bypass: 2 } as const
export type PermissionLevelName = keyof typeof PERMISSION_LEVEL

export function maxPermissionCap(): PermissionLevelName {
  const raw = (process.env.ANNOTASK_MAX_PERMISSION ?? '').trim().toLowerCase()
  return raw === 'plan' || raw === 'default' ? raw : 'bypass'
}

/** Flags that, if present, mean the run removes sandboxes / auto-approves all. */
const BYPASS_FLAGS = new Set([
  '--dangerously-skip-permissions', // claude, opencode
  '--dangerously-bypass-approvals-and-sandbox', // codex
  '--allow-all', // copilot
])
/** Flags that imply a sandboxed/minimal "default" level (still writes, but scoped). */
const DEFAULT_FLAGS = new Set(['--full-auto', '--allow-all-tools'])

/**
 * Re-derive the highest permission level the given argv implies. Best-effort
 * floor, not a full parser: it mirrors exactly what the client emits per CLI
 * per mode (see ../embedded/permission-mode-flags.ts) PLUS the synonym
 * spellings a crafted request could substitute for them — claude's
 * `--permission-mode bypassPermissions`/`acceptEdits`, codex's
 * `--sandbox danger-full-access` and `--ask-for-approval never`, and the
 * `--flag=value` joined form of each. Bypass flags win over default-level
 * flags; absence of any recognized flag is the safest `plan` level. When an
 * allow-listed CLI grows new permission flags they MUST be added here, or
 * the ANNOTASK_MAX_PERMISSION cap won't see them.
 *
 * Two deliberate asymmetries:
 *   - copilot's plan and default modes emit identical flags (headless `-p`
 *     requires `--allow-all-tools`; plan is prompt-enforced), so copilot plan
 *     derives as `default` — a conservative over-count, never an under-count.
 *   - codex `--ask-for-approval never` is only as dangerous as the sandbox it
 *     pairs with: harmless under an explicit `read-only` sandbox, but with a
 *     writable or absent sandbox flag the effective sandbox comes from the
 *     user's config.toml (which we can't see) — assume `bypass`.
 */
export function permissionLevelOfArgs(args: string[]): PermissionLevelName {
  let level: PermissionLevelName = 'plan'
  const bump = (l: PermissionLevelName) => {
    if (PERMISSION_LEVEL[l] > PERMISSION_LEVEL[level]) level = l
  }
  // codex's approval policy and sandbox interact — track both, resolve after.
  let sandbox: string | undefined
  let approvalNever = false

  for (let i = 0; i < args.length; i++) {
    const token = args[i]
    // Accept both `--flag value` and `--flag=value` spellings — every
    // allow-listed CLI's arg parser does, so the floor must too.
    const eq = token.startsWith('-') ? token.indexOf('=') : -1
    const flag = eq > 0 ? token.slice(0, eq) : token
    const value = eq > 0 ? token.slice(eq + 1) : args[i + 1]

    if (BYPASS_FLAGS.has(flag)) return 'bypass'
    if (DEFAULT_FLAGS.has(flag)) { bump('default'); continue }
    if (flag === '--permission-mode') { // claude
      if (value === 'bypassPermissions') return 'bypass'
      // default / acceptEdits / unknown future modes: at least writes files.
      if (value !== 'plan') bump('default')
      continue
    }
    if (flag === '--sandbox' || flag === '-s') { // codex
      sandbox = value
      if (value === 'danger-full-access') return 'bypass'
      // workspace-write / unknown future modes: writes, but OS-scoped.
      if (value !== 'read-only') bump('default')
      continue
    }
    if ((flag === '--ask-for-approval' || flag === '-a') && value === 'never') { // codex
      approvalNever = true
    }
  }

  if (approvalNever && sandbox !== 'read-only') return 'bypass'
  return level
}

/**
 * Return the (level, cap) pair when the given argv exceeds the configured
 * `ANNOTASK_MAX_PERMISSION` ceiling, or `null` when it's within the cap. Shared
 * by the per-task spawn handler and the init pipeline so both honor the same
 * floor.
 */
export function exceedsPermissionCap(
  args: string[],
): { level: PermissionLevelName; cap: PermissionLevelName } | null {
  const cap = maxPermissionCap()
  const level = permissionLevelOfArgs(args)
  return PERMISSION_LEVEL[level] > PERMISSION_LEVEL[cap] ? { level, cap } : null
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
  let taskId: string | undefined
  if (body.taskId !== undefined) {
    if (typeof body.taskId !== 'string' || !SAFE_TASK_ID.test(body.taskId)) return '`taskId` must be a task id when set'
    taskId = body.taskId
  }
  return { cli: body.cli, args: body.args as string[], stdin: body.stdin as string | undefined, env, taskId }
}

export function createAgentSpawnHandler(opts: AgentSpawnOptions = {}): AgentSpawnHandler {
  const active = new Map<string, ActiveRun>()
  // taskId -> runId. Enforces one live run per task (cross-tab dedup).
  const byTask = new Map<string, string>()

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
    byTask.clear()
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

    // Server-side permission floor. The browser assembles the permission flags;
    // here we re-derive the level from the argv and refuse anything above the
    // configured cap so a same-origin page can't hand-craft a bypass run.
    const exceeded = exceedsPermissionCap(parsed.args)
    if (exceeded) {
      res.statusCode = 403
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({
        error: {
          code: 'permission_exceeds_cap',
          message: `Spawn requested '${exceeded.level}' permission but ANNOTASK_MAX_PERMISSION caps at '${exceeded.cap}'.`,
        },
      }))
      return
    }

    // Concurrency floor — bound the number of live child processes regardless
    // of how many tabs/clients ask. (Checked before spawning, not registered.)
    if (active.size >= MAX_CONCURRENT_SPAWNS) {
      res.statusCode = 503
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({
        error: {
          code: 'too_many_agents',
          message: `Too many agents running (${active.size}/${MAX_CONCURRENT_SPAWNS}). Wait for one to finish.`,
        },
      }))
      return
    }

    const runId = newRunId()
    // Per-task dedup: at most one live run per task. Closes the cross-tab
    // double-spawn hole — two tabs each auto-running the same task would
    // otherwise fork two CLIs editing the same files, which the client-side
    // (per-tab) concurrency guard can't prevent. Reserve BEFORE the SSE headers
    // so the rejection can still be a plain 409. (Sync between check and set.)
    if (parsed.taskId) {
      if (byTask.has(parsed.taskId)) {
        res.statusCode = 409
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify({
          error: {
            code: 'task_already_running',
            message: `Task ${parsed.taskId} is already running in another tab or session.`,
          },
        }))
        return
      }
      byTask.set(parsed.taskId, runId)
    }

    // SSE headers.
    res.statusCode = 200
    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-store')
    res.setHeader('Connection', 'keep-alive')
    res.flushHeaders?.()

    write(res, 'run', { runId })

    let child: ChildProcessWithoutNullStreams
    try {
      const hostUser = hostUserSpawnOptions()
      child = (opts.spawnImpl ?? spawn)(parsed.cli, parsed.args, {
        cwd: projectRoot,
        shell: false,
        uid: hostUser.uid,
        gid: hostUser.gid,
        // POSIX: make the child a process-group leader so killChild can signal
        // the whole group (`process.kill(-pid)`). Agent CLIs routinely fork
        // grandchildren (shell commands, MCP servers) — killing only the
        // direct child would orphan those mid-run on abort/disconnect.
        // Windows has no process groups, so detaching buys nothing there.
        detached: process.platform !== 'win32',
        // Force PWD to match cwd. The inherited PWD points at wherever the dev
        // server was launched, which usually equals projectRoot — but when it
        // doesn't (monorepo / Docker / nested launch), CLIs that read $PWD for
        // project-root detection (e.g. opencode) would operate on the wrong
        // tree instead of the spawn cwd. Setting it last keeps it authoritative.
        env: { ...process.env, PATH: effectiveSpawnPath(), ...(hostUser.env ?? {}), ...(parsed.env ?? {}), PWD: projectRoot },
        stdio: ['pipe', 'pipe', 'pipe'],
      })
    } catch (err) {
      if (parsed.taskId && byTask.get(parsed.taskId) === runId) byTask.delete(parsed.taskId)
      write(res, 'error', (err as Error).message)
      write(res, 'exit', { code: null, signal: null })
      res.end()
      return
    }

    let killed = false
    // Signal the whole process group on POSIX (the child was spawned detached,
    // i.e. as a group leader) so grandchildren the agent forked die with it.
    // Falls back to the direct child.kill when there's no pid (spawn-time
    // failure), when the group is already gone (ESRCH), and always on win32.
    function killGroup(sig: NodeJS.Signals) {
      if (process.platform !== 'win32' && typeof child.pid === 'number') {
        try { process.kill(-child.pid, sig); return } catch { /* ESRCH/EPERM — fall through */ }
      }
      try { child.kill(sig) } catch { /* ignore */ }
    }
    function killChild() {
      if (killed) return
      killed = true
      killGroup('SIGTERM')
      setTimeout(() => { killGroup('SIGKILL') }, KILL_GRACE_MS).unref()
    }
    active.set(runId, { child, kill: killChild, taskId: parsed.taskId })

    // Pipe stdin if provided. Attach the async error listener BEFORE writing:
    // a child that closes its read end early emits an *asynchronous* EPIPE that
    // the synchronous try/catch can't catch — left unhandled it throws and
    // crashes the whole dev server, taking down every other in-flight run.
    // Ending stdin in the write callback avoids ending mid-flush.
    child.stdin.on('error', (err) => {
      write(res, 'error', `stdin write failed: ${(err as Error).message}`)
    })
    if (parsed.stdin) {
      child.stdin.write(parsed.stdin, () => {
        try { child.stdin.end() } catch { /* ignore */ }
      })
    } else {
      try { child.stdin.end() } catch { /* ignore */ }
    }

    // Keepalive ping so reverse proxies don't 504 on idle CLI startup.
    const keepalive = setInterval(() => {
      try { res.write(': keepalive\n\n') } catch { /* socket closed */ }
    }, KEEPALIVE_INTERVAL_MS)
    keepalive.unref()

    // Abort on client disconnect. Belt-and-suspenders: some proxies close
    // the response socket rather than the request, so we listen on both.
    req.on('close', () => { killChild() })
    res.on('close', () => { killChild() })

    // Absolute duration backstop — kill a child that outlives the ceiling
    // (e.g. its client died without closing the socket). Cleared on close.
    const maxDuration = setTimeout(() => {
      write(res, 'error', `Run exceeded the ${Math.round(MAX_SPAWN_DURATION_MS / 60_000)}-minute server limit; terminating.`)
      killChild()
    }, MAX_SPAWN_DURATION_MS)
    maxDuration.unref()

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
    clearTimeout(maxDuration)
    active.delete(runId)
    if (parsed.taskId && byTask.get(parsed.taskId) === runId) byTask.delete(parsed.taskId)
    try { res.end() } catch { /* already ended */ }
    // Report the run end so a task the client never finalized (orphaned by a
    // closed tab) can be reconciled server-side. Fired for normal completions
    // too — the handler grace-checks status, so those no-op.
    if (parsed.taskId) {
      try { opts.onRunEnd?.(parsed.taskId, { killed }) } catch { /* never let a sink break cleanup */ }
    }
  }

  return {
    registry: { abort, killAll, size: () => active.size, taskRunning: (taskId) => byTask.has(taskId) },
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
