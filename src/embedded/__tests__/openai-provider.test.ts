import { describe, it, expect } from 'vitest'
import { OpenAIProvider } from '../openai-provider'
import type { ChatCompletionsRequest } from '../chat-completions'

function sseResponse(frames: string[]): Response {
  return new Response(frames.map(f => `data: ${f}\n\n`).join(''), {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  })
}

describe('OpenAIProvider', () => {
  it('drives the injected transport and falls back to gpt-4o-mini as default model', async () => {
    let captured: { body: ChatCompletionsRequest } | null = null
    const provider = new OpenAIProvider({
      apiKey: 'sk-test',
      transport: async (body) => {
        captured = { body }
        return sseResponse([
          JSON.stringify({ choices: [{ index: 0, delta: { content: 'ok' } }] }),
          JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }),
          JSON.stringify({ usage: { prompt_tokens: 1, completion_tokens: 1 } }),
          '[DONE]',
        ])
      },
    })

    const events = []
    for await (const ev of provider.stream(
      [{ role: 'user', content: 'hi' }],
      [],
      { systemPrompt: 'sys' },
    )) events.push(ev)

    expect(captured).not.toBeNull()
    expect(captured!.body.model).toBe('gpt-4o-mini')
    expect(captured!.body.stream).toBe(true)
    expect(events.map(e => e.type)).toContain('text')
    expect(events[events.length - 1].type).toBe('done')
  })

  it('surfaces a structured error event when the transport returns non-2xx', async () => {
    const provider = new OpenAIProvider({
      apiKey: 'sk-test',
      transport: async () => new Response('rate limit', { status: 429 }),
    })
    const events = []
    for await (const ev of provider.stream(
      [{ role: 'user', content: 'hi' }],
      [],
      { systemPrompt: 'sys' },
    )) events.push(ev)
    const err = events.find(e => e.type === 'error')
    expect(err).toBeDefined()
    expect((err as { error: string }).error).toMatch(/HTTP 429/)
    expect(events[events.length - 1]).toMatchObject({ type: 'done', stopReason: 'error' })
  })

  it('refuses to send when apiKey is missing and no transport is injected', async () => {
    const provider = new OpenAIProvider({})
    const events = []
    for await (const ev of provider.stream(
      [{ role: 'user', content: 'hi' }],
      [],
      { systemPrompt: 'sys' },
    )) events.push(ev)
    const err = events.find(e => e.type === 'error')
    expect(err).toBeDefined()
    expect((err as { error: string }).error).toMatch(/apiKey/)
  })
})
