import { describe, it, expect } from 'vitest'
import {
  AnthropicProvider,
  buildAnthropicRequest,
  iterateAnthropicStream,
  type AnthropicClientLike,
  type AnthropicCreateParams,
  type AnthropicStreamEvent,
} from '../anthropic-provider'
import type { ProviderEvent, ProviderMessage, ProviderTool } from '../provider'

function makeFakeClient(events: AnthropicStreamEvent[]): {
  client: AnthropicClientLike
  captured: AnthropicCreateParams[]
} {
  const captured: AnthropicCreateParams[] = []
  const client: AnthropicClientLike = {
    messages: {
      stream(params) {
        captured.push(params)
        return (async function* () {
          for (const ev of events) yield ev
        })()
      },
    },
  }
  return { client, captured }
}

async function collect(stream: AsyncIterable<ProviderEvent>): Promise<ProviderEvent[]> {
  const out: ProviderEvent[] = []
  for await (const ev of stream) out.push(ev)
  return out
}

const SAMPLE_TOOLS: ProviderTool[] = [
  {
    name: 'annotask_get_tasks',
    description: 'List pending tasks',
    inputSchema: { type: 'object', properties: { status: { type: 'string' } } },
  },
]

const SAMPLE_MESSAGES: ProviderMessage[] = [
  { role: 'user', content: 'Apply pending tasks please.' },
]

describe('buildAnthropicRequest', () => {
  it('places cache_control on the system block when caching is requested', () => {
    const params = buildAnthropicRequest(
      SAMPLE_MESSAGES,
      SAMPLE_TOOLS,
      { systemPrompt: 'SKILL BODY', cacheSystemPrompt: true },
      { defaultModel: 'claude-test', defaultMaxTokens: 1024 },
    )

    expect(Array.isArray(params.system)).toBe(true)
    const blocks = params.system as Array<{ type: string, text: string, cache_control?: { type: string } }>
    expect(blocks).toHaveLength(1)
    expect(blocks[0]).toMatchObject({
      type: 'text',
      text: 'SKILL BODY',
      cache_control: { type: 'ephemeral' },
    })
  })

  it('passes the system prompt as a plain string when caching is disabled', () => {
    const params = buildAnthropicRequest(
      SAMPLE_MESSAGES,
      SAMPLE_TOOLS,
      { systemPrompt: 'SKILL BODY' },
      { defaultModel: 'claude-test', defaultMaxTokens: 1024 },
    )
    expect(typeof params.system).toBe('string')
    expect(params.system).toBe('SKILL BODY')
  })

  it('maps provider tools to Anthropic input_schema shape', () => {
    const params = buildAnthropicRequest(
      SAMPLE_MESSAGES,
      SAMPLE_TOOLS,
      { systemPrompt: 'x' },
      { defaultModel: 'claude-test', defaultMaxTokens: 1024 },
    )
    expect(params.tools).toEqual([
      {
        name: 'annotask_get_tasks',
        description: 'List pending tasks',
        input_schema: { type: 'object', properties: { status: { type: 'string' } } },
      },
    ])
  })

  it('translates tool_use / tool_result content blocks', () => {
    const params = buildAnthropicRequest(
      [
        {
          role: 'assistant',
          content: [
            { type: 'text', text: 'I will fetch tasks.' },
            { type: 'tool_use', id: 'tu_1', name: 'annotask_get_tasks', input: { status: 'pending' } },
          ],
        },
        {
          role: 'user',
          content: [
            { type: 'tool_result', toolUseId: 'tu_1', content: '{"tasks":[]}' },
          ],
        },
      ],
      [],
      { systemPrompt: 'x' },
      { defaultModel: 'claude-test', defaultMaxTokens: 1024 },
    )

    expect(params.messages[0].content).toEqual([
      { type: 'text', text: 'I will fetch tasks.' },
      { type: 'tool_use', id: 'tu_1', name: 'annotask_get_tasks', input: { status: 'pending' } },
    ])
    expect(params.messages[1].content).toEqual([
      { type: 'tool_result', tool_use_id: 'tu_1', content: '{"tasks":[]}', is_error: undefined },
    ])
  })

  it('omits the tools array when none are registered', () => {
    const params = buildAnthropicRequest(
      SAMPLE_MESSAGES,
      [],
      { systemPrompt: 'x' },
      { defaultModel: 'claude-test', defaultMaxTokens: 1024 },
    )
    expect(params.tools).toBeUndefined()
  })

  it('honors caller-provided model and max_tokens', () => {
    const params = buildAnthropicRequest(
      SAMPLE_MESSAGES,
      [],
      { systemPrompt: 'x', model: 'claude-opus-test', maxTokens: 256 },
      { defaultModel: 'claude-default', defaultMaxTokens: 1024 },
    )
    expect(params.model).toBe('claude-opus-test')
    expect(params.max_tokens).toBe(256)
  })
})

