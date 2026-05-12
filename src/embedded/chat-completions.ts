/**
 * Shared OpenAI-style Chat Completions streaming layer.
 *
 * OpenAI, OpenAI-compatible local endpoints (opencode/Ollama/LM Studio/vLLM),
 * and GitHub Copilot all speak the same `POST /chat/completions` wire format.
 * Providers differ only in:
 *   - base URL,
 *   - auth headers,
 *   - a few defaults (model id, max tokens),
 *   - and minor request-body tweaks (e.g. Copilot's editor headers).
 *
 * The transport abstraction below is what each provider plugs in to drive the
 * shared request builder and SSE event parser without re-implementing them.
 */

import type {
  LLMProvider,
  ProviderMessage,
  ProviderTool,
  ProviderEvent,
  ProviderContentBlock,
  StreamOptions,
} from './provider.js'

export interface ChatCompletionsTool {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: Record<string, unknown>
  }
}

export interface ChatCompletionsToolCall {
  id: string
  type: 'function'
  function: { name: string, arguments: string }
}

export interface ChatCompletionsMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content?: string | null
  name?: string
  tool_calls?: ChatCompletionsToolCall[]
  tool_call_id?: string
}

export interface ChatCompletionsRequest {
  model: string
  messages: ChatCompletionsMessage[]
  tools?: ChatCompletionsTool[]
  max_tokens?: number
  stream: true
  stream_options?: { include_usage?: boolean }
  /** Provider-specific extras (e.g. opencode's `top_p`). */
  [extra: string]: unknown
}

/** A streamed chat.completions chunk — narrowed to fields we read. */
export interface ChatCompletionsChunk {
  id?: string
  object?: string
  choices?: Array<{
    index?: number
    delta?: {
      role?: string
      content?: string | null
      tool_calls?: Array<{
        index?: number
        id?: string
        type?: 'function'
        function?: { name?: string, arguments?: string }
      }>
    }
    finish_reason?: string | null
  }>
  usage?: {
    prompt_tokens?: number
    completion_tokens?: number
    total_tokens?: number
  } | null
}

/**
 * A transport runs the HTTP call. Providers supply one of these; tests inject
 * a fake that returns a synthetic SSE `Response`. Keeping it `fetch`-shaped
 * means we never have to take a hard dependency on the openai SDK just to use
 * the chat-completions wire format.
 */
export type ChatCompletionsTransport = (
  body: ChatCompletionsRequest,
  signal?: AbortSignal,
) => Promise<Response>

export interface ChatCompletionsProviderConfig {
  /** Stable identifier for telemetry/UI labels. */
  name: string
  transport: ChatCompletionsTransport
  defaultModel: string
  defaultMaxTokens: number
  /** Hook to mutate the body just before send — e.g. add provider-specific
   *  knobs without forcing every provider to re-implement build. */
  shapeRequest?: (body: ChatCompletionsRequest) => ChatCompletionsRequest
}

/** Lowest-common-denominator LLMProvider backed by an OpenAI-style endpoint. */
export class ChatCompletionsProvider implements LLMProvider {
  readonly name: string

  constructor(private readonly cfg: ChatCompletionsProviderConfig) {
    this.name = cfg.name
  }

  async *stream(
    messages: ProviderMessage[],
    tools: ProviderTool[],
    options: StreamOptions,
  ): AsyncIterable<ProviderEvent> {
    if (options.signal?.aborted) {
      yield { type: 'done', stopReason: 'aborted' }
      return
    }

    let body = buildChatCompletionsRequest(messages, tools, options, {
      defaultModel: this.cfg.defaultModel,
      defaultMaxTokens: this.cfg.defaultMaxTokens,
    })
    if (this.cfg.shapeRequest) body = this.cfg.shapeRequest(body)

    let response: Response
    try {
      response = await this.cfg.transport(body, options.signal)
    } catch (err) {
      yield { type: 'error', error: (err as Error).message ?? String(err) }
      yield { type: 'done', stopReason: 'error' }
      return
    }

    if (!response.ok) {
      const text = await safeReadText(response)
      yield {
        type: 'error',
        error: `[${this.name}] HTTP ${response.status}: ${text || response.statusText}`,
      }
      yield { type: 'done', stopReason: 'error' }
      return
    }

    if (!response.body) {
      yield { type: 'error', error: `[${this.name}] response has no body` }
      yield { type: 'done', stopReason: 'error' }
      return
    }

    yield* iterateChatCompletionsStream(response.body, options.signal)
  }
}

