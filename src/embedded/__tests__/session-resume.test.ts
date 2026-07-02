/**
 * Session resume across the four local-CLI providers.
 *
 * Pins the three layers of the feature:
 *   1. Session-id PARSING — each provider maps its CLI's session envelope
 *      (claude stream-json init/result, codex thread.started/session.created,
 *      opencode part.sessionID, copilot session.* data) to a shared
 *      `{type:'session', sessionId}` event.
 *   2. Resume ARGV — with `options.resumeSessionId` set, each provider builds
 *      its CLI's native resume invocation and sends ONLY the latest user
 *      message: no system prompt, no prior turns (the session already holds
 *      them). Cold spawns stay byte-identical to before.
 *   3. Cold FALLBACK — the base class discards a resume attempt that dies
 *      contentless (stale/expired session) and silently retries with the
 *      full-history spawn, so a wrong id can never lose a turn.
 */
import { describe, it, expect } from 'vitest'
import type { CliLocalProvider, SpawnRequest } from '../cli-local-provider.js'
import { ClaudeLocalProvider, mapClaudeEvent } from '../claude-local-provider.js'
import { CodexLocalProvider, mapCodexEvent } from '../codex-local-provider.js'
import { OpencodeLocalProvider, mapOpencodeEvent } from '../opencode-local-provider.js'
import { CopilotLocalProvider, mapCopilotEvent } from '../copilot-local-provider.js'
import type { ProviderEvent, ProviderMessage } from '../provider.js'

const SYSTEM = 'SYSPROMPT_SENTINEL: be terse.'

const THREE_TURNS: ProviderMessage[] = [
  { role: 'user', content: 'make the button red' },
  { role: 'assistant', content: '[Tool] Editing Button.vue\nDone — the button is now red.' },
  { role: 'user', content: 'actually make it blue instead' },
]

// ── Fake spawn transport: programmable SSE per request, records every body ──

function sse(lines: string[]): Response {
  const body = lines.join('\n') + '\n\n'
  return new Response(
    new ReadableStream<Uint8Array>({
      start(c) { c.enqueue(new TextEncoder().encode(body)); c.close() },
    }),
    { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
  )
}

function exitFrame(code: number): string[] {
  return ['event: exit', `data: {"code":${code},"signal":null}`, '']
}

function stdoutFrame(json: string): string[] {
  return ['event: stdout', `data: ${json}`, '']
}

/** Fake fetch that serves `responses[i]` to the i-th POST and records bodies. */
function makeScriptedFetch(responses: Array<() => Response>): { fetchImpl: typeof fetch; bodies: SpawnRequest[] } {
  const bodies: SpawnRequest[] = []
  let call = 0
  const fetchImpl = (async (_url: string, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body ?? '{}')) as SpawnRequest)
    const make = responses[Math.min(call, responses.length - 1)]
    call++
    return make()
  }) as unknown as typeof fetch
  return { fetchImpl, bodies }
}

async function drain(provider: CliLocalProvider, messages: ProviderMessage[], resumeSessionId?: string): Promise<ProviderEvent[]> {
  const events: ProviderEvent[] = []
  for await (const ev of provider.stream(messages, [], { systemPrompt: SYSTEM, resumeSessionId })) {
    events.push(ev)
  }
  return events
}

// ── 1. Session-id parsing ──────────────────────────────────────────────────

