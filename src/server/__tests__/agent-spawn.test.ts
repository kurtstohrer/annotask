import { describe, it, expect, afterEach, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { ChildProcessWithoutNullStreams, spawn as nodeSpawn } from 'node:child_process'
import { parseSpawnBody, permissionLevelOfArgs, maxPermissionCap, exceedsPermissionCap, createAgentSpawnHandler, __test } from '../agent-spawn.js'
import {
  initPermissionFlagsFor,
  claudePermissionFlags,
  codexPermissionFlags,
  opencodePermissionFlags,
  copilotPermissionFlags,
  normalizeHeadlessMode,
} from '../../embedded/permission-mode-flags.js'

// ── Mocks so the registry/lifecycle can be tested without a real subprocess ──
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
  /** Unset by default so killChild takes the direct child.kill path. Group-kill
   *  tests set it explicitly (with process.kill spied) to exercise -pid signaling. */
  pid?: number
  kill() { this.killed = true; return true }
  /** Resolve the handler's wait by emitting the child's `close`. */
  finish(code = 0) { this.emit('close', code, null) }
}
class FakeRes extends EventEmitter {
  statusCode = 200
  ended = false
  body = ''
  setHeader() { /* noop */ }
  flushHeaders() { /* noop */ }
  write(s: string) { this.body += s; return true }
  end(s?: string) { if (s) this.body += s; this.ended = true; this.emit('close'); return this }
}
function fakeReq() { return new EventEmitter() as unknown as IncomingMessage }
function fakeRes() { return new FakeRes() as unknown as ServerResponse & FakeRes }
function fakeSpawn(child: FakeChild): typeof nodeSpawn {
  return (() => child as unknown as ChildProcessWithoutNullStreams) as unknown as typeof nodeSpawn
}

describe('parseSpawnBody', () => {
  it('accepts a well-formed body', () => {
    const out = parseSpawnBody({ cli: 'claude', args: ['--print', '-p', 'hi'] })
    expect(typeof out === 'string').toBe(false)
    if (typeof out !== 'string') {
      expect(out.cli).toBe('claude')
      expect(out.args).toEqual(['--print', '-p', 'hi'])
    }
  })

  it('rejects non-allowed CLIs', () => {
    const out = parseSpawnBody({ cli: 'rm', args: ['-rf', '/'] })
    expect(typeof out).toBe('string')
    expect(out as string).toMatch(/must be one of/)
  })

  it('rejects non-array args', () => {
    const out = parseSpawnBody({ cli: 'claude', args: 'not an array' })
    expect(typeof out).toBe('string')
  })

  it('drops unknown env keys silently', () => {
    const out = parseSpawnBody({
      cli: 'claude',
      args: [],
      env: { PATH: '/etc', ANTHROPIC_MODEL: 'sonnet-4', NOT_ALLOWED: 'x' },
    })
    expect(typeof out === 'string').toBe(false)
    if (typeof out !== 'string') {
      expect(out.env).toEqual({ ANTHROPIC_MODEL: 'sonnet-4' })
      // PATH is dangerous to override; it must NOT make it through.
      expect(out.env?.PATH).toBeUndefined()
    }
  })

  it('rejects non-string args entries', () => {
    const out = parseSpawnBody({ cli: 'claude', args: ['--print', 42] })
    expect(typeof out).toBe('string')
  })

  it('treats body that is not an object as invalid', () => {
    expect(typeof parseSpawnBody(null)).toBe('string')
    expect(typeof parseSpawnBody('hi')).toBe('string')
    expect(typeof parseSpawnBody([])).toBe('string')
  })
})

describe('allow-list integrity', () => {
  it('contains exactly the four expected binaries', () => {
    expect([...__test.ALLOWED_CLIS].sort()).toEqual(['claude', 'codex', 'copilot', 'opencode'])
  })

  it('does not include PATH/HOME in safe env keys', () => {
    expect(__test.SAFE_ENV_KEYS.has('PATH')).toBe(false)
    expect(__test.SAFE_ENV_KEYS.has('HOME')).toBe(false)
  })
})

