import { describe, it, expect } from 'vitest'
import {
  buildChatCompletionsRequest,
  iterateChatCompletionsStream,
  type ChatCompletionsRequest,
} from '../chat-completions'
import type { ProviderEvent, ProviderMessage, ProviderTool } from '../provider'

const TOOLS: ProviderTool[] = [
  {
    name: 'annotask_apply',
    description: 'Apply a task',
    inputSchema: { type: 'object', properties: { taskId: { type: 'string' } } },
  },
]

async function collect(stream: AsyncIterable<ProviderEvent>): Promise<ProviderEvent[]> {
  const out: ProviderEvent[] = []
  for await (const ev of stream) out.push(ev)
  return out
}

function sseStream(frames: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  return new ReadableStream({
    start(controller) {
      for (const frame of frames) controller.enqueue(encoder.encode(frame))
      controller.close()
    },
  })
}

describe('buildChatCompletionsRequest', () => {
  it('prefixes the system prompt as a system-role message', () => {
    const body = buildChatCompletionsRequest(
      [{ role: 'user', content: 'hi' }],
      [],
      { systemPrompt: 'SKILL' },
      { defaultModel: 'gpt-4o-mini', defaultMaxTokens: 1024 },
    )
    expect(body.messages[0]).toEqual({ role: 'system', content: 'SKILL' })
    expect(body.messages[1]).toEqual({ role: 'user', content: 'hi' })
    expect(body.stream).toBe(true)
    expect(body.stream_options).toEqual({ include_usage: true })
  })

  it('maps tools to the chat.completions function schema', () => {
    const body = buildChatCompletionsRequest(
      [{ role: 'user', content: 'go' }],
      TOOLS,
      { systemPrompt: 's' },
      { defaultModel: 'gpt-4o-mini', defaultMaxTokens: 1024 },
    )
    expect(body.tools).toEqual([
      {
        type: 'function',
        function: {
          name: 'annotask_apply',
          description: 'Apply a task',
          parameters: { type: 'object', properties: { taskId: { type: 'string' } } },
        },
      },
    ])
  })

  it('splits assistant tool_use blocks into a tool_calls field and tool_result into role:tool messages', () => {
    const messages: ProviderMessage[] = [
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'Applying.' },
          { type: 'tool_use', id: 'tu_1', name: 'annotask_apply', input: { taskId: 't_1' } },
        ],
      },
      {
        role: 'user',
        content: [
          { type: 'tool_result', toolUseId: 'tu_1', content: '{"ok":true}' },
          { type: 'text', text: 'Anything else?' },
        ],
      },
    ]
    const body = buildChatCompletionsRequest(
      messages,
      [],
      { systemPrompt: 's' },
      { defaultModel: 'gpt-4o-mini', defaultMaxTokens: 1024 },
    )
    // [0] is the system prompt
    expect(body.messages[1]).toEqual({
      role: 'assistant',
      content: 'Applying.',
      tool_calls: [
        {
          id: 'tu_1',
          type: 'function',
          function: { name: 'annotask_apply', arguments: '{"taskId":"t_1"}' },
        },
      ],
    })
    // tool_result must be its own role:'tool' message — and any user text in
    // the same provider message stays as a separate role:'user' entry.
    expect(body.messages[2]).toEqual({ role: 'user', content: 'Anything else?' })
    expect(body.messages[3]).toEqual({
      role: 'tool',
      tool_call_id: 'tu_1',
      content: '{"ok":true}',
    })
  })

  it('prefixes tool errors with ERROR: so the model sees the failure surface', () => {
    const body = buildChatCompletionsRequest(
      [
        {
          role: 'user',
          content: [{ type: 'tool_result', toolUseId: 'tu_x', content: 'boom', isError: true }],
        },
      ],
      [],
      { systemPrompt: 's' },
      { defaultModel: 'gpt-4o-mini', defaultMaxTokens: 1024 },
    )
    expect(body.messages[1]).toEqual({
      role: 'tool',
      tool_call_id: 'tu_x',
      content: 'ERROR: boom',
    })
  })
})

