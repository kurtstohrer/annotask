import { describe, it, expect } from 'vitest'
import { parseSpawnBody, __test } from '../agent-spawn.js'

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
  it('contains exactly the five expected binaries', () => {
    expect([...__test.ALLOWED_CLIS].sort()).toEqual(['claude', 'codex', 'copilot', 'gh', 'opencode'])
  })

  it('does not include PATH/HOME in safe env keys', () => {
    expect(__test.SAFE_ENV_KEYS.has('PATH')).toBe(false)
    expect(__test.SAFE_ENV_KEYS.has('HOME')).toBe(false)
  })
})