describe('iterateAnthropicStream', () => {
  it('emits text → tool_call → usage → done in order', async () => {
    const events: AnthropicStreamEvent[] = [
      {
        type: 'message_start',
        message: {
          usage: { input_tokens: 42, output_tokens: 1, cache_read_input_tokens: 30 },
        },
      },
      { type: 'content_block_start', index: 0, content_block: { type: 'text' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hello ' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'world.' } },
      { type: 'content_block_stop', index: 0 },
      {
        type: 'content_block_start',
        index: 1,
        content_block: { type: 'tool_use', id: 'tu_42', name: 'annotask_get_tasks' },
      },
      {
        type: 'content_block_delta',
        index: 1,
        delta: { type: 'input_json_delta', partial_json: '{"status":' },
      },
      {
        type: 'content_block_delta',
        index: 1,
        delta: { type: 'input_json_delta', partial_json: '"pending"}' },
      },
      { type: 'content_block_stop', index: 1 },
      { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 17 } },
      { type: 'message_stop' },
    ]

    const events$ = (async function* () { for (const ev of events) yield ev })()
    const out = await collect(iterateAnthropicStream(events$))

    expect(out).toEqual([
      { type: 'text', text: 'Hello ' },
      { type: 'text', text: 'world.' },
      { type: 'tool_call', id: 'tu_42', name: 'annotask_get_tasks', input: { status: 'pending' } },
      {
        type: 'usage',
        inputTokens: 42,
        outputTokens: 17,
        cacheReadTokens: 30,
        cacheCreationTokens: undefined,
      },
      { type: 'done', stopReason: 'tool_use' },
    ])
  })

  it('surfaces an error event for malformed tool input JSON', async () => {
    const events: AnthropicStreamEvent[] = [
      { type: 'message_start', message: { usage: { input_tokens: 1, output_tokens: 0 } } },
      {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'tool_use', id: 'tu_1', name: 'broken' },
      },
      {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'input_json_delta', partial_json: '{not json' },
      },
      { type: 'content_block_stop', index: 0 },
      { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 1 } },
      { type: 'message_stop' },
    ]
    const events$ = (async function* () { for (const ev of events) yield ev })()
    const out = await collect(iterateAnthropicStream(events$))
    const errEvent = out.find(e => e.type === 'error')
    expect(errEvent?.type).toBe('error')
    expect((errEvent as { type: 'error', error: string }).error).toMatch(/Malformed tool input/)
    expect(out.some(e => e.type === 'done')).toBe(true)
  })

  it('stops iterating when the abort signal fires before message_stop', async () => {
    const controller = new AbortController()
    const events: AnthropicStreamEvent[] = [
      { type: 'message_start', message: { usage: { input_tokens: 5 } } },
      { type: 'content_block_start', index: 0, content_block: { type: 'text' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'partial' } },
    ]
    async function* gen(): AsyncIterable<AnthropicStreamEvent> {
      for (const ev of events) {
        yield ev
        if (ev.type === 'content_block_delta') controller.abort()
      }
      // These would emit if abort were ignored.
      yield { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'after-abort' } }
      yield { type: 'message_stop' }
    }
    const out = await collect(iterateAnthropicStream(gen(), controller.signal))
    const texts = out.filter(e => e.type === 'text').map(e => (e as { text: string }).text)
    expect(texts).toEqual(['partial'])
    expect(out[out.length - 1]).toEqual({ type: 'done', stopReason: 'aborted' })
  })

  it('emits a single usage event even when message_delta carries no usage', async () => {
    const events: AnthropicStreamEvent[] = [
      {
        type: 'message_start',
        message: { usage: { input_tokens: 10, output_tokens: 1, cache_creation_input_tokens: 5 } },
      },
      { type: 'content_block_start', index: 0, content_block: { type: 'text' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'ok' } },
      { type: 'content_block_stop', index: 0 },
      { type: 'message_delta', delta: { stop_reason: 'end_turn' } },
      { type: 'message_stop' },
    ]
    const events$ = (async function* () { for (const ev of events) yield ev })()
    const out = await collect(iterateAnthropicStream(events$))
    const usage = out.find(e => e.type === 'usage') as Extract<ProviderEvent, { type: 'usage' }>
    expect(usage).toMatchObject({
      type: 'usage',
      inputTokens: 10,
      outputTokens: 1,
      cacheCreationTokens: 5,
    })
  })
})

describe('AnthropicProvider.stream', () => {
  it('drives the injected client and produces ordered ProviderEvents', async () => {
    const events: AnthropicStreamEvent[] = [
      { type: 'message_start', message: { usage: { input_tokens: 7 } } },
      { type: 'content_block_start', index: 0, content_block: { type: 'text' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'hi' } },
      { type: 'content_block_stop', index: 0 },
      { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 3 } },
      { type: 'message_stop' },
    ]
    const { client, captured } = makeFakeClient(events)
    const provider = new AnthropicProvider({ client, defaultModel: 'claude-test' })
    const out = await collect(
      provider.stream(SAMPLE_MESSAGES, SAMPLE_TOOLS, {
        systemPrompt: 'SKILL',
        cacheSystemPrompt: true,
      }),
    )

    expect(captured).toHaveLength(1)
    expect(captured[0].model).toBe('claude-test')
    expect(Array.isArray(captured[0].system)).toBe(true)
    const sysBlock = (captured[0].system as Array<{ cache_control?: { type: string } }>)[0]
    expect(sysBlock.cache_control).toEqual({ type: 'ephemeral' })

    expect(out.map(e => e.type)).toEqual(['text', 'usage', 'done'])
  })

  it('returns a single done event when the signal is already aborted', async () => {
    const { client } = makeFakeClient([])
    const provider = new AnthropicProvider({ client })
    const controller = new AbortController()
    controller.abort()
    const out = await collect(
      provider.stream([], [], { systemPrompt: 'x', signal: controller.signal }),
    )
    expect(out).toEqual([{ type: 'done', stopReason: 'aborted' }])
  })
})