/** Build a `chat.completions` request body from the provider-agnostic shape. */
export function buildChatCompletionsRequest(
  messages: ProviderMessage[],
  tools: ProviderTool[],
  options: StreamOptions,
  defaults: { defaultModel: string, defaultMaxTokens: number },
): ChatCompletionsRequest {
  const out: ChatCompletionsMessage[] = []
  if (options.systemPrompt) {
    out.push({ role: 'system', content: options.systemPrompt })
  }
  for (const msg of messages) out.push(...toChatCompletionsMessages(msg))

  return {
    model: options.model ?? defaults.defaultModel,
    messages: out,
    tools: tools.length > 0 ? tools.map(toChatCompletionsTool) : undefined,
    max_tokens: options.maxTokens ?? defaults.defaultMaxTokens,
    stream: true,
    // OpenAI only emits usage on the final chunk when this is set; ignored by
    // most compat servers but they tolerate the extra field.
    stream_options: { include_usage: true },
  }
}

function toChatCompletionsTool(tool: ProviderTool): ChatCompletionsTool {
  return {
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema,
    },
  }
}

/**
 * Translate one provider-agnostic message into one or more chat.completions
 * messages. A user message that carries `tool_result` blocks must be split
 * into one `role: 'tool'` entry per result, because that's how the OpenAI
 * schema represents it.
 */
function toChatCompletionsMessages(msg: ProviderMessage): ChatCompletionsMessage[] {
  if (typeof msg.content === 'string') {
    return [{ role: msg.role, content: msg.content }]
  }

  if (msg.role === 'assistant') {
    const text: string[] = []
    const toolCalls: ChatCompletionsToolCall[] = []
    for (const block of msg.content) {
      if (block.type === 'text') text.push(block.text)
      else if (block.type === 'tool_use') {
        toolCalls.push({
          id: block.id,
          type: 'function',
          function: { name: block.name, arguments: stringifyToolInput(block.input) },
        })
      }
    }
    const out: ChatCompletionsMessage = { role: 'assistant', content: text.join('') || null }
    if (toolCalls.length > 0) out.tool_calls = toolCalls
    return [out]
  }

  // user role: split tool_result blocks into role:'tool' entries
  const messages: ChatCompletionsMessage[] = []
  const userText: string[] = []
  for (const block of msg.content) {
    if (block.type === 'text') userText.push(block.text)
    else if (block.type === 'tool_result') {
      messages.push({
        role: 'tool',
        tool_call_id: block.toolUseId,
        content: block.isError ? `ERROR: ${block.content}` : block.content,
      })
    }
  }
  if (userText.length > 0) {
    messages.unshift({ role: 'user', content: userText.join('') })
  }
  return messages
}

function stringifyToolInput(input: unknown): string {
  if (typeof input === 'string') return input
  try { return JSON.stringify(input ?? {}) }
  catch { return '{}' }
}

async function safeReadText(response: Response): Promise<string> {
  try { return (await response.text()).slice(0, 1024) }
  catch { return '' }
}

/**
 * Parse an SSE-formatted chat.completions response stream into ordered
 * ProviderEvents. Exposed for tests so the chunk parser can be driven
 * directly off a synthetic ReadableStream without spinning up fetch.
 */
