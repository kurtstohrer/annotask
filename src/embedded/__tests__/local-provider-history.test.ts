/**
 * Multi-turn history rollup for the one-shot positional-prompt CLIs.
 *
 * codex/opencode/copilot spawn a fresh subprocess per chat turn, so the only
 * conversation memory they get is what `rollupHistoryAsPrompt` packs into the
 * positional prompt. These tests pin:
 *   - the rollup shape (prior turns in order, system prompt exactly once,
 *     current request last),
 *   - the argv-size budget (oldest turns dropped first, marker left behind),
 *   - that each provider's buildSpawn actually threads the rollup through
 *     to the spawned argv (captured via a fake spawn transport, same pattern
 *     as provider-permission-matrix.test.ts),
 *   - that claude keeps its stdin path (full flattened history, no rollup
 *     headings) untouched.
 */
import { describe, it, expect } from 'vitest'
import {
  rollupHistoryAsPrompt,
  withSystemPrompt,
  lastUserMessageText,
  POSITIONAL_PROMPT_MAX_CHARS,
  HISTORY_TRUNCATED_MARKER,
  type CliLocalProvider,
  type SpawnRequest,
} from '../cli-local-provider.js'
import { ClaudeLocalProvider } from '../claude-local-provider.js'
import { CodexLocalProvider } from '../codex-local-provider.js'
import { OpencodeLocalProvider } from '../opencode-local-provider.js'
import { CopilotLocalProvider } from '../copilot-local-provider.js'
import type { ProviderMessage } from '../provider.js'

const SYSTEM = 'SYSPROMPT_SENTINEL: be terse.'

/** 3-turn conversation: one full prior exchange + the live follow-up. */
const THREE_TURNS: ProviderMessage[] = [
  { role: 'user', content: 'make the button red' },
  { role: 'assistant', content: '[Tool] Editing Button.vue\nDone — the button is now red.' },
  { role: 'user', content: 'actually make it blue instead' },
]