describe('permissionLevelOfArgs (server-side flag re-derivation)', () => {
  it('detects bypass-level flags across CLIs', () => {
    expect(permissionLevelOfArgs(['--print', '--dangerously-skip-permissions'])).toBe('bypass')
    expect(permissionLevelOfArgs(['exec', '--dangerously-bypass-approvals-and-sandbox'])).toBe('bypass')
    expect(permissionLevelOfArgs(['--allow-all', '--allow-all-tools', '--no-ask-user'])).toBe('bypass')
  })

  it('detects default-level (sandboxed/minimal) flags', () => {
    expect(permissionLevelOfArgs(['exec', '--full-auto'])).toBe('default')
    expect(permissionLevelOfArgs(['--allow-all-tools', '--no-ask-user', '-p', 'hi'])).toBe('default')
    expect(permissionLevelOfArgs(['--print', '--permission-mode', 'default'])).toBe('default')
  })

  it('treats plan / no-flag argv as the safest level', () => {
    expect(permissionLevelOfArgs(['--print', '--permission-mode', 'plan'])).toBe('plan')
    expect(permissionLevelOfArgs(['exec', '--sandbox', 'read-only'])).toBe('plan')
    expect(permissionLevelOfArgs(['run', '--format=json'])).toBe('plan')
  })

  // Synonym spellings the client never emits but a crafted request could
  // substitute — each used to derive as `plan` and slip under the cap.
  it('treats claude --permission-mode bypassPermissions as bypass (pair and = forms)', () => {
    expect(permissionLevelOfArgs(['--print', '--permission-mode', 'bypassPermissions'])).toBe('bypass')
    expect(permissionLevelOfArgs(['--print', '--permission-mode=bypassPermissions'])).toBe('bypass')
  })

  it('treats claude --permission-mode acceptEdits (and unknown future modes) as at least default', () => {
    expect(permissionLevelOfArgs(['--print', '--permission-mode', 'acceptEdits'])).toBe('default')
    expect(permissionLevelOfArgs(['--print', '--permission-mode', 'someFutureMode'])).toBe('default')
  })

  it('treats codex --sandbox danger-full-access as bypass (pair, =, and -s forms)', () => {
    expect(permissionLevelOfArgs(['exec', '--sandbox', 'danger-full-access'])).toBe('bypass')
    expect(permissionLevelOfArgs(['exec', '--sandbox=danger-full-access'])).toBe('bypass')
    expect(permissionLevelOfArgs(['exec', '-s', 'danger-full-access'])).toBe('bypass')
  })

  it('treats codex --sandbox workspace-write as default', () => {
    expect(permissionLevelOfArgs(['exec', '--sandbox', 'workspace-write'])).toBe('default')
  })

  it('treats codex --ask-for-approval never as bypass unless the sandbox is explicitly read-only', () => {
    // No sandbox flag: the effective sandbox comes from config.toml — assume worst.
    expect(permissionLevelOfArgs(['exec', '--ask-for-approval', 'never'])).toBe('bypass')
    expect(permissionLevelOfArgs(['exec', '-a', 'never', '--sandbox', 'workspace-write'])).toBe('bypass')
    expect(permissionLevelOfArgs(['exec', '-a=never', '--sandbox', 'workspace-write'])).toBe('bypass')
    // OS-enforced read-only sandbox: never-ask grants nothing extra.
    expect(permissionLevelOfArgs(['exec', '-a', 'never', '--sandbox', 'read-only'])).toBe('plan')
  })

  it('maps every client-emitted flag set (permission-mode-flags.ts) to its true level', () => {
    // claude: 1:1 native modes.
    expect(permissionLevelOfArgs(claudePermissionFlags('plan'))).toBe('plan')
    expect(permissionLevelOfArgs(claudePermissionFlags('default'))).toBe('default')
    expect(permissionLevelOfArgs(claudePermissionFlags('bypass'))).toBe('bypass')
    // codex: sandbox-driven.
    expect(permissionLevelOfArgs(codexPermissionFlags('plan'))).toBe('plan')
    expect(permissionLevelOfArgs(codexPermissionFlags('default'))).toBe('default')
    expect(permissionLevelOfArgs(codexPermissionFlags('bypass'))).toBe('bypass')
    // opencode: plan/default emit no flags (the CLI prompts/stalls instead of
    // writing), so the safest `plan` floor is correct for both.
    expect(permissionLevelOfArgs(opencodePermissionFlags('plan'))).toBe('plan')
    expect(permissionLevelOfArgs(opencodePermissionFlags('default'))).toBe('plan')
    expect(permissionLevelOfArgs(opencodePermissionFlags('bypass'))).toBe('bypass')
    // ...but what the client *actually* spawns for requested-default on
    // opencode is the headless-normalized mode (default → bypass).
    expect(permissionLevelOfArgs(opencodePermissionFlags(normalizeHeadlessMode('default', 'opencode')))).toBe('bypass')
    // copilot: plan and default share flags (plan is prompt-enforced), so plan
    // derives as `default` — conservative over-count, never an under-count.
    expect(permissionLevelOfArgs(copilotPermissionFlags('plan'))).toBe('default')
    expect(permissionLevelOfArgs(copilotPermissionFlags('default'))).toBe('default')
    expect(permissionLevelOfArgs(copilotPermissionFlags('bypass'))).toBe('bypass')
  })
})