describe('session-id parsing', () => {
  it('claude: system/init and result envelopes yield session events; result keeps usage', () => {
    expect(mapClaudeEvent({ type: 'system', subtype: 'init', session_id: 'c-1' }))
      .toEqual([{ type: 'session', sessionId: 'c-1' }])
    const result = mapClaudeEvent({ type: 'result', session_id: 'c-2', usage: { input_tokens: 5, output_tokens: 7 } })
    expect(result[0]).toEqual({ type: 'session', sessionId: 'c-2' })
    expect(result[1]).toMatchObject({ type: 'usage', inputTokens: 5, outputTokens: 7 })
    // A result without a session id still surfaces its usage.
    expect(mapClaudeEvent({ type: 'result', usage: { input_tokens: 1, output_tokens: 2 } }))
      .toEqual([{ type: 'usage', inputTokens: 1, outputTokens: 2, cacheReadTokens: undefined, cacheCreationTokens: undefined }])
    // Non-init system envelopes carry no session event.
    expect(mapClaudeEvent({ type: 'system', subtype: 'hook', session_id: 'c-3' })).toEqual([])
  })

  it('codex: thread.started (0.111+) and session.created (older) both parse', () => {
    expect(mapCodexEvent({ type: 'thread.started', thread_id: 'x-1' }))
      .toEqual([{ type: 'session', sessionId: 'x-1' }])
    expect(mapCodexEvent({ type: 'session.created', session_id: 'x-2' }))
      .toEqual([{ type: 'session', sessionId: 'x-2' }])
    expect(mapCodexEvent({ type: 'session_configured', session_id: 'x-3' }))
      .toEqual([{ type: 'session', sessionId: 'x-3' }])
    expect(mapCodexEvent({ type: 'thread.started' })).toEqual([])
  })

  it('opencode: part.sessionID and top-level spellings parse alongside the payload', () => {
    const events = mapOpencodeEvent({ type: 'text', part: { type: 'text', text: 'hi', sessionID: 'o-1' } })
    expect(events).toContainEqual({ type: 'session', sessionId: 'o-1' })
    expect(events).toContainEqual({ type: 'text', text: 'hi' })
    expect(mapOpencodeEvent({ type: 'step_finish', sessionID: 'o-2', part: { type: 'step-finish' } }))
      .toContainEqual({ type: 'session', sessionId: 'o-2' })
  })

  it('copilot: session.* envelopes yield session events across key spellings', () => {
    expect(mapCopilotEvent({ type: 'session.start', data: { sessionId: 'p-1' } }))
      .toEqual([{ type: 'session', sessionId: 'p-1' }])
    expect(mapCopilotEvent({ type: 'session.resumed', data: { session_id: 'p-2' } }))
      .toEqual([{ type: 'session', sessionId: 'p-2' }])
    // Non-session envelopes are untouched.
    expect(mapCopilotEvent({ type: 'assistant.message_delta', data: { deltaContent: 'ok' } }))
      .toEqual([{ type: 'text', text: 'ok' }])
  })
})

// ── 2. Resume argv: native flag + delta-only prompt ────────────────────────

describe('resume argv', () => {
  const okStream = () => sse([...stdoutFrame('{}'), ...exitFrame(0)])

  it('claude: --resume + stdin carries ONLY the latest user message', async () => {
    const { fetchImpl, bodies } = makeScriptedFetch([okStream])
    await drain(new ClaudeLocalProvider({ fetchImpl }), THREE_TURNS, 'sess-1')
    const req = bodies[0]
    const i = req.args.indexOf('--resume')
    expect(i).toBeGreaterThan(-1)
    expect(req.args[i + 1]).toBe('sess-1')
    expect(req.stdin).toBe('actually make it blue instead')
    expect(req.stdin).not.toContain('SYSPROMPT_SENTINEL')
    expect(req.stdin).not.toContain('make the button red')
  })

  it('codex: `exec resume <id>` subcommand + delta-only positional', async () => {
    const { fetchImpl, bodies } = makeScriptedFetch([okStream])
    await drain(new CodexLocalProvider({ fetchImpl }), THREE_TURNS, 'sess-2')
    const req = bodies[0]
    expect(req.args.slice(0, 3)).toEqual(['exec', 'resume', 'sess-2'])
    const positional = req.args[req.args.length - 1]
    expect(positional).toBe('actually make it blue instead')
  })

  it('opencode: --session <id> + delta-only positional', async () => {
    const { fetchImpl, bodies } = makeScriptedFetch([okStream])
    await drain(new OpencodeLocalProvider({ fetchImpl }), THREE_TURNS, 'sess-3')
    const req = bodies[0]
    const i = req.args.indexOf('--session')
    expect(i).toBeGreaterThan(-1)
    expect(req.args[i + 1]).toBe('sess-3')
    expect(req.args[req.args.length - 1]).toBe('actually make it blue instead')
  })

  it('copilot: --resume <id> + delta-only -p prompt', async () => {
    const { fetchImpl, bodies } = makeScriptedFetch([okStream])
    await drain(new CopilotLocalProvider({ fetchImpl }), THREE_TURNS, 'sess-4')
    const req = bodies[0]
    const r = req.args.indexOf('--resume')
    expect(r).toBeGreaterThan(-1)
    expect(req.args[r + 1]).toBe('sess-4')
    const p = req.args.indexOf('-p')
    expect(req.args[p + 1]).toBe('actually make it blue instead')
  })

  it('cold spawns stay resume-free with the full history (no regression)', async () => {
    const { fetchImpl, bodies } = makeScriptedFetch([okStream])
    await drain(new ClaudeLocalProvider({ fetchImpl }), THREE_TURNS)
    expect(bodies).toHaveLength(1)
    expect(bodies[0].args).not.toContain('--resume')
    expect(bodies[0].stdin).toContain('SYSPROMPT_SENTINEL')
    expect(bodies[0].stdin).toContain('make the button red')
  })
})