// ── Fake spawn transport: capture the POSTed SpawnRequest, return a trivial SSE ──
function makeCapturingFetch(): { fetchImpl: typeof fetch; captured: () => SpawnRequest } {
  let captured: SpawnRequest = { cli: 'claude', args: [] }
  const fetchImpl = (async (_url: string, init?: RequestInit) => {
    captured = JSON.parse(String(init?.body ?? '{}')) as SpawnRequest
    const sse = ['event: exit', 'data: {"code":0,"signal":null}', '', ''].join('\n')
    return new Response(
      new ReadableStream<Uint8Array>({
        start(c) { c.enqueue(new TextEncoder().encode(sse)); c.close() },
      }),
      { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
    )
  }) as unknown as typeof fetch
  return { fetchImpl, captured: () => captured }
}

async function captureSpawn(provider: CliLocalProvider, capture: () => SpawnRequest, messages: ProviderMessage[]): Promise<SpawnRequest> {
  for await (const _ of provider.stream(messages, [], { systemPrompt: SYSTEM })) { /* drain */ }
  return capture()
}

/** Assert the rolled-up prompt carries both prior turns + the live request, in order. */
function expectFullHistoryInOrder(prompt: string): void {
  const iUser1 = prompt.indexOf('User: make the button red')
  const iAssistant = prompt.indexOf('Assistant: [Tool] Editing Button.vue')
  const iCurrent = prompt.indexOf('actually make it blue instead')
  expect(iUser1).toBeGreaterThan(-1)
  expect(iAssistant).toBeGreaterThan(iUser1)
  expect(iCurrent).toBeGreaterThan(iAssistant)
  // System prompt present exactly once, ahead of the transcript.
  expect(prompt.split('SYSPROMPT_SENTINEL').length - 1).toBe(1)
  expect(prompt.indexOf(SYSTEM)).toBeLessThan(iUser1)
}

describe('rollupHistoryAsPrompt', () => {
  it('keeps the exact single-shot shape on the first turn (no prior history)', () => {
    const messages: ProviderMessage[] = [{ role: 'user', content: 'apply task t-1' }]
    expect(rollupHistoryAsPrompt(messages, SYSTEM))
      .toBe(withSystemPrompt(lastUserMessageText(messages), SYSTEM))
  })

  it('rolls up prior turns as a delimited transcript before the current request', () => {
    const prompt = rollupHistoryAsPrompt(THREE_TURNS, SYSTEM)
    expectFullHistoryInOrder(prompt)
    expect(prompt).toContain('## Conversation so far')
    expect(prompt).toContain('## Current request')
    // The live request comes after the transcript section.
    expect(prompt.indexOf('## Current request')).toBeGreaterThan(prompt.indexOf('## Conversation so far'))
    expect(prompt).not.toContain(HISTORY_TRUNCATED_MARKER)
  })

  it('reads text out of content-block messages too', () => {
    const messages: ProviderMessage[] = [
      { role: 'user', content: [{ type: 'text', text: 'first ' }, { type: 'text', text: 'question' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'first answer' }] },
      { role: 'user', content: 'second question' },
    ]
    const prompt = rollupHistoryAsPrompt(messages, SYSTEM)
    expect(prompt).toContain('User: first question')
    expect(prompt).toContain('Assistant: first answer')
    expect(prompt).toContain('second question')
  })

  it('drops OLDEST turns first when the history exceeds the budget, leaving a marker', () => {
    const messages: ProviderMessage[] = [
      { role: 'user', content: `OLDEST_TURN ${'x'.repeat(200_000)}` },
      { role: 'assistant', content: 'RECENT_REPLY still fits' },
      { role: 'user', content: 'CURRENT_REQUEST' },
    ]
    const prompt = rollupHistoryAsPrompt(messages, SYSTEM)
    expect(prompt.length).toBeLessThanOrEqual(POSITIONAL_PROMPT_MAX_CHARS)
    expect(prompt).not.toContain('OLDEST_TURN')
    expect(prompt).toContain(HISTORY_TRUNCATED_MARKER)
    // The marker sits where the dropped turns were — before what survived.
    expect(prompt.indexOf(HISTORY_TRUNCATED_MARKER)).toBeLessThan(prompt.indexOf('RECENT_REPLY'))
    expect(prompt).toContain('RECENT_REPLY still fits')
    expect(prompt).toContain('CURRENT_REQUEST')
  })

  it('stops keeping turns at the first one that does not fit (no out-of-order gaps)', () => {
    // Newest-first walk: turn C fits, oversized turn B does not — so A (older
    // than B) must be dropped too even though it would fit on its own.
    const messages: ProviderMessage[] = [
      { role: 'user', content: 'TURN_A tiny' },
      { role: 'assistant', content: `TURN_B ${'y'.repeat(200_000)}` },
      { role: 'user', content: 'TURN_C also tiny' },
      { role: 'user', content: 'CURRENT' },
    ]
    const prompt = rollupHistoryAsPrompt(messages, SYSTEM)
    expect(prompt).toContain('TURN_C also tiny')
    expect(prompt).not.toContain('TURN_B')
    expect(prompt).not.toContain('TURN_A')
    expect(prompt).toContain(HISTORY_TRUNCATED_MARKER)
  })

  it('never truncates the current request, even when it alone exceeds the budget', () => {
    const huge = `HUGE_SEED ${'z'.repeat(150_000)}`
    const messages: ProviderMessage[] = [
      { role: 'user', content: 'small prior turn' },
      { role: 'assistant', content: 'small reply' },
      { role: 'user', content: huge },
    ]
    const prompt = rollupHistoryAsPrompt(messages, SYSTEM)
    expect(prompt).toContain(huge)
    // All history gets dropped to make room; the marker says so.
    expect(prompt).not.toContain('small prior turn')
    expect(prompt).toContain(HISTORY_TRUNCATED_MARKER)
  })
})

describe('positional-prompt providers thread the rollup into argv', () => {
  // Codex/opencode pass the prompt as the positional after `--`; copilot
  // passes it as the value of `-p`.
  const cases: Array<{ name: string; make(fetchImpl: typeof fetch): CliLocalProvider; promptOf(req: SpawnRequest): string }> = [
    {
      name: 'codex',
      make: (fetchImpl) => new CodexLocalProvider({ fetchImpl }),
      promptOf: (req) => req.args[req.args.indexOf('--') + 1] ?? '',
    },
    {
      name: 'opencode',
      make: (fetchImpl) => new OpencodeLocalProvider({ fetchImpl }),
      promptOf: (req) => req.args[req.args.indexOf('--') + 1] ?? '',
    },
    {
      name: 'copilot',
      make: (fetchImpl) => new CopilotLocalProvider({ fetchImpl }),
      promptOf: (req) => req.args[req.args.indexOf('-p') + 1] ?? '',
    },
  ]

  for (const c of cases) {
    it(`${c.name}: a 3-turn conversation reaches the CLI with full history in order`, async () => {
      const { fetchImpl, captured } = makeCapturingFetch()
      const req = await captureSpawn(c.make(fetchImpl), captured, THREE_TURNS)
      const prompt = c.promptOf(req)
      expectFullHistoryInOrder(prompt)
      expect(prompt).toContain('## Conversation so far')
    })

    it(`${c.name}: an oversized history is truncated to the argv budget`, async () => {
      const { fetchImpl, captured } = makeCapturingFetch()
      const messages: ProviderMessage[] = [
        { role: 'user', content: `OLDEST_TURN ${'x'.repeat(200_000)}` },
        { role: 'assistant', content: 'recent reply' },
        { role: 'user', content: 'current request' },
      ]
      const req = await captureSpawn(c.make(fetchImpl), captured, messages)
      const prompt = c.promptOf(req)
      expect(prompt.length).toBeLessThanOrEqual(POSITIONAL_PROMPT_MAX_CHARS)
      expect(prompt).not.toContain('OLDEST_TURN')
      expect(prompt).toContain(HISTORY_TRUNCATED_MARKER)
      expect(prompt).toContain('current request')
    })
  }
})

describe('claude keeps its stdin path', () => {
  it('full flattened history rides on stdin, not the rollup headings', async () => {
    const { fetchImpl, captured } = makeCapturingFetch()
    const req = await captureSpawn(new ClaudeLocalProvider({ fetchImpl }), captured, THREE_TURNS)
    expect(req.stdin).toBeDefined()
    const stdin = req.stdin ?? ''
    // Flatten shape: every turn prefixed, no transcript headings.
    expect(stdin).toContain('User: make the button red')
    expect(stdin).toContain('User: actually make it blue instead')
    expect(stdin).not.toContain('## Conversation so far')
    // No positional prompt in argv.
    expect(req.args).not.toContain('--')
  })
})
