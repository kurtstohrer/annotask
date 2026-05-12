import type {
  LLMProvider,
  ProviderMessage,
  ProviderTool,
  StreamOptions,
  ProviderEvent,
  ProviderContentBlock,
} from './provider.js'

/** The slice of the official `@anthropic-ai/sdk` we depend on. Kept narrow so
 *  the SDK can stay a peer/optional dependency and tests can inject a fake. */
export interface AnthropicClientLike {
  messages: {
    stream(params: AnthropicCreateParams): AsyncIterable<AnthropicStreamEvent>
  }
}

export interface AnthropicCreateParams {
  model: string
  max_tokens: number
  system: AnthropicSystem
  messages: AnthropicMessage[]
  tools?: AnthropicTool[]
  metadata?: Record<string, unknown>
}

export type AnthropicSystem =
  | string
  | Array<{
      type: 'text'
      text: string
      cache_control?: { type: 'ephemeral' }
    }>

export interface AnthropicMessage {
  role: 'user' | 'assistant'
  content: AnthropicContentBlock[] | string
}

export type AnthropicContentBlock =
  | { type: 'text', text: string }
  | { type: 'tool_use', id: string, name: string, input: unknown }
  | {
      type: 'tool_result'
      tool_use_id: string
      content: string | Array<{ type: 'text', text: string }>
      is_error?: boolean
    }

export interface AnthropicTool {
  name: string
  description: string
  input_schema: Record<string, unknown>
}

/** Loose typing for the streaming protocol — SDK ships strict types but we
 *  only need a structural subset and want to stay decoupled from version
 *  bumps. */
export type AnthropicStreamEvent =
  | {
      type: 'message_start'
      message: {
        usage?: {
          input_tokens?: number
          output_tokens?: number
          cache_creation_input_tokens?: number
          cache_read_input_tokens?: number
        }
      }
    }
  | {
      type: 'content_block_start'
      index: number
      content_block:
        | { type: 'text', text?: string }
        | { type: 'tool_use', id: string, name: string, input?: unknown }
    }
  | {
      type: 'content_block_delta'
      index: number
      delta:
        | { type: 'text_delta', text: string }
        | { type: 'input_json_delta', partial_json: string }
    }
  | { type: 'content_block_stop', index: number }
  | {
      type: 'message_delta'
      delta: { stop_reason?: string | null }
      usage?: { output_tokens?: number }
    }
  | { type: 'message_stop' }

export interface AnthropicProviderOptions {
  /** Caller-supplied API key. BYOK only — the embedded runner never injects a
   *  shared key on the user's behalf. */
  apiKey?: string
  /** Override the default model. */
  defaultModel?: string
  /** Inject a pre-built SDK client. Tests use this to swap in a fake; the
   *  embedded runner uses it to share a long-lived client across runs. */
  client?: AnthropicClientLike
  /** Maximum tokens to generate when the caller omits `options.maxTokens`. */
  defaultMaxTokens?: number
}

const DEFAULT_MODEL = 'claude-sonnet-4-5'
const DEFAULT_MAX_TOKENS = 4096

/**
 * Concrete `LLMProvider` for Anthropic Messages API.
 *
 * - Streams text + tool calls + usage in arrival order.
 * - Marks the system prompt block with `cache_control: ephemeral` when
 *   `options.cacheSystemPrompt` is true so the shared skill content stays in
 *   the prompt cache across calls.
 * - Lazy-loads the SDK so consumers that only use the MCP surface don't have
 *   to install `@anthropic-ai/sdk`.
 */
export class AnthropicProvider implements LLMProvider {
  readonly name = 'anthropic'
  private readonly defaultModel: string
  private readonly defaultMaxTokens: number
  private clientPromise: Promise<AnthropicClientLike> | null = null

  constructor(private readonly opts: AnthropicProviderOptions = {}) {
    this.defaultModel = opts.defaultModel ?? DEFAULT_MODEL
    this.defaultMaxTokens = opts.defaultMaxTokens ?? DEFAULT_MAX_TOKENS
  }

  private async getClient(): Promise<AnthropicClientLike> {
    if (this.opts.client) return this.opts.client
    if (!this.clientPromise) {
      this.clientPromise = loadSdkClient(this.opts.apiKey)
    }
    return this.clientPromise
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

    const client = await this.getClient()
    const params = buildAnthropicRequest(messages, tools, options, {
      defaultModel: this.defaultModel,
      defaultMaxTokens: this.defaultMaxTokens,
    })

    const stream = client.messages.stream(params)
    yield* iterateAnthropicStream(stream, options.signal)
  }
}

/**
 * Build the Anthropic request body. Exposed for unit testing so the
 * cache-control marker placement can be asserted without spinning up a fake
 * stream.
 */