describe('maxPermissionCap (ANNOTASK_MAX_PERMISSION)', () => {
  afterEach(() => { delete process.env.ANNOTASK_MAX_PERMISSION })

  it('defaults to bypass (no restriction) when unset or invalid', () => {
    delete process.env.ANNOTASK_MAX_PERMISSION
    expect(maxPermissionCap()).toBe('bypass')
    process.env.ANNOTASK_MAX_PERMISSION = 'nonsense'
    expect(maxPermissionCap()).toBe('bypass')
  })

  it('reads plan and default caps (case-insensitive, trimmed)', () => {
    process.env.ANNOTASK_MAX_PERMISSION = ' Plan '
    expect(maxPermissionCap()).toBe('plan')
    process.env.ANNOTASK_MAX_PERMISSION = 'default'
    expect(maxPermissionCap()).toBe('default')
  })
})

describe('exceedsPermissionCap applied to init flags (the init-pipeline floor)', () => {
  afterEach(() => { delete process.env.ANNOTASK_MAX_PERMISSION })
  const bins = ['claude', 'codex', 'opencode', 'copilot'] as const

  it('no cap → init agent is never blocked on any CLI', () => {
    delete process.env.ANNOTASK_MAX_PERMISSION
    for (const bin of bins) {
      expect(exceedsPermissionCap(initPermissionFlagsFor(bin))).toBeNull()
    }
  })

  it("cap=default → blocks claude/opencode (bypass) but allows codex/copilot (sandboxed default)", () => {
    process.env.ANNOTASK_MAX_PERMISSION = 'default'
    expect(exceedsPermissionCap(initPermissionFlagsFor('claude'))).toMatchObject({ level: 'bypass', cap: 'default' })
    expect(exceedsPermissionCap(initPermissionFlagsFor('opencode'))).toMatchObject({ level: 'bypass', cap: 'default' })
    expect(exceedsPermissionCap(initPermissionFlagsFor('codex'))).toBeNull()
    expect(exceedsPermissionCap(initPermissionFlagsFor('copilot'))).toBeNull()
  })

  it('cap=plan → blocks every init agent (init must write, plan cannot)', () => {
    process.env.ANNOTASK_MAX_PERMISSION = 'plan'
    for (const bin of bins) {
      expect(exceedsPermissionCap(initPermissionFlagsFor(bin))).not.toBeNull()
    }
  })
})

describe('parseSpawnBody — taskId', () => {
  it('accepts a valid task id and rejects malformed ones', () => {
    const ok = parseSpawnBody({ cli: 'claude', args: [], taskId: 'task-abc_1-XYZ' })
    expect(typeof ok === 'string').toBe(false)
    if (typeof ok !== 'string') expect(ok.taskId).toBe('task-abc_1-XYZ')
    expect(typeof parseSpawnBody({ cli: 'claude', args: [], taskId: '../evil' })).toBe('string')
    expect(typeof parseSpawnBody({ cli: 'claude', args: [], taskId: 'nope' })).toBe('string')
    expect(typeof parseSpawnBody({ cli: 'claude', args: [], taskId: 123 })).toBe('string')
    // Absent taskId is fine (free-form chat / non-task runs).
    expect(typeof parseSpawnBody({ cli: 'claude', args: [] }) === 'string').toBe(false)
  })
})

describe('run registry — per-task dedup + orphan hook', () => {
  it('rejects a second spawn for a task already running (cross-tab dedup)', async () => {
    const child = new FakeChild()
    const handler = createAgentSpawnHandler({ spawnImpl: fakeSpawn(child) })

    // Run 1 starts and parks awaiting the child's close.
    const p1 = handler.handleSpawn(fakeReq(), fakeRes(), { cli: 'claude', args: [], taskId: 'task-dup' }, '/tmp')
    expect(handler.registry.taskRunning('task-dup')).toBe(true)

    // Run 2 for the SAME task is refused with 409 — no second child.
    const res2 = fakeRes()
    await handler.handleSpawn(fakeReq(), res2, { cli: 'claude', args: [], taskId: 'task-dup' }, '/tmp')
    expect(res2.statusCode).toBe(409)
    expect(res2.body).toContain('already running')
    expect(handler.registry.taskRunning('task-dup')).toBe(true) // run 1 still holds it

    // Finishing run 1 releases the task slot.
    child.finish(0)
    await p1
    expect(handler.registry.taskRunning('task-dup')).toBe(false)
  })

  it('fires onRunEnd with the task id when a run ends (orphan-finalization hook)', async () => {
    const ended: string[] = []
    const child = new FakeChild()
    const handler = createAgentSpawnHandler({ spawnImpl: fakeSpawn(child), onRunEnd: (id) => ended.push(id) })
    const p = handler.handleSpawn(fakeReq(), fakeRes(), { cli: 'claude', args: [], taskId: 'task-orphan' }, '/tmp')
    child.finish(0)
    await p
    expect(ended).toEqual(['task-orphan'])
  })

  it('does not dedup or fire the hook for runs without a taskId', async () => {
    const ended: string[] = []
    const child = new FakeChild()
    const handler = createAgentSpawnHandler({ spawnImpl: fakeSpawn(child), onRunEnd: (id) => ended.push(id) })
    const p = handler.handleSpawn(fakeReq(), fakeRes(), { cli: 'claude', args: [] }, '/tmp')
    expect(handler.registry.size()).toBe(1)
    child.finish(0)
    await p
    expect(ended).toEqual([]) // no taskId → no orphan reconciliation
  })
})

