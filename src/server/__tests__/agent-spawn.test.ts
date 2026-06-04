import { describe, it, expect, afterEach } from 'vitest'
import { EventEmitter } from 'node:events'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { ChildProcessWithoutNullStreams, spawn as nodeSpawn } from 'node:child_process'
import { parseSpawnBody, permissionLevelOfArgs, maxPermissionCap, exceedsPermissionCap, createAgentSpawnHandler, __test } from '../agent-spawn.js'
import { initPermissionFlagsFor } from '../../embedded/permission-mode-flags.js'

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
  // Spawn routes use originMatchesPort — these are imported from origin.ts
  // but tested end-to-end through the API middleware in the api.test.ts suite.
  // Here we verify the unit-level contract: gh is no longer spawnable.
  it('rejects gh as a CLI', () => {
    const out = parseSpawnBody({ cli: 'gh', args: ['pr', 'list'] })
    expect(typeof out).toBe('string')
    expect(out as string).toMatch(/must be one of/)
  })
})
