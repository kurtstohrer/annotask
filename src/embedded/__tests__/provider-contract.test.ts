/**
 * Shared LLMProvider contract suite. Every provider implementation is
 * exercised against the same scripted conversation:
 *   1. Streams partial text in two chunks.
 *   2. Emits one tool_call with parsed JSON input.
 *   3. Reports prompt + completion token usage.
 *   4. Closes with a terminal `done` event.
 *
 * Each provider supplies a fake transport/client that produces the same
 * underlying event sequence in its native wire format. If any provider drops
 * a required event, this suite fails before we ship it.
 */

import { describe, it, expect } from 'vitest'
import type {
  LLMProvider,
  ProviderEvent,
  ProviderMessage,
  ProviderTool,
} from '../provider'
import {
  AnthropicProvider,
  type AnthropicClientLike,
  type AnthropicStreamEvent,
} from '../anthropic-provider'
import { OpenAIProvider } from '../openai-provider'
import { OpenAICompatibleProvider } from '../openai-compatible-provider'
import { CopilotProvider } from '../copilot-provider'
import { PaperclipProvider } from '../paperclip-provider'

const TOOLS: ProviderTool[] = [
  {
    name: 'annotask_apply',
    description: 'Apply a pending task',
    inputSchema: { type: 'object', properties: { taskId: { type: 'string' } } },
  },
]

const MESSAGES: ProviderMessage[] = [
  { role: 'user', content: 'Apply the pending design task.' },
]

async function collect(stream: AsyncIterable<ProviderEvent>): Promise<ProviderEvent[]> {
  const out: ProviderEvent[] = []
  for await (const ev of stream) out.push(ev)
  return out
}

/** Anthropic fake client emits the contract events in Anthropic wire format. */
function makeAnthropicClient(): AnthropicClientLike {
  const events: AnthropicStreamEvent[] = [
    {
      type: 'message_start',
      message: { usage: { input_tokens: 42, output_tokens: 1 } },
    },
    { type: 'content_block_start', index: 0, content_block: { type: 'text' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hello ' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'world.' } },
    { type: 'content_block_stop', index: 0 },
    {
      type: 'content_block_start',
      index: 1,
      content_block: { type: 'tool_use', id: 'tu_1', name: 'annotask_apply' },
    },
    {
      type: 'content_block_delta',
      index: 1,
      delta: { type: 'input_json_delta', partial_json: '{"taskId":"t_1"}' },
    },
    { type: 'content_block_stop', index: 1 },
    {
      type: 'message_delta',
      delta: { stop_reason: 'tool_use' },
      usage: { output_tokens: 13 },
    },
    { type: 'message_stop' },
  ]
  return {
    messages: {
      stream() {
        return (async function* () { for (const e of events) yield e })()
      },
    },
  }
}

/** Build an SSE Response that mimics an OpenAI chat.completions stream. */
function makeChatCompletionsResponse(): Response {
  const lines = [
    JSON.stringify({ choices: [{ index: 0, delta: { role: 'assistant', content: 'Hello ' } }] }),
    JSON.stringify({ choices: [{ index: 0, delta: { content: 'world.' } }] }),
    JSON.stringify({
      choices: [{
        index: 0,
        delta: {
          tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name: 'annotask_apply', arguments: '{"taskId":' } }],
        },
      }],
    }),
    JSON.stringify({
      choices: [{
        index: 0,
        delta: {
          tool_calls: [{ index: 0, function: { arguments: '"t_1"}' } }],
        },
      }],
    }),
    JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] }),
    JSON.stringify({ usage: { prompt_tokens: 42, completion_tokens: 13 } }),
    '[DONE]',
  ]
  const sse = lines.map(l => `data: ${l}\n\n`).join('')
  return new Response(sse, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  })
}

interface Variant {
  name: string
  build: () => LLMProvider
}

const VARIANTS: Variant[] = [
  {
    name: 'AnthropicProvider',
    build: () => new AnthropicProvider({ client: makeAnthropicClient(), defaultModel: 'claude-test' }),
  },
  {
    name: 'OpenAIProvider',
    build: () => new OpenAIProvider({
      apiKey: 'sk-test',
      transport: async () => makeChatCompletionsResponse(),
    }),
  },
  {
    name: 'OpenAICompatibleProvider',
    build: () => new OpenAICompatibleProvider({
      baseURL: 'http://localhost:11434/v1',
      defaultModel: 'llama3.1',
      transport: async () => makeChatCompletionsResponse(),
    }),
  },
  {
    name: 'CopilotProvider',
    build: () => new CopilotProvider({
      // The transport-injection path bypasses the OAuth/session exchange.
      transport: async () => makeChatCompletionsResponse(),
    }),
  },
  {
    name: 'PaperclipProvider',
    build: () => new PaperclipProvider({
      endpoint: 'https://paperclip.example/api/chat/completions',
      apiKey: 'pc-test',
      transport: async () => makeChatCompletionsResponse(),
    }),
  },
]

describe('LLMProvider contract', () => {
  for (const variant of VARIANTS) {
    describe(variant.name, () => {
      it('streams text → tool_call → usage → done in arrival order', async () => {
        const provider = variant.build()
        const out = await collect(
          provider.stream(MESSAGES, TOOLS, { systemPrompt: 'SKILL BODY' }),
        )

        const texts = out
          .filter(e => e.type === 'text')
          .map(e => (e as { type: 'text', text: string }).text)
        expect(texts.join('')).toBe('Hello world.')

        const toolCalls = out.filter(e => e.type === 'tool_call')
        expect(toolCalls).toHaveLength(1)
        expect(toolCalls[0]).toMatchObject({
          type: 'tool_call',
          name: 'annotask_apply',
          input: { taskId: 't_1' },
        })

        const usage = out.find(e => e.type === 'usage') as Extract<ProviderEvent, { type: 'usage' }>
        expect(usage).toBeDefined()
        expect(usage.inputTokens).toBe(42)
        expect(usage.outputTokens).toBe(13)

        expect(out[out.length - 1]?.type).toBe('done')

        // Event ordering invariant: every text precedes its tool_call,
        // tool_calls precede usage, usage precedes done.
        const order = out.map(e => e.type)
        const lastText = order.lastIndexOf('text')
        const firstToolCall = order.indexOf('tool_call')
        const usageIdx = order.indexOf('usage')
        const doneIdx = order.indexOf('done')
        expect(lastText).toBeLessThan(firstToolCall)
        expect(firstToolCall).toBeLessThan(usageIdx)
        expect(usageIdx).toBeLessThan(doneIdx)
      })

      it('aborts cleanly when the signal is already fired', async () => {
        const provider = variant.build()
        const controller = new AbortController()
        controller.abort()
        const out = await collect(
          provider.stream(MESSAGES, TOOLS, {
            systemPrompt: 'SKILL BODY',
            signal: controller.signal,
          }),
        )
        // We don't require the same exact event count, but the stream must
        // terminate with a done event and emit no further events after.
        const doneIdx = out.findIndex(e => e.type === 'done')
        expect(doneIdx).toBeGreaterThanOrEqual(0)
        expect(doneIdx).toBe(out.length - 1)
      })

      it('exposes a stable provider name', () => {
        const provider = variant.build()
        expect(typeof provider.name).toBe('string')
        expect(provider.name.length).toBeGreaterThan(0)
      })
    })
  }
})
