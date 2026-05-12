import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import {
  CopilotProvider,
  readOAuthToken,
  type CopilotSessionToken,
} from '../copilot-provider'

function sseResponse(frames: string[]): Response {
  return new Response(frames.map(f => `data: ${f}\n\n`).join(''), {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  })
}

describe('readOAuthToken', () => {
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'copilot-token-'))
  })
  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  it('reads oauth_token from apps.json when present', async () => {
    await fs.writeFile(
      path.join(tmpDir, 'apps.json'),
      JSON.stringify({ 'github.com:Iv1.b507': { oauth_token: 'ghu_apps' } }),
    )
    expect(await readOAuthToken(tmpDir)).toBe('ghu_apps')
  })

  it('falls back to hosts.json when apps.json is absent', async () => {
    await fs.writeFile(
      path.join(tmpDir, 'hosts.json'),
      JSON.stringify({ 'github.com': { oauth_token: 'ghu_hosts' } }),
    )
    expect(await readOAuthToken(tmpDir)).toBe('ghu_hosts')
  })

  it('throws a directive error when neither file exists', async () => {
    await expect(readOAuthToken(tmpDir)).rejects.toThrow(/No GitHub Copilot OAuth token/)
  })
})

describe('CopilotProvider session token cache', () => {
  it('reuses the session token across calls and refreshes only when it nears expiry', async () => {
    const fixed = 1_700_000_000_000
    vi.useFakeTimers()
    vi.setSystemTime(fixed)

    const issued: string[] = []
    let nextExpiresIn = 300 // 5 minutes
    const resolver = vi.fn(async (): Promise<CopilotSessionToken> => {
      const token = `copilot-token-${issued.length + 1}`
      issued.push(token)
      return {
        token,
        expiresAt: Math.floor(Date.now() / 1000) + nextExpiresIn,
        chatEndpoint: 'https://copilot.example/chat/completions',
      }
    })

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      sseResponse([
        JSON.stringify({ choices: [{ index: 0, delta: { content: 'ok' } }] }),
        JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }),
        JSON.stringify({ usage: { prompt_tokens: 1, completion_tokens: 1 } }),
        '[DONE]',
      ]),
    )

    const provider = new CopilotProvider({ sessionTokenResolver: resolver })

    async function drainTurn() {
      const out = []
      for await (const ev of provider.stream(
        [{ role: 'user', content: 'hi' }],
        [],
        { systemPrompt: 'sys' },
      )) out.push(ev)
      return out
    }

    await drainTurn()
    await drainTurn()
    // Two turns, one issued token — cache hit on the second call.
    expect(resolver).toHaveBeenCalledTimes(1)

    // Jump past the near-expiry slack window and call again — the next
    // request must trigger a refresh.
    nextExpiresIn = 600
    vi.setSystemTime(fixed + 5 * 60 * 1000) // +5min, inside slack window
    await drainTurn()
    expect(resolver).toHaveBeenCalledTimes(2)
    expect(issued).toEqual(['copilot-token-1', 'copilot-token-2'])

    fetchSpy.mockRestore()
    vi.useRealTimers()
  })

  it('runs a full streaming turn through the default transport when a resolver is supplied', async () => {
    const fixed = 1_700_000_000_000
    vi.useFakeTimers()
    vi.setSystemTime(fixed)
    const resolver = vi.fn(async (): Promise<CopilotSessionToken> => ({
      token: 'copilot-token-A',
      expiresAt: Math.floor(fixed / 1000) + 300,
      chatEndpoint: 'https://copilot.example/chat/completions',
    }))

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      sseResponse([
        JSON.stringify({ choices: [{ index: 0, delta: { content: 'ok' } }] }),
        JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }),
        JSON.stringify({ usage: { prompt_tokens: 1, completion_tokens: 1 } }),
        '[DONE]',
      ]),
    )

    const provider = new CopilotProvider({ sessionTokenResolver: resolver })
    const events = []
    for await (const ev of provider.stream(
      [{ role: 'user', content: 'hi' }],
      [],
      { systemPrompt: 'sys' },
    )) events.push(ev)
    expect(resolver).toHaveBeenCalledTimes(1)
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const [calledUrl, init] = fetchSpy.mock.calls[0] as [string, RequestInit]
    expect(calledUrl).toBe('https://copilot.example/chat/completions')
    const headers = init.headers as Record<string, string>
    expect(headers.Authorization).toBe('Bearer copilot-token-A')
    expect(headers['Editor-Version']).toBeDefined()
    expect(headers['Copilot-Integration-Id']).toBe('vscode-chat')
    // Copilot strips stream_options.
    const sent = JSON.parse(init.body as string)
    expect(sent.stream_options).toBeUndefined()
    expect(events.at(-1)?.type).toBe('done')

    fetchSpy.mockRestore()
    vi.useRealTimers()
  })
})