describe('iterateChatCompletionsStream', () => {
  it('reassembles tool_call arguments across chunks split mid-JSON', async () => {
    const frames = [
      'data: {"choices":[{"index":0,"delta":{"content":"Hi "}}]}\n',
      'data: {"choices":[{"index":0,"delta":{"content":"there."}}]}\n',
      'data: {"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"call_1","type":"function","function":{"name":"annotask_apply","arguments":"{\\"task"}}]}}]}\n',
      'data: {"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"Id\\":\\"t_1\\"}"}}]}}]}\n',
      'data: {"choices":[{"index":0,"delta":{},"finish_reason":"tool_calls"}]}\n',
      'data: {"usage":{"prompt_tokens":12,"completion_tokens":7}}\n',
      'data: [DONE]\n',
    ]
    const out = await collect(iterateChatCompletionsStream(sseStream(frames)))
    const texts = out.filter(e => e.type === 'text').map(e => (e as { text: string }).text)
    expect(texts.join('')).toBe('Hi there.')

    const calls = out.filter(e => e.type === 'tool_call')
    expect(calls).toEqual([
      { type: 'tool_call', id: 'call_1', name: 'annotask_apply', input: { taskId: 't_1' } },
    ])

    const usage = out.find(e => e.type === 'usage') as Extract<ProviderEvent, { type: 'usage' }>
    expect(usage).toMatchObject({ type: 'usage', inputTokens: 12, outputTokens: 7 })
    expect(out[out.length - 1]).toMatchObject({ type: 'done' })
  })

  it('honors mid-stream abort and stops yielding events', async () => {
    const encoder = new TextEncoder()
    const controller = new AbortController()
    let firstPullDone = false
    const body = new ReadableStream<Uint8Array>({
      async pull(c) {
        if (!firstPullDone) {
          firstPullDone = true
          c.enqueue(encoder.encode('data: {"choices":[{"index":0,"delta":{"content":"partial"}}]}\n'))
          // Abort *after* yielding the first chunk so the iterator has time
          // to surface "partial" before the signal kills the loop.
          controller.abort()
          return
        }
        // These chunks must never reach the consumer.
        c.enqueue(encoder.encode('data: {"choices":[{"index":0,"delta":{"content":"after-abort"}}]}\n'))
        c.enqueue(encoder.encode('data: [DONE]\n'))
        c.close()
      },
    })
    const out = await collect(iterateChatCompletionsStream(body, controller.signal))
    const texts = out.filter(e => e.type === 'text').map(e => (e as { text: string }).text)
    expect(texts).toEqual(['partial'])
    expect(out[out.length - 1]).toMatchObject({ type: 'done', stopReason: 'aborted' })
  })

  it('surfaces malformed tool arguments as an error event but still terminates', async () => {
    const frames = [
      'data: {"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"call_1","type":"function","function":{"name":"x","arguments":"{not json"}}]}}]}\n',
      'data: {"choices":[{"index":0,"delta":{},"finish_reason":"tool_calls"}]}\n',
      'data: [DONE]\n',
    ]
    const out = await collect(iterateChatCompletionsStream(sseStream(frames)))
    const err = out.find(e => e.type === 'error')
    expect(err).toBeDefined()
    expect((err as { error: string }).error).toMatch(/Malformed tool input/)
    expect(out[out.length - 1]).toMatchObject({ type: 'done' })
  })

  it('handles SSE frames split across reader boundaries', async () => {
    // First write delivers only half of a JSON payload — the parser must
    // wait for the next chunk before attempting to parse.
    const frames = [
      'data: {"choices":[{"index":0,"delta":{"content":"chu',
      'nked"}}]}\n',
      'data: [DONE]\n',
    ]
    const out = await collect(iterateChatCompletionsStream(sseStream(frames)))
    const texts = out.filter(e => e.type === 'text').map(e => (e as { text: string }).text)
    expect(texts.join('')).toBe('chunked')
  })
})

describe('buildChatCompletionsRequest model + max_tokens', () => {
  it('honors caller-provided model and maxTokens', () => {
    const body: ChatCompletionsRequest = buildChatCompletionsRequest(
      [{ role: 'user', content: 'hi' }],
      [],
      { systemPrompt: 's', model: 'gpt-4o', maxTokens: 256 },
      { defaultModel: 'gpt-4o-mini', defaultMaxTokens: 1024 },
    )
    expect(body.model).toBe('gpt-4o')
    expect(body.max_tokens).toBe(256)
  })
})
