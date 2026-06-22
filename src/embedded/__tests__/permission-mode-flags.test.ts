/**
 * Locks the security-critical permission-flag surface: every (cli, mode) pair
 * maps to an exact argv, and each provider's buildSpawn actually threads the
 * resolved flag into the POSTed `args`. This is the guardrail that makes the
 * default-permission-mode change safe — a regression that silently grants
 * write access in plan mode, or drops the flag entirely, fails here.
 */
import { describe, it, expect } from 'vitest'
import {
  claudePermissionFlags,
  codexPermissionFlags,
  opencodePermissionFlags,
  copilotPermissionFlags,
  initPermissionModeFor,
  initPermissionFlagsFor,
  permissionModeSystemPromptPrefix,
  normalizeHeadlessMode,
  defaultPermissionModeFor,
  type InitCliBin,
} from '../permission-mode-flags.js'
import { ClaudeLocalProvider } from '../claude-local-provider.js'
import { CodexLocalProvider } from '../codex-local-provider.js'
import { OpencodeLocalProvider } from '../opencode-local-provider.js'
import { CopilotLocalProvider } from '../copilot-local-provider.js'
import type { CliLocalProvider } from '../cli-local-provider.js'
import type { PermissionMode } from '../../schema.js'
import type { StreamOptions } from '../provider.js'

describe('permission flag mapping', () => {
  it('claude maps default/plan/bypass to its native flags', () => {
    expect(claudePermissionFlags('default')).toEqual(['--permission-mode', 'default'])
    expect(claudePermissionFlags('plan')).toEqual(['--permission-mode', 'plan'])
    expect(claudePermissionFlags('bypass')).toEqual(['--dangerously-skip-permissions'])
  })

  it('codex maps to sandbox flags (default=full-auto, plan=read-only, bypass removes sandbox)', () => {
    expect(codexPermissionFlags('default')).toEqual(['--full-auto'])
    expect(codexPermissionFlags('plan')).toEqual(['--sandbox', 'read-only'])
    expect(codexPermissionFlags('bypass')).toEqual(['--dangerously-bypass-approvals-and-sandbox'])
  })

  it('opencode only exposes the bypass toggle; default/plan emit no flag', () => {
    expect(opencodePermissionFlags('default')).toEqual([])
    expect(opencodePermissionFlags('plan')).toEqual([])
    expect(opencodePermissionFlags('bypass')).toEqual(['--dangerously-skip-permissions'])
  })

  it('copilot always keeps --allow-all-tools for -p; bypass adds --allow-all', () => {
    expect(copilotPermissionFlags('default')).toEqual(['--allow-all-tools', '--no-ask-user'])
    expect(copilotPermissionFlags('plan')).toEqual(['--allow-all-tools', '--no-ask-user'])
    expect(copilotPermissionFlags('bypass')).toEqual(['--allow-all', '--allow-all-tools', '--no-ask-user'])
  })
})

describe('normalizeHeadlessMode (the safe-by-default escalation)', () => {
  it("escalates 'default' to 'bypass' only on claude/opencode (no headless ask-mode)", () => {
    expect(normalizeHeadlessMode('default', 'claude')).toBe('bypass')
    expect(normalizeHeadlessMode('default', 'opencode')).toBe('bypass')
  })

  it("leaves 'default' intact on codex/copilot (they honor it headlessly)", () => {
    expect(normalizeHeadlessMode('default', 'codex')).toBe('default')
    expect(normalizeHeadlessMode('default', 'copilot')).toBe('default')
  })

  it('never rewrites plan or bypass on any CLI', () => {
    for (const bin of ['claude', 'codex', 'opencode', 'copilot'] as InitCliBin[]) {
      expect(normalizeHeadlessMode('plan', bin)).toBe('plan')
      expect(normalizeHeadlessMode('bypass', bin)).toBe('bypass')
    }
  })

  it('defaultPermissionModeFor is normalizeHeadlessMode(default, bin)', () => {
    for (const bin of ['claude', 'codex', 'opencode', 'copilot'] as InitCliBin[]) {
      expect(defaultPermissionModeFor(bin)).toBe(normalizeHeadlessMode('default', bin))
    }
    // The safe per-CLI default: codex/copilot sandboxed/minimal, others bypass.
    expect(defaultPermissionModeFor('codex')).toBe('default')
    expect(defaultPermissionModeFor('copilot')).toBe('default')
    expect(defaultPermissionModeFor('claude')).toBe('bypass')
    expect(defaultPermissionModeFor('opencode')).toBe('bypass')
  })
})

