import { describe, it, expect, afterEach } from 'vitest'
import { parseSpawnBody, permissionLevelOfArgs, maxPermissionCap, exceedsPermissionCap, __test } from '../agent-spawn.js'
import { initPermissionFlagsFor } from '../../embedded/permission-mode-flags.js'

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
