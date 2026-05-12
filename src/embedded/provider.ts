/**
 * Embedded-agent LLM provider interface.
 *
 * One concrete implementation today (`AnthropicProvider`). OpenAI and Gemini
 * implementations will land later without changing callers. The shape is
 * intentionally minimal — just enough to drive a tool-using loop and a
 * streaming UI on top.
 */

export type ProviderRole = 'user' | 'assistant'

export type ProviderContentBlock =
  | { type: 'text', text: string }
  | { type: 'tool_use', id: string, name: string, input: unknown }
  | { type: 'tool_result', toolUseId: string, content: string, isError?: boolean }

export interface ProviderMessage {
  role: ProviderRole
  /** String form is shorthand for `[{ type: 'text', text }]`. Use the block
   *  form for assistant messages that include tool calls and for tool results. */
  content: string | ProviderContentBlock[]
}

export interface ProviderTool {
  name: string
  description: string
  /** JSON Schema for the tool's input. Matches the MCP tool definition shape
   *  so the same tool catalog can feed both surfaces without translation. */
  inputSchema: Record<string, unknown>
}

export interface StreamOptions {
  /** System prompt. Loaded by callers from the shared skills loader. */
  systemPrompt: string
  /** When true, mark the system prompt block as cacheable. Anthropic-only
   *  today; other providers should ignore. */
  cacheSystemPrompt?: boolean
  /** Provider-specific model id. Each provider picks a default when omitted. */
  model?: string
  /** Max tokens to generate. */
  maxTokens?: number
  /** Caller's abort signal. Providers must terminate the stream when it fires. */
  signal?: AbortSignal
}

export type ProviderEvent =
  /** Streaming text from the assistant. Multiple `text` events compose. */
  | { type: 'text', text: string }
  /** A complete tool call ready to dispatch. Emitted once the model has
   *  finished assembling the tool's JSON input. */
  | { type: 'tool_call', id: string, name: string, input: unknown }
  /** End-of-message usage counters. Cache-token fields are populated when the
   *  provider exposes them (Anthropic does). */
  | {
      type: 'usage'
      inputTokens: number
      outputTokens: number
      cacheReadTokens?: number
      cacheCreationTokens?: number
    }
  /** Terminal event for the stream. `stopReason` is provider-specific. */
  | { type: 'done', stopReason?: string }
  /** Non-fatal error surfaced through the stream rather than thrown. The
   *  runner decides whether to retry, abort, or surface to the user. */
  | { type: 'error', error: string }

export interface LLMProvider {
  /** Stable identifier for telemetry and UI labels (`'anthropic'`, …). */
  readonly name: string

  /**
   * Stream a single assistant turn given the conversation so far and the tool
   * catalog. Implementations MUST:
   * - emit `text` events in arrival order,
   * - emit at most one `tool_call` event per tool the model requests,
   * - emit exactly one `usage` event (when the provider reports it) and one
   *   `done` event,
   * - honor `options.signal` and stop promptly when aborted.
   */
  stream(
    messages: ProviderMessage[],
    tools: ProviderTool[],
    options: StreamOptions,
  ): AsyncIterable<ProviderEvent>
}