describe('init permission mode', () => {
  it('returns the least-permissive headless-capable write mode per CLI', () => {
    expect(initPermissionModeFor('claude')).toBe('bypass')
    expect(initPermissionModeFor('opencode')).toBe('bypass')
    expect(initPermissionModeFor('codex')).toBe('default')
    expect(initPermissionModeFor('copilot')).toBe('default')
  })

  it('initPermissionFlagsFor matches the resolved per-CLI flags', () => {
    expect(initPermissionFlagsFor('claude')).toEqual(['--dangerously-skip-permissions'])
    expect(initPermissionFlagsFor('codex')).toEqual(['--full-auto'])
    expect(initPermissionFlagsFor('opencode')).toEqual(['--dangerously-skip-permissions'])
    expect(initPermissionFlagsFor('copilot')).toEqual(['--allow-all-tools', '--no-ask-user'])
  })
})

describe('permissionModeSystemPromptPrefix', () => {
  it('is empty for default and bypass', () => {
    expect(permissionModeSystemPromptPrefix('default')).toBe('')
    expect(permissionModeSystemPromptPrefix('bypass')).toBe('')
  })

  it('emits a strong read-only directive for plan', () => {
    const prefix = permissionModeSystemPromptPrefix('plan')
    expect(prefix).toContain('PLAN MODE')
    expect(prefix).toContain('Do NOT call any tool that')
    expect(prefix.length).toBeGreaterThan(0)
  })
})

/**
 * Spin a provider's stream once with a fake fetch that captures the POSTed
 * spawn body, then returns a trivial SSE stream so the generator completes.
 * Returns the `args` the provider asked the server to spawn.
 */
async function captureSpawnArgs(
  provider: CliLocalProvider,
  options: StreamOptions,
): Promise<string[]> {
  for await (const _ of provider.stream([{ role: 'user', content: 'hi' }], [], options)) {
    // drain — the fake fetch already captured the body on the POST
  }
  return capturedArgs
}

let capturedArgs: string[] = []
function fakeSpawnFetch(): typeof fetch {
  return (async (_url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? '{}')) as { args?: string[] }
    capturedArgs = body.args ?? []
    const sse = ['event: exit', 'data: {"code":0,"signal":null}', '', ''].join('\n')
    return new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(sse))
          controller.close()
        },
      }),
      { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
    )
  }) as unknown as typeof fetch
}

describe('providers thread the permission flag into spawn args', () => {
  const fetchImpl = fakeSpawnFetch()

  it('claude threads plan and bypass flags', async () => {
    const p = new ClaudeLocalProvider({ fetchImpl })
    expect(await captureSpawnArgs(p, { systemPrompt: '', permissionMode: 'plan' }))
      .toEqual(expect.arrayContaining(['--permission-mode', 'plan']))
    expect(await captureSpawnArgs(p, { systemPrompt: '', permissionMode: 'bypass' }))
      .toContain('--dangerously-skip-permissions')
  })

  it('codex threads sandbox flags', async () => {
    const p = new CodexLocalProvider({ fetchImpl })
    expect(await captureSpawnArgs(p, { systemPrompt: '', permissionMode: 'plan' }))
      .toEqual(expect.arrayContaining(['--sandbox', 'read-only']))
    expect(await captureSpawnArgs(p, { systemPrompt: '', permissionMode: 'default' }))
      .toContain('--full-auto')
  })

  it('opencode threads the bypass toggle only', async () => {
    const p = new OpencodeLocalProvider({ fetchImpl })
    expect(await captureSpawnArgs(p, { systemPrompt: '', permissionMode: 'bypass' }))
      .toContain('--dangerously-skip-permissions')
    expect(await captureSpawnArgs(p, { systemPrompt: '', permissionMode: 'plan' }))
      .not.toContain('--dangerously-skip-permissions')
  })

  it('copilot always threads --allow-all-tools; bypass adds --allow-all', async () => {
    const p = new CopilotLocalProvider({ fetchImpl })
    expect(await captureSpawnArgs(p, { systemPrompt: '', permissionMode: 'plan' }))
      .toContain('--allow-all-tools')
    expect(await captureSpawnArgs(p, { systemPrompt: '', permissionMode: 'bypass' }))
      .toContain('--allow-all')
  })
})

// Exhaustiveness guard: every PermissionMode is handled by every flag fn.
describe('flag functions are total over PermissionMode', () => {
  const modes: PermissionMode[] = ['default', 'plan', 'bypass']
  const bins: InitCliBin[] = ['claude', 'codex', 'opencode', 'copilot']
  it('never throws and always returns string[]', () => {
    for (const m of modes) {
      expect(Array.isArray(claudePermissionFlags(m))).toBe(true)
      expect(Array.isArray(codexPermissionFlags(m))).toBe(true)
      expect(Array.isArray(opencodePermissionFlags(m))).toBe(true)
      expect(Array.isArray(copilotPermissionFlags(m))).toBe(true)
    }
    for (const b of bins) {
      expect(Array.isArray(initPermissionFlagsFor(b))).toBe(true)
    }
  })
})