// ── 3. Cold fallback on a stale session ────────────────────────────────────

const CLAUDE_TEXT = '{"type":"assistant","message":{"content":[{"type":"text","text":"blue now"}]}}'
const CLAUDE_INIT = '{"type":"system","subtype":"init","session_id":"fresh-1"}'
// The REAL stale-resume shape observed from claude 2.1.198: exit 1, an stderr
// line, AND an error `result` envelope that echoes the BOGUS session id back
// with zero usage. The holdback must discard all of it — a leaked bogus-id
// session event would poison the runner's stored id and doom every later turn.
const CLAUDE_STALE_RESULT =
  '{"type":"result","subtype":"error_during_execution","is_error":true,"num_turns":0,"session_id":"sess-9","usage":{"input_tokens":0,"output_tokens":0}}'

describe('stale-session fallback', () => {
  it('a contentless non-zero resume attempt silently retries cold with full history', async () => {
    const { fetchImpl, bodies } = makeScriptedFetch([
      // Attempt 1 (resume): the real observed stale-session shape.
      () => sse([
        'event: stderr', 'data: No conversation found with session ID: sess-9', '',
        ...stdoutFrame(CLAUDE_STALE_RESULT),
        ...exitFrame(1),
      ]),
      // Attempt 2 (cold): fresh session id + real content.
      () => sse([...stdoutFrame(CLAUDE_INIT), ...stdoutFrame(CLAUDE_TEXT), ...exitFrame(0)]),
    ])
    const events = await drain(new ClaudeLocalProvider({ fetchImpl }), THREE_TURNS, 'sess-9')

    expect(bodies).toHaveLength(2)
    expect(bodies[0].args).toContain('--resume')
    expect(bodies[1].args).not.toContain('--resume')
    expect(bodies[1].stdin).toContain('SYSPROMPT_SENTINEL')
    expect(bodies[1].stdin).toContain('make the button red')

    // The caller sees ONE clean turn: no error from the discarded attempt,
    // the cold attempt's text + fresh session id, exactly one done — and the
    // bogus id from the failed attempt's result envelope never leaks.
    expect(events.filter((e) => e.type === 'error')).toEqual([])
    expect(events).toContainEqual({ type: 'text', text: 'blue now' })
    expect(events).toContainEqual({ type: 'session', sessionId: 'fresh-1' })
    expect(events).not.toContainEqual({ type: 'session', sessionId: 'sess-9' })
    const dones = events.filter((e) => e.type === 'done')
    expect(dones).toHaveLength(1)
    expect((dones[0] as { stopReason?: string }).stopReason).toBeUndefined()
  })

  it('a resume attempt that produces content does NOT fall back, even on non-zero exit', async () => {
    const { fetchImpl, bodies } = makeScriptedFetch([
      () => sse([...stdoutFrame(CLAUDE_TEXT), ...exitFrame(1)]),
    ])
    const events = await drain(new ClaudeLocalProvider({ fetchImpl }), THREE_TURNS, 'sess-9')
    expect(bodies).toHaveLength(1)
    expect(events).toContainEqual({ type: 'text', text: 'blue now' })
    // The failure surfaces honestly instead of being retried.
    expect(events.some((e) => e.type === 'error')).toBe(true)
  })

  it('a successful resume attempt spawns exactly once', async () => {
    const { fetchImpl, bodies } = makeScriptedFetch([
      () => sse([...stdoutFrame(CLAUDE_INIT), ...stdoutFrame(CLAUDE_TEXT), ...exitFrame(0)]),
    ])
    const events = await drain(new ClaudeLocalProvider({ fetchImpl }), THREE_TURNS, 'sess-1')
    expect(bodies).toHaveLength(1)
    expect(events).toContainEqual({ type: 'text', text: 'blue now' })
    expect(events).toContainEqual({ type: 'session', sessionId: 'fresh-1' })
  })

  it('the 409 already-running rejection never triggers a fallback spawn', async () => {
    const { fetchImpl, bodies } = makeScriptedFetch([
      () => new Response(JSON.stringify({ error: { code: 'task_already_running', message: 'busy' } }), { status: 409 }),
    ])
    const events = await drain(new ClaudeLocalProvider({ fetchImpl }), THREE_TURNS, 'sess-1')
    expect(bodies).toHaveLength(1)
    expect(events).toEqual([{ type: 'done', stopReason: 'already_running' }])
  })
})