describe('origin policy', () => {
  // Spawn routes use originMatchesPort — that gate lives in api.ts and is
  // exercised end-to-end (real middleware + real spawn handler over a real
  // socket) in agent-spawn-http.test.ts. (api.test.ts stubs handleSpawn, so
  // it does NOT cover it.) Here we verify the unit-level contract:
  // gh is no longer spawnable.
  it('rejects gh as a CLI', () => {
    const out = parseSpawnBody({ cli: 'gh', args: ['pr', 'list'] })
    expect(typeof out).toBe('string')
    expect(out as string).toMatch(/must be one of/)
  })
})

describe('process-group kill', () => {
  // Beyond Linux's pid_max (4_194_304) and macOS's (99_998): if an unref'd
  // SIGKILL grace timer ever fires after the process.kill spy is restored,
  // the real syscall can only land on ESRCH — never on a live process group.
  const FAKE_PID = 2 ** 30

  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('spawns detached on POSIX so the child leads its own process group', async () => {
    let captured: { detached?: boolean } | undefined
    const child = new FakeChild()
    const spawnImpl = ((_cmd: string, _args: string[], opts: { detached?: boolean }) => {
      captured = opts
      return child as unknown as ChildProcessWithoutNullStreams
    }) as unknown as typeof nodeSpawn
    const handler = createAgentSpawnHandler({ spawnImpl })
    const p = handler.handleSpawn(fakeReq(), fakeRes(), { cli: 'claude', args: [] }, '/tmp')
    child.finish(0)
    await p
    expect(captured?.detached).toBe(process.platform !== 'win32')
  })

  it('kills the process group: SIGTERM, then SIGKILL after the grace period', async () => {
    if (process.platform === 'win32') return // no process groups on Windows
    vi.useFakeTimers()
    const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true)
    const child = new FakeChild()
    child.pid = FAKE_PID
    const handler = createAgentSpawnHandler({ spawnImpl: fakeSpawn(child) })
    const req = fakeReq()
    const p = handler.handleSpawn(req, fakeRes(), { cli: 'claude', args: [] }, '/tmp')

    // Client disconnect → killChild → group SIGTERM.
    ;(req as unknown as EventEmitter).emit('close')
    expect(killSpy).toHaveBeenCalledWith(-FAKE_PID, 'SIGTERM')
    expect(child.killed).toBe(false) // group signal used, not the direct child.kill

    // Grace period elapses with the child still alive → group SIGKILL.
    vi.advanceTimersByTime(2_000)
    expect(killSpy).toHaveBeenCalledWith(-FAKE_PID, 'SIGKILL')

    // A second disconnect event must not re-signal (killed-flag idempotency).
    const calls = killSpy.mock.calls.length
    ;(req as unknown as EventEmitter).emit('close')
    expect(killSpy.mock.calls.length).toBe(calls)

    child.finish(143)
    await p
  })

  it('falls back to the direct child.kill when the group signal throws ESRCH', async () => {
    if (process.platform === 'win32') return
    const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => {
      throw Object.assign(new Error('kill ESRCH'), { code: 'ESRCH' })
    })
    const child = new FakeChild()
    child.pid = FAKE_PID
    const handler = createAgentSpawnHandler({ spawnImpl: fakeSpawn(child) })
    const req = fakeReq()
    const p = handler.handleSpawn(req, fakeRes(), { cli: 'claude', args: [] }, '/tmp')
    ;(req as unknown as EventEmitter).emit('close')
    expect(killSpy).toHaveBeenCalledWith(-FAKE_PID, 'SIGTERM')
    expect(child.killed).toBe(true) // graceful fallback still terminated the child
    child.finish(143)
    await p
  })

  it('uses the direct child.kill when the child has no pid (spawn seam / failed spawn)', async () => {
    const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true)
    const child = new FakeChild() // pid stays undefined
    const handler = createAgentSpawnHandler({ spawnImpl: fakeSpawn(child) })
    const req = fakeReq()
    const p = handler.handleSpawn(req, fakeRes(), { cli: 'claude', args: [] }, '/tmp')
    ;(req as unknown as EventEmitter).emit('close')
    expect(killSpy).not.toHaveBeenCalled()
    expect(child.killed).toBe(true)
    child.finish(143)
    await p
  })
})