export function buildAnthropicRequest(
  messages: ProviderMessage[],
  tools: ProviderTool[],
  options: StreamOptions,
  defaults: { defaultModel: string, defaultMaxTokens: number },
): AnthropicCreateParams {
  const system: AnthropicSystem = options.cacheSystemPrompt
    ? [{
        type: 'text',
        text: options.systemPrompt,
        cache_control: { type: 'ephemeral' },
      }]
    : options.systemPrompt

  return {
    model: options.model ?? defaults.defaultModel,
    max_tokens: options.maxTokens ?? defaults.defaultMaxTokens,
    system,
    messages: messages.map(toAnthropicMessage),
    tools: tools.length > 0 ? tools.map(toAnthropicTool) : undefined,
  }
}

function toAnthropicTool(tool: ProviderTool): AnthropicTool {
  return {
    name: tool.name,
    description: tool.description,
    input_schema: tool.inputSchema,
  }
}

function toAnthropicMessage(msg: ProviderMessage): AnthropicMessage {
  if (typeof msg.content === 'string') {
    return { role: msg.role, content: msg.content }
  }
  return { role: msg.role, content: msg.content.map(toAnthropicBlock) }
}

function toAnthropicBlock(block: ProviderContentBlock): AnthropicContentBlock {
  switch (block.type) {
    case 'text':
      return { type: 'text', text: block.text }
    case 'tool_use':
      return { type: 'tool_use', id: block.id, name: block.name, input: block.input }
    case 'tool_result':
      return {
        type: 'tool_result',
        tool_use_id: block.toolUseId,
        content: block.content,
        is_error: block.isError,
      }
  }
}

/**
 * Translate the SDK's raw stream event protocol into ordered `ProviderEvent`s.
 * Exposed separately so the test suite can drive it with a synthetic event
 * sequence (no SDK or network required).
 */
export async function* iterateAnthropicStream(
  stream: AsyncIterable<AnthropicStreamEvent>,
  signal?: AbortSignal,
): AsyncIterable<ProviderEvent> {
  let inputTokens = 0
  let outputTokens = 0
  let cacheReadTokens: number | undefined
  let cacheCreationTokens: number | undefined
  let stopReason: string | undefined
  const toolCalls = new Map<number, { id: string, name: string, jsonBuffer: string }>()

  try {
    for await (const event of stream) {
      if (signal?.aborted) {
        stopReason = 'aborted'
        break
      }

      switch (event.type) {
        case 'message_start': {
          const u = event.message?.usage
          if (u) {
            if (typeof u.input_tokens === 'number') inputTokens = u.input_tokens
            if (typeof u.output_tokens === 'number') outputTokens = u.output_tokens
            if (typeof u.cache_read_input_tokens === 'number') cacheReadTokens = u.cache_read_input_tokens
            if (typeof u.cache_creation_input_tokens === 'number') cacheCreationTokens = u.cache_creation_input_tokens
          }
          break
        }
        case 'content_block_start': {
          if (event.content_block.type === 'tool_use') {
            toolCalls.set(event.index, {
              id: event.content_block.id,
              name: event.content_block.name,
              jsonBuffer: '',
            })
          }
          break
        }
        case 'content_block_delta': {
          if (event.delta.type === 'text_delta') {
            yield { type: 'text', text: event.delta.text }
          } else if (event.delta.type === 'input_json_delta') {
            const tc = toolCalls.get(event.index)
            if (tc) tc.jsonBuffer += event.delta.partial_json
          }
          break
        }
        case 'content_block_stop': {
          const tc = toolCalls.get(event.index)
          if (tc) {
            let input: unknown = {}
            if (tc.jsonBuffer.length > 0) {
              try { input = JSON.parse(tc.jsonBuffer) }
              catch (err) {
                yield {
                  type: 'error',
                  error: `Malformed tool input for ${tc.name}: ${(err as Error).message}`,
                }
                toolCalls.delete(event.index)
                break
              }
            }
            yield { type: 'tool_call', id: tc.id, name: tc.name, input }
            toolCalls.delete(event.index)
          }
          break
        }
        case 'message_delta': {
          if (event.delta?.stop_reason) stopReason = event.delta.stop_reason
          if (typeof event.usage?.output_tokens === 'number') {
            outputTokens = event.usage.output_tokens
          }
          break
        }
        case 'message_stop': {
          // Final emission handled outside the loop.
          break
        }
      }
    }
  } catch (err) {
    yield { type: 'error', error: (err as Error).message ?? String(err) }
    yield { type: 'done', stopReason: stopReason ?? 'error' }
    return
  }

  yield {
    type: 'usage',
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheCreationTokens,
  }
  yield { type: 'done', stopReason }
}

async function loadSdkClient(apiKey: string | undefined): Promise<AnthropicClientLike> {
  // The SDK is a peer/optional dep — surface a helpful error when it's not
  // installed rather than the raw module-resolution failure.
  let mod: any
  try {
    mod = await import('@anthropic-ai/sdk')
  } catch (err) {
    throw new Error(
      '[annotask] @anthropic-ai/sdk is not installed. Run `npm install @anthropic-ai/sdk` to enable the embedded agent.',
    )
  }
  const Anthropic = mod?.default ?? mod?.Anthropic
  if (typeof Anthropic !== 'function') {
    throw new Error('[annotask] Loaded @anthropic-ai/sdk but no usable default/Anthropic export.')
  }
  return new Anthropic({ apiKey }) as AnthropicClientLike
}
