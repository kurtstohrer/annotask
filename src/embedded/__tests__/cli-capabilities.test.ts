/**
 * Capability-driven CLI invocations + estimated usage.
 *
 * Pins the three behaviors added with the capability probe:
 *   1. claude `--append-system-prompt` — with the capability flagged, the
 *      composed skill prompt rides a REAL system-prompt flag (cacheable
 *      alongside Claude Code's own prefix) and leaves the user message; an
 *      un-flagged CLI keeps the legacy stdin flatten byte-identical.
 *   2. codex stdin transport — with `stdinPrompt` flagged, the prompt moves
 *      off argv (`-` positional) onto stdin with the larger history budget.
 *   3. estimated usage — a CLI that reports no usage at all yields a
 *      character-length estimate flagged `estimated`, and copilot's
 *      output-only usage gets its input side estimated instead of 0.
 */
import { describe, it, expect } from 'vitest'
import {
  estimateTokensFromChars,
  type CliLocalProvider,
  type SpawnRequest,
} from '../cli-local-provider.js'
import { ClaudeLocalProvider } from '../claude-local-provider.js'
import { CodexLocalProvider } from '../codex-local-provider.js'
import { CopilotLocalProvider } from '../copilot-local-provider.js'
import type { ProviderEvent, ProviderMessage, StreamOptions } from '../provider.js'

const SYSTEM = 'SYSPROMPT_SENTINEL: be terse.'

const TURNS: ProviderMessage[] = [
  { role: 'user', content: 'make the button red' },
  { role: 'assistant', content: 'Done — the button is now red.' },
  { role: 'user', content: 'actually make it blue instead' },
]

function sse(lines: string[]): Response {
  const body = lines.join('\n') + '\n\n'
  return new Response(
    new ReadableStream<Uint8Array>({
      start(c) { c.enqueue(new TextEncoder().encode(body)); c.close() },
    }),
    { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
  )
}

function makeCapturingFetch(frames: string[] = ['event: exit', 'data: {"code":0,"signal":null}', '']): {
  fetchImpl: typeof fetch
  captured: () => SpawnRequest
} {
  let captured: SpawnRequest = { cli: 'claude', args: [] }
  const fetchImpl = (async (_url: string, init?: RequestInit) => {
    captured = JSON.parse(String(init?.body ?? '{}')) as SpawnRequest
    return sse(frames)
  }) as unknown as typeof fetch
  return { fetchImpl, captured: () => captured }
}

async function drainWith(
  provider: CliLocalProvider,
  options: Partial<StreamOptions>,
): Promise<ProviderEvent[]> {
  const events: ProviderEvent[] = []
  for await (const ev of provider.stream(TURNS, [], { systemPrompt: SYSTEM, ...options })) {
    events.push(ev)
  }
  return events
}

describe('claude --append-system-prompt', () => {
  it('with the capability, the skill prompt rides the flag and leaves stdin', async () => {
    const { fetchImpl, captured } = makeCapturingFetch()
    await drainWith(new ClaudeLocalProvider({ fetchImpl }), {
      cliCapabilities: { appendSystemPrompt: true },
    })
    const req = captured()
    const i = req.args.indexOf('--append-system-prompt')
    expect(i).toBeGreaterThan(-1)
    expect(req.args[i + 1]).toBe(SYSTEM)
    // stdin keeps the FULL history but no longer opens with the instructions.
    expect(req.stdin).not.toContain('SYSPROMPT_SENTINEL')
    expect(req.stdin).toContain('make the button red')
    expect(req.stdin).toContain('actually make it blue instead')
  })

  it('without the capability, the legacy stdin flatten is untouched', async () => {
    const { fetchImpl, captured } = makeCapturingFetch()
    await drainWith(new ClaudeLocalProvider({ fetchImpl }), {})
    const req = captured()
    expect(req.args).not.toContain('--append-system-prompt')
    expect(req.stdin).toContain('SYSPROMPT_SENTINEL')
  })

  it('resume spawns never re-send the system prompt, flag or not', async () => {
    const { fetchImpl, captured } = makeCapturingFetch()
    await drainWith(new ClaudeLocalProvider({ fetchImpl }), {
      resumeSessionId: 'sess-1',
      cliCapabilities: { appendSystemPrompt: true },
    })
    const req = captured()
    expect(req.args).not.toContain('--append-system-prompt')
    expect(req.stdin).toBe('actually make it blue instead')
  })
})

describe('codex stdin transport', () => {
  it('with stdinPrompt, the prompt moves to stdin behind the `-` positional', async () => {
    const { fetchImpl, captured } = makeCapturingFetch()
    await drainWith(new CodexLocalProvider({ fetchImpl }), {
      cliCapabilities: { stdinPrompt: true },
    })
    const req = captured()
    expect(req.args.slice(-2)).toEqual(['--', '-'])
    expect(req.stdin).toContain('SYSPROMPT_SENTINEL')
    expect(req.stdin).toContain('actually make it blue instead')
  })

  it('without the capability, the prompt stays a positional argv element', async () => {
    const { fetchImpl, captured } = makeCapturingFetch()
    await drainWith(new CodexLocalProvider({ fetchImpl }), {})
    const req = captured()
    expect(req.stdin).toBeUndefined()
    expect(req.args[req.args.length - 1]).toContain('SYSPROMPT_SENTINEL')
  })
})

describe('estimated usage', () => {
  it('a CLI that reports no usage yields a character-length estimate, flagged', async () => {
    const text = JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'blue now' }] } })
    const { fetchImpl } = makeCapturingFetch([
      'event: stdout', `data: ${text}`, '',
      'event: exit', 'data: {"code":0,"signal":null}', '',
    ])
    const events = await drainWith(new ClaudeLocalProvider({ fetchImpl }), {})
    const usage = events.find((e) => e.type === 'usage')
    expect(usage).toBeDefined()
    expect(usage).toMatchObject({ estimated: true })
    // Prompt is dozens of chars → estimate must be non-zero; output is
    // 'blue now' (8 chars) → ~2 tokens.
    expect((usage as { inputTokens: number }).inputTokens).toBeGreaterThan(0)
    expect((usage as { outputTokens: number }).outputTokens).toBe(estimateTokensFromChars('blue now'.length))
  })

  it("copilot's output-only usage gets its input side estimated instead of 0", async () => {
    const final = JSON.stringify({ type: 'assistant.message', data: { content: 'ok', outputTokens: 21 } })
    const { fetchImpl } = makeCapturingFetch([
      'event: stdout', `data: ${JSON.stringify({ type: 'assistant.message_delta', data: { deltaContent: 'ok' } })}`, '',
      'event: stdout', `data: ${final}`, '',
      'event: exit', 'data: {"code":0,"signal":null}', '',
    ])
    const events = await drainWith(new CopilotLocalProvider({ fetchImpl }), {})
    const usage = events.find((e) => e.type === 'usage')
    expect(usage).toMatchObject({ outputTokens: 21, estimated: true })
    expect((usage as { inputTokens: number }).inputTokens).toBeGreaterThan(0)
  })

  it('estimateTokensFromChars is ~chars/3.6 and clamps garbage to 0', () => {
    expect(estimateTokensFromChars(360)).toBe(100)
    expect(estimateTokensFromChars(0)).toBe(0)
    expect(estimateTokensFromChars(-5)).toBe(0)
    expect(estimateTokensFromChars(Number.NaN)).toBe(0)
  })
})
