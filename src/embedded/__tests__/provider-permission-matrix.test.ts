/**
 * Cross-provider permission WORKFLOW matrix — all 4 local CLIs × all 3 modes,
 * hermetic (no CLI install needed, runs in CI).
 *
 * This exercises the real end-to-end path a user triggers when they pick a
 * permission mode in the UI:
 *
 *   selected mode  --normalizeHeadlessMode(mode, bin)-->  effective mode
 *                  --provider.buildSpawn()-->             spawned argv
 *                  --exceedsPermissionCap()-->            server-side floor
 *
 * It pins the headline "Auto" (`default`) safety behavior per CLI (codex/
 * copilot stay sandboxed/minimal; claude/opencode escalate to bypass) and
 * proves the ANNOTASK_MAX_PERMISSION clamp would gate the right providers.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { ClaudeLocalProvider } from '../claude-local-provider.js'
import { CodexLocalProvider } from '../codex-local-provider.js'
import { OpencodeLocalProvider } from '../opencode-local-provider.js'
import { CopilotLocalProvider } from '../copilot-local-provider.js'
import {
  normalizeHeadlessMode,
  claudePermissionFlags,
  codexPermissionFlags,
  opencodePermissionFlags,
  copilotPermissionFlags,
  type InitCliBin,
} from '../permission-mode-flags.js'
import { exceedsPermissionCap } from '../../server/agent-spawn.js'
import type { CliLocalProvider } from '../cli-local-provider.js'
import type { PermissionMode } from '../../schema.js'

// ── Fake spawn transport: capture the POSTed argv, return a trivial SSE ──────
let capturedArgs: string[] = []
const fetchImpl = (async (_url: string, init?: RequestInit) => {
  capturedArgs = (JSON.parse(String(init?.body ?? '{}')) as { args?: string[] }).args ?? []
  const sse = ['event: exit', 'data: {"code":0,"signal":null}', '', ''].join('\n')
  return new Response(
    new ReadableStream<Uint8Array>({
      start(c) { c.enqueue(new TextEncoder().encode(sse)); c.close() },
    }),
    { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
  )
}) as unknown as typeof fetch

async function spawnArgsFor(provider: CliLocalProvider, effectiveMode: PermissionMode): Promise<string[]> {
  for await (const _ of provider.stream(
    [{ role: 'user', content: 'apply the task' }], [], { systemPrompt: '', permissionMode: effectiveMode },
  )) { /* drain */ }
  return capturedArgs
}

interface ProviderSpec {
  bin: InitCliBin
  make(): CliLocalProvider
  flags(mode: PermissionMode): string[]
}

const PROVIDERS: ProviderSpec[] = [
  { bin: 'claude', make: () => new ClaudeLocalProvider({ fetchImpl }), flags: claudePermissionFlags },
  { bin: 'codex', make: () => new CodexLocalProvider({ fetchImpl }), flags: codexPermissionFlags },
  { bin: 'opencode', make: () => new OpencodeLocalProvider({ fetchImpl }), flags: opencodePermissionFlags },
  { bin: 'copilot', make: () => new CopilotLocalProvider({ fetchImpl }), flags: copilotPermissionFlags },
]
const SELECTED_MODES: PermissionMode[] = ['default', 'plan', 'bypass']

describe('provider permission workflow matrix (4 CLIs × 3 modes)', () => {
  for (const p of PROVIDERS) {
    for (const selected of SELECTED_MODES) {
      it(`${p.bin}: selecting '${selected}' spawns the headless-normalized flags`, async () => {
        // What the runner actually does: resolve → normalize for the CLI → spawn.
        const effective = normalizeHeadlessMode(selected, p.bin)
        const expected = p.flags(effective)
        const args = await spawnArgsFor(p.make(), effective)
        for (const flag of expected) expect(args).toContain(flag)
        // Plan must never leave a bypass flag on a CLI that has native plan.
        if (selected === 'plan' && (p.bin === 'claude' || p.bin === 'codex')) {
          expect(args).not.toContain('--dangerously-skip-permissions')
          expect(args).not.toContain('--dangerously-bypass-approvals-and-sandbox')
        }
      })
    }
  }
})

describe("headline 'Auto' (default) safety behavior per CLI", () => {
  it('codex Auto stays sandboxed (--full-auto), NOT sandbox-off', async () => {
    const args = await spawnArgsFor(new CodexLocalProvider({ fetchImpl }), normalizeHeadlessMode('default', 'codex'))
    expect(args).toContain('--full-auto')
    expect(args).not.toContain('--dangerously-bypass-approvals-and-sandbox')
  })
  it('copilot Auto stays minimal (--allow-all-tools), NOT --allow-all', async () => {
    const args = await spawnArgsFor(new CopilotLocalProvider({ fetchImpl }), normalizeHeadlessMode('default', 'copilot'))
    expect(args).toContain('--allow-all-tools')
    expect(args).not.toContain('--allow-all')
  })
  it('claude Auto escalates to bypass (no headless ask-mode)', async () => {
    const args = await spawnArgsFor(new ClaudeLocalProvider({ fetchImpl }), normalizeHeadlessMode('default', 'claude'))
    expect(args).toContain('--dangerously-skip-permissions')
  })
  it('opencode Auto escalates to bypass (no headless ask-mode)', async () => {
    const args = await spawnArgsFor(new OpencodeLocalProvider({ fetchImpl }), normalizeHeadlessMode('default', 'opencode'))
    expect(args).toContain('--dangerously-skip-permissions')
  })
})

describe('ANNOTASK_MAX_PERMISSION clamp gates the right providers (per-task path)', () => {
  afterEach(() => { delete process.env.ANNOTASK_MAX_PERMISSION })

  it("cap=default blocks an Auto run on claude/opencode but allows codex/copilot", async () => {
    process.env.ANNOTASK_MAX_PERMISSION = 'default'
    for (const p of PROVIDERS) {
      const args = await spawnArgsFor(p.make(), normalizeHeadlessMode('default', p.bin))
      const blocked = exceedsPermissionCap(args)
      if (p.bin === 'claude' || p.bin === 'opencode') {
        expect(blocked).toMatchObject({ level: 'bypass', cap: 'default' })
      } else {
        expect(blocked).toBeNull()
      }
    }
  })

  it('cap=plan blocks an Auto run on every CLI (all need writes)', async () => {
    process.env.ANNOTASK_MAX_PERMISSION = 'plan'
    for (const p of PROVIDERS) {
      const args = await spawnArgsFor(p.make(), normalizeHeadlessMode('default', p.bin))
      expect(exceedsPermissionCap(args)).not.toBeNull()
    }
  })

  it('no cap → an Auto run is allowed on every CLI', async () => {
    delete process.env.ANNOTASK_MAX_PERMISSION
    for (const p of PROVIDERS) {
      const args = await spawnArgsFor(p.make(), normalizeHeadlessMode('default', p.bin))
      expect(exceedsPermissionCap(args)).toBeNull()
    }
  })
})