export async function* iterateChatCompletionsStream(
  body: ReadableStream<Uint8Array>,
  signal?: AbortSignal,
): AsyncIterable<ProviderEvent> {
  const decoder = new TextDecoder()
  const reader = body.getReader()
  let buffer = ''

  // Tool calls stream by `index` — we accumulate name + argument JSON across
  // many chunks before emitting a single `tool_call` event.
  const toolCalls = new Map<number, { id: string, name: string, argsBuffer: string }>()
  let inputTokens = 0
  let outputTokens = 0
  let stopReason: string | undefined
  let sawAnyChunk = false

  try {
    for (;;) {
      if (signal?.aborted) {
        stopReason = 'aborted'
        break
      }
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })

      let nl
      // SSE frames are separated by blank lines, but most chat.completions
      // implementations send one `data: ...\n` line per chunk — handle either.
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const rawLine = buffer.slice(0, nl).replace(/\r$/, '')
        buffer = buffer.slice(nl + 1)
        if (!rawLine) continue
        if (!rawLine.startsWith('data:')) continue

        const data = rawLine.slice(5).trim()
        if (!data) continue
        if (data === '[DONE]') {
          // [DONE] is OpenAI's terminator; usage chunk (if any) arrived first.
          buffer = ''
          break
        }

        let chunk: ChatCompletionsChunk
        try { chunk = JSON.parse(data) }
        catch (err) {
          yield {
            type: 'error',
            error: `Malformed chat.completions chunk: ${(err as Error).message}`,
          }
          continue
        }
        sawAnyChunk = true

        const choice = chunk.choices?.[0]
        if (choice?.delta?.content) {
          yield { type: 'text', text: choice.delta.content }
        }
        if (choice?.delta?.tool_calls) {
          for (const tc of choice.delta.tool_calls) {
            // OpenAI/Copilot send `index` on each chunk to disambiguate
            // simultaneous tool calls; vLLM/Ollama omit `index` and rely on
            // order — default to 0 then.
            const idx = typeof tc.index === 'number' ? tc.index : 0
            let entry = toolCalls.get(idx)
            if (!entry) {
              entry = { id: tc.id ?? '', name: tc.function?.name ?? '', argsBuffer: '' }
              toolCalls.set(idx, entry)
            }
            if (tc.id && !entry.id) entry.id = tc.id
            if (tc.function?.name && !entry.name) entry.name = tc.function.name
            if (typeof tc.function?.arguments === 'string') {
              entry.argsBuffer += tc.function.arguments
            }
          }
        }
        if (choice?.finish_reason) stopReason = choice.finish_reason
        if (chunk.usage) {
          if (typeof chunk.usage.prompt_tokens === 'number') inputTokens = chunk.usage.prompt_tokens
          if (typeof chunk.usage.completion_tokens === 'number') outputTokens = chunk.usage.completion_tokens
        }
      }
    }
  } catch (err) {
    yield { type: 'error', error: (err as Error).message ?? String(err) }
    yield { type: 'done', stopReason: stopReason ?? 'error' }
    try { await reader.cancel() } catch { /* ignore */ }
    return
  }

  // Drain accumulated tool calls in `index` order so callers receive them in
  // the same order the model produced them.
  const indices = [...toolCalls.keys()].sort((a, b) => a - b)
  for (const idx of indices) {
    const tc = toolCalls.get(idx)!
    let input: unknown = {}
    if (tc.argsBuffer.length > 0) {
      try { input = JSON.parse(tc.argsBuffer) }
      catch (err) {
        yield {
          type: 'error',
          error: `Malformed tool input for ${tc.name || '(anonymous)'}: ${(err as Error).message}`,
        }
        continue
      }
    }
    yield {
      type: 'tool_call',
      id: tc.id || `tool_${idx}`,
      name: tc.name,
      input,
    }
  }

  yield {
    type: 'usage',
    inputTokens,
    outputTokens,
  }
  yield {
    type: 'done',
    stopReason: stopReason ?? (sawAnyChunk ? undefined : 'empty'),
  }
}

/**
 * Convenience: build a `ChatCompletionsTransport` over `fetch`. Used by all
 * three OpenAI-flavored providers (OpenAI, OpenAICompatible, Copilot). Tests
 * skip this and inject their own transport.
 */
export function createFetchTransport(
  endpoint: string,
  buildHeaders: () => Promise<Record<string, string>> | Record<string, string>,
): ChatCompletionsTransport {
  return async (body, signal) => {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
      ...(await buildHeaders()),
    }
    return fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal,
    })
  }
}
